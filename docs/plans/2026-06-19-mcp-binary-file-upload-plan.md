# MCP Binary File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let connector clients upload a file as raw binary (code-capable clients, no base64) or one clean base64 op (pure-chat), then attach the resulting `uploadRequestId` to comments, documents, daily logs, and cost items.

**Architecture:** Extract the JobTread upload core (`createUploadRequest` + signed PUT) into a shared `uploadBytesToJobTread` helper. Add two ingress paths that funnel through it — a binary REST route `POST /api/files/blob` and a `jt_files op:uploadBase64` op — plus extend the daily-log and cost-item write paths to accept an `uploadRequestId` handle.

**Tech Stack:** Cloudflare Workers, `@modelcontextprotocol/sdk`, Zod, Pave (JobTread API), `node:test`.

**Spec:** [docs/plans/2026-06-19-mcp-binary-file-upload-design.md](2026-06-19-mcp-binary-file-upload-design.md)

**Working dir for all commands:** `server/mcp-server`

---

## File Structure

- **Modify** `src/writes/files-write.js` — extract `export uploadBytesToJobTread`; refactor `fetchAndUpload` to use it; add `uploadBase64` op; extend `uploadToCostItem` to accept `uploadRequestId`; register `uploadBase64`.
- **Modify** `src/writes/files-write.test.js` — helper test, `uploadBase64` tests, cost-item handle test, op-count update.
- **Modify** `src/writes/daily-log-write.js` — accept `{uploadRequestId,name}` or `{id,name}` in `files` (create + update) via a shared validator.
- **Modify** `src/writes/daily-log-write.test.js` — handle-attach tests.
- **Create** `src/blob-upload.js` — `parseBlobRequest`, `runBlobUpload`, `handleBlobUpload`.
- **Create** `src/blob-upload.test.js` — validation + happy-path tests.
- **Modify** `src/index.js` — route `/api/files/blob` to `handleBlobUpload` before the generic `/api/` dispatch.
- **Modify** `src/tools.js` — `jt_files` op enum + `dataBase64`/`contentType`/`uploadRequestId` params + description; `jt_daily_log_write` `files` schema.
- **Modify** `CHANGELOG.md` — document the feature.

---

## Task 1: Extract `uploadBytesToJobTread` shared helper

Pure refactor of `fetchAndUpload` — no behavior change for existing callers.

**Files:**
- Modify: `src/writes/files-write.js`
- Test: `src/writes/files-write.test.js`

- [ ] **Step 1: Write the failing test** — add to `files-write.test.js` after the `mockCtx` helper (top of file), and update the import line to pull in the new export.

Change the import at the top:
```js
import { handleFilesWrite, uploadBytesToJobTread } from './files-write.js';
```

Add this test block after the `stubFetch` definition:
```js
test('uploadBytesToJobTread creates the upload request and PUTs the bytes', async () => {
  const restore = stubFetch([{ match: 'upload-target', status: 200 }]);
  try {
    const ctx = {
      orgId: 'ORG1', calls: [],
      async pave(query) {
        this.calls.push(query);
        return { createUploadRequest: { createdUploadRequest: {
          id: 'UR-9', url: 'https://upload-target/9', method: 'PUT', headers: {},
        } } };
      },
    };
    const bytes = new ArrayBuffer(2048);
    const res = await uploadBytesToJobTread(bytes, { contentType: 'application/pdf', name: 'x.pdf' }, ctx);

    assert.strictEqual(res.uploadRequestId, 'UR-9');
    assert.strictEqual(res.name, 'x.pdf');
    assert.strictEqual(res.size, 2048);
    assert.strictEqual(res.contentType, 'application/pdf');
    const q = ctx.calls[0].createUploadRequest.$;
    assert.strictEqual(q.organizationId, 'ORG1');
    assert.strictEqual(q.size, 2048);
    assert.strictEqual(q.type, 'application/pdf');
  } finally { restore(); }
});

test('uploadBytesToJobTread rejects empty and oversize buffers', async () => {
  const ctx = { orgId: 'ORG1', async pave() { throw new Error('should not be called'); } };
  await assert.rejects(() => uploadBytesToJobTread(new ArrayBuffer(0), { contentType: 'application/pdf', name: 'a' }, ctx), /empty/i);
  await assert.rejects(() => uploadBytesToJobTread(new ArrayBuffer(26 * 1024 * 1024), { contentType: 'application/pdf', name: 'a' }, ctx), /25MB|too large/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/writes/files-write.test.js`
Expected: FAIL — `uploadBytesToJobTread is not a function` (not yet exported).

- [ ] **Step 3: Implement the extraction** — in `src/writes/files-write.js`, add the exported helper above `fetchAndUpload`, and rewrite `fetchAndUpload` to call it.

Add this new function (place it just before `async function fetchAndUpload`):
```js
/**
 * Create a Pave upload request for `bytes` and PUT them to the signed URL.
 * The single ingress-agnostic core: URL fetch, base64 decode, and the binary
 * REST route all funnel through here. Returns { uploadReq, uploadRequestId,
 * name, size, contentType }.
 */
export async function uploadBytesToJobTread(bytes, { contentType, name }, ctx) {
  const size = bytes.byteLength;
  if (size === 0) throw new Error('File is empty (0 bytes)');
  if (size > 25 * 1024 * 1024) throw new Error('File too large (max 25MB)');
  const type = contentType || 'application/octet-stream';

  const uploadData = await ctx.pave({
    createUploadRequest: {
      $: { organizationId: ctx.orgId, size, type },
      createdUploadRequest: { id: {}, url: {}, method: {}, headers: {} },
    },
  });
  const uploadReq = uploadData.createUploadRequest?.createdUploadRequest;
  if (!uploadReq) throw new Error('Failed to create upload request');

  const uploadHeaders = {};
  if (uploadReq.headers && typeof uploadReq.headers === 'object') {
    for (const [k, v] of Object.entries(uploadReq.headers)) uploadHeaders[k] = v;
  }
  const uploadResp = await fetch(uploadReq.url, {
    method: uploadReq.method || 'PUT',
    headers: uploadHeaders,
    body: bytes,
  });
  if (!uploadResp.ok) {
    const errText = await uploadResp.text().catch(() => '');
    throw new Error(`Upload failed (${uploadResp.status}): ${errText.slice(0, 200)}`);
  }
  return { uploadReq, uploadRequestId: uploadReq.id, name: name || 'uploaded-file', size, contentType: type };
}
```

Then replace the body of `fetchAndUpload` from the `// 2. Create upload request via Pave` comment through the `return` so it delegates. The function becomes:
```js
async function fetchAndUpload(fileUrl, fileName, ctx) {
  // 1. Fetch from source
  let fileResp;
  try {
    fileResp = await fetch(fileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JTPowerTools/1.0)' },
      redirect: 'follow',
    });
    if (!fileResp.ok) throw new Error(`HTTP ${fileResp.status}: ${fileResp.statusText}`);
  } catch (e) {
    throw new Error(`Failed to fetch file from URL: ${e.message}`);
  }

  const fileBytes = await fileResp.arrayBuffer();

  // Detect content type
  let contentType = fileResp.headers.get('content-type') || '';
  if (contentType.includes(';')) contentType = contentType.split(';')[0].trim();
  if (!contentType || contentType === 'application/octet-stream') {
    const ext = fileUrl.split('?')[0].split('.').pop().toLowerCase();
    const mimeMap = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    contentType = mimeMap[ext] || 'application/octet-stream';
  }

  // Derive filename if not provided
  if (!fileName) {
    try {
      const urlPath = new URL(fileUrl).pathname;
      fileName = decodeURIComponent(urlPath.split('/').pop()) || 'uploaded-file';
    } catch {
      fileName = 'uploaded-file';
    }
  }

  const res = await uploadBytesToJobTread(fileBytes, { contentType, name: fileName }, ctx);
  return { uploadReq: res.uploadReq, fileName: res.name, fileSize: res.size, contentType: res.contentType };
}
```

- [ ] **Step 4: Run the full file test to verify pass + no regressions**

Run: `node --test src/writes/files-write.test.js`
Expected: PASS (new helper tests + all existing `prepareUploadFromUrls`/`upload` tests still green — they exercise the same Pave query shape through the helper).

- [ ] **Step 5: Commit**

```bash
git add src/writes/files-write.js src/writes/files-write.test.js
git commit -m "refactor(mcp): extract uploadBytesToJobTread from fetchAndUpload"
```

---

## Task 2: Add `jt_files op:uploadBase64`

**Files:**
- Modify: `src/writes/files-write.js`
- Modify: `src/tools.js` (op enum + params + description)
- Test: `src/writes/files-write.test.js`

- [ ] **Step 1: Write the failing tests** — add to `files-write.test.js`:

```js
test('uploadBase64 decodes and uploads, returning an uploadRequestId', async () => {
  const restore = stubFetch([{ match: 'upload-target', status: 200 }]);
  try {
    const ctx = {
      orgId: 'ORG1', calls: [],
      async pave() { return { createUploadRequest: { createdUploadRequest: {
        id: 'UR-B64', url: 'https://upload-target/b', method: 'PUT', headers: {},
      } } }; },
    };
    // "hello" → aGVsbG8=
    const result = await handleFilesWrite({
      op: 'uploadBase64', dataBase64: 'aGVsbG8=', name: 'note.txt', contentType: 'text/plain',
    }, ctx);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.uploadRequestId, 'UR-B64');
    assert.strictEqual(result.name, 'note.txt');
    assert.strictEqual(result.size, 5);
  } finally { restore(); }
});

test('uploadBase64 strips a data: URI prefix', async () => {
  const restore = stubFetch([{ match: 'upload-target', status: 200 }]);
  try {
    const ctx = {
      orgId: 'ORG1',
      async pave() { return { createUploadRequest: { createdUploadRequest: {
        id: 'UR-D', url: 'https://upload-target/d', method: 'PUT', headers: {} } } }; },
    };
    const result = await handleFilesWrite({
      op: 'uploadBase64', dataBase64: 'data:text/plain;base64,aGVsbG8=', name: 'h.txt',
    }, ctx);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.size, 5);
  } finally { restore(); }
});

test('uploadBase64 rejects missing fields, bad base64, and over-cap', async () => {
  const ctx = mockCtx({});
  const missing = await handleFilesWrite({ op: 'uploadBase64' }, ctx);
  assert.strictEqual(missing.success, false);
  assert.match(missing.error, /dataBase64/);
  assert.match(missing.error, /name/);

  const bad = await handleFilesWrite({ op: 'uploadBase64', dataBase64: '@@not base64@@', name: 'x' }, ctx);
  assert.strictEqual(bad.success, false);
  assert.match(bad.error, /not valid base64/i);

  // 11MB of 'A' chars decodes to ~8.25MB... build >10MB decoded: 14M base64 chars → ~10.5MB
  const big = 'A'.repeat(14 * 1024 * 1024);
  const over = await handleFilesWrite({ op: 'uploadBase64', dataBase64: big, name: 'big.bin' }, ctx);
  assert.strictEqual(over.success, false);
  assert.match(over.error, /10MB|blob/i);
});
```

Also update the op-count test (`'all 11 ops are registered'`):
```js
test('all 12 ops are registered', async () => {
  const ctx = mockCtx({});
  const result = await handleFilesWrite({ op: 'bogus' }, ctx);
  const expectedOps = [
    'upload', 'uploadToCostItem', 'prepareUploadFromUrls', 'uploadBase64',
    'updateFile', 'updateFileTag', 'deleteFile',
    'createPlan', 'updatePlan', 'deletePlan', 'generatePdf', 'signQuery',
  ];
  for (const op of expectedOps) {
    assert.match(result.error, new RegExp(op), `Op "${op}" should be listed`);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test src/writes/files-write.test.js`
Expected: FAIL — `Unknown op "uploadBase64"`.

- [ ] **Step 3: Implement** — in `src/writes/files-write.js`, add a decode helper + the op, and register it in the dispatcher.

Add near the top (after imports):
```js
// Decode base64 (optionally a data: URI) to a Uint8Array. Throws on invalid input.
function decodeBase64ToBytes(b64) {
  const marker = b64.indexOf('base64,');
  const raw = (marker !== -1 ? b64.slice(marker + 7) : b64).trim();
  const binary = atob(raw); // throws on invalid base64
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
```

Add the op (place after `prepareUploadFromUrls`):
```js
// ─── uploadBase64 (pure-chat ingress) ───────────────────────
//
// Text-only MCP clients can't send raw binary, so bytes ride in as base64.
// One clean op: decode → uploadBytesToJobTread → return the handle. Capped
// well below the binary endpoint because base64 in a tool arg burns context.

async function uploadBase64(params, ctx) {
  const err = requireFields(params, ['dataBase64', 'name'], 'uploadBase64');
  if (err) return err;
  const { dataBase64, name, contentType } = params;

  let bytes;
  try {
    bytes = decodeBase64ToBytes(dataBase64);
  } catch {
    return errorResponse('uploadBase64', 'dataBase64 is not valid base64');
  }
  if (bytes.byteLength === 0) return errorResponse('uploadBase64', 'Decoded file is empty (0 bytes)');
  if (bytes.byteLength > 10 * 1024 * 1024) {
    return errorResponse('uploadBase64',
      `Decoded file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB — over the 10MB base64 cap. ` +
      `Use the binary endpoint POST /api/files/blob for larger files.`);
  }

  const res = await uploadBytesToJobTread(
    bytes, { contentType: contentType || 'application/octet-stream', name }, ctx
  );
  return {
    ...successResponse('uploadBase64', 'uploadRequest', res.uploadRequestId,
      `Uploaded ${res.name} (${(res.size / 1024).toFixed(1)}KB). Attach via files:[{uploadRequestId}] on a comment, document, daily log, or cost item.`),
    uploadRequestId: res.uploadRequestId,
    name: res.name,
    size: res.size,
    contentType: res.contentType,
  };
}
```

Register it in the dispatcher:
```js
export const handleFilesWrite = createOpDispatcher({
  upload,
  uploadToCostItem,
  prepareUploadFromUrls,
  uploadBase64,
  updateFile,
  updateFileTag,
  deleteFile,
  createPlan,
  updatePlan,
  deletePlan,
  generatePdf,
  signQuery,
});
```

- [ ] **Step 4: Update the tool schema** — in `src/tools.js`, in the `jt_files` definition (`name: 'jt_files'`):

Add `'uploadBase64'` to the op enum's first line:
```js
      op: z.enum([
        'upload', 'uploadToCostItem', 'prepareUploadFromUrls', 'uploadBase64',
        'updateFile', 'updateFileTag', 'deleteFile',
        'createPlan', 'updatePlan', 'deletePlan',
        'generatePdf', 'signQuery',
        'parsePdf', 'extractProduct',
      ]).describe('Operation'),
```

Add these params (place right after the `fileUrl` line):
```js
      dataBase64: z.string().optional().describe('uploadBase64: file bytes as base64 (a data: URI prefix is stripped). Decoded cap 10MB — for larger files use the binary endpoint POST /api/files/blob.'),
      contentType: z.string().optional().describe('MIME type for uploadBase64 (e.g. application/pdf). Defaults to application/octet-stream.'),
```

Update the `jt_files` description: append after the existing text (before the closing quote of the description string):
```
 ' Two ways to upload without a public URL: (1) code-capable clients POST raw ' +
 'binary to /api/files/blob (no base64) and get back an uploadRequestId; ' +
 '(2) text-only clients use op:uploadBase64 { dataBase64, name, contentType }. ' +
 'Either handle attaches via files:[{uploadRequestId}] on jt_comment_write, ' +
 'jt_document_write, jt_daily_log_write, or jt_files op:uploadToCostItem.'
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test src/writes/files-write.test.js`
Expected: PASS (uploadBase64 tests + updated op-count test green).

- [ ] **Step 6: Commit**

```bash
git add src/writes/files-write.js src/tools.js src/writes/files-write.test.js
git commit -m "feat(mcp): add jt_files op:uploadBase64 (base64 ingress -> uploadRequestId)"
```

---

## Task 3: Extend `uploadToCostItem` to accept `uploadRequestId`

**Files:**
- Modify: `src/writes/files-write.js`
- Modify: `src/tools.js` (add `uploadRequestId` param)
- Test: `src/writes/files-write.test.js`

- [ ] **Step 1: Write the failing test + update the old required-fields test**

Replace the existing `'uploadToCostItem validates required fields (costItemId, fileUrl)'` test with:
```js
test('uploadToCostItem requires costItemId and one of fileUrl/uploadRequestId', async () => {
  const ctx = mockCtx({});
  const noId = await handleFilesWrite({ op: 'uploadToCostItem' }, ctx);
  assert.strictEqual(noId.success, false);
  assert.match(noId.error, /costItemId/);

  const noSource = await handleFilesWrite({ op: 'uploadToCostItem', costItemId: 'CI1' }, ctx);
  assert.strictEqual(noSource.success, false);
  assert.match(noSource.error, /fileUrl|uploadRequestId/);
});

test('uploadToCostItem attaches by uploadRequestId without fetching', async () => {
  const ctx = {
    orgId: 'ORG1', calls: [],
    async pave(query) {
      this.calls.push(query);
      return { updateCostItem: { costItem: {
        id: 'CI1', name: 'Lumber', files: { nodes: [{ id: 'F1', name: 'spec.pdf', url: 'https://x/f1' }] },
      } } };
    },
  };
  const result = await handleFilesWrite({
    op: 'uploadToCostItem', costItemId: 'CI1', uploadRequestId: 'UR-7', fileName: 'spec.pdf',
  }, ctx);

  assert.strictEqual(result.success, true);
  // Only the attach mutation ran — no createUploadRequest (no fetch path).
  assert.strictEqual(ctx.calls.length, 1);
  assert.deepStrictEqual(ctx.calls[0].updateCostItem.$.files, [{ uploadRequestId: 'UR-7', name: 'spec.pdf' }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test src/writes/files-write.test.js`
Expected: FAIL — the uploadRequestId test fails (handler still requires `fileUrl`, calls `fetchAndUpload`).

- [ ] **Step 3: Implement** — replace the head of `uploadToCostItem` (the `requireFields` + destructure + `fetchAndUpload` lines) with:

```js
async function uploadToCostItem(params, ctx) {
  const { costItemId, fileUrl, uploadRequestId, fileName: rawFileName } = params;
  if (!costItemId) return errorResponse('uploadToCostItem', 'Missing required field: costItemId');
  if (!fileUrl && !uploadRequestId) {
    return errorResponse('uploadToCostItem',
      'Provide either fileUrl (fetch + upload) or uploadRequestId (an already-uploaded handle from /api/files/blob or op:uploadBase64)');
  }

  let reqId, fileName, fileSize, contentType;
  if (uploadRequestId) {
    reqId = uploadRequestId;
    fileName = rawFileName || 'uploaded-file';
  } else {
    const r = await fetchAndUpload(fileUrl, rawFileName, ctx);
    reqId = r.uploadReq.id;
    fileName = r.fileName;
    fileSize = r.fileSize;
    contentType = r.contentType;
  }

  // Attach to cost item
  const data = await ctx.pave({
    updateCostItem: {
      $: { id: costItemId, files: [{ uploadRequestId: reqId, name: fileName }] },
      costItem: {
        id: {}, name: {},
        files: { nodes: { id: {}, name: {}, url: {} } },
      },
    },
  });
```

Leave the rest of the function (the `const costItem = ...` through `return {...}`) unchanged.

- [ ] **Step 4: Add the `uploadRequestId` param** — in `src/tools.js` `jt_files` schema, after the `costItemId` line:
```js
      uploadRequestId: z.string().optional().describe('uploadToCostItem: attach an already-uploaded file by its handle (from /api/files/blob or op:uploadBase64) instead of fileUrl.'),
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test src/writes/files-write.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/writes/files-write.js src/tools.js src/writes/files-write.test.js
git commit -m "feat(mcp): uploadToCostItem accepts uploadRequestId handle (skip fetch)"
```

---

## Task 4: Daily-log `files` accepts an `uploadRequestId` handle

**Files:**
- Modify: `src/writes/daily-log-write.js`
- Modify: `src/tools.js` (`jt_daily_log_write` `files` schema)
- Test: `src/writes/daily-log-write.test.js`

- [ ] **Step 1: Write the failing tests** — add to `daily-log-write.test.js` (it uses the same `mockCtx` pattern; if a `createDailyLog` happy-path mock isn't present, use the inline ctx below):

```js
test('createDailyLog accepts files by uploadRequestId or id, with name required', async () => {
  const ok = {
    orgId: 'ORG1', calls: [],
    async pave(q) { this.calls.push(q); return { createDailyLog: { createdDailyLog: {
      id: 'DL1', date: '2026-06-19', notes: '', job: { id: 'J1', name: 'Job', number: 1 } } } }; },
  };
  const res = await handleDailyLogWrite({
    op: 'createDailyLog', jobId: 'J1', date: '2026-06-19',
    files: [{ uploadRequestId: 'UR-1', name: 'photo.jpg' }, { id: 'F2', name: 'old.pdf' }],
  }, ok);
  assert.strictEqual(res.success, true);
  assert.deepStrictEqual(ok.calls[0].createDailyLog.$.files, [
    { uploadRequestId: 'UR-1', name: 'photo.jpg' }, { id: 'F2', name: 'old.pdf' },
  ]);
});

test('createDailyLog rejects a file entry with no id and no uploadRequestId', async () => {
  const ctx = mockCtx({});
  const res = await handleDailyLogWrite({
    op: 'createDailyLog', jobId: 'J1', date: '2026-06-19', files: [{ name: 'orphan.pdf' }],
  }, ctx);
  assert.strictEqual(res.success, false);
  assert.match(res.error, /id.*uploadRequestId|uploadRequestId.*id/);
});

test('createDailyLog rejects a file entry missing name', async () => {
  const ctx = mockCtx({});
  const res = await handleDailyLogWrite({
    op: 'createDailyLog', jobId: 'J1', date: '2026-06-19', files: [{ uploadRequestId: 'UR-1' }],
  }, ctx);
  assert.strictEqual(res.success, false);
  assert.match(res.error, /name/);
});
```

If `daily-log-write.test.js` doesn't already import `handleDailyLogWrite` + define `mockCtx`, add at the top:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDailyLogWrite } from './daily-log-write.js';

function mockCtx(paveResponse, orgId = 'ORG1') {
  const calls = [];
  return { orgId, calls, async pave(q) { calls.push(q); return typeof paveResponse === 'function' ? paveResponse(q) : paveResponse; } };
}
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test src/writes/daily-log-write.test.js`
Expected: FAIL — current validation requires `f.id` (rejects the `uploadRequestId` entry with the wrong message / wrongly).

- [ ] **Step 3: Implement** — in `src/writes/daily-log-write.js`, add a shared validator and use it in both create and update.

Add after the imports:
```js
// A daily-log file entry attaches an existing file (id) or a freshly uploaded
// one (uploadRequestId). Pave requires `name` either way.
function validateDailyLogFiles(files, op) {
  if (!Array.isArray(files)) return null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f || !f.name) {
      return errorResponse(op, `files[${i}] must have "name"`);
    }
    if (!f.id && !f.uploadRequestId) {
      return errorResponse(op, `files[${i}] must have either "id" (existing file) or "uploadRequestId" (freshly uploaded)`);
    }
  }
  return null;
}
```

In `createDailyLog`, replace the existing `if (files) { for (...) {...} }` validation block with:
```js
  if (files) {
    const fileErr = validateDailyLogFiles(files, 'createDailyLog');
    if (fileErr) return fileErr;
  }
```

In `updateDailyLog`, add validation before building `input` (right after the `const id = ...; if (!id) return ...` lines):
```js
  if (params.files) {
    const fileErr = validateDailyLogFiles(params.files, 'updateDailyLog');
    if (fileErr) return fileErr;
  }
```

- [ ] **Step 4: Update the tool schema** — in `src/tools.js`, in the `jt_daily_log_write` definition, replace the `files` line:
```js
      files: z.array(z.object({
        uploadRequestId: z.string().optional(),
        id: z.string().optional(),
        name: z.string(),
      })).optional().describe('Attach files: { uploadRequestId, name } for a freshly uploaded file (from /api/files/blob or op:uploadBase64) OR { id, name } for an existing JobTread file. name is required either way.'),
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test src/writes/daily-log-write.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/writes/daily-log-write.js src/tools.js src/writes/daily-log-write.test.js
git commit -m "feat(mcp): daily-log files accept uploadRequestId handle (id or handle + name)"
```

---

## Task 5: Binary upload handler (`blob-upload.js`)

**Files:**
- Create: `src/blob-upload.js`
- Test: `src/blob-upload.test.js`

- [ ] **Step 1: Write the failing tests** — create `src/blob-upload.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlobRequest, runBlobUpload } from './blob-upload.js';

function req(body, headers = {}, urlExtra = '') {
  return new Request('https://mcp.test/api/files/blob' + urlExtra, { method: 'POST', headers, body });
}

test('parseBlobRequest reads content type and X-File-Name', () => {
  const meta = parseBlobRequest(req('x', { 'Content-Type': 'application/pdf', 'X-File-Name': 'forecast.pdf' }));
  assert.strictEqual(meta.contentType, 'application/pdf');
  assert.strictEqual(meta.name, 'forecast.pdf');
});

test('parseBlobRequest falls back to ?name then a typed default', () => {
  const m1 = parseBlobRequest(req('x', { 'Content-Type': 'image/png' }, '?name=shot.png'));
  assert.strictEqual(m1.name, 'shot.png');
  const m2 = parseBlobRequest(req('x', { 'Content-Type': 'application/pdf' }));
  assert.strictEqual(m2.name, 'upload.pdf');
});

test('parseBlobRequest rejects oversize via Content-Length', () => {
  const meta = parseBlobRequest(req('x', { 'Content-Type': 'application/pdf', 'Content-Length': String(30 * 1024 * 1024) }));
  assert.ok(meta.error);
  assert.strictEqual(meta.status, 413);
});

test('runBlobUpload happy path returns uploadRequestId', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
  try {
    const ctx = {
      orgId: 'ORG1', permission: 'delete', calls: [],
      async pave(q) { this.calls.push(q); return { createUploadRequest: { createdUploadRequest: {
        id: 'UR-BLOB', url: 'https://upload-target/x', method: 'PUT', headers: {} } } }; },
    };
    const resp = await runBlobUpload(
      req(new Uint8Array([1, 2, 3, 4]), { 'Content-Type': 'application/pdf', 'X-File-Name': 'a.pdf' }),
      ctx
    );
    assert.strictEqual(resp.status, 200);
    const json = JSON.parse(await resp.text());
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.uploadRequestId, 'UR-BLOB');
    assert.strictEqual(json.name, 'a.pdf');
    assert.strictEqual(json.size, 4);
  } finally { globalThis.fetch = originalFetch; }
});

test('runBlobUpload rejects an empty body', async () => {
  const ctx = { orgId: 'ORG1', permission: 'delete', async pave() { throw new Error('nope'); } };
  const resp = await runBlobUpload(req(new Uint8Array([]), { 'Content-Type': 'application/pdf' }), ctx);
  assert.strictEqual(resp.status, 400);
});

test('runBlobUpload denies when permission is insufficient', async () => {
  const ctx = { orgId: 'ORG1', permission: 'read', async pave() { throw new Error('nope'); } };
  const resp = await runBlobUpload(req(new Uint8Array([1]), { 'Content-Type': 'application/pdf' }), ctx);
  assert.strictEqual(resp.status, 403);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test src/blob-upload.test.js`
Expected: FAIL — `Cannot find module './blob-upload.js'` (or no such exports).

- [ ] **Step 3: Implement** — create `src/blob-upload.js`:

```js
/**
 * blob-upload.js — POST /api/files/blob
 *
 * Raw-binary file upload. The client POSTs file bytes (no base64); the worker
 * creates a JobTread upload request, PUTs the bytes to the signed URL, and
 * returns { uploadRequestId, name, size, contentType } to attach via the write
 * tools (jt_comment_write / jt_document_write / jt_daily_log_write /
 * jt_files op:uploadToCostItem).
 *
 * Run tests: node --test server/mcp-server/src/blob-upload.test.js
 */

import { uploadBytesToJobTread } from './writes/files-write.js';
import { buildContext } from './tools.js';
import { canCall, permissionDeniedMessage } from './mcp-permissions.js';

const MAX_BLOB_BYTES = 25 * 1024 * 1024;
const EXT_BY_TYPE = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg',
  'image/gif': 'gif', 'image/webp': 'webp', 'text/plain': 'txt',
};

/** Pull contentType + filename from headers/query. Returns { contentType, name } or { error, status }. */
export function parseBlobRequest(request) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BLOB_BYTES) {
    return { error: `File too large (${(declared / 1024 / 1024).toFixed(1)}MB). Max 25MB.`, status: 413 };
  }
  let contentType = (request.headers.get('Content-Type') || 'application/octet-stream').split(';')[0].trim();
  if (!contentType) contentType = 'application/octet-stream';

  const url = new URL(request.url);
  let name = request.headers.get('X-File-Name') || url.searchParams.get('name') || '';
  name = name.split('/').pop().split('\\').pop().trim(); // base filename only — no path semantics
  if (!name) name = `upload.${EXT_BY_TYPE[contentType] || 'bin'}`;

  return { contentType, name };
}

/** Core handler — takes a pre-built ctx so it's unit-testable. */
export async function runBlobUpload(request, ctx) {
  if (!canCall(ctx.permission, 'jt_files', 'upload')) {
    return blobJson({ error: permissionDeniedMessage(ctx.permission, 'jt_files', 'upload'), code: 'PERMISSION_DENIED' }, 403);
  }

  const meta = parseBlobRequest(request);
  if (meta.error) return blobJson({ error: meta.error }, meta.status || 400);

  let bytes;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return blobJson({ error: 'Failed to read request body' }, 400);
  }
  if (!bytes || bytes.byteLength === 0) {
    return blobJson({ error: 'Empty body — POST the file bytes (e.g. curl --data-binary @file.pdf)' }, 400);
  }
  if (bytes.byteLength > MAX_BLOB_BYTES) {
    return blobJson({ error: 'File too large (max 25MB)' }, 413);
  }

  try {
    const res = await uploadBytesToJobTread(bytes, { contentType: meta.contentType, name: meta.name }, ctx);
    return blobJson({
      success: true,
      uploadRequestId: res.uploadRequestId,
      name: res.name,
      size: res.size,
      contentType: res.contentType,
    });
  } catch (e) {
    return blobJson({ error: e.message || 'Upload failed' }, 502);
  }
}

/** Route entry: build ctx from the already-validated authResult, then run. */
export async function handleBlobUpload(request, env, authResult) {
  const ctx = buildContext(env, authResult);
  return runBlobUpload(request, ctx);
}

function blobJson(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Name',
    },
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test src/blob-upload.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/blob-upload.js src/blob-upload.test.js
git commit -m "feat(mcp): binary upload handler for POST /api/files/blob"
```

---

## Task 6: Wire the `/api/files/blob` route

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Add the import** — near the other route imports (next to `import { handleRestRequest } from './rest-handler.js';`):
```js
import { handleBlobUpload } from './blob-upload.js';
```

- [ ] **Step 2: Add the route branch** — in the `apiHandler.fetch` handler, immediately BEFORE the existing `if (url.pathname.startsWith('/api/'))` block:
```js
      // ─── Binary file upload (raw bytes, not JSON) ──────────
      // Must run before the generic /api/ tool dispatch, which JSON-parses.
      if (url.pathname === '/api/files/blob') {
        if (!hasMcpAccess(authResult.license.tier)) {
          return jsonResponse(
            { error: `Your ${authResult.license.tier} tier doesn't include API access. Upgrade to Power User at jobtread-tools.pro/upgrade`, code: 'TIER_NO_API' },
            403
          );
        }
        return handleBlobUpload(request, env, authResult);
      }
```

- [ ] **Step 3: Verify the build loads** — run the full suite (a syntax/import error surfaces here):

Run: `npm test`
Expected: PASS — full suite green (count = prior 704 + new tests from Tasks 1–5).

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat(mcp): route POST /api/files/blob to the binary upload handler"
```

---

## Task 7: Docs (CHANGELOG + OpenAPI note)

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/openapi.js` (manual path for the binary endpoint)

- [ ] **Step 1: CHANGELOG** — under `## [Unreleased]`, add an `### Added` entry:
```markdown
- **MCP server: binary file upload without base64** ([blob-upload.js](server/mcp-server/src/blob-upload.js), [files-write.js](server/mcp-server/src/writes/files-write.js)). Code-capable clients `POST` raw bytes to `/api/files/blob` (auth + `Content-Type` + `X-File-Name`) and get back an `uploadRequestId` — no base64, no public host. Text-only clients use `jt_files op:uploadBase64` (one call, ~10MB cap). The handle attaches uniformly via `jt_comment_write`, `jt_document_write`, `jt_daily_log_write`, and `jt_files op:uploadToCostItem`. Shared `uploadBytesToJobTread` helper backs all ingress paths.
```

- [ ] **Step 2: OpenAPI manual path** — `src/openapi.js` generates paths from `TOOL_DEFINITIONS`; the binary route isn't a tool. After the generated `paths` object is built, inject a hand-written entry. Locate where the spec's `paths` are assembled and add:
```js
  paths['/api/files/blob'] = {
    post: {
      summary: 'Upload raw file bytes (no base64); returns an uploadRequestId handle',
      requestBody: {
        required: true,
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
      parameters: [
        { name: 'X-File-Name', in: 'header', required: false, schema: { type: 'string' } },
        { name: 'name', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: { '200': { description: '{ uploadRequestId, name, size, contentType }' } },
    },
  };
```
(If `openapi.js` structure makes a clean injection point unclear, skip this step — the endpoint is documented in the `jt_files` description and CHANGELOG. Do not block the feature on it.)

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md src/openapi.js
git commit -m "docs(mcp): document binary file upload endpoint + uploadBase64"
```

---

## Task 8: Verify, deploy, live-check

- [ ] **Step 1: Full suite green**

Run: `npm test`
Expected: all tests pass, 0 fail.

- [ ] **Step 2: Deploy**

Run: `npx wrangler deploy`
Expected: `Current Version ID: ...` printed, no errors.

- [ ] **Step 3: Verify the binary endpoint live** (uses a real Bearer; safe — single small upload, no attach):

```bash
printf 'hello pdf' > /tmp/t.txt
curl -s -X POST "https://mcp.jtpowertools.com/api/files/blob" \
  -H "Authorization: Bearer <license_key>:<grant_key>" \
  -H "Content-Type: text/plain" -H "X-File-Name: t.txt" \
  --data-binary @/tmp/t.txt
```
Expected: `{ "success": true, "uploadRequestId": "...", "name": "t.txt", "size": 9 }`.

- [ ] **Step 4: Verify daily-log handle acceptance at the Pave layer** (the one design-flagged unknown). On a SAFE test job, `jt_daily_log_write op:createDailyLog` with `files:[{uploadRequestId:"<from step 3>", name:"t.txt"}]`. If Pave rejects `uploadRequestId` on daily-log files, fall back to the two-step (upload via comment to mint a file `id`, then `{id,name}`) and note it in the spec's "Verify live" section. Not a release blocker for the other targets.

- [ ] **Step 5: Final commit (if any verification fixes were needed) + reconnect note**

MCP schema changes (`uploadBase64`, daily-log/cost-item `files`) require clients to FULLY reconnect to pick up the new `tools/list`. The `/api/files/blob` REST route needs no client refresh.

---

## Self-Review

- **Spec coverage:** shared helper (T1), binary endpoint (T5/T6), uploadBase64 (T2), comment egress (already shipped), document egress (already supported), daily-log egress (T4), cost-item egress (T3), caps 25MB/10MB (T2/T5), errors (T2/T5), tests (every task), deploy + reconnect + daily-log Pave verify (T8). All spec sections map to a task.
- **Type/name consistency:** `uploadBytesToJobTread(bytes, { contentType, name }, ctx)` returns `{ uploadReq, uploadRequestId, name, size, contentType }` — used consistently by `fetchAndUpload` (remaps to `fileName`/`fileSize`), `uploadBase64`, `uploadToCostItem`, and `runBlobUpload`. `validateDailyLogFiles(files, op)` used by both daily-log ops.
- **No placeholders:** every code step shows complete code; the only conditional is T7 Step 2 (OpenAPI injection), explicitly marked skippable without blocking.
