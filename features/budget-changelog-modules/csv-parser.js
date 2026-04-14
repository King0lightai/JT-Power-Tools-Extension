// Budget Changelog - CSV Parser Module
// Parses JobTread budget backup CSV files into structured data

const BudgetCSVParser = (() => {
  /**
   * Parse a CSV string into an array of budget items
   * Handles multiline fields, quoted values, and BOM characters
   * @param {string} csvText - Raw CSV text content
   * @returns {Array} Array of parsed budget item objects
   */
  function parse(csvText) {
    // Remove BOM character if present
    if (csvText.charCodeAt(0) === 0xFEFF) {
      csvText = csvText.slice(1);
    }

    const lines = parseCSVLines(csvText);
    if (lines.length < 2) {
      return [];
    }

    // First line is headers
    const headers = lines[0];
    const items = [];

    // Parse each data row
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i];
      if (values.length === 0 || (values.length === 1 && values[0] === '')) {
        continue; // Skip empty rows
      }

      const item = parseRow(headers, values);
      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  /**
   * Parse CSV text respecting quoted fields with newlines
   * @param {string} csvText - Raw CSV text
   * @returns {Array<Array<string>>} Array of rows, each row is array of values
   */
  function parseCSVLines(csvText) {
    const rows = [];
    let currentRow = [];
    let currentValue = '';
    let insideQuotes = false;
    let i = 0;

    while (i < csvText.length) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (insideQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            // Escaped quote
            currentValue += '"';
            i += 2;
          } else {
            // End of quoted field
            insideQuotes = false;
            i++;
          }
        } else {
          currentValue += char;
          i++;
        }
      } else {
        if (char === '"') {
          // Start of quoted field
          insideQuotes = true;
          i++;
        } else if (char === ',') {
          // Field separator
          currentRow.push(currentValue);
          currentValue = '';
          i++;
        } else if (char === '\r' && nextChar === '\n') {
          // Windows line ending
          currentRow.push(currentValue);
          rows.push(currentRow);
          currentRow = [];
          currentValue = '';
          i += 2;
        } else if (char === '\n') {
          // Unix line ending
          currentRow.push(currentValue);
          rows.push(currentRow);
          currentRow = [];
          currentValue = '';
          i++;
        } else {
          currentValue += char;
          i++;
        }
      }
    }

    // Don't forget last value/row
    if (currentValue || currentRow.length > 0) {
      currentRow.push(currentValue);
      rows.push(currentRow);
    }

    return rows;
  }

  /**
   * Parse a single row into a structured budget item
   * @param {Array<string>} headers - Column headers
   * @param {Array<string>} values - Row values
   * @returns {Object|null} Parsed budget item or null if invalid
   */
  function parseRow(headers, values) {
    const item = {
      // Core identification
      costGroup: '',
      hierarchy: [],
      name: '',
      description: '',

      // Quantities
      quantity: null,
      quantityFormula: '',
      unit: '',

      // Costs
      unitCost: null,
      unitCostFormula: '',
      extendedCost: null,

      // Prices
      unitPrice: null,
      unitPriceFormula: '',
      extendedPrice: null,

      // Metadata
      taxable: false,
      costType: '',
      costCode: '',
      selected: false,
      minSelections: null,
      maxSelections: null,

      // Custom fields (dynamic)
      customFields: {},

      // Computed
      isGroup: false,
      uniqueKey: ''
    };

    // Map values to item properties
    for (let i = 0; i < headers.length && i < values.length; i++) {
      const header = headers[i].trim();
      const value = values[i];

      switch (header) {
        case 'Cost Group':
          item.costGroup = value;
          item.hierarchy = parseHierarchy(value);
          break;
        case 'Cost Item Name':
          item.name = value;
          break;
        case 'Description':
          item.description = value;
          break;
        case 'Quantity':
          item.quantity = parseNumber(value);
          break;
        case 'Quantity Formula':
          item.quantityFormula = value;
          break;
        case 'Unit':
          item.unit = value;
          break;
        case 'Unit Cost':
          item.unitCost = parseNumber(value);
          break;
        case 'Unit Cost Formula':
          item.unitCostFormula = value;
          break;
        case 'Extended Cost':
          item.extendedCost = parseCurrency(value);
          break;
        case 'Unit Price':
          item.unitPrice = parseNumber(value);
          break;
        case 'Unit Price Formula':
          item.unitPriceFormula = value;
          break;
        case 'Extended Price':
          item.extendedPrice = parseCurrency(value);
          break;
        case 'Taxable':
          item.taxable = value.toLowerCase() === 'true';
          break;
        case 'Cost Type':
          item.costType = value;
          break;
        case 'Cost Code':
          item.costCode = value;
          break;
        case 'Selected':
          item.selected = value.toLowerCase() === 'true';
          break;
        case 'Minimum Selections':
          item.minSelections = parseNumber(value);
          break;
        case 'Maximum Selections':
          item.maxSelections = parseNumber(value);
          break;
        default:
          // Handle custom fields (start with "Custom: ")
          if (header.startsWith('Custom: ')) {
            const fieldName = header.replace('Custom: ', '');
            item.customFields[fieldName] = value;
          }
          break;
      }
    }

    // Determine if this is a group (container) row
    // Groups have no name and typically $0.00 values
    item.isGroup = !item.name && item.hierarchy.length > 0;

    // Generate unique key for matching items across backups
    item.uniqueKey = generateUniqueKey(item);

    return item;
  }

  /**
   * Parse hierarchy from Cost Group string
   * e.g., "SCOPE OF WORK; DEMOLITION; DEMO LABOR" -> ["SCOPE OF WORK", "DEMOLITION", "DEMO LABOR"]
   * @param {string} costGroup - Cost Group value
   * @returns {Array<string>} Hierarchy path
   */
  function parseHierarchy(costGroup) {
    if (!costGroup) return [];
    return costGroup.split(';').map(part => part.trim()).filter(part => part);
  }

  /**
   * Parse a number from string, handling empty values
   * @param {string} value - String value
   * @returns {number|null} Parsed number or null
   */
  function parseNumber(value) {
    if (!value || value.trim() === '') return null;
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  }

  /**
   * Parse currency value (handles $X.XX format)
   * @param {string} value - Currency string
   * @returns {number|null} Parsed number or null
   */
  function parseCurrency(value) {
    if (!value || value.trim() === '') return null;
    // Remove $ and commas
    const cleaned = value.replace(/[$,]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  /**
   * Generate a unique key for matching items between backups
   * Uses: hierarchy path + name + cost code
   * @param {Object} item - Parsed budget item
   * @returns {string} Unique key
   */
  function generateUniqueKey(item) {
    const parts = [
      item.hierarchy.join(' > '),
      item.name || '[GROUP]',
      item.costCode || ''
    ];
    return parts.join('|').toLowerCase();
  }

  /**
   * Get summary statistics for a parsed budget
   * @param {Array} items - Parsed budget items
   * @returns {Object} Summary stats
   */
  function getSummary(items) {
    const lineItems = items.filter(i => !i.isGroup);
    const groups = items.filter(i => i.isGroup);

    let totalCost = 0;
    let totalPrice = 0;

    for (const item of lineItems) {
      if (item.extendedCost !== null) totalCost += item.extendedCost;
      if (item.extendedPrice !== null) totalPrice += item.extendedPrice;
    }

    return {
      totalItems: items.length,
      lineItemCount: lineItems.length,
      groupCount: groups.length,
      totalCost,
      totalPrice,
      costTypes: [...new Set(lineItems.map(i => i.costType).filter(t => t))]
    };
  }

  /**
   * Build a hierarchical tree structure from flat items
   * Useful for displaying in a tree view
   * @param {Array} items - Flat array of parsed items
   * @returns {Object} Nested tree structure
   */
  function buildTree(items) {
    const root = { children: {}, items: [] };

    for (const item of items) {
      let current = root;

      for (const segment of item.hierarchy) {
        if (!current.children[segment]) {
          current.children[segment] = { children: {}, items: [] };
        }
        current = current.children[segment];
      }

      if (!item.isGroup) {
        current.items.push(item);
      }
    }

    return root;
  }

  // Public API
  return {
    parse,
    parseCSVLines,
    parseHierarchy,
    getSummary,
    buildTree,
    generateUniqueKey
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.BudgetCSVParser = BudgetCSVParser;
}
