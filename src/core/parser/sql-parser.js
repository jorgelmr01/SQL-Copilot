/**
 * SQL Parser Module
 * 
 * Provides SQL parsing with multi-dialect support using node-sql-parser.
 * Transforms raw SQL into a canonical Intermediate Representation (IR).
 * 
 * Supported dialects: Presto/Trino, Spark SQL, PostgreSQL, MySQL
 */

// For browser usage, we'll use a bundled version of node-sql-parser
// or implement a lightweight parser. For now, we implement core parsing logic.

/**
 * Canonical IR Node Types
 */
export const IRNodeType = {
  SELECT: 'SELECT',
  CTAS: 'CREATE_TABLE_AS',
  CREATE_VIEW: 'CREATE_VIEW',
  INSERT: 'INSERT',
  MERGE: 'MERGE',
  CTE: 'CTE',
  SUBQUERY: 'SUBQUERY',
  UNION: 'UNION',
  INTERSECT: 'INTERSECT',
  EXCEPT: 'EXCEPT'
};

/**
 * Expression types in the IR
 */
export const ExprType = {
  COLUMN_REF: 'column_ref',
  LITERAL: 'literal',
  FUNCTION: 'function',
  BINARY_OP: 'binary_op',
  UNARY_OP: 'unary_op',
  CASE: 'case',
  CAST: 'cast',
  SUBQUERY: 'subquery',
  STAR: 'star',
  WINDOW: 'window',
  ARRAY: 'array',
  STRUCT: 'struct'
};

/**
 * Join types
 */
export const JoinType = {
  INNER: 'INNER',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  FULL: 'FULL',
  CROSS: 'CROSS',
  LATERAL: 'LATERAL'
};

/**
 * SQL Parser class
 * Parses SQL strings into canonical IR
 */
export class SQLParser {
  constructor(dialect = 'presto') {
    this.dialect = dialect.toLowerCase();
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Set the SQL dialect for parsing
   */
  setDialect(dialect) {
    this.dialect = dialect.toLowerCase();
  }

  /**
   * Parse SQL string to canonical IR
   * @param {string} sql - Raw SQL string
   * @returns {Object} Canonical IR representation
   */
  parse(sql) {
    this.errors = [];
    this.warnings = [];

    try {
      // Normalize whitespace and remove comments for parsing
      const normalizedSQL = this.normalizeSQL(sql);
      
      // Detect statement type
      const statementType = this.detectStatementType(normalizedSQL);
      
      // Parse based on statement type
      let ir;
      switch (statementType) {
        case IRNodeType.SELECT:
          ir = this.parseSelect(normalizedSQL);
          break;
        case IRNodeType.CTAS:
          ir = this.parseCTAS(normalizedSQL);
          break;
        case IRNodeType.CREATE_VIEW:
          ir = this.parseCreateView(normalizedSQL);
          break;
        default:
          ir = this.parseSelect(normalizedSQL);
      }

      ir.originalSQL = sql;
      ir.dialect = this.dialect;
      ir.errors = this.errors;
      ir.warnings = this.warnings;

      return ir;
    } catch (error) {
      this.errors.push({
        type: 'PARSE_ERROR',
        message: error.message,
        position: error.position || null
      });
      
      return {
        type: 'ERROR',
        originalSQL: sql,
        dialect: this.dialect,
        errors: this.errors,
        warnings: this.warnings
      };
    }
  }

  /**
   * Normalize SQL for consistent parsing
   */
  normalizeSQL(sql) {
    let normalized = sql.trim();
    
    // Remove single-line comments
    normalized = normalized.replace(/--.*$/gm, '');
    
    // Remove multi-line comments
    normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Normalize whitespace
    normalized = normalized.replace(/\s+/g, ' ');
    
    // Remove trailing semicolon
    normalized = normalized.replace(/;\s*$/, '');
    
    return normalized.trim();
  }

  /**
   * Detect the type of SQL statement
   */
  detectStatementType(sql) {
    const upper = sql.toUpperCase().trim();
    
    if (upper.startsWith('CREATE TABLE') && upper.includes(' AS ')) {
      return IRNodeType.CTAS;
    }
    if (upper.startsWith('CREATE VIEW') || upper.startsWith('CREATE OR REPLACE VIEW')) {
      return IRNodeType.CREATE_VIEW;
    }
    if (upper.startsWith('WITH ') || upper.startsWith('SELECT ')) {
      return IRNodeType.SELECT;
    }
    if (upper.startsWith('INSERT ')) {
      return IRNodeType.INSERT;
    }
    if (upper.startsWith('MERGE ')) {
      return IRNodeType.MERGE;
    }
    
    return IRNodeType.SELECT;
  }

  /**
   * Parse a SELECT statement (including CTEs)
   */
  parseSelect(sql) {
    const ir = {
      type: IRNodeType.SELECT,
      ctes: new Map(),
      projections: [],
      sources: [],
      joins: [],
      filters: [],
      groupBy: [],
      having: [],
      orderBy: [],
      limit: null,
      distinct: false
    };

    let remaining = sql;

    // Parse CTEs (WITH clause)
    if (remaining.toUpperCase().startsWith('WITH ')) {
      const { ctes, remainingSQL } = this.parseCTEs(remaining);
      ir.ctes = ctes;
      remaining = remainingSQL;
    }

    // Parse main SELECT
    const selectMatch = remaining.match(/^SELECT\s+(DISTINCT\s+)?([\s\S]+?)(?=\s+FROM\s+|\s*$)/i);
    if (selectMatch) {
      ir.distinct = !!selectMatch[1];
      ir.projections = this.parseProjections(selectMatch[2]);
      remaining = remaining.substring(selectMatch[0].length);
    }

    // Parse FROM clause
    const fromMatch = remaining.match(/^\s*FROM\s+([\s\S]+?)(?=\s+WHERE\s+|\s+GROUP\s+BY\s+|\s+HAVING\s+|\s+ORDER\s+BY\s+|\s+LIMIT\s+|\s+UNION\s+|\s+INTERSECT\s+|\s+EXCEPT\s+|\s*$)/i);
    if (fromMatch) {
      const { sources, joins } = this.parseFromClause(fromMatch[1]);
      ir.sources = sources;
      ir.joins = joins;
      remaining = remaining.substring(fromMatch[0].length);
    }

    // Parse WHERE clause
    const whereMatch = remaining.match(/^\s*WHERE\s+([\s\S]+?)(?=\s+GROUP\s+BY\s+|\s+HAVING\s+|\s+ORDER\s+BY\s+|\s+LIMIT\s+|\s+UNION\s+|\s+INTERSECT\s+|\s+EXCEPT\s+|\s*$)/i);
    if (whereMatch) {
      ir.filters = this.parseFilters(whereMatch[1]);
      remaining = remaining.substring(whereMatch[0].length);
    }

    // Parse GROUP BY clause
    const groupMatch = remaining.match(/^\s*GROUP\s+BY\s+([\s\S]+?)(?=\s+HAVING\s+|\s+ORDER\s+BY\s+|\s+LIMIT\s+|\s+UNION\s+|\s+INTERSECT\s+|\s+EXCEPT\s+|\s*$)/i);
    if (groupMatch) {
      ir.groupBy = this.parseGroupBy(groupMatch[1]);
      remaining = remaining.substring(groupMatch[0].length);
    }

    // Parse HAVING clause
    const havingMatch = remaining.match(/^\s*HAVING\s+([\s\S]+?)(?=\s+ORDER\s+BY\s+|\s+LIMIT\s+|\s+UNION\s+|\s+INTERSECT\s+|\s+EXCEPT\s+|\s*$)/i);
    if (havingMatch) {
      ir.having = this.parseFilters(havingMatch[1]);
      remaining = remaining.substring(havingMatch[0].length);
    }

    // Parse ORDER BY clause
    const orderMatch = remaining.match(/^\s*ORDER\s+BY\s+([\s\S]+?)(?=\s+LIMIT\s+|\s+UNION\s+|\s+INTERSECT\s+|\s+EXCEPT\s+|\s*$)/i);
    if (orderMatch) {
      ir.orderBy = this.parseOrderBy(orderMatch[1]);
      remaining = remaining.substring(orderMatch[0].length);
    }

    // Parse LIMIT clause
    const limitMatch = remaining.match(/^\s*LIMIT\s+(\d+)/i);
    if (limitMatch) {
      ir.limit = parseInt(limitMatch[1], 10);
    }

    return ir;
  }

  /**
   * Parse CREATE TABLE AS SELECT
   */
  parseCTAS(sql) {
    const match = sql.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s+(?:WITH\s*\([^)]*\)\s+)?AS\s+([\s\S]+)$/i);
    
    if (!match) {
      throw new Error('Invalid CREATE TABLE AS syntax');
    }

    const tableName = match[1];
    const selectSQL = match[2];
    
    const selectIR = this.parseSelect(selectSQL);
    
    return {
      type: IRNodeType.CTAS,
      targetTable: this.parseTableName(tableName),
      ...selectIR
    };
  }

  /**
   * Parse CREATE VIEW
   */
  parseCreateView(sql) {
    const match = sql.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([^\s(]+)\s+AS\s+([\s\S]+)$/i);
    
    if (!match) {
      throw new Error('Invalid CREATE VIEW syntax');
    }

    const viewName = match[1];
    const selectSQL = match[2];
    
    const selectIR = this.parseSelect(selectSQL);
    
    return {
      type: IRNodeType.CREATE_VIEW,
      targetView: this.parseTableName(viewName),
      ...selectIR
    };
  }

  /**
   * Parse CTEs (WITH clause)
   */
  parseCTEs(sql) {
    const ctes = new Map();
    let remaining = sql.substring(5).trim(); // Remove 'WITH '
    
    // Match CTE definitions
    const ctePattern = /^(\w+)\s+AS\s*\(([\s\S]+?)\)(?:\s*,\s*|\s+(?=SELECT))/i;
    
    while (true) {
      const match = remaining.match(ctePattern);
      if (!match) break;
      
      const cteName = match[1];
      const cteSQL = match[2];
      
      // Parse the CTE's SELECT statement
      const cteIR = this.parseSelect(cteSQL);
      cteIR.type = IRNodeType.CTE;
      cteIR.name = cteName;
      
      ctes.set(cteName.toLowerCase(), cteIR);
      remaining = remaining.substring(match[0].length).trim();
    }
    
    return { ctes, remainingSQL: remaining };
  }

  /**
   * Parse SELECT projections (column list)
   */
  parseProjections(columnsStr) {
    const projections = [];
    const columns = this.splitByComma(columnsStr);
    
    for (const col of columns) {
      const trimmed = col.trim();
      if (!trimmed) continue;
      
      // Check for alias
      const aliasMatch = trimmed.match(/^([\s\S]+?)\s+(?:AS\s+)?(\w+)$/i);
      
      if (aliasMatch) {
        const expr = this.parseExpression(aliasMatch[1].trim());
        projections.push({
          alias: aliasMatch[2],
          expression: expr,
          sourceColumns: this.extractColumnRefs(expr)
        });
      } else {
        const expr = this.parseExpression(trimmed);
        // Use column name as alias if it's a simple column ref
        const alias = expr.type === ExprType.COLUMN_REF ? expr.column : trimmed;
        projections.push({
          alias: alias,
          expression: expr,
          sourceColumns: this.extractColumnRefs(expr)
        });
      }
    }
    
    return projections;
  }

  /**
   * Parse FROM clause including JOINs
   */
  parseFromClause(fromStr) {
    const sources = [];
    const joins = [];
    
    // Split by JOIN keywords while preserving them
    const joinPattern = /\s+((?:LEFT|RIGHT|FULL|INNER|CROSS|LATERAL)\s+(?:OUTER\s+)?)?JOIN\s+/i;
    const parts = fromStr.split(joinPattern);
    
    // First part is the main source
    if (parts[0]) {
      const source = this.parseTableSource(parts[0].trim());
      if (source) sources.push(source);
    }
    
    // Remaining parts are joins
    for (let i = 1; i < parts.length; i += 2) {
      const joinTypeStr = (parts[i] || '').trim().toUpperCase();
      const joinContent = parts[i + 1];
      
      if (!joinContent) continue;
      
      // Determine join type
      let joinType = JoinType.INNER;
      if (joinTypeStr.includes('LEFT')) joinType = JoinType.LEFT;
      else if (joinTypeStr.includes('RIGHT')) joinType = JoinType.RIGHT;
      else if (joinTypeStr.includes('FULL')) joinType = JoinType.FULL;
      else if (joinTypeStr.includes('CROSS')) joinType = JoinType.CROSS;
      else if (joinTypeStr.includes('LATERAL')) joinType = JoinType.LATERAL;
      
      // Parse join table and ON condition
      const onMatch = joinContent.match(/^([\s\S]+?)\s+ON\s+([\s\S]+)$/i);
      
      if (onMatch) {
        const rightSource = this.parseTableSource(onMatch[1].trim());
        const predicate = this.parseExpression(onMatch[2].trim());
        
        joins.push({
          type: joinType,
          right: rightSource,
          predicate: predicate,
          predicateColumns: this.extractColumnRefs(predicate)
        });
      } else {
        // CROSS JOIN or JOIN without ON
        const rightSource = this.parseTableSource(joinContent.trim());
        joins.push({
          type: joinType,
          right: rightSource,
          predicate: null,
          predicateColumns: []
        });
      }
    }
    
    return { sources, joins };
  }

  /**
   * Parse a table source (table name, subquery, or CTE reference)
   */
  parseTableSource(sourceStr) {
    const trimmed = sourceStr.trim();
    if (!trimmed) return null;
    
    // Check for subquery
    if (trimmed.startsWith('(')) {
      const subqueryMatch = trimmed.match(/^\(([\s\S]+)\)\s*(?:AS\s+)?(\w+)?$/i);
      if (subqueryMatch) {
        return {
          type: 'subquery',
          query: this.parseSelect(subqueryMatch[1]),
          alias: subqueryMatch[2] || null
        };
      }
    }
    
    // Table with optional alias
    const tableMatch = trimmed.match(/^([^\s]+)(?:\s+(?:AS\s+)?(\w+))?$/i);
    if (tableMatch) {
      return {
        type: 'table',
        ...this.parseTableName(tableMatch[1]),
        alias: tableMatch[2] || null
      };
    }
    
    return null;
  }

  /**
   * Parse a fully qualified table name
   */
  parseTableName(name) {
    const parts = name.split('.');
    
    if (parts.length === 3) {
      return { catalog: parts[0], schema: parts[1], table: parts[2] };
    } else if (parts.length === 2) {
      return { catalog: null, schema: parts[0], table: parts[1] };
    } else {
      return { catalog: null, schema: null, table: parts[0] };
    }
  }

  /**
   * Parse WHERE/HAVING filters
   */
  parseFilters(filterStr) {
    // For now, return as a single expression
    // TODO: Split by AND/OR for more granular analysis
    return [this.parseExpression(filterStr.trim())];
  }

  /**
   * Parse GROUP BY clause
   */
  parseGroupBy(groupStr) {
    const columns = this.splitByComma(groupStr);
    return columns.map(col => this.parseExpression(col.trim()));
  }

  /**
   * Parse ORDER BY clause
   */
  parseOrderBy(orderStr) {
    const columns = this.splitByComma(orderStr);
    return columns.map(col => {
      const match = col.trim().match(/^([\s\S]+?)\s*(ASC|DESC)?$/i);
      return {
        expression: this.parseExpression(match[1].trim()),
        direction: (match[2] || 'ASC').toUpperCase()
      };
    });
  }

  /**
   * Parse an expression (column ref, function, literal, etc.)
   */
  parseExpression(exprStr) {
    const trimmed = exprStr.trim();
    
    // Star (SELECT *)
    if (trimmed === '*') {
      return { type: ExprType.STAR, table: null };
    }
    
    // Table.* (SELECT t.*)
    const tableStarMatch = trimmed.match(/^(\w+)\.\*$/);
    if (tableStarMatch) {
      return { type: ExprType.STAR, table: tableStarMatch[1] };
    }
    
    // Literal number
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { type: ExprType.LITERAL, value: parseFloat(trimmed), dataType: 'NUMBER' };
    }
    
    // Literal string
    if (/^'[^']*'$/.test(trimmed)) {
      return { type: ExprType.LITERAL, value: trimmed.slice(1, -1), dataType: 'STRING' };
    }
    
    // NULL
    if (trimmed.toUpperCase() === 'NULL') {
      return { type: ExprType.LITERAL, value: null, dataType: 'NULL' };
    }
    
    // Boolean
    if (/^(TRUE|FALSE)$/i.test(trimmed)) {
      return { type: ExprType.LITERAL, value: trimmed.toUpperCase() === 'TRUE', dataType: 'BOOLEAN' };
    }
    
    // CASE expression
    if (trimmed.toUpperCase().startsWith('CASE ')) {
      return this.parseCaseExpression(trimmed);
    }
    
    // CAST expression
    const castMatch = trimmed.match(/^CAST\s*\(\s*([\s\S]+?)\s+AS\s+(\w+(?:\([^)]+\))?)\s*\)$/i);
    if (castMatch) {
      return {
        type: ExprType.CAST,
        expression: this.parseExpression(castMatch[1]),
        targetType: castMatch[2].toUpperCase()
      };
    }
    
    // Function call
    const funcMatch = trimmed.match(/^(\w+)\s*\(([\s\S]*)\)$/);
    if (funcMatch) {
      const funcName = funcMatch[1].toUpperCase();
      const argsStr = funcMatch[2];
      
      // Check for window function
      const overMatch = argsStr.match(/([\s\S]*?)\s+OVER\s*\(([\s\S]*)\)$/i);
      if (overMatch) {
        return {
          type: ExprType.WINDOW,
          function: funcName,
          args: this.splitByComma(overMatch[1]).map(a => this.parseExpression(a.trim())),
          over: this.parseWindowSpec(overMatch[2])
        };
      }
      
      // Check for DISTINCT in aggregate
      const distinctMatch = argsStr.match(/^DISTINCT\s+([\s\S]+)$/i);
      
      return {
        type: ExprType.FUNCTION,
        name: funcName,
        args: this.splitByComma(distinctMatch ? distinctMatch[1] : argsStr)
          .map(a => this.parseExpression(a.trim())),
        distinct: !!distinctMatch
      };
    }
    
    // Binary operation (simplified - handles basic cases)
    const binaryOps = ['=', '!=', '<>', '>=', '<=', '>', '<', '+', '-', '*', '/', '%', 'AND', 'OR', 'LIKE', 'IN', 'IS'];
    for (const op of binaryOps) {
      const opPattern = op.length > 1 
        ? new RegExp(`\\s+${op}\\s+`, 'i')
        : new RegExp(`\\s*${op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`);
      
      const parts = trimmed.split(opPattern);
      if (parts.length === 2) {
        return {
          type: ExprType.BINARY_OP,
          operator: op.toUpperCase(),
          left: this.parseExpression(parts[0]),
          right: this.parseExpression(parts[1])
        };
      }
    }
    
    // Column reference (possibly qualified)
    const colMatch = trimmed.match(/^(?:(\w+)\.)?(\w+)$/);
    if (colMatch) {
      return {
        type: ExprType.COLUMN_REF,
        table: colMatch[1] || null,
        column: colMatch[2]
      };
    }
    
    // Fallback: treat as raw expression
    return {
      type: 'raw',
      sql: trimmed
    };
  }

  /**
   * Parse CASE expression
   */
  parseCaseExpression(caseStr) {
    const result = {
      type: ExprType.CASE,
      conditions: [],
      elseResult: null
    };
    
    // Simple CASE vs Searched CASE
    const simpleMatch = caseStr.match(/^CASE\s+(\w+)\s+([\s\S]+)\s+END$/i);
    const searchedMatch = caseStr.match(/^CASE\s+([\s\S]+)\s+END$/i);
    
    if (simpleMatch) {
      result.operand = this.parseExpression(simpleMatch[1]);
      // Parse WHEN clauses
      const whenPattern = /WHEN\s+([\s\S]+?)\s+THEN\s+([\s\S]+?)(?=\s+WHEN|\s+ELSE|\s+END)/gi;
      let match;
      while ((match = whenPattern.exec(simpleMatch[2])) !== null) {
        result.conditions.push({
          when: this.parseExpression(match[1]),
          then: this.parseExpression(match[2])
        });
      }
    } else if (searchedMatch) {
      const whenPattern = /WHEN\s+([\s\S]+?)\s+THEN\s+([\s\S]+?)(?=\s+WHEN|\s+ELSE|\s+END)/gi;
      let match;
      while ((match = whenPattern.exec(searchedMatch[1])) !== null) {
        result.conditions.push({
          when: this.parseExpression(match[1]),
          then: this.parseExpression(match[2])
        });
      }
    }
    
    // Parse ELSE clause
    const elseMatch = caseStr.match(/ELSE\s+([\s\S]+?)\s+END$/i);
    if (elseMatch) {
      result.elseResult = this.parseExpression(elseMatch[1]);
    }
    
    return result;
  }

  /**
   * Parse window specification (OVER clause)
   */
  parseWindowSpec(overStr) {
    const spec = {
      partitionBy: [],
      orderBy: []
    };
    
    const partitionMatch = overStr.match(/PARTITION\s+BY\s+([\s\S]+?)(?=\s+ORDER|\s*$)/i);
    if (partitionMatch) {
      spec.partitionBy = this.splitByComma(partitionMatch[1])
        .map(p => this.parseExpression(p.trim()));
    }
    
    const orderMatch = overStr.match(/ORDER\s+BY\s+([\s\S]+?)(?=\s+ROWS|\s+RANGE|\s*$)/i);
    if (orderMatch) {
      spec.orderBy = this.parseOrderBy(orderMatch[1]);
    }
    
    return spec;
  }

  /**
   * Extract all column references from an expression
   */
  extractColumnRefs(expr) {
    const refs = [];
    
    const walk = (node) => {
      if (!node) return;
      
      if (node.type === ExprType.COLUMN_REF) {
        const ref = node.table ? `${node.table}.${node.column}` : node.column;
        refs.push(ref);
      } else if (node.type === ExprType.FUNCTION || node.type === ExprType.WINDOW) {
        (node.args || []).forEach(walk);
        if (node.over) {
          node.over.partitionBy?.forEach(walk);
          node.over.orderBy?.forEach(o => walk(o.expression));
        }
      } else if (node.type === ExprType.BINARY_OP) {
        walk(node.left);
        walk(node.right);
      } else if (node.type === ExprType.CASE) {
        if (node.operand) walk(node.operand);
        node.conditions?.forEach(c => {
          walk(c.when);
          walk(c.then);
        });
        if (node.elseResult) walk(node.elseResult);
      } else if (node.type === ExprType.CAST) {
        walk(node.expression);
      }
    };
    
    walk(expr);
    return refs;
  }

  /**
   * Split string by comma, respecting parentheses
   */
  splitByComma(str) {
    const result = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = null;
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      if (inString) {
        current += char;
        if (char === stringChar && str[i - 1] !== '\\') {
          inString = false;
        }
      } else if (char === "'" || char === '"') {
        inString = true;
        stringChar = char;
        current += char;
      } else if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      result.push(current.trim());
    }
    
    return result;
  }
}

/**
 * Render an expression back to SQL string
 */
export function renderExpression(expr, dialect = 'presto') {
  if (!expr) return '';
  
  switch (expr.type) {
    case ExprType.COLUMN_REF:
      return expr.table ? `${expr.table}.${expr.column}` : expr.column;
    
    case ExprType.LITERAL:
      if (expr.value === null) return 'NULL';
      if (expr.dataType === 'STRING') return `'${expr.value}'`;
      return String(expr.value);
    
    case ExprType.STAR:
      return expr.table ? `${expr.table}.*` : '*';
    
    case ExprType.FUNCTION:
      const args = expr.args.map(a => renderExpression(a, dialect)).join(', ');
      const distinct = expr.distinct ? 'DISTINCT ' : '';
      return `${expr.name}(${distinct}${args})`;
    
    case ExprType.WINDOW:
      const funcPart = `${expr.function}(${expr.args.map(a => renderExpression(a, dialect)).join(', ')})`;
      const partitionPart = expr.over.partitionBy?.length 
        ? `PARTITION BY ${expr.over.partitionBy.map(p => renderExpression(p, dialect)).join(', ')}`
        : '';
      const orderPart = expr.over.orderBy?.length
        ? `ORDER BY ${expr.over.orderBy.map(o => `${renderExpression(o.expression, dialect)} ${o.direction}`).join(', ')}`
        : '';
      return `${funcPart} OVER (${[partitionPart, orderPart].filter(Boolean).join(' ')})`;
    
    case ExprType.BINARY_OP:
      return `${renderExpression(expr.left, dialect)} ${expr.operator} ${renderExpression(expr.right, dialect)}`;
    
    case ExprType.CAST:
      return `CAST(${renderExpression(expr.expression, dialect)} AS ${expr.targetType})`;
    
    case ExprType.CASE:
      let caseSql = 'CASE';
      if (expr.operand) caseSql += ` ${renderExpression(expr.operand, dialect)}`;
      for (const cond of expr.conditions) {
        caseSql += ` WHEN ${renderExpression(cond.when, dialect)} THEN ${renderExpression(cond.then, dialect)}`;
      }
      if (expr.elseResult) caseSql += ` ELSE ${renderExpression(expr.elseResult, dialect)}`;
      caseSql += ' END';
      return caseSql;
    
    case 'raw':
      return expr.sql;
    
    default:
      return expr.sql || '';
  }
}

export default SQLParser;
