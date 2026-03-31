// Smart Code Generator - Production-Ready SQL Generation
// Leverages table mapping, schema metadata, and dialect-specific optimizations

class SmartCodeGenerator {
  constructor(dialect = 'presto') {
    this.dialect = dialect;
    this.schemaMetadata = null;
    this.enhancedMetadata = null;
    this.optimizationHints = [];
    this.validationErrors = [];
    this.warnings = [];
  }

  // Set schema context from AppState
  setSchemaContext(tables, relationships, enhancedData = null) {
    this.schemaMetadata = {
      tables: tables || [],
      relationships: relationships || [],
      tableMap: new Map((tables || []).map(t => [t.name.toLowerCase(), t])),
      columnMap: new Map()
    };
    
    // Build column map for fast lookup
    (tables || []).forEach(table => {
      (table.columns || []).forEach(col => {
        const key = `${table.name.toLowerCase()}.${col.name.toLowerCase()}`;
        this.columnMap.set(key, { table, column: col });
      });
    });
    
    this.enhancedMetadata = enhancedData;
  }

  // Generate production-ready SQL from template and mappings
  generateProductionSQL(template, mappings, options = {}) {
    this.optimizationHints = [];
    this.validationErrors = [];
    this.warnings = [];
    
    const {
      addComments = true,
      addOptimizationHints = true,
      validateSchema = true,
      formatCode = true,
      addMetadata = true
    } = options;
    
    // Step 1: Resolve template variables with actual schema
    let sql = this.resolveTemplateVariables(template, mappings);
    
    // Step 2: Validate against schema
    if (validateSchema && this.schemaMetadata) {
      this.validateSQL(sql);
    }
    
    // Step 3: Apply dialect-specific optimizations
    sql = this.applyDialectOptimizations(sql);
    
    // Step 4: Add helpful comments
    if (addComments) {
      sql = this.addInlineComments(sql, mappings);
    }
    
    // Step 5: Format code
    if (formatCode) {
      sql = this.formatSQL(sql);
    }
    
    // Step 6: Add metadata header
    if (addMetadata) {
      sql = this.addMetadataHeader(sql, options.metadata);
    }
    
    // Step 7: Add optimization hints as comments
    if (addOptimizationHints && this.optimizationHints.length > 0) {
      sql = this.addOptimizationHintsToSQL(sql);
    }
    
    return {
      sql,
      hints: this.optimizationHints,
      errors: this.validationErrors,
      warnings: this.warnings,
      isValid: this.validationErrors.length === 0
    };
  }

  // Resolve template variables using mappings and schema intelligence
  resolveTemplateVariables(template, mappings) {
    let sql = template;
    const variablePattern = /\{\{(\w+)\}\}/g;
    
    // Extract all variables
    const variables = new Set();
    let match;
    while ((match = variablePattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
    
    // Resolve each variable
    variables.forEach(varName => {
      const value = this.resolveVariable(varName, mappings);
      const pattern = new RegExp(`\\{\\{${varName}\\}\\}`, 'g');
      sql = sql.replace(pattern, value);
    });
    
    return sql;
  }

  // Intelligent variable resolution with schema context
  resolveVariable(varName, mappings) {
    // First check explicit mappings
    if (mappings[varName]) {
      return mappings[varName];
    }
    
    // Try to infer from schema based on variable name patterns
    const lowerName = varName.toLowerCase();
    
    // Table patterns
    if (lowerName.includes('table') || lowerName.includes('source') || lowerName.includes('target')) {
      return this.inferTableName(varName);
    }
    
    // Column patterns
    if (lowerName.includes('column') || lowerName.includes('key') || lowerName.includes('field')) {
      return this.inferColumnName(varName);
    }
    
    // Date patterns
    if (lowerName.includes('date') && (lowerName.includes('start') || lowerName.includes('end'))) {
      return this.inferDateValue(varName);
    }
    
    // Schema patterns
    if (lowerName.includes('schema')) {
      return this.inferSchemaName(varName);
    }
    
    // Return placeholder if cannot resolve
    this.warnings.push({
      type: 'UNRESOLVED_VARIABLE',
      variable: varName,
      message: `Could not resolve variable '${varName}' - using placeholder`
    });
    
    return `{{${varName}}}`;
  }

  // Infer table name from schema
  inferTableName(varName) {
    if (!this.schemaMetadata?.tables?.length) return `{{${varName}}}`;
    
    const lowerName = varName.toLowerCase();
    
    // Try pattern matching
    if (lowerName.includes('fact')) {
      const factTables = this.schemaMetadata.tables.filter(t => 
        t.tableType === 'fact' || t.name.toLowerCase().includes('fact')
      );
      if (factTables.length > 0) {
        this.optimizationHints.push({
          type: 'AUTO_INFERRED',
          message: `Auto-selected fact table: ${factTables[0].name}`
        });
        return factTables[0].name;
      }
    }
    
    if (lowerName.includes('dim')) {
      const dimTables = this.schemaMetadata.tables.filter(t => 
        t.tableType === 'dimension' || t.name.toLowerCase().includes('dim')
      );
      if (dimTables.length > 0) {
        this.optimizationHints.push({
          type: 'AUTO_INFERRED',
          message: `Auto-selected dimension table: ${dimTables[0].name}`
        });
        return dimTables[0].name;
      }
    }
    
    // Return first table as fallback
    if (this.schemaMetadata.tables.length > 0) {
      return this.schemaMetadata.tables[0].name;
    }
    
    return `{{${varName}}}`;
  }

  // Infer column name from schema
  inferColumnName(varName) {
    if (!this.schemaMetadata?.tables?.length) return `{{${varName}}}`;
    
    const lowerName = varName.toLowerCase();
    
    // Primary key patterns
    if (lowerName.includes('pk') || lowerName.includes('primary')) {
      for (const table of this.schemaMetadata.tables) {
        const pkCol = (table.columns || []).find(c => c.isPK);
        if (pkCol) {
          return pkCol.name;
        }
      }
    }
    
    // Timestamp patterns
    if (lowerName.includes('timestamp') || lowerName.includes('date')) {
      for (const table of this.schemaMetadata.tables) {
        const dateCol = (table.columns || []).find(c => 
          c.type?.includes('TIMESTAMP') || c.type?.includes('DATE') ||
          c.name.toLowerCase().includes('timestamp') || c.name.toLowerCase().includes('date')
        );
        if (dateCol) {
          return dateCol.name;
        }
      }
    }
    
    return `{{${varName}}}`;
  }

  // Infer date values
  inferDateValue(varName) {
    const lowerName = varName.toLowerCase();
    
    if (lowerName.includes('start')) {
      return "CURRENT_DATE - INTERVAL '30' DAY";
    }
    
    if (lowerName.includes('end')) {
      return "CURRENT_DATE";
    }
    
    return `{{${varName}}}`;
  }

  // Infer schema name
  inferSchemaName(varName) {
    if (!this.schemaMetadata?.tables?.length) return `{{${varName}}}`;
    
    const lowerName = varName.toLowerCase();
    
    if (lowerName.includes('bronze') || lowerName.includes('raw')) {
      return 'bronze';
    }
    
    if (lowerName.includes('silver') || lowerName.includes('staging')) {
      return 'silver';
    }
    
    if (lowerName.includes('gold')) {
      return 'gold';
    }
    
    // Extract schema from first table
    const firstTable = this.schemaMetadata.tables[0];
    if (firstTable.schema) {
      return firstTable.schema;
    }
    
    return `{{${varName}}}`;
  }

  // Validate SQL against schema
  validateSQL(sql) {
    if (!this.schemaMetadata) return;
    
    // Extract table references
    const tablePattern = /(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi;
    let match;
    
    while ((match = tablePattern.exec(sql)) !== null) {
      const tableName = match[1].toLowerCase();
      
      // Check if table exists in schema
      if (!this.schemaMetadata.tableMap.has(tableName)) {
        // Check with schema prefix
        const hasSchemaPrefix = tableName.includes('.');
        if (!hasSchemaPrefix) {
          let found = false;
          for (const [key, table] of this.schemaMetadata.tableMap) {
            if (key.endsWith(`.${tableName}`)) {
              found = true;
              this.warnings.push({
                type: 'MISSING_SCHEMA_PREFIX',
                table: tableName,
                suggestion: key,
                message: `Table '${tableName}' should include schema prefix: '${key}'`
              });
              break;
            }
          }
          
          if (!found) {
            this.validationErrors.push({
              type: 'UNKNOWN_TABLE',
              table: tableName,
              message: `Table '${tableName}' not found in schema`
            });
          }
        } else {
          this.validationErrors.push({
            type: 'UNKNOWN_TABLE',
            table: tableName,
            message: `Table '${tableName}' not found in schema`
          });
        }
      }
    }
    
    // Extract column references
    const columnPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)/g;
    
    while ((match = columnPattern.exec(sql)) !== null) {
      const table = match[1].toLowerCase();
      const column = match[2].toLowerCase();
      const key = `${table}.${column}`;
      
      // Skip if it's a schema.table reference
      if (sql.slice(Math.max(0, match.index - 10), match.index).match(/FROM|JOIN/i)) {
        continue;
      }
      
      // Check if column exists
      if (!this.columnMap.has(key)) {
        this.warnings.push({
          type: 'UNKNOWN_COLUMN',
          column: key,
          message: `Column '${key}' not found in schema`
        });
      }
    }
  }

  // Apply dialect-specific optimizations
  applyDialectOptimizations(sql) {
    switch (this.dialect) {
      case 'presto':
      case 'athena':
        return this.optimizeForAthena(sql);
      case 'spark':
        return this.optimizeForSpark(sql);
      case 'pyspark':
        return this.convertToPySpark(sql);
      default:
        return sql;
    }
  }

  // Athena/Presto specific optimizations
  optimizeForAthena(sql) {
    let optimized = sql;
    
    // Add partition pruning hints
    if (sql.match(/WHERE.*date|timestamp/i)) {
      this.optimizationHints.push({
        type: 'PARTITION_PRUNING',
        message: 'Ensure date/timestamp filters use partitioned columns for better performance'
      });
    }
    
    // Suggest CTAS over INSERT for better performance
    if (sql.match(/INSERT\s+INTO/i) && !sql.match(/CREATE\s+TABLE/i)) {
      this.optimizationHints.push({
        type: 'CTAS_RECOMMENDATION',
        message: 'Consider using CREATE TABLE AS SELECT (CTAS) instead of INSERT INTO for better performance in Athena'
      });
    }
    
    // Add bucketing suggestions for large tables
    if (sql.match(/GROUP\s+BY|JOIN/i)) {
      this.optimizationHints.push({
        type: 'BUCKETING',
        message: 'For large tables, consider bucketing on join/group keys'
      });
    }
    
    // Replace QUALIFY with equivalent if present (Athena doesn't support QUALIFY)
    if (sql.includes('QUALIFY')) {
      optimized = this.convertQualifyToSubquery(optimized);
      this.optimizationHints.push({
        type: 'QUALIFY_CONVERSION',
        message: 'Converted QUALIFY to subquery (Athena compatible)'
      });
    }
    
    return optimized;
  }

  // Spark SQL specific optimizations
  optimizeForSpark(sql) {
    let optimized = sql;
    
    // Add broadcast hint for small dimension tables
    if (sql.match(/JOIN/i) && this.schemaMetadata) {
      const tables = this.extractTableReferences(sql);
      tables.forEach(tableName => {
        const table = this.schemaMetadata.tableMap.get(tableName.toLowerCase());
        if (table && table.tableType === 'dimension') {
          this.optimizationHints.push({
            type: 'BROADCAST_JOIN',
            table: tableName,
            message: `Consider adding /*+ BROADCAST(${tableName}) */ hint for dimension table`
          });
        }
      });
    }
    
    // Suggest caching for reused CTEs
    if (sql.match(/WITH\s+\w+\s+AS/gi)) {
      const cteCount = (sql.match(/WITH\s+\w+\s+AS/gi) || []).length;
      if (cteCount > 2) {
        this.optimizationHints.push({
          type: 'CACHE_CTE',
          message: 'Consider caching intermediate CTEs that are used multiple times'
        });
      }
    }
    
    return optimized;
  }

  // Convert QUALIFY to subquery (Athena compatible)
  convertQualifyToSubquery(sql) {
    // This is a simplified conversion - full implementation would need SQL parsing
    const qualifyMatch = sql.match(/QUALIFY\s+(.+?)(?:;|$)/is);
    if (!qualifyMatch) return sql;
    
    const qualifyCondition = qualifyMatch[1];
    const beforeQualify = sql.substring(0, qualifyMatch.index);
    
    return `
SELECT * FROM (
${beforeQualify}
) qualified_results
WHERE ${qualifyCondition};`;
  }

  // Convert SQL to PySpark code
  convertToPySpark(sql) {
    // This is a placeholder for PySpark conversion
    // Would need full SQL parsing to properly convert
    this.optimizationHints.push({
      type: 'PYSPARK_CONVERSION',
      message: 'PySpark conversion requires manual review - SQL structure provided as comment'
    });
    
    return `# Original SQL:
# ${sql.replace(/\n/g, '\n# ')}

# PySpark equivalent (review and adjust):
from pyspark.sql import functions as F
from pyspark.sql.window import Window

# Load source tables
# df = spark.table("your_table")

# Apply transformations
# result = df.select(...).filter(...).groupBy(...).agg(...)

# Write result
# result.write.saveAsTable("target_table")`;
  }

  // Add inline comments explaining the SQL
  addInlineComments(sql, mappings) {
    let commented = sql;
    
    // Add header comment
    const header = `-- Generated SQL for ${this.dialect.toUpperCase()}
-- Date: ${new Date().toISOString().split('T')[0]}
-- Mapped Tables: ${Object.keys(mappings).filter(k => k.includes('table')).length}
-- Validated: ${this.validationErrors.length === 0 ? 'Yes' : 'No'}
\n`;
    
    commented = header + commented;
    
    // Add comments for complex operations
    commented = commented.replace(/WITH\s+(\w+)\s+AS/gi, (match, cteName) => {
      return `-- CTE: ${cteName}\n${match}`;
    });
    
    commented = commented.replace(/GROUP\s+BY/gi, (match) => {
      return `\n-- Aggregation\n${match}`;
    });
    
    commented = commented.replace(/JOIN/gi, (match) => {
      return `\n-- Join operation\n${match}`;
    });
    
    return commented;
  }

  // Format SQL for readability
  formatSQL(sql) {
    let formatted = sql;
    
    // Add proper indentation
    formatted = formatted
      .replace(/\bSELECT\b/gi, '\nSELECT')
      .replace(/\bFROM\b/gi, '\nFROM')
      .replace(/\bWHERE\b/gi, '\nWHERE')
      .replace(/\bGROUP BY\b/gi, '\nGROUP BY')
      .replace(/\bORDER BY\b/gi, '\nORDER BY')
      .replace(/\bHAVING\b/gi, '\nHAVING')
      .replace(/\bJOIN\b/gi, '\n  JOIN')
      .replace(/\bLEFT JOIN\b/gi, '\n  LEFT JOIN')
      .replace(/\bRIGHT JOIN\b/gi, '\n  RIGHT JOIN')
      .replace(/\bINNER JOIN\b/gi, '\n  INNER JOIN')
      .replace(/\bON\b/gi, '\n    ON')
      .replace(/\bAND\b/gi, '\n  AND')
      .replace(/,\s*(?=[a-zA-Z_])/g, ',\n  ');
    
    // Clean up multiple newlines
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    
    // Trim leading/trailing whitespace
    formatted = formatted.trim();
    
    return formatted;
  }

  // Add metadata header
  addMetadataHeader(sql, metadata = {}) {
    const {
      title = 'Generated Query',
      description = '',
      author = 'SQL Copilot',
      version = '1.0'
    } = metadata;
    
    const header = `/*
 * ${title}
 * ${description ? description + '\n * ' : ''}
 * Generated by: ${author}
 * Dialect: ${this.dialect.toUpperCase()}
 * Date: ${new Date().toISOString()}
 * Version: ${version}
 */

`;
    
    return header + sql;
  }

  // Add optimization hints as comments
  addOptimizationHintsToSQL(sql) {
    if (this.optimizationHints.length === 0) return sql;
    
    const hintsSection = `
/* OPTIMIZATION HINTS:
${this.optimizationHints.map((h, i) => ` * ${i + 1}. [${h.type}] ${h.message}${h.table ? ` (Table: ${h.table})` : ''}`).join('\n')}
 */

`;
    
    return sql + hintsSection;
  }

  // Extract table references from SQL
  extractTableReferences(sql) {
    const tables = new Set();
    const pattern = /(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi;
    let match;
    
    while ((match = pattern.exec(sql)) !== null) {
      tables.add(match[1]);
    }
    
    return Array.from(tables);
  }

  // Generate SQL from natural language using schema context
  async generateFromNaturalLanguage(prompt, schemaContext) {
    // This would integrate with AI generation
    // Returns structured query plan that can be converted to SQL
    return {
      plan: {},
      tables: [],
      columns: [],
      operations: []
    };
  }

  // Smart template selection based on query intent
  selectSmartTemplate(intent, context) {
    // Analyze intent and context to suggest best template
    const templates = window.SQLTemplates || {};
    
    // Simple keyword matching for now
    if (intent.toLowerCase().includes('incremental')) {
      return templates.incremental?.dailyLoad;
    }
    
    if (intent.toLowerCase().includes('dimension')) {
      return templates.medallion?.goldDimension;
    }
    
    if (intent.toLowerCase().includes('fact')) {
      return templates.medallion?.goldFact;
    }
    
    if (intent.toLowerCase().includes('quality') || intent.toLowerCase().includes('validation')) {
      return templates.quality?.dataValidation;
    }
    
    return null;
  }
}

// Export for use in main application
window.SmartCodeGenerator = SmartCodeGenerator;
