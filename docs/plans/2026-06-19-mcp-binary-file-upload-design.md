# MCP Binary File Upload — Design

**Date:** 2026-06-19
**Status:** Approved (brainstorm) — pending spec review
**Component:** `server/mcp-server` (JobTread MCP connector)

## Problem

Attaching a file through the connector currently forces the bytes through a
tool argument as a `data:` URI, i.e. **base64**. The connector runs server-side
and cannot read a local file by path; its only file inputs are a fetchable
`https://` URL or an inline `data:` URI. With nowhere to host the bytes
publicly, base64 is the only path — and it inflates payloads ~33% and pushes the
whole blob through a single tool argument, which is bulky, slow, and burns
context.

The bytes-to-server transfer is the only real bottleneck. JobTread's
`createUploadRequest` already returns a **single-use signed PUT URL**; once bytes
land there, the resulting `uploadRequestId` attaches cleanly (we just enabled
`jt_comment_write files:[{uploadRequestId}]`).

## Goals

- Give **code-capable** clients (Claude Code, Cursor, code-interpreter/computer-use)
  a way to upload **raw binary** — no base64.
- Keep a working, clean path for **pure-chat** clients (Claude.ai, ChatGPT
  connectors) that can only send text tool args — base64 is physically
  unavoidable there, but make it a single self-documenting op.
- Make one **upload handle** (`uploadRequestId`) attach uniformly across
  comments, documents, **daily logs**, and **cost items**.

## Non-goals

- Resumable / chunked uploads or R2 staging (YAGNI — the 25 MB single-shot path
  covers the real cases; revisit only if a >25 MB or resumable need appears).
- A direct presigned-PUT-to-JobTread handoff (considered; rejected in favor of
  the worker proxy, which is far more ergonomic for the client — no size math,
  no signed-header replication).
- Changing how pure-chat clients fundamentally move bytes (text channel ⇒ base64).

## Architecture

"Upload" and "attach" are two halves joined by JobTread's native single-use
`uploadRequestId`. Only **ingress** varies; **egress** is shared.

### Shared core

**`uploadBytesToJobTread(bytes, { contentType, name }, ctx)`** — extracted from
the existing `fetchAndUpload` in `writes/files-write.js`. Responsibilities:

1. Validate size (`> 0`, `<= 25 MB`).
2. `createUploadRequest({ organizationId: ctx.orgId, size, type: contentType })`
   → `{ id, url, method, headers }`.
3. PUT `bytes` to the signed `url` with `method`/`headers`.
4. Return `{ uploadRequestId, name, size, contentType }`.

`fetchAndUpload(fileUrl, fileName, ctx)` becomes a thin wrapper: fetch the URL →
derive contentType/name → `uploadBytesToJobTread`. No behavior change for
existing `upload` / `uploadToCostItem` / `prepareUploadFromUrls` callers.

### Ingress path 1 — binary, no base64 (code-capable)

**`POST /api/files/blob`** — new REST route, Bearer-authed exactly like other
`/api/*` endpoints (license_key:grant_key → ctx with orgId + pave).

- Reads: `Content-Type` (the file's MIME), `Content-Length` (size),
  `X-File-Name` header (filename; falls back to `?name=` query, then
  `upload.<ext-from-content-type>`).
- Buffers the request body (≤ 25 MB; chosen over streaming so the JobTread PUT
  has a known Content-Length and to match the existing helper — streaming is a
  possible future optimization).
- Calls `uploadBytesToJobTread`.
- Returns JSON `{ success: true, uploadRequestId, name, size, contentType }`.

Client usage:
```
curl -X POST https://mcp.jtpowertools.com/api/files/blob \
  -H "Authorization: Bearer <license_key>:<grant_key>" \
  -H "Content-Type: application/pdf" \
  -H "X-File-Name: forecast.pdf" \
  --data-binary @forecast.pdf
# → { "uploadRequestId": "...", "name": "forecast.pdf", "size": 81234 }
```
Then attach with any MCP tool that takes the handle.

### Ingress path 2 — base64, one clean call (pure-chat)

**`jt_files op:uploadBase64`** — new op. Params `{ dataBase64, name, contentType }`.
Decodes base64 → bytes → `uploadBytesToJobTread` → returns `{ uploadRequestId,
name, size, contentType }`. Decoded cap **10 MB** (base64 in a tool arg is
costly and large ones blow context); over-cap error steers the caller to
`/api/files/blob`. Invalid base64 → 400-style error response.

This is a clearer front door than hand-crafting a `data:` URI through
`upload`/`prepareUploadFromUrls` (which keep working unchanged).

### Egress — attach by handle, uniformly

The `uploadRequestId` (from any ingress path) attaches to:

- **Comments** — `jt_comment_write files:[{uploadRequestId?, id?, name?}]`
  (shipped 2026-06-19). Adds the file to the job and posts the comment.
- **Documents** — `jt_document_write` `lineItems[].files[].uploadRequestId`
  (already supported).
- **Daily logs** — *extend* `jt_daily_log_write`:
  - Schema `files` → `[{ uploadRequestId?, id?, name }]` (name required).
  - `createDailyLog` validation: accept an entry with **either** `uploadRequestId`
    **or** `id`, plus `name` (currently it hard-requires `id` + `name`).
    `updateDailyLog` forwards `files` the same way.
  - Forward the array as-is to Pave.
- **Cost items** — *extend* `jt_files op:uploadToCostItem`: accept
  `uploadRequestId` as an alternative to `fileUrl`. When `uploadRequestId` is
  supplied, skip fetch+upload and call `updateCostItem files:[{uploadRequestId,
  name}]` directly. (Cost items already accept `uploadRequestId` — the current
  fetch path uses it.)

## Data flows

**Code-capable:** `curl --data-binary @f.pdf …/api/files/blob` → `{uploadRequestId}`
→ `jt_comment_write` / `jt_daily_log_write` / `jt_files op:uploadToCostItem` /
`jt_document_write`. Binary throughout; no base64.

**Pure-chat:** `jt_files op:uploadBase64 {dataBase64,name,contentType}` →
`{uploadRequestId}` → same attach tools.

## Caps, errors, security

- 25 MB binary cap (blob endpoint + shared helper); 10 MB decoded cap
  (`uploadBase64`).
- Auth: `/api/files/blob` uses the same Bearer auth + permission tier check as
  other write endpoints. No new permission surface.
- `createUploadRequest`/PUT failures surface the upstream status + message
  (502-style for the REST route; `errorResponse` for the op).
- `uploadRequestId` is single-use and short-lived: attach promptly. (The
  job-email handler already re-mints on retry — same property.)
- `X-File-Name` is used only as a label; no path semantics, sanitized to a base
  filename.

## Testing

- `uploadBytesToJobTread` — createUploadRequest payload shape (`organizationId`,
  `size`, `type`), PUT to signed URL (mock `ctx.pave` + stubbed `fetch`),
  returns `uploadRequestId`. Size-cap rejection.
- `jt_files op:uploadBase64` — valid decode → handle; invalid base64 → error;
  over-cap → error with steer-to-blob message.
- `/api/files/blob` — validation (missing/zero Content-Length, oversize, bad
  auth) and a happy-path with stubbed helper.
- `jt_daily_log_write` — `files:[{uploadRequestId, name}]` accepted; `{id,name}`
  still accepted; entry missing both id and uploadRequestId rejected; missing
  name rejected.
- `jt_files op:uploadToCostItem` — `uploadRequestId` path skips fetch and calls
  `updateCostItem` with the handle.
- Full `node --test` suite stays green.

## Verify live (post-deploy)

- **Pave acceptance of `uploadRequestId` on `createDailyLog.files` /
  `updateDailyLog.files`.** Comments, documents, and cost items are confirmed to
  accept the handle; daily logs are designed to but unconfirmed. If Pave rejects
  it, daily-log attach falls back to the two-step (upload via comment to mint a
  file `id`, then reference `{id, name}`) — design note, not a blocker.

## Rollout

- Deploy via `npx wrangler deploy` from `server/mcp-server`.
- MCP schema changes (`uploadBase64`, daily-log/cost-item `files` shapes) require
  clients to **fully reconnect** to pick up the new `tools/list` (a soft reload
  won't re-handshake). The `/api/files/blob` REST route needs no client schema
  refresh.
