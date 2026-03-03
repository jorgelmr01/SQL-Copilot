/**
 * Schema Extractor
 * 
 * Extracts schema metadata from parsed SQL IR:
 * - Output columns with types and lineage
 * - Table dependencies
 * - Grain/key columns
 * - Filters and aggregations
 */

import { ExprType, renderExpression } from '../parser/sql-parser.js';

/**
 * Semantic roles for columns
 */
export const SemanticRole = {
  DIMENSION: 'dimension',
  MEASURE: 'measure',
  KEY: 'key',
  TIMESTAMP: 'timestamp',
  UNKNOWN: 'unknown'
};

/**
 * Aggregation types
 */
export const AggregationType = {
  NONE: 'none',
  COUNT: 'count',
  COUNT_DISTINCT: 'count_distinct',
  SUM: 'sum',
  AVG: 'avg',
  MIN: 'min',
  MAX: 'max',
  RATIO: 'ratio',
  CUSTOM: 'custom'
};

/**
 * Schema Extractor class
 */
export class SchemaExtractor {
  constructor(catalogResolver = null) {
    this.catalog = catalogResolver;
    this.typeInferenceRules = this.buildTypeInferenceRules();
  }

  /**
   * Set the catalog resolver
   */
  setCatalog(catalog) {
    this.catalog = catalog;
  }

  /**
   * Extract schema from parsed IR
   * @param {Object} ir - Canonical IR from parser
   * @param {string} modelName - Name for this model/table
   * @param {Object} options - Extraction options
   * @returns {Object} Extracted schema
   */
  extract(ir, modelName, options = {}) {
    const { layer = null, description = null } = options;

    // Determine output table name
    const targetTable = ir.targetTable || ir.targetView || { table: modelName };
    
    // Extract columns with lineage
    const columns = this.extractColumns(ir);
    
    // Determine if aggregated
    const isAggregated = ir.groupBy && ir.groupBy.length > 0;
    
    // Extract grain columns (GROUP BY columns for aggregated tables)
    const grainColumns = isAggregated 
      ? this.extractGrainColumns(ir.groupBy, columns)
      : this.inferPrimaryKey(columns);
    
    // Extract filters
    const filters = this.extractFilters(ir.filters);
    
    // Extract dependencies
    const dependencies = this.extractDependencies(ir);
    
    // Extract join metadata
    const joinMetadata = this.extractJoinMetadata(ir.joins);

    return {
      id: this.generateId(modelName),
      name: targetTable.table || modelName,
      schema: targetTable.schema || null,
      database: targetTable.database || null,
      description: description,
      layer: layer,
      
      // Schema info
      columns: columns,
      grainColumns: grainColumns,
      isAggregated: isAggregated,
      
      // Lineage info
      dependencies: dependencies,
      joinMetadata: joinMetadata,
      
      // Query info
      filters: filters,
      filtersNormalized: filters.map(f => this.normalizeFilter(f)),
      
      // Metadata
      sourceType: ir.type,
      hasPartialLineage: ir.isPartial || false,
      extractedAt: new Date().toISOString()
    };
  }

  /**
   * Extract columns from IR projections
   */
  extractColumns(ir) {
    if (!ir.projections) return [];

    return ir.projections.map((proj, index) => {
      // Get expression info
      const expr = proj.expression;
      const sourceColumns = proj.sourceColumns || this.extractSourceColumns(expr);
      
      // Infer type
      const typeInfo = this.inferType(expr);
      
      // Detect aggregation
      const aggInfo = this.detectAggregation(expr);
      
      // Classify semantic role
      const semanticRole = this.classifySemanticRole(proj, aggInfo, ir.groupBy);
      
      // Infer nullability
      const nullable = this.inferNullability(expr, aggInfo);

      return {
        id: this.generateColumnId(proj.alias, index),
        name: proj.alias,
        type: typeInfo.type,
        typeConfidence: typeInfo.confidence,
        
        // Expression info
        expressionIR: expr,
        expressionSQL: renderExpression(expr),
        sourceColumns: sourceColumns,
        
        // Semantic info
        semanticRole: semanticRole,
        aggregationType: aggInfo.type,
        aggregationDistinct: aggInfo.distinct,
        
        // Constraints
        nullable: nullable,
        isPK: false, // Will be set by grain detection
        isFK: false, // Will be set by relationship inference
        
        // Flags
        isComputed: this.isComputedColumn(expr),
        isPassthrough: sourceColumns.length === 1 && expr.type === ExprType.COLUMN_REF
      };
    });
  }

  /**
   * Extract source column references from an expression
   */
  extractSourceColumns(expr) {
    const refs = [];
    
    const walk = (node) => {
      if (!node) return;
      
      switch (node.type) {
        case ExprType.COLUMN_REF:
          const ref = node.table ? `${node.table}.${node.column}` : node.column;
          if (!refs.includes(ref)) refs.push(ref);
          break;
        
        case ExprType.FUNCTION:
        case ExprType.WINDOW:
          (node.args || []).forEach(walk);
          if (node.over) {
            node.over.partitionBy?.forEach(walk);
            node.over.orderBy?.forEach(o => walk(o.expression));
          }
          break;
        
        case ExprType.BINARY_OP:
          walk(node.left);
          walk(node.right);
          break;
        
        case ExprType.CASE:
          if (node.operand) walk(node.operand);
          node.conditions?.forEach(c => {
            walk(c.when);
            walk(c.then);
          });
          if (node.elseResult) walk(node.elseResult);
          break;
        
        case ExprType.CAST:
          walk(node.expression);
          break;
        
        case ExprType.STAR:
          // Can't resolve without catalog
          if (node.table) {
            refs.push(`${node.table}.*`);
          } else {
            refs.push('*');
          }
          break;
      }
    };
    
    walk(expr);
    return refs;
  }

  /**
   * Infer the data type of an expression
   */
  inferType(expr) {
    if (!expr) return { type: 'UNKNOWN', confidence: 0 };

    switch (expr.type) {
      case ExprType.LITERAL:
        return { type: expr.dataType || 'UNKNOWN', confidence: 1.0 };
      
      case ExprType.COLUMN_REF:
        // Try to resolve from catalog
        if (this.catalog && expr.table) {
          const colType = this.catalog.getColumnType(expr.table, expr.column);
          if (colType) return { type: colType, confidence: 0.9 };
        }
        // Infer from naming conventions
        return this.inferTypeFromName(expr.column);
      
      case ExprType.FUNCTION:
        return this.inferFunctionReturnType(expr);
      
      case ExprType.WINDOW:
        return this.inferFunctionReturnType(expr);
      
      case ExprType.CAST:
        return { type: expr.targetType, confidence: 1.0 };
      
      case ExprType.BINARY_OP:
        return this.inferBinaryOpType(expr);
      
      case ExprType.CASE:
        // Type is the type of THEN expressions
        if (expr.conditions?.length > 0) {
          return this.inferType(expr.conditions[0].then);
        }
        if (expr.elseResult) {
          return this.inferType(expr.elseResult);
        }
        return { type: 'UNKNOWN', confidence: 0.3 };
      
      default:
        return { type: 'UNKNOWN', confidence: 0 };
    }
  }

  /**
   * Infer type from column name conventions
   */
  inferTypeFromName(name) {
    const lower = name.toLowerCase();
    
    // ID columns
    if (lower.endsWith('_id') || lower === 'id') {
      return { type: 'BIGINT', confidence: 0.7 };
    }
    
    // Timestamp columns
    if (lower.endsWith('_at') || lower.endsWith('_ts') || lower.includes('timestamp')) {
      return { type: 'TIMESTAMP', confidence: 0.7 };
    }
    
    // Date columns
    if (lower.endsWith('_dt') || lower.endsWith('_date') || lower === 'date') {
      return { type: 'DATE', confidence: 0.7 };
    }
    
    // Amount/money columns
    if (lower.endsWith('_amt') || lower.endsWith('_amount') || 
        lower.includes('price') || lower.includes('cost') || lower.includes('revenue')) {
      return { type: 'DECIMAL(18,2)', confidence: 0.6 };
    }
    
    // Count columns
    if (lower.endsWith('_cnt') || lower.endsWith('_count') || lower.startsWith('num_')) {
      return { type: 'BIGINT', confidence: 0.6 };
    }
    
    // Boolean columns
    if (lower.startsWith('is_') || lower.startsWith('has_') || lower.endsWith('_flag')) {
      return { type: 'BOOLEAN', confidence: 0.7 };
    }
    
    // Rate/percentage columns
    if (lower.endsWith('_rate') || lower.endsWith('_pct') || lower.endsWith('_ratio')) {
      return { type: 'DECIMAL(10,6)', confidence: 0.6 };
    }
    
    // Default to VARCHAR
    return { type: 'VARCHAR', confidence: 0.3 };
  }

  /**
   * Infer return type of a function
   */
  inferFunctionReturnType(expr) {
    const funcName = (expr.function || expr.name || '').toUpperCase();
    
    // Aggregate functions
    const aggregateTypes = {
      'COUNT': { type: 'BIGINT', confidence: 1.0 },
      'SUM': null, // Depends on input
      'AVG': { type: 'DOUBLE', confidence: 0.9 },
      'MIN': null, // Same as input
      'MAX': null, // Same as input
      'ARRAY_AGG': { type: 'ARRAY', confidence: 0.9 },
      'STRING_AGG': { type: 'VARCHAR', confidence: 0.9 },
      'LISTAGG': { type: 'VARCHAR', confidence: 0.9 }
    };
    
    if (funcName in aggregateTypes) {
      const result = aggregateTypes[funcName];
      if (result) return result;
      // For SUM/MIN/MAX, return type of first argument
      if (expr.args?.length > 0) {
        return this.inferType(expr.args[0]);
      }
    }
    
    // Date/time functions
    const dateTimeFunctions = {
      'DATE_TRUNC': { type: 'TIMESTAMP', confidence: 0.9 },
      'DATE': { type: 'DATE', confidence: 1.0 },
      'TIMESTAMP': { type: 'TIMESTAMP', confidence: 1.0 },
      'NOW': { type: 'TIMESTAMP', confidence: 1.0 },
      'CURRENT_DATE': { type: 'DATE', confidence: 1.0 },
      'CURRENT_TIMESTAMP': { type: 'TIMESTAMP', confidence: 1.0 },
      'DATE_ADD': { type: 'DATE', confidence: 0.9 },
      'DATE_SUB': { type: 'DATE', confidence: 0.9 },
      'DATEDIFF': { type: 'BIGINT', confidence: 0.9 },
      'EXTRACT': { type: 'BIGINT', confidence: 0.9 },
      'YEAR': { type: 'BIGINT', confidence: 1.0 },
      'MONTH': { type: 'BIGINT', confidence: 1.0 },
      'DAY': { type: 'BIGINT', confidence: 1.0 }
    };
    
    if (funcName in dateTimeFunctions) {
      return dateTimeFunctions[funcName];
    }
    
    // String functions
    const stringFunctions = ['CONCAT', 'UPPER', 'LOWER', 'TRIM', 'SUBSTR', 'SUBSTRING', 
                            'REPLACE', 'REGEXP_REPLACE', 'SPLIT_PART', 'COALESCE'];
    if (stringFunctions.includes(funcName)) {
      // COALESCE returns type of first non-null arg
      if (funcName === 'COALESCE' && expr.args?.length > 0) {
        return this.inferType(expr.args[0]);
      }
      return { type: 'VARCHAR', confidence: 0.8 };
    }
    
    // Numeric functions
    const numericFunctions = ['ABS', 'CEIL', 'FLOOR', 'ROUND', 'TRUNC', 'MOD', 'POWER', 'SQRT'];
    if (numericFunctions.includes(funcName)) {
      if (expr.args?.length > 0) {
        return this.inferType(expr.args[0]);
      }
      return { type: 'DOUBLE', confidence: 0.7 };
    }
    
    // Boolean functions
    const booleanFunctions = ['COALESCE', 'NULLIF', 'IF', 'IIF'];
    // Note: These can return various types
    
    return { type: 'UNKNOWN', confidence: 0.2 };
  }

  /**
   * Infer type of binary operation
   */
  inferBinaryOpType(expr) {
    const op = expr.operator?.toUpperCase();
    
    // Comparison operators return boolean
    if (['=', '!=', '<>', '>', '<', '>=', '<=', 'LIKE', 'IN', 'IS'].includes(op)) {
      return { type: 'BOOLEAN', confidence: 1.0 };
    }
    
    // Logical operators return boolean
    if (['AND', 'OR', 'NOT'].includes(op)) {
      return { type: 'BOOLEAN', confidence: 1.0 };
    }
    
    // Arithmetic operators - return type based on operands
    if (['+', '-', '*', '/'].includes(op)) {
      const leftType = this.inferType(expr.left);
      const rightType = this.inferType(expr.right);
      
      // Division always returns DOUBLE
      if (op === '/') {
        return { type: 'DOUBLE', confidence: 0.9 };
      }
      
      // If either is DOUBLE, result is DOUBLE
      if (leftType.type === 'DOUBLE' || rightType.type === 'DOUBLE') {
        return { type: 'DOUBLE', confidence: 0.8 };
      }
      
      // If either is DECIMAL, result is DECIMAL
      if (leftType.type?.startsWith('DECIMAL') || rightType.type?.startsWith('DECIMAL')) {
        return { type: 'DECIMAL', confidence: 0.8 };
      }
      
      return leftType.confidence > rightType.confidence ? leftType : rightType;
    }
    
    // String concatenation
    if (op === '||') {
      return { type: 'VARCHAR', confidence: 0.9 };
    }
    
    return { type: 'UNKNOWN', confidence: 0.2 };
  }

  /**
   * Detect aggregation in an expression
   */
  detectAggregation(expr) {
    if (!expr) return { type: AggregationType.NONE, distinct: false };

    const aggregateFunctions = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ARRAY_AGG', 
                                'STRING_AGG', 'LISTAGG', 'STDDEV', 'VARIANCE'];
    
    if (expr.type === ExprType.FUNCTION || expr.type === ExprType.WINDOW) {
      const funcName = (expr.function || expr.name || '').toUpperCase();
      
      if (aggregateFunctions.includes(funcName)) {
        let aggType = AggregationType.CUSTOM;
        
        switch (funcName) {
          case 'COUNT':
            aggType = expr.distinct ? AggregationType.COUNT_DISTINCT : AggregationType.COUNT;
            break;
          case 'SUM':
            aggType = AggregationType.SUM;
            break;
          case 'AVG':
            aggType = AggregationType.AVG;
            break;
          case 'MIN':
            aggType = AggregationType.MIN;
            break;
          case 'MAX':
            aggType = AggregationType.MAX;
            break;
        }
        
        return { type: aggType, distinct: expr.distinct || false };
      }
    }
    
    // Check for ratio pattern: SUM(x) / SUM(y) or similar
    if (expr.type === ExprType.BINARY_OP && expr.operator === '/') {
      const leftAgg = this.detectAggregation(expr.left);
      const rightAgg = this.detectAggregation(expr.right);
      
      if (leftAgg.type !== AggregationType.NONE && rightAgg.type !== AggregationType.NONE) {
        return { type: AggregationType.RATIO, distinct: false };
      }
    }
    
    // Recursively check for nested aggregations
    if (expr.type === ExprType.BINARY_OP) {
      const leftAgg = this.detectAggregation(expr.left);
      const rightAgg = this.detectAggregation(expr.right);
      
      if (leftAgg.type !== AggregationType.NONE) return leftAgg;
      if (rightAgg.type !== AggregationType.NONE) return rightAgg;
    }
    
    if (expr.type === ExprType.CASE) {
      for (const cond of (expr.conditions || [])) {
        const thenAgg = this.detectAggregation(cond.then);
        if (thenAgg.type !== AggregationType.NONE) return thenAgg;
      }
      if (expr.elseResult) {
        const elseAgg = this.detectAggregation(expr.elseResult);
        if (elseAgg.type !== AggregationType.NONE) return elseAgg;
      }
    }
    
    return { type: AggregationType.NONE, distinct: false };
  }

  /**
   * Classify semantic role of a column
   */
  classifySemanticRole(proj, aggInfo, groupBy) {
    // If it's an aggregate, it's a measure
    if (aggInfo.type !== AggregationType.NONE) {
      return SemanticRole.MEASURE;
    }
    
    // If it's in GROUP BY, it's a dimension
    if (groupBy && groupBy.length > 0) {
      const colName = proj.alias?.toLowerCase();
      const isInGroupBy = groupBy.some(g => {
        if (g.type === ExprType.COLUMN_REF) {
          return g.column?.toLowerCase() === colName;
        }
        return false;
      });
      
      if (isInGroupBy) {
        return SemanticRole.DIMENSION;
      }
    }
    
    // Infer from name
    const name = proj.alias?.toLowerCase() || '';
    
    // Key columns
    if (name.endsWith('_id') || name === 'id') {
      return SemanticRole.KEY;
    }
    
    // Timestamp columns
    if (name.endsWith('_at') || name.endsWith('_ts') || name.includes('timestamp')) {
      return SemanticRole.TIMESTAMP;
    }
    
    // Measure-like names
    if (name.endsWith('_amt') || name.endsWith('_amount') || name.endsWith('_cnt') ||
        name.endsWith('_count') || name.endsWith('_sum') || name.endsWith('_avg') ||
        name.includes('revenue') || name.includes('cost') || name.includes('total')) {
      return SemanticRole.MEASURE;
    }
    
    return SemanticRole.UNKNOWN;
  }

  /**
   * Infer nullability of an expression
   */
  inferNullability(expr, aggInfo) {
    // COUNT is never null
    if (aggInfo.type === AggregationType.COUNT || aggInfo.type === AggregationType.COUNT_DISTINCT) {
      return false;
    }
    
    // Literals are not null (unless NULL literal)
    if (expr?.type === ExprType.LITERAL) {
      return expr.value === null;
    }
    
    // COALESCE with non-null default is not null
    if (expr?.type === ExprType.FUNCTION && expr.name?.toUpperCase() === 'COALESCE') {
      const lastArg = expr.args?.[expr.args.length - 1];
      if (lastArg?.type === ExprType.LITERAL && lastArg.value !== null) {
        return false;
      }
    }
    
    // Division can produce null (division by zero with NULLIF)
    if (expr?.type === ExprType.BINARY_OP && expr.operator === '/') {
      return true; // Potentially null
    }
    
    // Default: unknown (null means unknown)
    return null;
  }

  /**
   * Check if expression is computed (not a simple column reference)
   */
  isComputedColumn(expr) {
    if (!expr) return false;
    return expr.type !== ExprType.COLUMN_REF;
  }

  /**
   * Extract grain columns from GROUP BY
   */
  extractGrainColumns(groupBy, columns) {
    if (!groupBy || groupBy.length === 0) return [];
    
    return groupBy.map(g => {
      if (g.type === ExprType.COLUMN_REF) {
        return g.column;
      }
      // For expressions, try to match to output column
      const rendered = renderExpression(g);
      const matchingCol = columns.find(c => c.expressionSQL === rendered);
      return matchingCol?.name || rendered;
    }).filter(Boolean);
  }

  /**
   * Infer primary key from columns (for non-aggregated tables)
   */
  inferPrimaryKey(columns) {
    // Look for 'id' column
    const idCol = columns.find(c => c.name.toLowerCase() === 'id');
    if (idCol) return [idCol.name];
    
    // Look for columns ending in '_id' that might be PKs
    const idCols = columns.filter(c => c.name.toLowerCase().endsWith('_id'));
    if (idCols.length === 1) return [idCols[0].name];
    
    return [];
  }

  /**
   * Extract filters from IR
   */
  extractFilters(filters) {
    if (!filters || filters.length === 0) return [];
    
    return filters.map(f => ({
      expression: f,
      sql: renderExpression(f),
      columns: this.extractSourceColumns(f)
    }));
  }

  /**
   * Normalize a filter for display
   */
  normalizeFilter(filter) {
    return filter.sql || renderExpression(filter.expression);
  }

  /**
   * Extract table dependencies from IR
   */
  extractDependencies(ir) {
    const deps = new Set();
    
    // From sources
    if (ir.sources) {
      for (const source of ir.sources) {
        if (source.type === 'table') {
          const fqn = this.buildTableFQN(source);
          deps.add(fqn);
        } else if (source.type === 'subquery') {
          // Recursively extract from subquery
          const subDeps = this.extractDependencies(source.query);
          subDeps.forEach(d => deps.add(d));
        }
      }
    }
    
    // From joins
    if (ir.joins) {
      for (const join of ir.joins) {
        if (join.right?.type === 'table') {
          const fqn = this.buildTableFQN(join.right);
          deps.add(fqn);
        } else if (join.right?.type === 'subquery') {
          const subDeps = this.extractDependencies(join.right.query);
          subDeps.forEach(d => deps.add(d));
        }
      }
    }
    
    // From CTEs (they depend on their own sources)
    if (ir.ctes) {
      for (const [name, cte] of ir.ctes) {
        const cteDeps = this.extractDependencies(cte);
        cteDeps.forEach(d => deps.add(d));
      }
    }
    
    return Array.from(deps);
  }

  /**
   * Build fully qualified table name
   */
  buildTableFQN(source) {
    const parts = [];
    if (source.catalog) parts.push(source.catalog);
    if (source.schema) parts.push(source.schema);
    parts.push(source.table);
    return parts.join('.');
  }

  /**
   * Extract join metadata
   */
  extractJoinMetadata(joins) {
    if (!joins || joins.length === 0) return [];
    
    return joins.map(join => ({
      type: join.type,
      rightTable: join.right?.type === 'table' ? this.buildTableFQN(join.right) : null,
      rightAlias: join.right?.alias || null,
      predicate: join.predicate ? renderExpression(join.predicate) : null,
      predicateColumns: join.predicateColumns || []
    }));
  }

  /**
   * Generate deterministic ID for a model
   */
  generateId(name) {
    return `model_${this.hashString(name.toLowerCase())}`;
  }

  /**
   * Generate deterministic ID for a column
   */
  generateColumnId(name, index) {
    return `col_${this.hashString(name.toLowerCase())}_${index}`;
  }

  /**
   * Simple hash function for IDs
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Build type inference rules
   */
  buildTypeInferenceRules() {
    return {
      // Function return types
      functions: new Map([
        ['COUNT', 'BIGINT'],
        ['AVG', 'DOUBLE'],
        ['DATE_TRUNC', 'TIMESTAMP'],
        // Add more as needed
      ]),
      
      // Naming patterns
      patterns: [
        { regex: /_id$/, type: 'BIGINT' },
        { regex: /_at$/, type: 'TIMESTAMP' },
        { regex: /_date$/, type: 'DATE' },
        // Add more as needed
      ]
    };
  }
}

export default SchemaExtractor;
