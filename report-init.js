// Budget Changelog Report - Initialization script
// Loads diff data from chrome.storage.local and renders the interactive report

(function() {
  'use strict';

  chrome.storage.local.get('_budgetReportData', function(result) {
    var payload = result._budgetReportData;
    if (!payload) {
      document.getElementById('app').innerHTML =
        '<h2 style="color:#ef4444;">No report data found</h2>' +
        '<p>Please run a budget comparison from the Budget Backups sidebar.</p>';
      return;
    }

    // Clean up temp storage immediately
    chrome.storage.local.remove('_budgetReportData');

    try {
      var data = payload;
      document.title = 'Budget Changelog - ' + (data.options.jobName || 'Budget');

      // Inject styles
      var style = document.createElement('style');
      style.textContent = BudgetReportApp.getReportStyles();
      document.head.appendChild(style);

      // Render the interactive report
      BudgetReportApp.renderReport(data);
    } catch(e) {
      document.getElementById('app').innerHTML =
        '<h2 style="color:#ef4444;">Report Error</h2><pre>' +
        e.message + '\n' + e.stack + '</pre>';
      console.error('Budget Report Error:', e);
    }
  });
})();
