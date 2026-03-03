/**
 * Catalog Resolver
 * 
 * Resolves table and column references against known schema.
 * Supports multiple sources:
 * - In-memory registry (from parsed SQL)
 * - YAML/JSON schema definitions
 * - dbt manifest
 */

/**
 * Table schema definition
 */
export class TableSchema {
  constructor(name, options = {}) {
    this.name = name;
    this.schema = options.schema || null;
    this.database = options.database || null;
    this.columns = new Map();
    this.primaryKey = options.primaryKey || [];
    this.description = options.description || null;
    this.layer = options.layer || null;
    this.tags = options.tags || [];
  }

  /**
   * Add a column to the table
   */
  addColumn(name, type, options = {}) {
    this.columns.set(name.toLowerCase(), {
      name: name,
      type: type,
      nullable: options.nullable !== false,
      description: options.description || null,
      isPK: options.isPK || false,
      isFK: options.isFK || false,
      fkTarget: options.fkTarget || null
    });
    return this;
  }

  /**
   * Get a column by name
   */
  getColumn(name) {
    return this.columns.get(name.toLowerCase()) || null;
  }

  /**
   * Get all columns
   */
  getColumns() {
    return Array.from(this.columns.values());
  }

  /**
   * Get fully qualified name
   */
  getFQN() {
    const parts = [];
    if (this.database) parts.push(this.database);
    if (this.schema) parts.push(this.schema);
    parts.push(this.name);
    return parts.join('.');
  }
}

/**
 * Catalog Resolver class
 */
export class CatalogResolver {
  constructor() {
    this.tables = new Map();      // FQN -> TableSchema
    this.aliases = new Map();     // Current query context aliases
    this.typeAliases = new Map(); // Type normalization
    
    this.initTypeAliases();
  }

  /**
   * Initialize type aliases for normalization
   */
  initTypeAliases() {
    // Integer types
    this.typeAliases.set('int', 'INTEGER');
    this.typeAliases.set('int4', 'INTEGER');
    this.typeAliases.set('int8', 'BIGINT');
    this.typeAliases.set('smallint', 'SMALLINT');
    this.typeAliases.set('tinyint', 'TINYINT');
    
    // String types
    this.typeAliases.set('string', 'VARCHAR');
    this.typeAliases.set('text', 'VARCHAR');
    this.typeAliases.set('char', 'VARCHAR');
    
    // Numeric types
    this.typeAliases.set('float', 'DOUBLE');
    this.typeAliases.set('float4', 'REAL');
    this.typeAliases.set('float8', 'DOUBLE');
    this.typeAliases.set('numeric', 'DECIMAL');
    this.typeAliases.set('number', 'DECIMAL');
    
    // Date/time types
    this.typeAliases.set('datetime', 'TIMESTAMP');
    this.typeAliases.set('timestamp_ntz', 'TIMESTAMP');
    this.typeAliases.set('timestamp_ltz', 'TIMESTAMP');
    
    // Boolean
    this.typeAliases.set('bool', 'BOOLEAN');
  }

  /**
   * Normalize a type name
   */
  normalizeType(type) {
    if (!type) return 'UNKNOWN';
    
    const upper = type.toUpperCase();
    
    // Check for parameterized types (e.g., VARCHAR(100), DECIMAL(18,2))
    const baseType = upper.split('(')[0].trim();
    const params = type.match(/\(([^)]+)\)/);
    
    const normalized = this.typeAliases.get(baseType.toLowerCase()) || baseType;
    
    if (params) {
      return `${normalized}(${params[1]})`;
    }
    
    return normalized;
  }

  /**
   * Register a table schema
   * @param {TableSchema|Object} schema - Table schema
   */
  registerTable(schema) {
    let tableSchema;
    
    if (schema instanceof TableSchema) {
      tableSchema = schema;
    } else {
      // Convert plain object to TableSchema
      tableSchema = new TableSchema(schema.name, {
        schema: schema.schema,
        database: schema.database,
        primaryKey: schema.primaryKey,
        description: schema.description,
        layer: schema.layer,
        tags: schema.tags
      });
      
      // Add columns
      for (const col of (schema.columns || [])) {
        tableSchema.addColumn(col.name, col.type, {
          nullable: col.nullable,
          description: col.description,
          isPK: col.isPK || col.primaryKey,
          isFK: col.isFK || col.foreignKey,
          fkTarget: col.fkTarget || col.foreignKeyTo
        });
      }
    }
    
    // Register by multiple keys for flexible lookup
    const fqn = tableSchema.getFQN();
    this.tables.set(fqn.toLowerCase(), tableSchema);
    this.tables.set(tableSchema.name.toLowerCase(), tableSchema);
    
    if (tableSchema.schema) {
      this.tables.set(`${tableSchema.schema}.${tableSchema.name}`.toLowerCase(), tableSchema);
    }
    
    return tableSchema;
  }

  /**
   * Register multiple tables from a schema definition
   * @param {Array} schemas - Array of table schemas
   */
  registerTables(schemas) {
    for (const schema of schemas) {
      this.registerTable(schema);
    }
  }

  /**
   * Load schema from YAML/JSON definition
   * @param {Object} definition - Schema definition object
   */
  loadSchemaDefinition(definition) {
    if (definition.tables) {
      this.registerTables(definition.tables);
    }
    
    if (definition.sources) {
      for (const source of definition.sources) {
        const tableSchema = new TableSchema(source.name, {
          schema: source.schema,
          database: source.database,
          description: source.description,
          layer: 'raw'
        });
        
        for (const col of (source.columns || [])) {
          tableSchema.addColumn(col.name, col.type || col.data_type, {
            description: col.description
          });
        }
        
        this.registerTable(tableSchema);
      }
    }
  }

  /**
   * Set query context aliases
   * @param {Map|Object} aliases - Alias -> table name mapping
   */
  setAliases(aliases) {
    this.aliases.clear();
    
    if (aliases instanceof Map) {
      for (const [alias, table] of aliases) {
        this.aliases.set(alias.toLowerCase(), table);
      }
    } else {
      for (const [alias, table] of Object.entries(aliases)) {
        this.aliases.set(alias.toLowerCase(), table);
      }
    }
  }

  /**
   * Clear query context aliases
   */
  clearAliases() {
    this.aliases.clear();
  }

  /**
   * Check if a table exists
   * @param {string} name - Table name (possibly qualified)
   */
  hasTable(name) {
    return this.tables.has(name.toLowerCase());
  }

  /**
   * Get a table schema
   * @param {string} name - Table name (possibly qualified)
   */
  getTable(name) {
    return this.tables.get(name.toLowerCase()) || null;
  }

  /**
   * Resolve a table reference (handles aliases)
   * @param {string} tableOrAlias - Table name or alias
   */
  resolveTable(tableOrAlias) {
    const lower = tableOrAlias.toLowerCase();
    
    // Check aliases first
    if (this.aliases.has(lower)) {
      const tableName = this.aliases.get(lower);
      return this.tables.get(tableName.toLowerCase()) || null;
    }
    
    // Direct table lookup
    return this.tables.get(lower) || null;
  }

  /**
   * Get column type
   * @param {string} tableOrAlias - Table name or alias
   * @param {string} columnName - Column name
   */
  getColumnType(tableOrAlias, columnName) {
    const table = this.resolveTable(tableOrAlias);
    if (!table) return null;
    
    const column = table.getColumn(columnName);
    return column?.type || null;
  }

  /**
   * Resolve a column reference
   * @param {string} tableOrAlias - Table name or alias
   * @param {string} columnName - Column name
   */
  resolveColumn(tableOrAlias, columnName) {
    const table = this.resolveTable(tableOrAlias);
    if (!table) {
      return { 
        found: false, 
        type: 'UNKNOWN', 
        confidence: 0,
        error: `Table '${tableOrAlias}' not found`
      };
    }
    
    const column = table.getColumn(columnName);
    if (!column) {
      return {
        found: false,
        type: 'UNKNOWN',
        confidence: 0.3,
        error: `Column '${columnName}' not found in table '${table.name}'`
      };
    }
    
    return {
      found: true,
      type: this.normalizeType(column.type),
      confidence: 0.9,
      column: column,
      table: table
    };
  }

  /**
   * Expand SELECT * for a table
   * @param {string} tableOrAlias - Table name or alias
   */
  expandStar(tableOrAlias) {
    const table = this.resolveTable(tableOrAlias);
    if (!table) return [];
    
    return table.getColumns().map(col => ({
      name: col.name,
      type: this.normalizeType(col.type),
      source: table.name,
      nullable: col.nullable
    }));
  }

  /**
   * Find tables containing a column name
   * @param {string} columnName - Column name to search
   */
  findTablesWithColumn(columnName) {
    const results = [];
    const lowerCol = columnName.toLowerCase();
    
    for (const [, table] of this.tables) {
      if (table.columns.has(lowerCol)) {
        results.push({
          table: table.name,
          column: table.getColumn(columnName)
        });
      }
    }
    
    return results;
  }

  /**
   * Get all registered tables
   */
  getAllTables() {
    // Deduplicate (same table may be registered under multiple keys)
    const seen = new Set();
    const tables = [];
    
    for (const table of this.tables.values()) {
      const fqn = table.getFQN();
      if (!seen.has(fqn)) {
        seen.add(fqn);
        tables.push(table);
      }
    }
    
    return tables;
  }

  /**
   * Clear all registered tables
   */
  clear() {
    this.tables.clear();
    this.aliases.clear();
  }

  /**
   * Export catalog to JSON
   */
  toJSON() {
    const tables = this.getAllTables().map(t => ({
      name: t.name,
      schema: t.schema,
      database: t.database,
      description: t.description,
      layer: t.layer,
      primaryKey: t.primaryKey,
      columns: t.getColumns()
    }));
    
    return { tables };
  }

  /**
   * Import catalog from JSON
   */
  fromJSON(data) {
    this.clear();
    if (data.tables) {
      this.registerTables(data.tables);
    }
  }
}

export default CatalogResolver;
