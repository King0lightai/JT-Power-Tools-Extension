# Feature: `confirmBeforeAction` Tweak verb — warn-before-action on React SPAs

**Status:** implemented (v1) · **Date:** 2026-06-04 · **Area:** Tweaks DSL

## Problem

"Warn before a destructive action" (e.g. *Are you sure you want to delete this job?*)
is one of the most-wanted tweak patterns, and it silently fails on React SPAs —
which is essentially every modern web app, including JobTread.

The existing `onEvent` verb already registers a **capture-phase listener at
`document`** and supports `preventDefault` / `stopPropagation` / `alert` / `then[]`.
What it *cannot* express is **conditional proceed**: its side effects are
unconditional. On React you can therefore *block* an action or *notify* after it,
but you cannot *gate* it — "ask, and only run the original action if the user
confirms."

Two React facts make this hard:

1. React routes the real action through a **single delegated synthetic handler**
   on the root container, not a native handler on the element.
2. A native listener's `preventDefault()` does **not** stop React's handler (it
   isn't a "default action"), and `stopPropagation()` alone can only *block* —
   it can't *conditionally proceed*.

## Design

A new closed-allowlist verb, `confirmBeforeAction`:

```jsonc
{
  "type": "confirmBeforeAction",
  "selector": "button.delete",     // auto-scoped to .jt-tweak-{id}
  "event": "click",                // click | dblclick | submit
  "confirm": "Delete this job?"     // 1..500 chars, shown before the action
}
```

**Semantics:** intercept `event` in the **capture phase at `document`** (above
React's root). For targets matching `selector` (via `closest()`), show a
**synchronous native `confirm()`**:

- **Cancel** → `preventDefault()` + `stopImmediatePropagation()` → React's
  delegated handler never fires; the action is blocked.
- **OK** → do nothing; the event keeps propagating to React, so the original
  action runs **untouched**.

Because the listener is **document-delegated**, it survives React re-renders with
no re-wrapping — the key reason this beats poking at fiber handlers.

### Why native `confirm()` (and not the styled `JTTweakAlert`)

`JTTweakAlert` (used by `onEvent.alert`) is an async DOM modal. An async dialog
**cannot gate a synchronous DOM event** in capture phase — by the time it
resolves, the event has already reached React and the action has happened. Native
`confirm()` is synchronous, so it can decide mid-dispatch. (A styled gate is
possible via *block-then-re-dispatch-on-confirm* but introduces synthetic-event
fragility; deferred to v2.)

### Why a verb, not fiber-wrapping

`wrapReactHandler` (reach `el.__reactProps$…onClick`, replace it) was considered
and rejected for v1: React replaces handlers on every re-render (constant
re-wrapping), prop-key hashes are build-specific, and React 18 makes it harder —
a large, fragile, security-sensitive surface. The capture interceptor achieves
the same product outcome robustly across React 16/17/18.

## Security

Stays inside the deliberately-closed DSL model:

- No arbitrary code — only a confirm dialog with a text-only message (native
  `confirm()` can't render HTML, so the message is XSS-inert).
- Closed event allowlist (`click`, `dblclick`, `submit`). `change`/`mousedown`
  excluded for v1 because the value/state has already mutated by dispatch time,
  so gating is semantically incomplete.
- Selector auto-scoped to `.jt-tweak-{id}`; extension-UI selectors refused.
- `confirm` length-capped (1..500). Forbidden inside `then[]` (it registers a
  listener), same as `onEvent`.
- Validated on **both** the client (popup/engine) and the server (the security
  gate on create/update) — identical rules.

## Implementation

| Layer | File | Change |
|---|---|---|
| Engine (runtime) | `JT-Tools-Master/features/tweak-engine/index.js` | `registerConfirmBeforeAction()` (capture listener + `tweakEventListeners` teardown); wired in the apply loop; skipped in the per-element DOM applier |
| Client validator | `JT-Tools-Master/utils/tweak-validator.js` | allowlist + `ALLOWED_CONFIRM_EVENTS` + `then[]` guard + shape validation |
| Server validator | `server/mcp-server/src/tweaks-validator.js` | same (security gate) |
| MCP tool | `server/mcp-server/src/tools.js` | `jt_tweaks` description + `actions` schema mention the verb + shape |

## Test plan / status

- ✅ Server-validator unit checks: valid `click`/`submit` accepted; bad event,
  missing/empty `confirm`, and nesting in `then[]` rejected.
- ✅ `node --check` on all four edited files.
- ☐ Live JobTread: guard a Delete button — cancel blocks, OK proceeds; survives
  re-render; cleans up on tweak disable. *(Needs a logged-in JobTread session.)*

## Future (v2)

- Styled confirm via `JTTweakAlert` using block-then-re-dispatch on confirm.
- Optional `confirmLabel` / `cancelLabel`.
- Consider `change` gating with value-revert.
