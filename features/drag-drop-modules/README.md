# Drag & Drop Modules

This directory contains the refactored drag-drop feature, broken into modular, maintainable components.

## Module Structure

### Core Utilities (No Dependencies)
- **date-utils.js** (322 lines) - Date extraction, parsing, and formatting
  - `extractDateFromCell()` - Extract day number from DOM
  - `extractFullDateInfo()` - Extract full date with intelligent year inference
  - `formatDateForInput()` - Format dates for JobTread input fields
  - Constants: `MONTH_ABBREV`, `MONTH_NAMES`, `MONTH_MAP`

- **weekend-utils.js** (128 lines) - Weekend detection and handling
  - `isWeekendCell()` - Check if date falls on weekend
  - `adjustDateToSkipWeekend()` - Move date to next Monday
  - `injectWeekendCSS()` - Add weekend styling
  - `removeWeekendCSS()` - Cleanup styling

### UI Components
- **ui-utils.js** (160 lines) - User interface utilities
  - `showNotification()` - Toast notifications
  - `makeScheduleItemsDraggable()` - Setup draggable elements
  - `makeDateCellsDroppable()` - Setup drop zones
  - `initDragAndDrop()` - Initialize all UI elements
  - `cleanupDragDrop()` - Remove all UI modifications

### Event Handling
- **event-handlers.js** (242 lines) - Drag & drop event handlers
  - `createHandlers()` - Factory function returning all handlers
  - Individual handlers: `onDragStart`, `onDragEnd`, `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop`
  - Handles year boundary transitions and weekend detection

### Sidebar Management
- **sidebar-manager.js** (309 lines) - Sidebar DOM manipulation
  - `injectHideSidebarCSS()` - Hide sidebar during operations
  - `removeSidebarCSS()` - Cleanup hiding styles
  - `openSidebar()` - Open sidebar by clicking element
  - `closeSidebar()` - Close sidebar and cleanup
  - `findDateField()` - Locate start date field with year inference
  - `findInputField()` - Find date input for typing
  - `checkUpdateCheckboxes()` - Auto-check related checkboxes

### Date Changing Logic
- **date-changer.js** (514 lines) - Date change orchestration
  - `attemptDateChange()` - Main orchestrator function
  - `typeIntoDateField()` - Typing method (most reliable)
  - `useCalendarPicker()` - Calendar dropdown fallback
  - `setDatePickerAndClickDay()` - Set dropdowns and click day
  - `clickDayInCalendar()` - Find and click correct day cell

## Load Order (Critical!)

Modules must be loaded in this order (defined in manifest.json):

1. `date-utils.js` - No dependencies
2. `weekend-utils.js` - Uses DateUtils
3. `ui-utils.js` - Uses DateUtils, WeekendUtils
4. `sidebar-manager.js` - Uses DateUtils
5. `date-changer.js` - Uses DateUtils, UIUtils, SidebarManager
6. `event-handlers.js` - Uses all utilities
7. `../drag-drop.js` - Main orchestrator, uses all modules

## Benefits

✅ **Maintainability** - Each module has a single, clear responsibility
✅ **Testability** - Pure functions can be unit tested independently
✅ **Debuggability** - Smaller files easier to navigate and debug
✅ **Reusability** - Date/weekend utilities can be used by other features
✅ **Readability** - Main orchestrator reduced from 1,475 → 149 lines (90% reduction)
✅ **Collaboration** - Multiple developers can work on different modules

## Architecture

```
DragDropFeature (149 lines)
├── DateUtils (322 lines)
│   └── Date extraction, parsing, formatting
├── WeekendUtils (128 lines)
│   └── Weekend detection and adjustment
├── UIUtils (160 lines)
│   └── Notifications and DOM setup
├── SidebarManager (309 lines)
│   └── Sidebar visibility and field finding
├── DateChanger (514 lines)
│   └── Date change orchestration
└── EventHandlers (242 lines)
    └── Drag & drop event handling

Total: 1,824 lines (vs original 1,475 lines)
```

*Note: Total line count includes additional documentation, error handling, and improved logging*

## Public API

The main `DragDropFeature` maintains the same public API:

```javascript
window.DragDropFeature = {
  init: () => {...},
  cleanup: () => {...},
  isActive: () => boolean
};
```

No changes required in `content.js` or other parts of the extension.

## State Management

Shared state is managed in the main `drag-drop.js` orchestrator:

```javascript
const state = {
  draggedElement: null,
  draggedItemData: null,
  sourceDateInfo: null,
  shiftKeyAtDragStart: false,
  isDateChangeInProgress: false
};
```

This state is passed to event handlers and modules as needed.

## Future Improvements

- Add unit tests for pure utility functions (date-utils, weekend-utils)
- Extract year boundary logic into separate module
- Add TypeScript definitions for better IDE support
- Create integration tests for full drag-drop flow
