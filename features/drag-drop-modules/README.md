# Task Completion modules

> **History:** This folder was originally the Schedule Drag & Drop feature. JobTread
> shipped native schedule drag & drop, so the drag/drop machinery was removed (Jun 2026)
> and the orchestrator was renamed to `features/task-completion-checkboxes.js`. The folder
> name is kept to avoid a storage/settings migration (the feature key is still `dragDrop`).

## Current modules

- **task-completion.js** — Adds completion checkboxes to schedule task cards. Marking a task
  complete works by opening the task's sidebar (hidden via CSS), toggling its progress
  checkbox, then closing the sidebar.
- **action-items-completion.js** — Adds completion checkboxes to the "Action Items" card.
- **sidebar-manager.js** — Shared sidebar helpers: `injectHideSidebarCSS`, `removeSidebarCSS`,
  `openSidebar`, `closeSidebar`. Also used by `features/file-drag-to-folder.js`.
- **ui-utils.js** — Shared `showNotification` toast. Also used by `file-drag-to-folder.js`.
- **view-detector.js** — Detects schedule view type (normal vs availability) and popup context;
  used by `task-completion.js` and `sidebar-manager.js`.

The orchestrator (`features/task-completion-checkboxes.js`) wires `task-completion` +
`action-items-completion` and exposes `window.DragDropFeature` (kept for compatibility).
