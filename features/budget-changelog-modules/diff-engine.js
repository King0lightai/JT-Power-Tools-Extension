// Budget Changelog - Diff Engine Module
// Compares two parsed budgets and identifies changes

const BudgetDiffEngine = (() => {
  /**
   * Compare two parsed budgets and return a diff
   * @param {Array} oldItems - Items from older backup
   * @param {Array} newItems - Items from newer backup
   * @returns {Object} Diff result with added, removed, modified items
   */
  function compare(oldItems, newItems) {
    // Filter out groups for comparison (we only care about line items)
    const oldLineItems = oldItems.filter(i => !i.isGroup);
    const newLineItems = newItems.filter(i => !i.isGroup);

    // Create maps for fast lookup
    const oldMap = new Map(oldLineItems.map(i => [i.uniqueKey, i]));
    const newMap = new Map(newLineItems.map(i => [i.uniqueKey, i]));

    const added = [];
    const removed = [];
    const modified = [];

    // Find added and modified items
    for (const [key, newItem] of newMap) {
      const oldItem = oldMap.get(key);
      if (!oldItem) {
        added.push(newItem);
      } else {
        const changes = compareItems(oldItem, newItem);
        if (changes.length > 0) {
          modified.push({
            item: newItem,
            oldItem: oldItem,
            changes: changes
          });
        }
      }
    }

    // Find removed items
    for (const [key, oldItem] of oldMap) {
      if (!newMap.has(key)) {
        removed.push(oldItem);
      }
    }

    // Find unchanged items
    const unchanged = [];
    for (const [key, newItem] of newMap.entries()) {
      if (oldMap.has(key)) {
        const isModified = modified.some(m => (m.item?.uniqueKey || m.uniqueKey) === key);
        if (!isModified) {
          unchanged.push({ item: newItem, type: 'unchanged' });
        }
      }
    }

    // Calculate summary
    const summary = calculateSummary(oldLineItems, newLineItems, added, removed, modified, unchanged);

    return {
      added,
      removed,
      modified,
      unchanged,
      summary,
      hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0
    };
  }

  /**
   * Compare two individual items and return list of changes
   * @param {Object} oldItem - Old version of item
   * @param {Object} newItem - New version of item
   * @returns {Array} Array of change objects
   */
  function compareItems(oldItem, newItem) {
    const changes = [];

    // Fields to compare
    const numericFields = [
      { key: 'quantity', label: 'Quantity' },
      { key: 'unitCost', label: 'Unit Cost', isCurrency: true },
      { key: 'extendedCost', label: 'Extended Cost', isCurrency: true },
      { key: 'unitPrice', label: 'Unit Price', isCurrency: true },
      { key: 'extendedPrice', label: 'Extended Price', isCurrency: true }
    ];

    const textFields = [
      { key: 'description', label: 'Description' },
      { key: 'unit', label: 'Unit' },
      { key: 'costType', label: 'Cost Type' },
      { key: 'quantityFormula', label: 'Quantity Formula' },
      { key: 'unitCostFormula', label: 'Unit Cost Formula' },
      { key: 'unitPriceFormula', label: 'Unit Price Formula' }
    ];

    const boolFields = [
      { key: 'taxable', label: 'Taxable' },
      { key: 'selected', label: 'Selected' }
    ];

    // Compare numeric fields
    for (const field of numericFields) {
      const oldVal = oldItem[field.key];
      const newVal = newItem[field.key];

      // Both null = no change
      if (oldVal === null && newVal === null) continue;

      // One null, one not = change
      if (oldVal !== newVal) {
        // For numbers, use tolerance for floating point comparison
        if (oldVal !== null && newVal !== null) {
          if (Math.abs(oldVal - newVal) < 0.001) continue;
        }

        changes.push({
          field: field.key,
          label: field.label,
          oldValue: oldVal,
          newValue: newVal,
          isCurrency: field.isCurrency || false,
          type: 'numeric',
          delta: (newVal || 0) - (oldVal || 0)
        });
      }
    }

    // Compare text fields
    for (const field of textFields) {
      const oldVal = (oldItem[field.key] || '').trim();
      const newVal = (newItem[field.key] || '').trim();

      if (oldVal !== newVal) {
        changes.push({
          field: field.key,
          label: field.label,
          oldValue: oldVal,
          newValue: newVal,
          type: 'text'
        });
      }
    }

    // Compare boolean fields
    for (const field of boolFields) {
      if (oldItem[field.key] !== newItem[field.key]) {
        changes.push({
          field: field.key,
          label: field.label,
          oldValue: oldItem[field.key],
          newValue: newItem[field.key],
          type: 'boolean'
        });
      }
    }

    // Compare custom fields
    const allCustomFieldKeys = new Set([
      ...Object.keys(oldItem.customFields || {}),
      ...Object.keys(newItem.customFields || {})
    ]);

    for (const fieldKey of allCustomFieldKeys) {
      const oldVal = (oldItem.customFields?.[fieldKey] || '').trim();
      const newVal = (newItem.customFields?.[fieldKey] || '').trim();

      if (oldVal !== newVal) {
        changes.push({
          field: `custom.${fieldKey}`,
          label: fieldKey,
          oldValue: oldVal,
          newValue: newVal,
          type: 'custom'
        });
      }
    }

    return changes;
  }

  /**
   * Calculate summary statistics for the diff
   * @param {Array} oldItems - Old line items
   * @param {Array} newItems - New line items
   * @param {Array} added - Added items
   * @param {Array} removed - Removed items
   * @param {Array} modified - Modified items
   * @returns {Object} Summary statistics
   */
  function calculateSummary(oldItems, newItems, added, removed, modified, unchanged = []) {
    // Calculate old totals
    let oldTotalCost = 0;
    let oldTotalPrice = 0;
    for (const item of oldItems) {
      if (item.extendedCost !== null) oldTotalCost += item.extendedCost;
      if (item.extendedPrice !== null) oldTotalPrice += item.extendedPrice;
    }

    // Calculate new totals
    let newTotalCost = 0;
    let newTotalPrice = 0;
    for (const item of newItems) {
      if (item.extendedCost !== null) newTotalCost += item.extendedCost;
      if (item.extendedPrice !== null) newTotalPrice += item.extendedPrice;
    }

    // Calculate impact of changes
    let addedCost = 0;
    let addedPrice = 0;
    for (const item of added) {
      if (item.extendedCost !== null) addedCost += item.extendedCost;
      if (item.extendedPrice !== null) addedPrice += item.extendedPrice;
    }

    let removedCost = 0;
    let removedPrice = 0;
    for (const item of removed) {
      if (item.extendedCost !== null) removedCost += item.extendedCost;
      if (item.extendedPrice !== null) removedPrice += item.extendedPrice;
    }

    let modifiedCostDelta = 0;
    let modifiedPriceDelta = 0;
    for (const mod of modified) {
      for (const change of mod.changes) {
        if (change.field === 'extendedCost') {
          modifiedCostDelta += change.delta;
        }
        if (change.field === 'extendedPrice') {
          modifiedPriceDelta += change.delta;
        }
      }
    }

    // Calculate unchanged count from the actual unchanged array
    const unchangedCount = unchanged.length;

    return {
      oldTotalCost,
      oldTotalPrice,
      newTotalCost,
      newTotalPrice,
      costChange: newTotalCost - oldTotalCost,
      priceChange: newTotalPrice - oldTotalPrice,
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      unchangedCount: Math.max(0, unchangedCount),
      addedCost,
      addedPrice,
      removedCost,
      removedPrice,
      modifiedCostDelta,
      modifiedPriceDelta
    };
  }

  /**
   * Format a currency value for display
   * @param {number} value - Currency value
   * @returns {string} Formatted string
   */
  function formatCurrency(value) {
    if (value === null || value === undefined) return '-';
    const prefix = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    return prefix + '$' + abs.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Format a change delta with +/- prefix
   * @param {number} value - Delta value
   * @param {boolean} isCurrency - Whether to format as currency
   * @returns {string} Formatted string
   */
  function formatDelta(value, isCurrency = false) {
    if (value === null || value === undefined || value === 0) return '-';
    const prefix = value > 0 ? '+' : '';
    if (isCurrency) {
      return prefix + formatCurrency(value);
    }
    return prefix + value.toLocaleString('en-US');
  }

  /**
   * Group changes by cost group hierarchy for display
   * @param {Object} diff - Diff result from compare()
   * @returns {Object} Changes grouped by hierarchy
   */
  function groupByHierarchy(diff) {
    const groups = {};

    // Helper to add item to group
    const addToGroup = (item, type, data = null) => {
      const groupKey = item.hierarchy.slice(0, -1).join(' > ') || 'Root';
      if (!groups[groupKey]) {
        groups[groupKey] = { added: [], removed: [], modified: [] };
      }
      if (type === 'modified') {
        groups[groupKey].modified.push(data);
      } else {
        groups[groupKey][type].push(item);
      }
    };

    for (const item of diff.added) {
      addToGroup(item, 'added');
    }

    for (const item of diff.removed) {
      addToGroup(item, 'removed');
    }

    for (const mod of diff.modified) {
      addToGroup(mod.item, 'modified', mod);
    }

    return groups;
  }

  /**
   * Generate a text summary of changes (for clipboard)
   * @param {Object} diff - Diff result from compare()
   * @param {Object} options - Options for formatting
   * @returns {string} Text summary
   */
  function generateTextSummary(diff, options = {}) {
    const { oldDate, newDate } = options;
    const lines = [];

    // Header
    lines.push('BUDGET CHANGELOG');
    if (oldDate && newDate) {
      lines.push(`Comparing: ${oldDate} → ${newDate}`);
    }
    lines.push('');

    // Summary stats
    lines.push('SUMMARY:');
    lines.push(`  Cost Change: ${formatDelta(diff.summary.costChange, true)}`);
    lines.push(`  Price Change: ${formatDelta(diff.summary.priceChange, true)}`);
    lines.push(`  Items Added: ${diff.summary.addedCount}`);
    lines.push(`  Items Removed: ${diff.summary.removedCount}`);
    lines.push(`  Items Modified: ${diff.summary.modifiedCount}`);
    lines.push('');

    // Added items
    if (diff.added.length > 0) {
      lines.push('ADDED ITEMS:');
      for (const item of diff.added) {
        const location = item.hierarchy.join(' > ');
        lines.push(`  + ${item.name}`);
        lines.push(`    Location: ${location}`);
        if (item.extendedCost !== null) {
          lines.push(`    Cost: ${formatCurrency(item.extendedCost)}`);
        }
        if (item.extendedPrice !== null) {
          lines.push(`    Price: ${formatCurrency(item.extendedPrice)}`);
        }
        lines.push('');
      }
    }

    // Removed items
    if (diff.removed.length > 0) {
      lines.push('REMOVED ITEMS:');
      for (const item of diff.removed) {
        const location = item.hierarchy.join(' > ');
        lines.push(`  - ${item.name}`);
        lines.push(`    Location: ${location}`);
        if (item.extendedCost !== null) {
          lines.push(`    Cost: ${formatCurrency(item.extendedCost)}`);
        }
        if (item.extendedPrice !== null) {
          lines.push(`    Price: ${formatCurrency(item.extendedPrice)}`);
        }
        lines.push('');
      }
    }

    // Modified items
    if (diff.modified.length > 0) {
      lines.push('MODIFIED ITEMS:');
      for (const mod of diff.modified) {
        const location = mod.item.hierarchy.join(' > ');
        lines.push(`  ~ ${mod.item.name}`);
        lines.push(`    Location: ${location}`);
        for (const change of mod.changes) {
          if (change.isCurrency) {
            lines.push(`    ${change.label}: ${formatCurrency(change.oldValue)} → ${formatCurrency(change.newValue)}`);
          } else if (change.type === 'boolean') {
            lines.push(`    ${change.label}: ${change.oldValue} → ${change.newValue}`);
          } else if (change.type === 'text' && change.field === 'description') {
            lines.push(`    ${change.label}: (changed)`);
          } else {
            lines.push(`    ${change.label}: ${change.oldValue || '(empty)'} → ${change.newValue || '(empty)'}`);
          }
        }
        lines.push('');
      }
    }

    if (!diff.hasChanges) {
      lines.push('No changes detected between these backups.');
    }

    return lines.join('\n');
  }

  /**
   * Extract all unique cost group names from a diff result
   * @param {Object} diff - Diff result from compare()
   * @returns {Array} Sorted array of unique cost group names
   */
  function getUniqueCostGroups(diff) {
    const groups = new Set();
    const allItems = [
      ...diff.added.map(a => a.item || a),
      ...diff.removed.map(r => r.item || r),
      ...diff.modified.map(m => m.newItem || m.item || m),
      ...(diff.unchanged || []).map(u => u.item || u)
    ];
    allItems.forEach(item => {
      if (item.hierarchy && item.hierarchy.length > 0) {
        groups.add(item.hierarchy[0]);
      }
    });
    return Array.from(groups).sort();
  }

  // Public API
  return {
    compare,
    compareItems,
    groupByHierarchy,
    generateTextSummary,
    formatCurrency,
    formatDelta,
    getUniqueCostGroups
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.BudgetDiffEngine = BudgetDiffEngine;
}
