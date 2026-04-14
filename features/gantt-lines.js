/**
 * Gantt Dependency Line Enhancement
 * Makes dependency lines thicker and easier to click in Gantt view
 */
const GanttLinesFeature = (() => {
  let isActiveState = false;
  let styleElement = null;

  function init() {
    if (isActiveState) return;
    isActiveState = true;
    console.log('GanttLines: Initializing...');
    injectStyles();
    console.log('GanttLines: Initialized');
  }

  function cleanup() {
    if (!isActiveState) return;
    console.log('GanttLines: Cleaning up...');
    removeStyles();
    isActiveState = false;
    console.log('GanttLines: Cleaned up');
  }

  function injectStyles() {
    styleElement = document.createElement('link');
    styleElement.rel = 'stylesheet';
    styleElement.href = chrome.runtime.getURL('styles/gantt-lines.css');
    styleElement.id = 'jt-gantt-lines-styles';
    document.head.appendChild(styleElement);
  }

  function removeStyles() {
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }
  }

  return {
    init,
    cleanup,
    isActive: () => isActiveState
  };
})();

window.GanttLinesFeature = GanttLinesFeature;
