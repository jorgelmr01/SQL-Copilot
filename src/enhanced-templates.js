// Enhanced Template System with Schema-Aware Auto-Completion
// Automatically fills template variables using mapped schema metadata

class EnhancedTemplateSystem {
  constructor() {
    this.templates = window.SQLTemplates || {};
    this.schemaContext = null;
    this.mappedTables = new Map();
    this.mappedColumns = new Map();
  }

  // Set schema context from ERD state
  setSchemaContext(tables, relationships) {
    this.schemaContext = { tables, relationships };
    
    // Build lookup maps
    tables.forEach(table => {
      this.mappedTables.set(table.name.toLowerCase(), table);
      
      (table.columns || []).forEach(col => {
        const key = `${table.name.toLowerCase()}.${col.name.toLowerCase()}`;
        this.mappedColumns.set(key, { table, column: col });
      });
    });
  }

  // Auto-fill template with intelligent schema mapping
  autoFillTemplate(templateKey, userHints = {}) {
    const template = this.getTemplate(templateKey);
    if (!template) {
      return { error: 'Template not found', template: templateKey };
    }

    const autoMappings = this.generateAutoMappings(template, userHints);
    const filledSQL = this.fillTemplate(template.template, autoMappings);
    
    return {
      sql: filledSQL,
      mappings: autoMappings,
      template: template,
      confidence: this.calculateConfidence(autoMappings),
      suggestions: this.generateSuggestions(template, autoMappings)
    };
  }

  // Get template by key
  getTemplate(key) {
    const parts = key.split('.');
    let template = this.templates;
    
    for (const part of parts) {
      template = template[part];
      if (!template) return null;
    }
    
    return template;
  }

  // Generate automatic mappings based on schema context
  generateAutoMappings(template, userHints) {
    const mappings = { ...userHints };
    const variables = template.variables || [];
    
    variables.forEach(varName => {
      if (mappings[varName]) return; // Already provided by user
      
      const value = this.inferVariableValue(varName, template);
      if (value) {
        mappings[varName] = value;
      }
    });
    
    return mappings;
  }

  // Infer variable value from schema context
  inferVariableValue(varName, template) {
    if (!this.schemaContext?.tables?.length) return null;
    
    const lowerName = varName.toLowerCase();
    const category = template.category?.toLowerCase() || '';
    
    // Schema name inference
    if (lowerName.includes('schema') || lowerName === 'target_schema' || lowerName === 'source_schema') {
      if (lowerName.includes('target') || lowerName.includes('gold')) {
        return 'gold';
      } else if (lowerName.includes('silver') || lowerName.includes('staging')) {
        return 'silver';
      } else if (lowerName.includes('bronze') || lowerName.includes('raw') || lowerName.includes('source')) {
        return 'bronze';
      }
      // Default to first table's schema
      const firstTable = this.schemaContext.tables[0];
      return firstTable.schema || 'public';
    }
    
    // Table name inference
    if (lowerName.includes('table')) {
      return this.inferTableName(varName, category);
    }
    
    // Column name inference
    if (lowerName.includes('column') || lowerName.includes('key') || lowerName.includes('field')) {
      return this.inferColumnName(varName, category);
    }
    
    // Date/timestamp inference
    if (lowerName.includes('timestamp') || lowerName.includes('date')) {
      if (lowerName.includes('start')) {
        return "CURRENT_DATE - INTERVAL '30' DAY";
      } else if (lowerName.includes('end')) {
        return "CURRENT_DATE";
      }
      // Find timestamp column
      return this.findTimestampColumn();
    }
    
    // Metric/measure column inference
    if (lowerName.includes('metric') || lowerName.includes('measure') || lowerName.includes('amount')) {
      return this.findMetricColumn();
    }
    
    // Dimension column inference
    if (lowerName.includes('dimension')) {
      return this.findDimensionColumns();
    }
    
    // Primary key inference
    if (lowerName.includes('primary_key') || lowerName.includes('pk')) {
      return this.findPrimaryKey();
    }
    
    // Foreign key inference
    if (lowerName.includes('foreign_key') || lowerName.includes('fk')) {
      return this.findForeignKey();
    }
    
    return null;
  }

  // Infer table name based on context
  inferTableName(varName, category) {
    const lowerName = varName.toLowerCase();
    const tables = this.schemaContext.tables;
    
    // Target table (usually gold/silver layer)
    if (lowerName.includes('target')) {
      const goldTables = tables.filter(t => t.tableType === 'gold' || t.schema === 'gold');
      if (goldTables.length > 0) return goldTables[0].name;
      
      const silverTables = tables.filter(t => t.tableType === 'silver' || t.schema === 'silver');
      if (silverTables.length > 0) return silverTables[0].name;
    }
    
    // Source table (usually bronze/raw layer)
    if (lowerName.includes('source')) {
      const bronzeTables = tables.filter(t => t.tableType === 'bronze' || t.schema === 'bronze');
      if (bronzeTables.length > 0) return bronzeTables[0].name;
    }
    
    // Fact table
    if (lowerName.includes('fact')) {
      const factTables = tables.filter(t => 
        t.tableType === 'fact' || 
        t.name.toLowerCase().includes('fact') ||
        t.is_aggregated
      );
      if (factTables.length > 0) return factTables[0].name;
    }
    
    // Dimension table
    if (lowerName.includes('dim')) {
      const dimTables = tables.filter(t => 
        t.tableType === 'dimension' || 
        t.name.toLowerCase().includes('dim')
      );
      if (dimTables.length > 0) return dimTables[0].name;
    }
    
    // Default to first table
    return tables[0]?.name || null;
  }

  // Infer column name based on context
  inferColumnName(varName, category) {
    const lowerName = varName.toLowerCase();
    const tables = this.schemaContext.tables;
    
    // Search all tables for matching column
    for (const table of tables) {
      const columns = table.columns || [];
      
      // Primary key
      if (lowerName.includes('pk') || lowerName.includes('primary')) {
        const pkCol = columns.find(c => c.isPK);
        if (pkCol) return pkCol.name;
      }
      
      // Timestamp
      if (lowerName.includes('timestamp') || (lowerName.includes('date') && !lowerName.includes('update'))) {
        const tsCol = columns.find(c => 
          c.type?.includes('TIMESTAMP') || 
          c.name.toLowerCase().includes('timestamp') ||
          c.name.toLowerCase().includes('_at') ||
          c.name.toLowerCase().includes('_date')
        );
        if (tsCol) return tsCol.name;
      }
      
      // Email
      if (lowerName.includes('email')) {
        const emailCol = columns.find(c => c.name.toLowerCase().includes('email'));
        if (emailCol) return emailCol.name;
      }
      
      // Phone
      if (lowerName.includes('phone')) {
        const phoneCol = columns.find(c => c.name.toLowerCase().includes('phone'));
        if (phoneCol) return phoneCol.name;
      }
      
      // Name/text column
      if (lowerName.includes('text') || lowerName.includes('name')) {
        const textCol = columns.find(c => 
          c.type?.includes('VARCHAR') || 
          c.name.toLowerCase().includes('name')
        );
        if (textCol) return textCol.name;
      }
      
      // Numeric column
      if (lowerName.includes('numeric') || lowerName.includes('amount')) {
        const numCol = columns.find(c => 
          c.type?.includes('DECIMAL') || 
          c.type?.includes('NUMERIC') ||
          c.name.toLowerCase().includes('amount') ||
          c.name.toLowerCase().includes('total')
        );
        if (numCol) return numCol.name;
      }
    }
    
    return null;
  }

  // Find timestamp column
  findTimestampColumn() {
    for (const table of this.schemaContext.tables) {
      const tsCol = (table.columns || []).find(c => 
        c.type?.includes('TIMESTAMP') || 
        c.name.toLowerCase().includes('timestamp') ||
        c.name.toLowerCase().endsWith('_at')
      );
      if (tsCol) return tsCol.name;
    }
    return 'created_at';
  }

  // Find metric column
  findMetricColumn() {
    for (const table of this.schemaContext.tables) {
      const metricCol = (table.columns || []).find(c => 
        c.type?.includes('DECIMAL') || 
        c.type?.includes('NUMERIC') ||
        c.type?.includes('DOUBLE') ||
        c.name.toLowerCase().includes('amount') ||
        c.name.toLowerCase().includes('total') ||
        c.name.toLowerCase().includes('revenue')
      );
      if (metricCol) return metricCol.name;
    }
    return 'amount';
  }

  // Find dimension columns
  findDimensionColumns() {
    const dimCols = [];
    
    for (const table of this.schemaContext.tables) {
      const cols = (table.columns || []).filter(c => 
        !c.isPK && 
        !c.isFK &&
        (c.type?.includes('VARCHAR') || c.type?.includes('DATE'))
      );
      dimCols.push(...cols.slice(0, 3).map(c => c.name));
    }
    
    return dimCols.join(', ') || 'dimension_column';
  }

  // Find primary key
  findPrimaryKey() {
    for (const table of this.schemaContext.tables) {
      const pkCol = (table.columns || []).find(c => c.isPK);
      if (pkCol) return pkCol.name;
    }
    return 'id';
  }

  // Find foreign key
  findForeignKey() {
    for (const table of this.schemaContext.tables) {
      const fkCol = (table.columns || []).find(c => c.isFK);
      if (fkCol) return fkCol.name;
    }
    return 'id';
  }

  // Fill template with mappings
  fillTemplate(template, mappings) {
    let filled = template;
    
    Object.entries(mappings).forEach(([key, value]) => {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      filled = filled.replace(pattern, value);
    });
    
    return filled;
  }

  // Calculate confidence score for auto-mappings
  calculateConfidence(mappings) {
    const total = Object.keys(mappings).length;
    if (total === 0) return 0;
    
    // Check how many values are not placeholders
    const resolved = Object.values(mappings).filter(v => 
      !v.includes('{{') && !v.includes('}}')
    ).length;
    
    return Math.round((resolved / total) * 100);
  }

  // Generate suggestions for missing mappings
  generateSuggestions(template, mappings) {
    const suggestions = [];
    const variables = template.variables || [];
    
    variables.forEach(varName => {
      const value = mappings[varName];
      if (!value || value.includes('{{')) {
        suggestions.push({
          variable: varName,
          message: `Please provide a value for '${varName}'`,
          options: this.getSuggestionsForVariable(varName)
        });
      }
    });
    
    return suggestions;
  }

  // Get suggestions for a variable
  getSuggestionsForVariable(varName) {
    const lowerName = varName.toLowerCase();
    const options = [];
    
    if (lowerName.includes('table')) {
      const tables = this.schemaContext?.tables || [];
      options.push(...tables.map(t => t.name));
    }
    
    if (lowerName.includes('column')) {
      const allColumns = new Set();
      (this.schemaContext?.tables || []).forEach(table => {
        (table.columns || []).forEach(col => {
          allColumns.add(col.name);
        });
      });
      options.push(...Array.from(allColumns));
    }
    
    if (lowerName.includes('schema')) {
      options.push('bronze', 'silver', 'gold');
    }
    
    return options;
  }

  // Get all templates organized by category
  getTemplatesByCategory() {
    const categorized = {};
    
    Object.entries(this.templates).forEach(([categoryKey, category]) => {
      if (typeof category === 'object' && !category.template) {
        Object.entries(category).forEach(([templateKey, template]) => {
          if (template.template) {
            const cat = template.category || 'Other';
            if (!categorized[cat]) categorized[cat] = [];
            categorized[cat].push({
              key: `${categoryKey}.${templateKey}`,
              name: template.name,
              description: template.description,
              dialect: template.dialect,
              variables: template.variables
            });
          }
        });
      }
    });
    
    return categorized;
  }

  // Generate template selection UI HTML
  generateTemplateSelectionUI() {
    const categorized = this.getTemplatesByCategory();
    
    let html = '<div class="template-categories">';
    
    Object.entries(categorized).forEach(([category, templates]) => {
      html += `
        <div class="template-category">
          <h4 class="text-sm font-semibold text-gray-300 mb-2">${category}</h4>
          <div class="space-y-1">
            ${templates.map(template => `
              <button onclick="selectTemplate('${template.key}')" 
                      class="w-full text-left p-3 bg-surface-light hover:bg-surface-lighter rounded-lg transition-colors">
                <div class="font-medium text-sm">${template.name}</div>
                <div class="text-xs text-gray-500 mt-1">${template.description}</div>
                <div class="flex gap-2 mt-2">
                  <span class="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">${template.dialect}</span>
                  <span class="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">${template.variables.length} variables</span>
                </div>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    return html;
  }

  // Generate quick-start SQL based on schema
  generateQuickStart(type = 'select') {
    if (!this.schemaContext?.tables?.length) {
      return '-- No schema available. Please load your schema first.';
    }
    
    const table = this.schemaContext.tables[0];
    const columns = table.columns || [];
    
    switch (type) {
      case 'select':
        return this.generateSelectQuery(table);
      case 'aggregate':
        return this.generateAggregateQuery(table);
      case 'join':
        return this.generateJoinQuery();
      case 'cte':
        return this.generateCTEQuery(table);
      default:
        return this.generateSelectQuery(table);
    }
  }

  // Generate SELECT query
  generateSelectQuery(table) {
    const columns = table.columns || [];
    const colNames = columns.slice(0, 10).map(c => `  ${c.name}`).join(',\n');
    const schemaPrefix = table.schema ? `${table.schema}.` : '';
    
    return `-- Basic SELECT query
SELECT
${colNames}
FROM ${schemaPrefix}${table.name}
WHERE 1=1
ORDER BY ${columns[0]?.name || 'id'}
LIMIT 100;`;
  }

  // Generate aggregate query
  generateAggregateQuery(table) {
    const columns = table.columns || [];
    const pkCol = columns.find(c => c.isPK) || columns[0];
    const metricCol = columns.find(c => 
      c.type?.includes('DECIMAL') || c.type?.includes('NUMERIC')
    ) || columns[1];
    const dimCol = columns.find(c => 
      c.type?.includes('VARCHAR') && !c.isPK
    ) || columns[2];
    const schemaPrefix = table.schema ? `${table.schema}.` : '';
    
    return `-- Aggregate query
SELECT
  ${dimCol?.name || 'dimension_col'},
  COUNT(*) as record_count,
  COUNT(DISTINCT ${pkCol?.name || 'id'}) as unique_count,
  ${metricCol ? `SUM(${metricCol.name}) as total_${metricCol.name},` : ''}
  ${metricCol ? `AVG(${metricCol.name}) as avg_${metricCol.name}` : ''}
FROM ${schemaPrefix}${table.name}
GROUP BY 1
ORDER BY 2 DESC
LIMIT 100;`;
  }

  // Generate JOIN query
  generateJoinQuery() {
    const tables = this.schemaContext.tables;
    if (tables.length < 2) return this.generateSelectQuery(tables[0]);
    
    const table1 = tables[0];
    const table2 = tables[1];
    
    // Find potential join columns
    const joinRel = this.schemaContext.relationships?.find(r => 
      (r.from.table === table1.name && r.to.table === table2.name) ||
      (r.from.table === table2.name && r.to.table === table1.name)
    );
    
    const joinCol1 = joinRel ? joinRel.from.column : (table1.columns?.find(c => c.isPK)?.name || 'id');
    const joinCol2 = joinRel ? joinRel.to.column : (table2.columns?.find(c => c.isFK)?.name || 'id');
    
    const schema1 = table1.schema ? `${table1.schema}.` : '';
    const schema2 = table2.schema ? `${table2.schema}.` : '';
    
    return `-- JOIN query
SELECT
  t1.*,
  t2.*
FROM ${schema1}${table1.name} t1
INNER JOIN ${schema2}${table2.name} t2 
  ON t1.${joinCol1} = t2.${joinCol2}
WHERE 1=1
LIMIT 100;`;
  }

  // Generate CTE query
  generateCTEQuery(table) {
    const schemaPrefix = table.schema ? `${table.schema}.` : '';
    const columns = table.columns || [];
    const pkCol = columns.find(c => c.isPK) || columns[0];
    
    return `-- CTE query example
WITH base_data AS (
  SELECT *
  FROM ${schemaPrefix}${table.name}
  WHERE 1=1
),
aggregated AS (
  SELECT
    ${pkCol?.name || 'id'},
    COUNT(*) as count
  FROM base_data
  GROUP BY 1
)
SELECT *
FROM aggregated
ORDER BY count DESC
LIMIT 100;`;
  }
}

// Export for use in main application
window.EnhancedTemplateSystem = EnhancedTemplateSystem;
