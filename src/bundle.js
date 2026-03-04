/**
 * SQL Copilot v2 - Bundled Modules (Part 1: Core)
 * All v2 compiler-style modules bundled as IIFE for direct browser usage.
 */
(function(global) {
  'use strict';

  // ============ CONSTANTS ============
  const ExprType = { COLUMN_REF: 'column_ref', LITERAL: 'literal', FUNCTION: 'function', BINARY_OP: 'binary_op', CASE: 'case', CAST: 'cast', STAR: 'star', WINDOW: 'window' };
  const JoinType = { INNER: 'INNER', LEFT: 'LEFT', RIGHT: 'RIGHT', FULL: 'FULL', CROSS: 'CROSS' };
  const NodeType = { MODEL: 'model', COLUMN: 'column', SOURCE: 'source' };
  const EdgeType = { DEPENDS_ON: 'depends_on', PRODUCES: 'produces', DERIVES_FROM: 'derives_from', JOINS_ON: 'joins_on', FOREIGN_KEY: 'foreign_key' };
  const Confidence = { EXPLICIT: 1.0, JOIN_USAGE: 0.7, NAMING: 0.4 };
  const SemanticRole = { DIMENSION: 'dimension', MEASURE: 'measure', KEY: 'key', TIMESTAMP: 'timestamp', UNKNOWN: 'unknown' };
  const AggregationType = { NONE: 'none', COUNT: 'count', COUNT_DISTINCT: 'count_distinct', SUM: 'sum', AVG: 'avg', MIN: 'min', MAX: 'max', RATIO: 'ratio' };

  // ============ SQL PARSER ============
  class SQLParser {
    constructor(dialect = 'presto') { this.dialect = dialect.toLowerCase(); this.errors = []; }
    setDialect(d) { this.dialect = d.toLowerCase(); }
    
    parse(sql) {
      this.errors = [];
      try {
        const n = this.normalize(sql);
        const upper = n.toUpperCase();
        
        // Detect statement type
        let ir;
        if (upper.startsWith('CREATE TABLE') && upper.includes(' AS ')) {
          ir = this.parseCTAS(n);
        } else if (upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE EXTERNAL TABLE')) {
          ir = this.parseDDL(n);
        } else if (upper.startsWith('CREATE VIEW') || upper.startsWith('CREATE OR REPLACE VIEW')) {
          ir = this.parseCreateView(n);
        } else {
          ir = this.parseSelect(n);
        }
        
        ir.originalSQL = sql; ir.dialect = this.dialect; ir.errors = this.errors;
        return ir;
      } catch (e) {
        this.errors.push({ type: 'PARSE_ERROR', message: e.message });
        return { type: 'ERROR', originalSQL: sql, errors: this.errors };
      }
    }
    
    // Parse CREATE TABLE DDL (not CTAS)
    parseDDL(sql) {
      const ir = { 
        type: 'DDL', 
        targetTable: null, 
        columns: [], 
        constraints: { primaryKey: [], uniqueKeys: [], foreignKeys: [] }
      };
      
      // Extract table name
      const tableMatch = sql.match(/CREATE\s+(?:EXTERNAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i);
      if (tableMatch) {
        ir.targetTable = this.parseTableName(tableMatch[1]);
      }
      
      // Extract column definitions and constraints from parentheses
      const colsMatch = sql.match(/\(([^)]+(?:\([^)]*\)[^)]*)*)\)/);
      if (colsMatch) {
        const colDefs = this.splitColumnDefs(colsMatch[1]);
        
        for (const def of colDefs) {
          const trimmed = def.trim();
          const upper = trimmed.toUpperCase();
          
          // Check for table-level constraints
          if (upper.startsWith('PRIMARY KEY')) {
            const pkMatch = trimmed.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
            if (pkMatch) {
              ir.constraints.primaryKey = pkMatch[1].split(',').map(c => c.trim());
            }
          } else if (upper.startsWith('UNIQUE')) {
            const ukMatch = trimmed.match(/UNIQUE\s*\(([^)]+)\)/i);
            if (ukMatch) {
              ir.constraints.uniqueKeys.push(ukMatch[1].split(',').map(c => c.trim()));
            }
          } else if (upper.startsWith('FOREIGN KEY') || upper.startsWith('CONSTRAINT')) {
            const fkMatch = trimmed.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)/i);
            if (fkMatch) {
              ir.constraints.foreignKeys.push({
                columns: fkMatch[1].split(',').map(c => c.trim()),
                refTable: fkMatch[2],
                refColumns: fkMatch[3].split(',').map(c => c.trim())
              });
            }
          } else {
            // Parse column definition
            const col = this.parseColumnDef(trimmed);
            if (col) ir.columns.push(col);
          }
        }
      }
      
      return ir;
    }
    
    parseColumnDef(def) {
      // Match: column_name TYPE [constraints...]
      const match = def.match(/^(\w+)\s+(\w+(?:\([^)]+\))?)\s*(.*)?$/i);
      if (!match) return null;
      
      const col = {
        name: match[1],
        type: match[2].toUpperCase(),
        isPK: false,
        isFK: false,
        nullable: true,
        unique: false,
        defaultValue: null,
        references: null
      };
      
      const constraints = (match[3] || '').toUpperCase();
      
      if (constraints.includes('PRIMARY KEY')) col.isPK = true;
      if (constraints.includes('NOT NULL')) col.nullable = false;
      if (constraints.includes('UNIQUE')) col.unique = true;
      
      // Check for inline REFERENCES
      const refMatch = (match[3] || '').match(/REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)/i);
      if (refMatch) {
        col.isFK = true;
        col.references = { table: refMatch[1], column: refMatch[2].trim() };
      }
      
      // Check for DEFAULT
      const defaultMatch = (match[3] || '').match(/DEFAULT\s+([^\s,]+)/i);
      if (defaultMatch) col.defaultValue = defaultMatch[1];
      
      return col;
    }
    
    splitColumnDefs(str) {
      const defs = [];
      let current = '';
      let depth = 0;
      
      for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth === 0) {
          if (current.trim()) defs.push(current.trim());
          current = '';
          continue;
        }
        current += c;
      }
      if (current.trim()) defs.push(current.trim());
      return defs;
    }
    
    parseCreateView(sql) {
      const match = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([^\s(]+)\s+AS\s+([\s\S]+)$/i);
      if (!match) throw new Error('Invalid CREATE VIEW');
      return { type: 'CREATE_VIEW', targetView: this.parseTableName(match[1]), ...this.parseSelect(match[2]) };
    }

    normalize(sql) {
      return sql.trim().replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
    }

    parseSelect(sql) {
      const ir = { type: 'SELECT', ctes: new Map(), projections: [], sources: [], joins: [], filters: [], groupBy: [], orderBy: [], limit: null, distinct: false };
      let rem = sql;

      if (rem.toUpperCase().startsWith('WITH ')) {
        const { ctes, remainingSQL } = this.parseCTEs(rem);
        ir.ctes = ctes; rem = remainingSQL;
      }

      const selMatch = rem.match(/^SELECT\s+(DISTINCT\s+)?([\s\S]+?)(?=\s+FROM\s+|\s*$)/i);
      if (selMatch) { ir.distinct = !!selMatch[1]; ir.projections = this.parseProjections(selMatch[2]); rem = rem.substring(selMatch[0].length); }

      const fromMatch = rem.match(/^\s*FROM\s+([\s\S]+?)(?=\s+WHERE\s+|\s+GROUP\s+BY\s+|\s+HAVING\s+|\s+ORDER\s+BY\s+|\s+LIMIT\s+|\s+UNION\s+|\s*$)/i);
      if (fromMatch) { const { sources, joins } = this.parseFrom(fromMatch[1]); ir.sources = sources; ir.joins = joins; rem = rem.substring(fromMatch[0].length); }

      const whereMatch = rem.match(/^\s*WHERE\s+([\s\S]+?)(?=\s+GROUP\s+BY\s+|\s+HAVING\s+|\s+ORDER\s+BY\s+|\s+LIMIT\s+|\s*$)/i);
      if (whereMatch) { ir.filters = [this.parseExpr(whereMatch[1].trim())]; rem = rem.substring(whereMatch[0].length); }

      const groupMatch = rem.match(/^\s*GROUP\s+BY\s+([\s\S]+?)(?=\s+HAVING\s+|\s+ORDER\s+BY\s+|\s+LIMIT\s+|\s*$)/i);
      if (groupMatch) { ir.groupBy = this.splitComma(groupMatch[1]).map(c => this.parseExpr(c.trim())); rem = rem.substring(groupMatch[0].length); }

      const orderMatch = rem.match(/^\s*ORDER\s+BY\s+([\s\S]+?)(?=\s+LIMIT\s+|\s*$)/i);
      if (orderMatch) { ir.orderBy = this.splitComma(orderMatch[1]).map(c => { const m = c.trim().match(/^([\s\S]+?)\s*(ASC|DESC)?$/i); return { expression: this.parseExpr(m[1].trim()), direction: (m[2]||'ASC').toUpperCase() }; }); rem = rem.substring(orderMatch[0].length); }

      const limitMatch = rem.match(/^\s*LIMIT\s+(\d+)/i);
      if (limitMatch) ir.limit = parseInt(limitMatch[1], 10);

      return ir;
    }

    parseCTAS(sql) {
      const m = sql.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s+(?:WITH\s*\([^)]*\)\s+)?AS\s+([\s\S]+)$/i);
      if (!m) throw new Error('Invalid CTAS');
      return { type: 'CTAS', targetTable: this.parseTableName(m[1]), ...this.parseSelect(m[2]) };
    }

    parseCTEs(sql) {
      const ctes = new Map(); let rem = sql.substring(5).trim();
      const pat = /^(\w+)\s+AS\s*\(([\s\S]+?)\)(?:\s*,\s*|\s+(?=SELECT))/i;
      while (true) { const m = rem.match(pat); if (!m) break; ctes.set(m[1].toLowerCase(), { ...this.parseSelect(m[2]), type: 'CTE', name: m[1] }); rem = rem.substring(m[0].length).trim(); }
      return { ctes, remainingSQL: rem };
    }

    parseProjections(str) {
      return this.splitComma(str).filter(c => c.trim()).map(col => {
        const t = col.trim();
        const aliasMatch = t.match(/^([\s\S]+?)\s+(?:AS\s+)?(\w+)$/i);
        if (aliasMatch) { const expr = this.parseExpr(aliasMatch[1].trim()); return { alias: aliasMatch[2], expression: expr, sourceColumns: this.extractColRefs(expr) }; }
        const expr = this.parseExpr(t);
        return { alias: expr.type === ExprType.COLUMN_REF ? expr.column : t, expression: expr, sourceColumns: this.extractColRefs(expr) };
      });
    }

    parseFrom(str) {
      const sources = [], joins = [];
      const parts = str.split(/\s+((?:LEFT|RIGHT|FULL|INNER|CROSS)\s+(?:OUTER\s+)?)?JOIN\s+/i);
      if (parts[0]) { const s = this.parseTableSource(parts[0].trim()); if (s) sources.push(s); }
      for (let i = 1; i < parts.length; i += 2) {
        const jt = (parts[i]||'').trim().toUpperCase();
        const jc = parts[i+1]; if (!jc) continue;
        let joinType = JoinType.INNER;
        if (jt.includes('LEFT')) joinType = JoinType.LEFT;
        else if (jt.includes('RIGHT')) joinType = JoinType.RIGHT;
        else if (jt.includes('FULL')) joinType = JoinType.FULL;
        const onMatch = jc.match(/^([\s\S]+?)\s+ON\s+([\s\S]+)$/i);
        if (onMatch) {
          const right = this.parseTableSource(onMatch[1].trim());
          const pred = this.parseExpr(onMatch[2].trim());
          joins.push({ type: joinType, right, predicate: pred, predicateColumns: this.extractColRefs(pred) });
        } else {
          joins.push({ type: joinType, right: this.parseTableSource(jc.trim()), predicate: null, predicateColumns: [] });
        }
      }
      return { sources, joins };
    }

    parseTableSource(str) {
      const t = str.trim(); if (!t) return null;
      if (t.startsWith('(')) { const m = t.match(/^\(([\s\S]+)\)\s*(?:AS\s+)?(\w+)?$/i); if (m) return { type: 'subquery', query: this.parseSelect(m[1]), alias: m[2]||null }; }
      const m = t.match(/^([^\s]+)(?:\s+(?:AS\s+)?(\w+))?$/i);
      if (m) return { type: 'table', ...this.parseTableName(m[1]), alias: m[2]||null };
      return null;
    }

    parseTableName(n) {
      const p = n.split('.');
      if (p.length === 3) return { catalog: p[0], schema: p[1], table: p[2] };
      if (p.length === 2) return { catalog: null, schema: p[0], table: p[1] };
      return { catalog: null, schema: null, table: p[0] };
    }

    parseExpr(str) {
      const t = str.trim();
      if (t === '*') return { type: ExprType.STAR, table: null };
      const starMatch = t.match(/^(\w+)\.\*$/); if (starMatch) return { type: ExprType.STAR, table: starMatch[1] };
      if (/^-?\d+(\.\d+)?$/.test(t)) return { type: ExprType.LITERAL, value: parseFloat(t), dataType: 'NUMBER' };
      if (/^'[^']*'$/.test(t)) return { type: ExprType.LITERAL, value: t.slice(1,-1), dataType: 'STRING' };
      if (t.toUpperCase() === 'NULL') return { type: ExprType.LITERAL, value: null, dataType: 'NULL' };
      if (/^(TRUE|FALSE)$/i.test(t)) return { type: ExprType.LITERAL, value: t.toUpperCase() === 'TRUE', dataType: 'BOOLEAN' };
      if (t.toUpperCase().startsWith('CASE ')) return this.parseCase(t);
      const castMatch = t.match(/^CAST\s*\(\s*([\s\S]+?)\s+AS\s+(\w+(?:\([^)]+\))?)\s*\)$/i);
      if (castMatch) return { type: ExprType.CAST, expression: this.parseExpr(castMatch[1]), targetType: castMatch[2].toUpperCase() };
      const funcMatch = t.match(/^(\w+)\s*\(([\s\S]*)\)$/);
      if (funcMatch) {
        const fn = funcMatch[1].toUpperCase(), args = funcMatch[2];
        const overMatch = args.match(/([\s\S]*?)\s+OVER\s*\(([\s\S]*)\)$/i);
        if (overMatch) return { type: ExprType.WINDOW, function: fn, args: this.splitComma(overMatch[1]).map(a => this.parseExpr(a.trim())), over: this.parseWindow(overMatch[2]) };
        const distMatch = args.match(/^DISTINCT\s+([\s\S]+)$/i);
        return { type: ExprType.FUNCTION, name: fn, args: this.splitComma(distMatch ? distMatch[1] : args).map(a => this.parseExpr(a.trim())), distinct: !!distMatch };
      }
      for (const op of ['=', '!=', '<>', '>=', '<=', '>', '<', '+', '-', '*', '/', 'AND', 'OR', 'LIKE']) {
        const pat = op.length > 1 ? new RegExp(`\\s+${op}\\s+`, 'i') : new RegExp(`\\s*${op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`);
        const parts = t.split(pat);
        if (parts.length === 2) return { type: ExprType.BINARY_OP, operator: op.toUpperCase(), left: this.parseExpr(parts[0]), right: this.parseExpr(parts[1]) };
      }
      const colMatch = t.match(/^(?:(\w+)\.)?(\w+)$/);
      if (colMatch) return { type: ExprType.COLUMN_REF, table: colMatch[1]||null, column: colMatch[2] };
      return { type: 'raw', sql: t };
    }

    parseCase(str) {
      const r = { type: ExprType.CASE, conditions: [], elseResult: null };
      const whenPat = /WHEN\s+([\s\S]+?)\s+THEN\s+([\s\S]+?)(?=\s+WHEN|\s+ELSE|\s+END)/gi;
      let m; while ((m = whenPat.exec(str)) !== null) r.conditions.push({ when: this.parseExpr(m[1]), then: this.parseExpr(m[2]) });
      const elseMatch = str.match(/ELSE\s+([\s\S]+?)\s+END$/i);
      if (elseMatch) r.elseResult = this.parseExpr(elseMatch[1]);
      return r;
    }

    parseWindow(str) {
      const spec = { partitionBy: [], orderBy: [] };
      const partMatch = str.match(/PARTITION\s+BY\s+([\s\S]+?)(?=\s+ORDER|\s*$)/i);
      if (partMatch) spec.partitionBy = this.splitComma(partMatch[1]).map(p => this.parseExpr(p.trim()));
      const ordMatch = str.match(/ORDER\s+BY\s+([\s\S]+?)(?=\s+ROWS|\s+RANGE|\s*$)/i);
      if (ordMatch) spec.orderBy = this.splitComma(ordMatch[1]).map(c => { const m = c.trim().match(/^([\s\S]+?)\s*(ASC|DESC)?$/i); return { expression: this.parseExpr(m[1].trim()), direction: (m[2]||'ASC').toUpperCase() }; });
      return spec;
    }

    extractColRefs(expr) {
      const refs = [];
      const walk = (n) => {
        if (!n) return;
        if (n.type === ExprType.COLUMN_REF) { refs.push(n.table ? `${n.table}.${n.column}` : n.column); }
        else if (n.type === ExprType.FUNCTION || n.type === ExprType.WINDOW) { (n.args||[]).forEach(walk); if (n.over) { n.over.partitionBy?.forEach(walk); n.over.orderBy?.forEach(o => walk(o.expression)); } }
        else if (n.type === ExprType.BINARY_OP) { walk(n.left); walk(n.right); }
        else if (n.type === ExprType.CASE) { if (n.operand) walk(n.operand); n.conditions?.forEach(c => { walk(c.when); walk(c.then); }); if (n.elseResult) walk(n.elseResult); }
        else if (n.type === ExprType.CAST) { walk(n.expression); }
      };
      walk(expr); return refs;
    }

    splitComma(str) {
      const r = []; let cur = '', depth = 0, inStr = false, strChar = null;
      for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (inStr) { cur += c; if (c === strChar && str[i-1] !== '\\') inStr = false; }
        else if (c === "'" || c === '"') { inStr = true; strChar = c; cur += c; }
        else if (c === '(') { depth++; cur += c; }
        else if (c === ')') { depth--; cur += c; }
        else if (c === ',' && depth === 0) { r.push(cur.trim()); cur = ''; }
        else { cur += c; }
      }
      if (cur.trim()) r.push(cur.trim());
      return r;
    }
  }

  // ============ RENDER EXPRESSION ============
  function renderExpression(expr, dialect = 'presto') {
    if (!expr) return '';
    switch (expr.type) {
      case ExprType.COLUMN_REF: return expr.table ? `${expr.table}.${expr.column}` : expr.column;
      case ExprType.LITERAL: if (expr.value === null) return 'NULL'; if (expr.dataType === 'STRING') return `'${expr.value}'`; return String(expr.value);
      case ExprType.STAR: return expr.table ? `${expr.table}.*` : '*';
      case ExprType.FUNCTION: return `${expr.name}(${expr.distinct ? 'DISTINCT ' : ''}${expr.args.map(a => renderExpression(a, dialect)).join(', ')})`;
      case ExprType.WINDOW: return `${expr.function}(${expr.args.map(a => renderExpression(a, dialect)).join(', ')}) OVER (${[expr.over.partitionBy?.length ? `PARTITION BY ${expr.over.partitionBy.map(p => renderExpression(p, dialect)).join(', ')}` : '', expr.over.orderBy?.length ? `ORDER BY ${expr.over.orderBy.map(o => `${renderExpression(o.expression, dialect)} ${o.direction}`).join(', ')}` : ''].filter(Boolean).join(' ')})`;
      case ExprType.BINARY_OP: return `${renderExpression(expr.left, dialect)} ${expr.operator} ${renderExpression(expr.right, dialect)}`;
      case ExprType.CAST: return `CAST(${renderExpression(expr.expression, dialect)} AS ${expr.targetType})`;
      case ExprType.CASE: let s = 'CASE'; if (expr.operand) s += ` ${renderExpression(expr.operand, dialect)}`; for (const c of expr.conditions) s += ` WHEN ${renderExpression(c.when, dialect)} THEN ${renderExpression(c.then, dialect)}`; if (expr.elseResult) s += ` ELSE ${renderExpression(expr.elseResult, dialect)}`; return s + ' END';
      default: return expr.sql || '';
    }
  }

  // ============ SCHEMA EXTRACTOR ============
  class SchemaExtractor {
    constructor() { 
      this.catalog = null; // WarehouseConnector or MockWarehouseConnector
      this.upstreamSchemas = new Map(); // modelName -> columns (for SELECT * expansion)
      this.warnings = []; // Track extraction warnings
    }
    
    setCatalog(c) { this.catalog = c; }
    setUpstreamSchemas(schemas) { 
      this.upstreamSchemas.clear();
      for (const [name, cols] of Object.entries(schemas)) {
        this.upstreamSchemas.set(name.toLowerCase(), cols);
      }
    }
    addUpstreamSchema(modelName, columns) {
      this.upstreamSchemas.set(modelName.toLowerCase(), columns);
    }
    getWarnings() { return this.warnings; }
    clearWarnings() { this.warnings = []; }

    extract(ir, modelName, options = {}) {
      const { layer = null, description = null } = options;
      this.warnings = [];
      const targetTable = ir.targetTable || ir.targetView || { table: modelName };
      
      // Extract schema prefix and table name
      const tableName = targetTable.table || modelName;
      const schemaName = targetTable.schema || null;
      
      // Detect layer from schema prefix (bronze.*, silver.*, gold.*)
      const detectedLayer = this.detectLayerFromSchema(schemaName, tableName);
      const finalLayer = layer || detectedLayer;
      
      // Build alias-to-table mapping for SELECT * expansion
      const aliasMap = this.buildAliasMap(ir);
      
      // Extract columns with SELECT * expansion
      const columns = this.extractColumns(ir, aliasMap);
      const isAggregated = ir.groupBy && ir.groupBy.length > 0;
      const grainColumns = isAggregated ? this.extractGrainColumns(ir.groupBy, columns) : this.inferPK(columns);
      const deps = this.extractDeps(ir);
      const joinMeta = this.extractJoinMeta(ir.joins);
      const filters = (ir.filters || []).map(f => ({ expression: f, sql: renderExpression(f), columns: this.extractSrcCols(f) }));

      return {
        id: `model_${this.hash(tableName.toLowerCase())}`, name: tableName, schema: schemaName,
        database: targetTable.database || null, description, layer: finalLayer, columns, grainColumns, isAggregated, dependencies: deps,
        joinMetadata: joinMeta, filters, filtersNormalized: filters.map(f => f.sql), sourceType: ir.type,
        hasPartialLineage: ir.isPartial || this.warnings.length > 0, extractedAt: new Date().toISOString(),
        warnings: this.warnings.length > 0 ? [...this.warnings] : undefined
      };
    }

    detectLayerFromSchema(schemaName, tableName) {
      // Map schema names to medallion architecture layers
      if (!schemaName && !tableName) return null;
      
      const schema = (schemaName || '').toLowerCase();
      const table = (tableName || '').toLowerCase();
      
      // Bronze/Raw layer
      if (schema === 'bronze' || schema === 'raw' || table.startsWith('raw_') || table.startsWith('bronze_')) {
        return 'raw';
      }
      
      // Silver/Staging layer
      if (schema === 'silver' || schema === 'staging' || schema === 'stg' || 
          table.startsWith('stg_') || table.startsWith('silver_') || table.startsWith('staging_')) {
        return 'staging';
      }
      
      // Gold layer - distinguish between dimensions, facts, and aggregates
      if (schema === 'gold' || schema === 'curated' || schema === 'analytics' || schema === 'mart') {
        if (table.startsWith('dim_')) return 'dimension';
        if (table.startsWith('fact_')) return 'fact';
        if (table.startsWith('agg_') || table.includes('_summary') || table.includes('_rollup')) return 'aggregate';
        return 'gold';
      }
      
      // Detect from table naming patterns only
      if (table.startsWith('dim_')) return 'dimension';
      if (table.startsWith('fact_')) return 'fact';
      
      return null;
    }

    // Build mapping of aliases to actual table names
    buildAliasMap(ir) {
      const aliasMap = new Map();
      
      // From main sources
      for (const src of (ir.sources || [])) {
        if (src.type === 'table') {
          const tableName = src.table;
          const alias = src.alias || tableName;
          aliasMap.set(alias.toLowerCase(), tableName.toLowerCase());
        }
      }
      
      // From joins
      for (const join of (ir.joins || [])) {
        if (join.right?.type === 'table') {
          const tableName = join.right.table;
          const alias = join.right.alias || tableName;
          aliasMap.set(alias.toLowerCase(), tableName.toLowerCase());
        }
      }
      
      // From CTEs
      if (ir.ctes) {
        for (const [cteName] of ir.ctes) {
          aliasMap.set(cteName.toLowerCase(), cteName.toLowerCase());
        }
      }
      
      return aliasMap;
    }

    // Expand SELECT * using catalog or upstream schemas
    async expandStar(tableName, aliasMap) {
      const resolvedTable = aliasMap.get(tableName?.toLowerCase()) || tableName?.toLowerCase();
      
      // Try upstream schemas first (from previously parsed models)
      if (this.upstreamSchemas.has(resolvedTable)) {
        const cols = this.upstreamSchemas.get(resolvedTable);
        return cols.map(c => ({
          name: c.name,
          type: c.type || 'VARCHAR',
          sourceTable: resolvedTable,
          fromCatalog: false
        }));
      }
      
      // Try warehouse catalog
      if (this.catalog) {
        // Try to find schema.table format
        const parts = resolvedTable.split('.');
        const schema = parts.length > 1 ? parts[0] : 'default';
        const table = parts.length > 1 ? parts[1] : parts[0];
        
        const cols = await this.catalog.getTableColumns(schema, table);
        if (cols && cols.length > 0) {
          return cols.map(c => ({
            name: c.name,
            type: c.type,
            sourceTable: resolvedTable,
            fromCatalog: true
          }));
        }
      }
      
      // Cannot expand - add warning
      this.warnings.push({
        type: 'STAR_NOT_EXPANDED',
        table: resolvedTable,
        message: `Could not expand SELECT * for table '${resolvedTable}' - no schema available`
      });
      
      return null;
    }

    extractColumns(ir, aliasMap) {
      if (!ir.projections) return [];
      
      const columns = [];
      let colIndex = 0;
      
      for (const proj of ir.projections) {
        const expr = proj.expression;
        
        // Handle SELECT * and table.*
        if (expr.type === ExprType.STAR) {
          const tableName = expr.table;
          
          // For now, synchronous fallback - mark as unexpanded
          // Full async expansion happens in extractAsync()
          if (tableName) {
            // table.* - try to expand from upstream schemas
            const resolvedTable = aliasMap.get(tableName.toLowerCase()) || tableName.toLowerCase();
            if (this.upstreamSchemas.has(resolvedTable)) {
              const upstreamCols = this.upstreamSchemas.get(resolvedTable);
              for (const col of upstreamCols) {
                columns.push({
                  id: `col_${this.hash(col.name.toLowerCase())}_${colIndex++}`,
                  name: col.name,
                  type: col.type || 'VARCHAR',
                  typeConfidence: 0.8,
                  expressionIR: { type: ExprType.COLUMN_REF, table: tableName, column: col.name },
                  expressionSQL: `${tableName}.${col.name}`,
                  sourceColumns: [`${resolvedTable}.${col.name}`],
                  semanticRole: this.classifyRoleByName(col.name),
                  aggregationType: AggregationType.NONE,
                  aggregationDistinct: false,
                  nullable: col.nullable,
                  isPK: col.isPK || false,
                  isFK: col.isFK || false,
                  isComputed: false,
                  isPassthrough: true,
                  expandedFrom: `${tableName}.*`
                });
              }
            } else {
              // Cannot expand - create placeholder
              this.warnings.push({
                type: 'STAR_NOT_EXPANDED',
                table: tableName,
                message: `Could not expand ${tableName}.* - no upstream schema available`
              });
              columns.push({
                id: `col_star_${tableName}_${colIndex++}`,
                name: `${tableName}.*`,
                type: 'UNKNOWN',
                typeConfidence: 0,
                expressionIR: expr,
                expressionSQL: `${tableName}.*`,
                sourceColumns: [`${tableName}.*`],
                semanticRole: SemanticRole.UNKNOWN,
                aggregationType: AggregationType.NONE,
                nullable: null,
                isPK: false,
                isFK: false,
                isComputed: false,
                isPassthrough: false,
                isUnexpandedStar: true
              });
            }
          } else {
            // SELECT * - expand all tables
            let expanded = false;
            for (const [alias, tableName] of aliasMap) {
              if (this.upstreamSchemas.has(tableName)) {
                const upstreamCols = this.upstreamSchemas.get(tableName);
                for (const col of upstreamCols) {
                  columns.push({
                    id: `col_${this.hash(col.name.toLowerCase())}_${colIndex++}`,
                    name: col.name,
                    type: col.type || 'VARCHAR',
                    typeConfidence: 0.8,
                    expressionIR: { type: ExprType.COLUMN_REF, table: alias, column: col.name },
                    expressionSQL: `${alias}.${col.name}`,
                    sourceColumns: [`${tableName}.${col.name}`],
                    semanticRole: this.classifyRoleByName(col.name),
                    aggregationType: AggregationType.NONE,
                    nullable: col.nullable,
                    isPK: col.isPK || false,
                    isFK: col.isFK || false,
                    isComputed: false,
                    isPassthrough: true,
                    expandedFrom: '*'
                  });
                }
                expanded = true;
              }
            }
            
            if (!expanded) {
              this.warnings.push({
                type: 'STAR_NOT_EXPANDED',
                table: null,
                message: 'Could not expand SELECT * - no upstream schemas available'
              });
              columns.push({
                id: `col_star_all_${colIndex++}`,
                name: '*',
                type: 'UNKNOWN',
                typeConfidence: 0,
                expressionIR: expr,
                expressionSQL: '*',
                sourceColumns: ['*'],
                semanticRole: SemanticRole.UNKNOWN,
                aggregationType: AggregationType.NONE,
                nullable: null,
                isPK: false,
                isFK: false,
                isComputed: false,
                isPassthrough: false,
                isUnexpandedStar: true
              });
            }
          }
        } else {
          // Regular column
          const srcCols = proj.sourceColumns || this.extractSrcCols(expr);
          const typeInfo = this.inferType(expr);
          const aggInfo = this.detectAgg(expr);
          const role = this.classifyRole(proj, aggInfo, ir.groupBy);
          
          columns.push({
            id: `col_${this.hash(proj.alias.toLowerCase())}_${colIndex++}`,
            name: proj.alias,
            type: typeInfo.type,
            typeConfidence: typeInfo.confidence,
            expressionIR: expr,
            expressionSQL: renderExpression(expr),
            sourceColumns: srcCols,
            semanticRole: role,
            aggregationType: aggInfo.type,
            aggregationDistinct: aggInfo.distinct,
            nullable: aggInfo.type === AggregationType.COUNT ? false : null,
            isPK: false,
            isFK: false,
            isComputed: expr.type !== ExprType.COLUMN_REF,
            isPassthrough: srcCols.length === 1 && expr.type === ExprType.COLUMN_REF
          });
        }
      }
      
      // Deduplicate columns by name (case-insensitive), keep first occurrence
      const seen = new Set();
      const deduplicated = [];
      for (const col of columns) {
        const key = col.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          deduplicated.push(col);
        }
      }
      
      return deduplicated;
    }
    
    classifyRoleByName(name) {
      const n = name.toLowerCase();
      if (n.endsWith('_id') || n === 'id') return SemanticRole.KEY;
      if (n.endsWith('_at') || n.endsWith('_ts')) return SemanticRole.TIMESTAMP;
      if (n.endsWith('_amt') || n.endsWith('_count') || n.includes('revenue') || n.includes('total')) return SemanticRole.MEASURE;
      return SemanticRole.UNKNOWN;
    }

    extractSrcCols(expr) {
      const refs = [];
      const walk = (n) => {
        if (!n) return;
        if (n.type === ExprType.COLUMN_REF) { const r = n.table ? `${n.table}.${n.column}` : n.column; if (!refs.includes(r)) refs.push(r); }
        else if (n.type === ExprType.FUNCTION || n.type === ExprType.WINDOW) { (n.args||[]).forEach(walk); if (n.over) { n.over.partitionBy?.forEach(walk); n.over.orderBy?.forEach(o => walk(o.expression)); } }
        else if (n.type === ExprType.BINARY_OP) { walk(n.left); walk(n.right); }
        else if (n.type === ExprType.CASE) { if (n.operand) walk(n.operand); n.conditions?.forEach(c => { walk(c.when); walk(c.then); }); if (n.elseResult) walk(n.elseResult); }
        else if (n.type === ExprType.CAST) { walk(n.expression); }
        else if (n.type === ExprType.STAR) { refs.push(n.table ? `${n.table}.*` : '*'); }
      };
      walk(expr); return refs;
    }

    inferType(expr) {
      if (!expr) return { type: 'UNKNOWN', confidence: 0 };
      if (expr.type === ExprType.LITERAL) return { type: expr.dataType || 'UNKNOWN', confidence: 1.0 };
      if (expr.type === ExprType.COLUMN_REF) return this.inferTypeFromName(expr.column);
      if (expr.type === ExprType.FUNCTION || expr.type === ExprType.WINDOW) return this.inferFuncType(expr);
      if (expr.type === ExprType.CAST) return { type: expr.targetType, confidence: 1.0 };
      if (expr.type === ExprType.BINARY_OP) {
        const op = expr.operator?.toUpperCase();
        if (['=','!=','<>','>','<','>=','<=','LIKE','IN','IS','AND','OR'].includes(op)) return { type: 'BOOLEAN', confidence: 1.0 };
        if (op === '/') return { type: 'DOUBLE', confidence: 0.9 };
        return this.inferType(expr.left);
      }
      if (expr.type === ExprType.CASE && expr.conditions?.length > 0) return this.inferType(expr.conditions[0].then);
      return { type: 'UNKNOWN', confidence: 0 };
    }

    inferTypeFromName(name) {
      const l = name.toLowerCase();
      if (l.endsWith('_id') || l === 'id') return { type: 'BIGINT', confidence: 0.7 };
      if (l.endsWith('_at') || l.endsWith('_ts') || l.includes('timestamp')) return { type: 'TIMESTAMP', confidence: 0.7 };
      if (l.endsWith('_dt') || l.endsWith('_date') || l === 'date') return { type: 'DATE', confidence: 0.7 };
      if (l.endsWith('_amt') || l.endsWith('_amount') || l.includes('price') || l.includes('revenue')) return { type: 'DECIMAL(18,2)', confidence: 0.6 };
      if (l.endsWith('_cnt') || l.endsWith('_count') || l.startsWith('num_')) return { type: 'BIGINT', confidence: 0.6 };
      if (l.startsWith('is_') || l.startsWith('has_') || l.endsWith('_flag')) return { type: 'BOOLEAN', confidence: 0.7 };
      return { type: 'VARCHAR', confidence: 0.3 };
    }

    inferFuncType(expr) {
      const fn = (expr.function || expr.name || '').toUpperCase();
      if (fn === 'COUNT') return { type: 'BIGINT', confidence: 1.0 };
      if (fn === 'AVG') return { type: 'DOUBLE', confidence: 0.9 };
      if (['SUM','MIN','MAX'].includes(fn) && expr.args?.length > 0) return this.inferType(expr.args[0]);
      if (['DATE_TRUNC','NOW','CURRENT_TIMESTAMP'].includes(fn)) return { type: 'TIMESTAMP', confidence: 0.9 };
      if (['DATE','CURRENT_DATE'].includes(fn)) return { type: 'DATE', confidence: 1.0 };
      if (['YEAR','MONTH','DAY','DATEDIFF'].includes(fn)) return { type: 'BIGINT', confidence: 1.0 };
      if (['CONCAT','UPPER','LOWER','TRIM','SUBSTR','SUBSTRING','REPLACE'].includes(fn)) return { type: 'VARCHAR', confidence: 0.8 };
      if (fn === 'COALESCE' && expr.args?.length > 0) return this.inferType(expr.args[0]);
      return { type: 'UNKNOWN', confidence: 0.2 };
    }

    detectAgg(expr) {
      if (!expr) return { type: AggregationType.NONE, distinct: false };
      const aggFuncs = ['COUNT','SUM','AVG','MIN','MAX'];
      if (expr.type === ExprType.FUNCTION || expr.type === ExprType.WINDOW) {
        const fn = (expr.function || expr.name || '').toUpperCase();
        if (aggFuncs.includes(fn)) {
          let t = AggregationType.CUSTOM;
          if (fn === 'COUNT') t = expr.distinct ? AggregationType.COUNT_DISTINCT : AggregationType.COUNT;
          else if (fn === 'SUM') t = AggregationType.SUM;
          else if (fn === 'AVG') t = AggregationType.AVG;
          else if (fn === 'MIN') t = AggregationType.MIN;
          else if (fn === 'MAX') t = AggregationType.MAX;
          return { type: t, distinct: expr.distinct || false };
        }
      }
      if (expr.type === ExprType.BINARY_OP && expr.operator === '/') {
        const l = this.detectAgg(expr.left), r = this.detectAgg(expr.right);
        if (l.type !== AggregationType.NONE && r.type !== AggregationType.NONE) return { type: AggregationType.RATIO, distinct: false };
      }
      if (expr.type === ExprType.BINARY_OP) {
        const l = this.detectAgg(expr.left); if (l.type !== AggregationType.NONE) return l;
        const r = this.detectAgg(expr.right); if (r.type !== AggregationType.NONE) return r;
      }
      return { type: AggregationType.NONE, distinct: false };
    }

    classifyRole(proj, aggInfo, groupBy) {
      if (aggInfo.type !== AggregationType.NONE) return SemanticRole.MEASURE;
      if (groupBy?.length > 0) {
        const cn = proj.alias?.toLowerCase();
        if (groupBy.some(g => g.type === ExprType.COLUMN_REF && g.column?.toLowerCase() === cn)) return SemanticRole.DIMENSION;
      }
      const n = proj.alias?.toLowerCase() || '';
      if (n.endsWith('_id') || n === 'id') return SemanticRole.KEY;
      if (n.endsWith('_at') || n.endsWith('_ts')) return SemanticRole.TIMESTAMP;
      if (n.endsWith('_amt') || n.endsWith('_count') || n.includes('revenue') || n.includes('total')) return SemanticRole.MEASURE;
      return SemanticRole.UNKNOWN;
    }

    extractGrainColumns(groupBy, columns) {
      if (!groupBy?.length) return [];
      return groupBy.map(g => {
        if (g.type === ExprType.COLUMN_REF) return g.column;
        const rendered = renderExpression(g);
        const mc = columns.find(c => c.expressionSQL === rendered);
        return mc?.name || rendered;
      }).filter(Boolean);
    }

    inferPK(columns) {
      const idCol = columns.find(c => c.name.toLowerCase() === 'id');
      if (idCol) return [idCol.name];
      const idCols = columns.filter(c => c.name.toLowerCase().endsWith('_id'));
      if (idCols.length === 1) return [idCols[0].name];
      return [];
    }

    extractDeps(ir) {
      const deps = new Set();
      const addSource = (s) => { if (s?.type === 'table') deps.add(this.buildFQN(s)); else if (s?.type === 'subquery') this.extractDeps(s.query).forEach(d => deps.add(d)); };
      (ir.sources || []).forEach(addSource);
      (ir.joins || []).forEach(j => addSource(j.right));
      if (ir.ctes) for (const [,cte] of ir.ctes) this.extractDeps(cte).forEach(d => deps.add(d));
      return Array.from(deps);
    }

    buildFQN(s) { const p = []; if (s.catalog) p.push(s.catalog); if (s.schema) p.push(s.schema); p.push(s.table); return p.join('.'); }

    extractJoinMeta(joins) {
      if (!joins?.length) return [];
      return joins.map(j => ({ type: j.type, rightTable: j.right?.type === 'table' ? this.buildFQN(j.right) : null, rightAlias: j.right?.alias || null, predicate: j.predicate ? renderExpression(j.predicate) : null, predicateColumns: j.predicateColumns || [] }));
    }

    hash(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h = h & h; } return Math.abs(h).toString(36); }
  }

  // ============ DBT RESOLVER ============
  class DbtResolver {
    constructor() { 
      this.manifest = null; 
      this.catalog = null;
      this.models = new Map(); 
      this.sources = new Map(); 
      this.columnTypes = new Map(); // modelName -> { colName -> type }
    }
    
    load(manifest) { 
      this.manifest = typeof manifest === 'string' ? JSON.parse(manifest) : manifest; 
      this.indexNodes(); 
      return this; 
    }
    
    // Load dbt catalog.json for column types
    loadCatalog(catalog) {
      this.catalog = typeof catalog === 'string' ? JSON.parse(catalog) : catalog;
      this.indexCatalog();
      return this;
    }
    
    indexNodes() {
      if (!this.manifest?.nodes) return;
      for (const [uid, node] of Object.entries(this.manifest.nodes)) {
        if (node.resource_type === 'model') this.models.set(node.name.toLowerCase(), { uniqueId: uid, ...node });
      }
      if (this.manifest.sources) for (const [uid, src] of Object.entries(this.manifest.sources)) this.sources.set(`${src.source_name}.${src.name}`.toLowerCase(), { uniqueId: uid, ...src });
    }
    
    // Index catalog for column type lookups
    indexCatalog() {
      if (!this.catalog?.nodes) return;
      
      for (const [nodeId, node] of Object.entries(this.catalog.nodes)) {
        if (!node.columns) continue;
        
        const modelName = node.metadata?.name?.toLowerCase() || nodeId.split('.').pop().toLowerCase();
        const colTypes = new Map();
        
        for (const [colName, colInfo] of Object.entries(node.columns)) {
          colTypes.set(colName.toLowerCase(), {
            name: colName,
            type: colInfo.type || 'VARCHAR',
            index: colInfo.index,
            comment: colInfo.comment,
            // Additional metadata from catalog
            stats: node.stats || {}
          });
        }
        
        this.columnTypes.set(modelName, colTypes);
      }
      
      // Also index sources from catalog
      if (this.catalog.sources) {
        for (const [sourceId, source] of Object.entries(this.catalog.sources)) {
          if (!source.columns) continue;
          
          const sourceName = `${source.metadata?.schema || 'default'}.${source.metadata?.name}`.toLowerCase();
          const colTypes = new Map();
          
          for (const [colName, colInfo] of Object.entries(source.columns)) {
            colTypes.set(colName.toLowerCase(), {
              name: colName,
              type: colInfo.type || 'VARCHAR',
              index: colInfo.index,
              comment: colInfo.comment
            });
          }
          
          this.columnTypes.set(sourceName, colTypes);
        }
      }
    }
    
    // Get column type from catalog
    getColumnType(modelName, columnName) {
      const modelCols = this.columnTypes.get(modelName.toLowerCase());
      if (!modelCols) return null;
      return modelCols.get(columnName.toLowerCase())?.type || null;
    }
    
    // Get all columns for a model from catalog
    getModelColumns(modelName) {
      const modelCols = this.columnTypes.get(modelName.toLowerCase());
      if (!modelCols) return null;
      return Array.from(modelCols.values());
    }
    
    // Check if catalog has column info for a model
    hasColumnInfo(modelName) {
      return this.columnTypes.has(modelName.toLowerCase());
    }
    
    resolveRef(modelName) {
      const node = this.models.get(modelName.toLowerCase());
      if (!node) return { resolved: false, original: modelName, error: `Model '${modelName}' not found` };
      return { resolved: true, original: modelName, uniqueId: node.uniqueId, schema: node.schema, database: node.database, fqn: this.buildFQN(node) };
    }
    
    resolveSource(sourceName, tableName) {
      const node = this.sources.get(`${sourceName}.${tableName}`.toLowerCase());
      if (!node) return { resolved: false, original: `${sourceName}.${tableName}`, error: 'Source not found' };
      return { resolved: true, original: `${sourceName}.${tableName}`, uniqueId: node.uniqueId, schema: node.schema, database: node.database, fqn: this.buildFQN(node) };
    }
    
    buildFQN(node) { const p = []; if (node.database) p.push(node.database); if (node.schema) p.push(node.schema); p.push(node.alias || node.identifier || node.name); return p.join('.'); }
    getCompiledSQL(modelName) { const node = this.models.get(modelName.toLowerCase()); return node?.compiled_code || node?.compiled_sql || null; }
    
    getAllModels() { 
      return Array.from(this.models.values()).map(n => ({ 
        name: n.name, 
        uniqueId: n.uniqueId, 
        schema: n.schema, 
        database: n.database, 
        fqn: this.buildFQN(n), 
        tags: n.tags || [], 
        description: n.description || null,
        columns: this.getModelColumns(n.name) // Include columns from catalog if available
      })); 
    }
    
    // Get model with full column info from both manifest and catalog
    getModelWithColumns(modelName) {
      const node = this.models.get(modelName.toLowerCase());
      if (!node) return null;
      
      const catalogCols = this.getModelColumns(modelName);
      const manifestCols = node.columns ? Object.entries(node.columns).map(([name, info]) => ({
        name,
        description: info.description,
        meta: info.meta,
        tags: info.tags
      })) : [];
      
      // Merge manifest and catalog column info
      const mergedCols = [];
      const colMap = new Map();
      
      // Start with catalog columns (have types)
      if (catalogCols) {
        for (const col of catalogCols) {
          colMap.set(col.name.toLowerCase(), { ...col });
        }
      }
      
      // Merge in manifest columns (have descriptions)
      for (const col of manifestCols) {
        const existing = colMap.get(col.name.toLowerCase());
        if (existing) {
          Object.assign(existing, { description: col.description, meta: col.meta, tags: col.tags });
        } else {
          colMap.set(col.name.toLowerCase(), { name: col.name, type: 'VARCHAR', ...col });
        }
      }
      
      return {
        ...node,
        fqn: this.buildFQN(node),
        columns: Array.from(colMap.values())
      };
    }
    
    isLoaded() { return this.manifest !== null; }
    isCatalogLoaded() { return this.catalog !== null; }
  }

  // ============ SQL PREPROCESSOR ============
  class SQLPreprocessor {
    constructor(dbtResolver = null) { this.dbtResolver = dbtResolver; this.variables = {}; this.extractedRefs = []; this.extractedSources = []; }
    setVariables(vars) { this.variables = { ...this.variables, ...vars }; }
    setDbtResolver(r) { this.dbtResolver = r; }
    compile(rawSQL, context = {}) {
      this.extractedRefs = []; this.extractedSources = [];
      let sql = rawSQL;
      const allVars = { ...this.variables, ...context };
      sql = this.resolveRefs(sql);
      sql = this.resolveSources(sql);
      sql = this.expandVars(sql, allVars);
      sql = sql.replace(/\{\{\s*config\s*\([^)]*\)\s*\}\}/g, '');
      const { cleanSQL, hasPartialLineage } = this.stripJinja(sql);
      return { compiledSQL: cleanSQL.trim(), originalSQL: rawSQL, isPartial: hasPartialLineage, refs: this.extractedRefs, sources: this.extractedSources };
    }
    resolveRefs(sql) {
      return sql.replace(/\{\{\s*ref\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g, (m, name) => {
        if (this.dbtResolver) { const r = this.dbtResolver.resolveRef(name); this.extractedRefs.push(r); if (r.resolved) return r.fqn; }
        this.extractedRefs.push({ resolved: false, original: name }); return name;
      });
    }
    resolveSources(sql) {
      return sql.replace(/\{\{\s*source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g, (m, src, tbl) => {
        if (this.dbtResolver) { const r = this.dbtResolver.resolveSource(src, tbl); this.extractedSources.push(r); if (r.resolved) return r.fqn; }
        this.extractedSources.push({ resolved: false, original: `${src}.${tbl}` }); return `${src}.${tbl}`;
      });
    }
    expandVars(sql, vars) {
      let r = sql.replace(/\{\{\s*var\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g, (m, vn) => vn in vars ? (typeof vars[vn] === 'string' ? `'${vars[vn]}'` : String(vars[vn])) : m);
      r = r.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, vn) => { if (['ref','source','config'].includes(vn)) return m; return vn in vars ? (typeof vars[vn] === 'string' ? `'${vars[vn]}'` : String(vars[vn])) : m; });
      return r;
    }
    stripJinja(sql) {
      let hasPartialLineage = false, clean = sql;
      clean = clean.replace(/\{%\s*if\s+[\s\S]*?%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (m, c) => { hasPartialLineage = true; return c; });
      clean = clean.replace(/\{%\s*for\s+[\s\S]*?%\}([\s\S]*?)\{%\s*endfor\s*%\}/g, (m, c) => { hasPartialLineage = true; return c; });
      clean = clean.replace(/\{%[\s\S]*?%\}/g, '').replace(/\{\{[\s\S]*?\}\}/g, '/* UNRESOLVED */');
      return { cleanSQL: clean, hasPartialLineage };
    }
  }

  // ============ METADATA GRAPH ============
  class MetadataGraph {
    constructor() { this.nodes = new Map(); this.edges = []; this.indexes = { nodesByType: new Map(), nodesByModel: new Map(), edgesBySource: new Map(), edgesByTarget: new Map(), edgesByType: new Map() }; }
    
    addNode(id, nodeType, data = {}) {
      // Rename data.type to dataType to avoid collision with node's type field
      const { type: dataType, ...restData } = data;
      const node = { id, type: nodeType, dataType, ...restData, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      this.nodes.set(id, node); this.indexNode(node); return node;
    }
    updateNode(id, data) { const n = this.nodes.get(id); if (!n) return null; this.unindexNode(n); Object.assign(n, data, { updatedAt: new Date().toISOString() }); this.indexNode(n); return n; }
    removeNode(id) { const n = this.nodes.get(id); if (!n) return false; this.edges = this.edges.filter(e => { if (e.source === id || e.target === id) { this.unindexEdge(e); return false; } return true; }); this.unindexNode(n); this.nodes.delete(id); return true; }
    getNode(id) { return this.nodes.get(id) || null; }
    getNodesByType(type) { const ids = this.indexes.nodesByType.get(type) || new Set(); return Array.from(ids).map(id => this.nodes.get(id)).filter(Boolean); }
    getColumnsForModel(modelId) { const ids = this.indexes.nodesByModel.get(modelId) || new Set(); return Array.from(ids).map(id => this.nodes.get(id)).filter(Boolean); }
    
    addEdge(sourceId, targetId, type, data = {}) {
      const edge = { id: `${sourceId}->${targetId}:${type}`, source: sourceId, target: targetId, type, ...data, createdAt: new Date().toISOString() };
      const existing = this.edges.find(e => e.id === edge.id);
      if (existing) { Object.assign(existing, data, { updatedAt: new Date().toISOString() }); return existing; }
      this.edges.push(edge); this.indexEdge(edge); return edge;
    }
    getEdgesFromSource(sourceId, type = null) { const edges = this.indexes.edgesBySource.get(sourceId) || []; return type ? edges.filter(e => e.type === type) : edges; }
    getEdgesToTarget(targetId, type = null) { const edges = this.indexes.edgesByTarget.get(targetId) || []; return type ? edges.filter(e => e.type === type) : edges; }
    getEdgesByType(type) { return this.indexes.edgesByType.get(type) || []; }

    getUpstream(nodeId, depth = Infinity, edgeTypes = [EdgeType.DEPENDS_ON, EdgeType.DERIVES_FROM]) {
      const result = [], visited = new Set(), queue = [{ id: nodeId, currentDepth: 0 }];
      while (queue.length > 0) {
        const { id, currentDepth } = queue.shift();
        if (visited.has(id) || currentDepth > depth) continue; visited.add(id);
        for (const edge of this.getEdgesFromSource(id)) {
          if (!edgeTypes.includes(edge.type)) continue;
          const targetNode = this.getNode(edge.target);
          if (targetNode && !visited.has(edge.target)) { result.push({ node: targetNode, edge, depth: currentDepth + 1 }); queue.push({ id: edge.target, currentDepth: currentDepth + 1 }); }
        }
      }
      return result;
    }

    getDownstream(nodeId, depth = Infinity, edgeTypes = [EdgeType.DEPENDS_ON, EdgeType.DERIVES_FROM]) {
      const result = [], visited = new Set(), queue = [{ id: nodeId, currentDepth: 0 }];
      while (queue.length > 0) {
        const { id, currentDepth } = queue.shift();
        if (visited.has(id) || currentDepth > depth) continue; visited.add(id);
        for (const edge of this.getEdgesToTarget(id)) {
          if (!edgeTypes.includes(edge.type)) continue;
          const sourceNode = this.getNode(edge.source);
          if (sourceNode && !visited.has(edge.source)) { result.push({ node: sourceNode, edge, depth: currentDepth + 1 }); queue.push({ id: edge.source, currentDepth: currentDepth + 1 }); }
        }
      }
      return result;
    }

    indexNode(node) {
      if (!this.indexes.nodesByType.has(node.type)) this.indexes.nodesByType.set(node.type, new Set());
      this.indexes.nodesByType.get(node.type).add(node.id);
      // Index columns by their parent model - check both constant and string value
      if ((node.type === NodeType.COLUMN || node.type === 'column') && node.modelId) {
        if (!this.indexes.nodesByModel.has(node.modelId)) this.indexes.nodesByModel.set(node.modelId, new Set());
        this.indexes.nodesByModel.get(node.modelId).add(node.id);
      }
    }
    unindexNode(node) {
      this.indexes.nodesByType.get(node.type)?.delete(node.id);
      if (node.type === NodeType.COLUMN && node.modelId) this.indexes.nodesByModel.get(node.modelId)?.delete(node.id);
    }
    indexEdge(edge) {
      if (!this.indexes.edgesBySource.has(edge.source)) this.indexes.edgesBySource.set(edge.source, []);
      this.indexes.edgesBySource.get(edge.source).push(edge);
      if (!this.indexes.edgesByTarget.has(edge.target)) this.indexes.edgesByTarget.set(edge.target, []);
      this.indexes.edgesByTarget.get(edge.target).push(edge);
      if (!this.indexes.edgesByType.has(edge.type)) this.indexes.edgesByType.set(edge.type, []);
      this.indexes.edgesByType.get(edge.type).push(edge);
    }
    unindexEdge(edge) {
      const srcEdges = this.indexes.edgesBySource.get(edge.source); if (srcEdges) { const i = srcEdges.indexOf(edge); if (i >= 0) srcEdges.splice(i, 1); }
      const tgtEdges = this.indexes.edgesByTarget.get(edge.target); if (tgtEdges) { const i = tgtEdges.indexOf(edge); if (i >= 0) tgtEdges.splice(i, 1); }
      const typeEdges = this.indexes.edgesByType.get(edge.type); if (typeEdges) { const i = typeEdges.indexOf(edge); if (i >= 0) typeEdges.splice(i, 1); }
    }

    clear() { this.nodes.clear(); this.edges = []; this.indexes = { nodesByType: new Map(), nodesByModel: new Map(), edgesBySource: new Map(), edgesByTarget: new Map(), edgesByType: new Map() }; }
    getStats() { const stats = { totalNodes: this.nodes.size, totalEdges: this.edges.length, nodesByType: {}, edgesByType: {} }; for (const [t, ids] of this.indexes.nodesByType) stats.nodesByType[t] = ids.size; for (const [t, edges] of this.indexes.edgesByType) stats.edgesByType[t] = edges.length; return stats; }
    toJSON() { return { nodes: Array.from(this.nodes.values()), edges: this.edges }; }
    fromJSON(data) { this.clear(); for (const n of (data.nodes || [])) { this.nodes.set(n.id, n); this.indexNode(n); } for (const e of (data.edges || [])) { this.edges.push(e); this.indexEdge(e); } }
  }

  // ============ RELATIONSHIP INFERENCE ============
  class RelationshipInferenceEngine {
    constructor(graph) { 
      this.graph = graph; 
      this.strategies = [
        new ExplicitConstraintStrategy(),
        new JoinUsageStrategy(), 
        new NamingConventionStrategy(),
        new LayerRulesStrategy()
      ]; 
    }
    
    async inferRelationships(models) {
      const candidates = [];
      for (const strategy of this.strategies) {
        const found = await strategy.infer(models, this.graph);
        candidates.push(...found);
      }
      return this.mergeCandidates(candidates);
    }

    mergeCandidates(candidates) {
      const merged = new Map();
      for (const c of candidates) {
        const key = `${c.from.table}.${c.from.column}->${c.to.table}.${c.to.column}`;
        if (merged.has(key)) {
          const existing = merged.get(key);
          existing.signals.push({ strategy: c.strategy, confidence: c.confidence });
          // Boost confidence when multiple strategies agree
          existing.confidence = Math.min(1.0, existing.confidence + c.confidence * 0.3);
          // Upgrade cardinality if we have better info
          if (c.cardinality && c.cardinality !== 'unknown' && existing.cardinality === 'unknown') {
            existing.cardinality = c.cardinality;
          }
        } else {
          merged.set(key, { ...c, signals: [{ strategy: c.strategy, confidence: c.confidence }] });
        }
      }
      return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
    }
  }

  // Strategy 1: Explicit DDL constraints (highest confidence)
  class ExplicitConstraintStrategy {
    async infer(models, graph) {
      const candidates = [];
      
      for (const model of models) {
        // Check for DDL-parsed constraints
        if (model.constraints) {
          // Primary keys
          for (const pkCol of (model.constraints.primaryKey || [])) {
            const col = (model.columns || []).find(c => c.name.toLowerCase() === pkCol.toLowerCase());
            if (col) col.isPK = true;
          }
          
          // Foreign keys from DDL
          for (const fk of (model.constraints.foreignKeys || [])) {
            for (let i = 0; i < fk.columns.length; i++) {
              candidates.push({
                from: { table: model.name, column: fk.columns[i] },
                to: { table: fk.refTable, column: fk.refColumns[i] || fk.refColumns[0] },
                type: EdgeType.FOREIGN_KEY,
                confidence: Confidence.EXPLICIT,
                strategy: 'explicit_constraint',
                cardinality: 'many-to-one',
                explanation: `Explicit FOREIGN KEY constraint in DDL`
              });
            }
          }
        }
        
        // Check for inline column references
        for (const col of (model.columns || [])) {
          if (col.references) {
            candidates.push({
              from: { table: model.name, column: col.name },
              to: { table: col.references.table, column: col.references.column },
              type: EdgeType.FOREIGN_KEY,
              confidence: Confidence.EXPLICIT,
              strategy: 'explicit_constraint',
              cardinality: 'many-to-one',
              explanation: `Inline REFERENCES constraint on column ${col.name}`
            });
          }
        }
      }
      
      return candidates;
    }
  }

  // Strategy 2: Join usage patterns
  class JoinUsageStrategy {
    async infer(models, graph) {
      const candidates = [];
      const joinFrequency = new Map(); // Track how often each join pattern appears
      
      for (const model of models) {
        for (const join of (model.joinMetadata || [])) {
          if (!join.predicate) continue;
          const cols = this.parseJoinPredicate(join.predicate);
          
          for (const { left, right } of cols) {
            const key = `${left.table}.${left.column}->${right.table}.${right.column}`;
            joinFrequency.set(key, (joinFrequency.get(key) || 0) + 1);
            
            // Infer cardinality from join type and naming
            let cardinality = 'unknown';
            if (join.type === 'LEFT' || join.type === 'RIGHT') {
              // LEFT JOIN typically means many-to-one (fact -> dim)
              cardinality = 'many-to-one';
            } else if (join.type === 'INNER') {
              // Could be either, check naming
              if (right.column.toLowerCase() === 'id' || right.column.toLowerCase().endsWith('_id')) {
                cardinality = 'many-to-one';
              }
            }
            
            candidates.push({
              from: { table: left.table, column: left.column }, 
              to: { table: right.table, column: right.column },
              type: EdgeType.JOINS_ON, 
              confidence: Confidence.JOIN_USAGE, 
              strategy: 'join_usage',
              cardinality: cardinality,
              joinType: join.type,
              explanation: `Found in SQL join: ${join.predicate}`
            });
          }
        }
      }
      
      // Boost confidence for frequently used joins
      for (const c of candidates) {
        const key = `${c.from.table}.${c.from.column}->${c.to.table}.${c.to.column}`;
        const freq = joinFrequency.get(key) || 1;
        if (freq > 1) {
          c.confidence = Math.min(1.0, c.confidence + 0.1 * (freq - 1));
          c.explanation += ` (used ${freq} times)`;
        }
      }
      
      return candidates;
    }
    
    parseJoinPredicate(pred) {
      const results = [];
      // Match all equality conditions in the predicate
      const regex = /(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/g;
      let match;
      while ((match = regex.exec(pred)) !== null) {
        results.push({ 
          left: { table: match[1], column: match[2] }, 
          right: { table: match[3], column: match[4] } 
        });
      }
      return results;
    }
  }

  // Strategy 3: Naming conventions
  class NamingConventionStrategy {
    async infer(models, graph) {
      const candidates = [];
      const pkColumns = new Map();
      for (const model of models) {
        for (const col of (model.columns || [])) {
          if (col.isPK || col.name.toLowerCase() === 'id' || (col.name.toLowerCase().endsWith('_id') && col.name.toLowerCase() === `${model.name.toLowerCase()}_id`)) {
            pkColumns.set(`${model.name.toLowerCase()}.${col.name.toLowerCase()}`, { model: model.name, column: col.name });
          }
        }
      }
      for (const model of models) {
        for (const col of (model.columns || [])) {
          const colLower = col.name.toLowerCase();
          if (colLower.endsWith('_id') && colLower !== 'id') {
            const refTable = colLower.replace(/_id$/, '');
            const pkKey = `${refTable}.id`;
            const pkKeyAlt = `${refTable}.${colLower}`;
            if (pkColumns.has(pkKey)) {
              const pk = pkColumns.get(pkKey);
              candidates.push({ from: { table: model.name, column: col.name }, to: { table: pk.model, column: pk.column }, type: EdgeType.FOREIGN_KEY, confidence: Confidence.NAMING, strategy: 'naming_convention', explanation: `Column ${col.name} matches pattern for FK to ${pk.model}` });
            } else if (pkColumns.has(pkKeyAlt)) {
              const pk = pkColumns.get(pkKeyAlt);
              candidates.push({ from: { table: model.name, column: col.name }, to: { table: pk.model, column: pk.column }, type: EdgeType.FOREIGN_KEY, confidence: Confidence.NAMING, strategy: 'naming_convention', explanation: `Column ${col.name} matches pattern for FK to ${pk.model}` });
            }
          }
        }
      }
      return candidates;
    }
  }

  // Strategy 4: Layer rules (gold/silver/bronze patterns)
  class LayerRulesStrategy {
    async infer(models, graph) {
      const candidates = [];
      const layerOrder = { 'bronze': 0, 'raw': 0, 'staging': 1, 'silver': 2, 'intermediate': 2, 'gold': 3, 'mart': 3, 'semantic': 3 };
      
      // Build model lookup by name
      const modelByName = new Map();
      for (const model of models) {
        modelByName.set(model.name.toLowerCase(), model);
      }
      
      for (const model of models) {
        const modelLayer = this.getLayerLevel(model, layerOrder);
        
        // Check dependencies - they should be from lower or same layer
        for (const dep of (model.dependencies || [])) {
          const depName = dep.split('.').pop().toLowerCase();
          const depModel = modelByName.get(depName);
          
          if (depModel) {
            const depLayer = this.getLayerLevel(depModel, layerOrder);
            
            // Flag if gold depends on bronze (skip silver) - unusual pattern
            if (modelLayer >= 3 && depLayer === 0) {
              // This is a potential data quality issue, but still a valid relationship
              // Lower confidence since it might be intentional
            }
            
            // Infer fact/dim patterns
            const modelName = model.name.toLowerCase();
            const depModelName = depModel.name.toLowerCase();
            
            // Fact tables typically join to dimension tables
            if ((modelName.startsWith('fact_') || modelName.includes('_fact')) && 
                (depModelName.startsWith('dim_') || depModelName.includes('_dim'))) {
              // Find common join columns
              for (const col of (model.columns || [])) {
                const colLower = col.name.toLowerCase();
                if (colLower.endsWith('_id') || colLower.endsWith('_key')) {
                  // Check if dim has matching column
                  const dimCol = (depModel.columns || []).find(dc => 
                    dc.name.toLowerCase() === colLower || 
                    dc.name.toLowerCase() === 'id' ||
                    dc.name.toLowerCase() === `${depModelName.replace('dim_', '')}_id`
                  );
                  
                  if (dimCol) {
                    candidates.push({
                      from: { table: model.name, column: col.name },
                      to: { table: depModel.name, column: dimCol.name },
                      type: EdgeType.FOREIGN_KEY,
                      confidence: 0.5, // Medium confidence for pattern-based
                      strategy: 'layer_rules',
                      cardinality: 'many-to-one',
                      explanation: `Fact-to-dim pattern: ${model.name} -> ${depModel.name}`
                    });
                  }
                }
              }
            }
          }
        }
      }
      
      return candidates;
    }
    
    getLayerLevel(model, layerOrder) {
      const layer = (model.layer || model.tableType || '').toLowerCase();
      if (layerOrder[layer] !== undefined) return layerOrder[layer];
      
      // Try to infer from name
      const name = model.name.toLowerCase();
      if (name.includes('raw') || name.includes('bronze')) return 0;
      if (name.includes('stg') || name.includes('staging')) return 1;
      if (name.includes('silver') || name.includes('int_')) return 2;
      if (name.includes('gold') || name.includes('mart') || name.startsWith('dim_') || name.startsWith('fact_')) return 3;
      
      return 1; // Default to staging
    }
  }

  // ============ GRAPH BUILDER ============
  class GraphBuilder {
    constructor(graph) {
      this.graph = graph || new MetadataGraph();
      this.modelIndex = new Map(); // name -> nodeId
      this.columnIndex = new Map(); // modelName.colName -> nodeId
    }

    getGraph() { return this.graph; }

    addModel(schema) {
      const modelId = schema.id || `model_${this.hash(schema.name.toLowerCase())}`;
      
      // Create or update model node
      let modelNode = this.graph.getNode(modelId);
      if (!modelNode) {
        modelNode = this.graph.addNode(modelId, NodeType.MODEL, {
          name: schema.name,
          schema: schema.schema,
          database: schema.database,
          layer: schema.layer || schema.tableType,
          description: schema.description,
          isAggregated: schema.isAggregated,
          grainColumns: schema.grainColumns || [],
          isStub: schema.is_stub || false,
          sourceType: schema.sourceType,
          filePath: schema.filePath,
          columns: schema.columns || [] // Store columns directly on model node as backup
        });
      } else {
        this.graph.updateNode(modelId, {
          layer: schema.layer || schema.tableType,
          description: schema.description,
          isAggregated: schema.isAggregated,
          grainColumns: schema.grainColumns || [],
          isStub: schema.is_stub || false,
          columns: schema.columns || [] // Update columns
        });
      }
      
      this.modelIndex.set(schema.name.toLowerCase(), modelId);
      
      // Add columns as separate nodes in the graph
      const cols = schema.columns || [];
      for (const col of cols) {
        this.addColumn(modelId, schema.name, col);
      }
      
      // Add dependency edges
      for (const dep of (schema.dependencies || [])) {
        const depName = dep.split('.').pop().toLowerCase();
        const depModelId = this.modelIndex.get(depName) || `model_${this.hash(depName)}`;
        
        // Ensure dependency model exists (as stub if needed)
        if (!this.graph.getNode(depModelId)) {
          this.graph.addNode(depModelId, NodeType.MODEL, {
            name: dep.split('.').pop(),
            isStub: true,
            layer: 'unknown'
          });
          this.modelIndex.set(depName, depModelId);
        }
        
        this.graph.addEdge(modelId, depModelId, EdgeType.DEPENDS_ON, {
          confidence: Confidence.EXPLICIT
        });
      }
      
      // Add join edges from metadata
      for (const join of (schema.joinMetadata || [])) {
        if (join.rightTable && join.predicate) {
          const rightName = join.rightTable.split('.').pop().toLowerCase();
          const rightModelId = this.modelIndex.get(rightName) || `model_${this.hash(rightName)}`;
          
          // Parse join predicate for column info
          const joinCols = this.parseJoinPredicate(join.predicate);
          
          this.graph.addEdge(modelId, rightModelId, EdgeType.JOINS_ON, {
            joinType: join.type,
            predicate: join.predicate,
            leftColumns: joinCols.left,
            rightColumns: joinCols.right,
            confidence: Confidence.JOIN_USAGE
          });
        }
      }
      
      return modelId;
    }

    addColumn(modelId, modelName, col) {
      const colId = col.id || `col_${modelId}_${this.hash(col.name.toLowerCase())}`;
      const colKey = `${modelName.toLowerCase()}.${col.name.toLowerCase()}`;
      
      let colNode = this.graph.getNode(colId);
      if (!colNode) {
        colNode = this.graph.addNode(colId, NodeType.COLUMN, {
          name: col.name,
          modelId: modelId,
          modelName: modelName,
          type: col.type,
          typeConfidence: col.typeConfidence || col.type_confidence,
          semanticRole: col.semanticRole || col.semantic_role,
          aggregationType: col.aggregationType || col.aggregation_type,
          expressionSQL: col.expressionSQL || col.expression_sql,
          sourceColumns: col.sourceColumns || col.source_columns || [],
          isPK: col.isPK || false,
          isFK: col.isFK || false,
          nullable: col.nullable,
          isComputed: col.isComputed,
          isPassthrough: col.isPassthrough,
          isGrain: col.is_grain || false
        });
      }
      
      this.columnIndex.set(colKey, colId);
      
      // Create PRODUCES edge (model -> column)
      this.graph.addEdge(modelId, colId, EdgeType.PRODUCES, {});
      
      // Create DERIVES_FROM edges for column lineage
      for (const srcCol of (col.sourceColumns || col.source_columns || [])) {
        if (srcCol && srcCol !== '*') {
          const srcParts = srcCol.includes('.') ? srcCol.split('.') : [null, srcCol];
          const srcTable = srcParts[0]?.toLowerCase();
          const srcColName = srcParts[srcParts.length - 1].toLowerCase();
          
          if (srcTable) {
            const srcColKey = `${srcTable}.${srcColName}`;
            let srcColId = this.columnIndex.get(srcColKey);
            
            // If source column doesn't exist, create a stub
            if (!srcColId) {
              const srcModelId = this.modelIndex.get(srcTable) || `model_${this.hash(srcTable)}`;
              srcColId = `col_${srcModelId}_${this.hash(srcColName)}`;
              
              if (!this.graph.getNode(srcColId)) {
                this.graph.addNode(srcColId, NodeType.COLUMN, {
                  name: srcColName,
                  modelId: srcModelId,
                  modelName: srcTable,
                  isStub: true
                });
                this.columnIndex.set(srcColKey, srcColId);
              }
            }
            
            this.graph.addEdge(colId, srcColId, EdgeType.DERIVES_FROM, {
              confidence: col.isPassthrough ? Confidence.EXPLICIT : Confidence.JOIN_USAGE
            });
          }
        }
      }
      
      return colId;
    }

    parseJoinPredicate(pred) {
      const left = [], right = [];
      const matches = pred.matchAll(/(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/g);
      for (const m of matches) {
        left.push({ table: m[1], column: m[2] });
        right.push({ table: m[3], column: m[4] });
      }
      return { left, right };
    }

    inferRelationships(models) {
      const engine = new RelationshipInferenceEngine(this.graph);
      return engine.inferRelationships(models);
    }

    applyInferredRelationships(candidates) {
      for (const rel of candidates) {
        const fromColKey = `${rel.from.table.toLowerCase()}.${rel.from.column.toLowerCase()}`;
        const toColKey = `${rel.to.table.toLowerCase()}.${rel.to.column.toLowerCase()}`;
        
        const fromColId = this.columnIndex.get(fromColKey);
        const toColId = this.columnIndex.get(toColKey);
        
        if (fromColId && toColId) {
          this.graph.addEdge(fromColId, toColId, rel.type, {
            confidence: rel.confidence,
            strategy: rel.strategy,
            explanation: rel.explanation,
            signals: rel.signals,
            cardinality: rel.cardinality || 'unknown'
          });
        }
      }
    }

    // Convert graph to ERDState format
    toERDState() {
      const tables = [];
      const relationships = [];
      
      // Convert model nodes to tables
      for (const model of this.graph.getNodesByType(NodeType.MODEL)) {
        // Get columns from graph index
        let columns = this.graph.getColumnsForModel(model.id).map(col => ({
          id: col.id,
          name: col.name,
          type: col.dataType || col.type || 'VARCHAR', // dataType is the column's SQL type
          type_confidence: col.typeConfidence,
          semantic_role: col.semanticRole,
          aggregation_type: col.aggregationType,
          expression_sql: col.expressionSQL,
          source_columns: col.sourceColumns,
          isPK: col.isPK,
          isFK: col.isFK,
          nullable: col.nullable,
          is_grain: col.isGrain
        }));
        
        // Fallback: if no columns from graph, check if model has columns property directly
        if (columns.length === 0 && model.columns && model.columns.length > 0) {
          columns = model.columns.map(col => ({
            id: col.id || `col_${model.id}_${col.name}`,
            name: col.name,
            type: col.dataType || col.type || 'VARCHAR',
            type_confidence: col.typeConfidence || col.type_confidence,
            semantic_role: col.semanticRole || col.semantic_role,
            aggregation_type: col.aggregationType || col.aggregation_type,
            expression_sql: col.expressionSQL || col.expression_sql,
            source_columns: col.sourceColumns || col.source_columns,
            isPK: col.isPK,
            isFK: col.isFK,
            nullable: col.nullable,
            is_grain: col.isGrain || col.is_grain
          }));
        }
        
        tables.push({
          id: model.id,
          name: model.name,
          tableType: model.layer || 'raw',
          description: model.description,
          is_aggregated: model.isAggregated,
          grain_columns: model.grainColumns,
          is_stub: model.isStub,
          schema_source: 'compiler_v2',
          columns: columns,
          x: model.x,
          y: model.y
        });
      }
      
      // Convert edges to relationships
      const joinEdges = this.graph.getEdgesByType(EdgeType.JOINS_ON);
      const fkEdges = this.graph.getEdgesByType(EdgeType.FOREIGN_KEY);
      
      for (const edge of [...joinEdges, ...fkEdges]) {
        const sourceNode = this.graph.getNode(edge.source);
        const targetNode = this.graph.getNode(edge.target);
        
        if (sourceNode && targetNode) {
          // For model-level joins
          if (sourceNode.type === NodeType.MODEL && targetNode.type === NodeType.MODEL) {
            const leftCols = edge.leftColumns || [];
            const rightCols = edge.rightColumns || [];
            
            relationships.push({
              id: edge.id,
              from: { 
                table: sourceNode.name, 
                column: leftCols[0]?.column || 'id' 
              },
              to: { 
                table: targetNode.name, 
                column: rightCols[0]?.column || 'id' 
              },
              type: edge.type === EdgeType.FOREIGN_KEY ? 'foreign_key' : 'join',
              join_type: edge.joinType || 'LEFT',
              on_sql: edge.predicate,
              confidence: edge.confidence,
              cardinality: edge.cardinality || 'many-to-one',
              explanation: edge.explanation
            });
          }
          // For column-level FKs
          else if (sourceNode.type === NodeType.COLUMN && targetNode.type === NodeType.COLUMN) {
            relationships.push({
              id: edge.id,
              from: { 
                table: sourceNode.modelName, 
                column: sourceNode.name 
              },
              to: { 
                table: targetNode.modelName, 
                column: targetNode.name 
              },
              type: 'foreign_key',
              confidence: edge.confidence,
              cardinality: edge.cardinality || 'many-to-one',
              explanation: edge.explanation
            });
          }
        }
      }
      
      return { tables, relationships };
    }

    // Get column lineage for a specific column
    getColumnLineage(modelName, columnName, depth = 10) {
      const colKey = `${modelName.toLowerCase()}.${columnName.toLowerCase()}`;
      const colId = this.columnIndex.get(colKey);
      if (!colId) return { upstream: [], downstream: [] };
      
      const upstream = this.graph.getUpstream(colId, depth, [EdgeType.DERIVES_FROM]);
      const downstream = this.graph.getDownstream(colId, depth, [EdgeType.DERIVES_FROM]);
      
      return {
        upstream: upstream.map(u => ({
          column: u.node.name,
          model: u.node.modelName,
          depth: u.depth,
          type: u.node.type
        })),
        downstream: downstream.map(d => ({
          column: d.node.name,
          model: d.node.modelName,
          depth: d.depth,
          type: d.node.type
        }))
      };
    }

    // Get model lineage (DAG)
    getModelLineage(modelName, depth = 10) {
      const modelId = this.modelIndex.get(modelName.toLowerCase());
      if (!modelId) return { upstream: [], downstream: [] };
      
      const upstream = this.graph.getUpstream(modelId, depth, [EdgeType.DEPENDS_ON]);
      const downstream = this.graph.getDownstream(modelId, depth, [EdgeType.DEPENDS_ON]);
      
      return {
        upstream: upstream.map(u => ({
          name: u.node.name,
          layer: u.node.layer,
          depth: u.depth
        })),
        downstream: downstream.map(d => ({
          name: d.node.name,
          layer: d.node.layer,
          depth: d.depth
        }))
      };
    }

    hash(str) { 
      let h = 0; 
      for (let i = 0; i < str.length; i++) { 
        h = ((h << 5) - h) + str.charCodeAt(i); 
        h = h & h; 
      } 
      return Math.abs(h).toString(36); 
    }
  }

  // ============ JOIN PATH FINDER ============
  class JoinPathFinder {
    constructor(graph) { this.graph = graph; }

    findPaths(fromTable, toTable, options = {}) {
      const { maxHops = 5, minConfidence = 0.3 } = options;
      const fromNode = this.findModelNode(fromTable), toNode = this.findModelNode(toTable);
      if (!fromNode || !toNode) return [];
      const adjacency = this.buildAdjacency(minConfidence);
      const rawPaths = this.bfs(fromNode.id, toNode.id, adjacency, maxHops);
      return rawPaths.map(p => this.pathToJoinPath(p)).sort((a, b) => b.score - a.score || a.hops - b.hops);
    }

    findModelNode(tableName) {
      const models = this.graph.getNodesByType(NodeType.MODEL);
      const lower = tableName.toLowerCase();
      let node = models.find(m => m.name === tableName) || models.find(m => m.name.toLowerCase() === lower);
      if (!node) { const parts = tableName.split('.'); const justTable = parts[parts.length - 1].toLowerCase(); node = models.find(m => m.name.split('.').pop().toLowerCase() === justTable); }
      return node || null;
    }

    buildAdjacency(minConfidence) {
      const adj = new Map();
      const addEdge = (src, tgt, edge) => { if (edge.confidence && edge.confidence < minConfidence) return; if (!adj.has(src)) adj.set(src, []); adj.get(src).push({ targetId: tgt, edge }); };
      for (const edge of this.graph.getEdgesByType(EdgeType.JOINS_ON)) { addEdge(edge.source, edge.target, edge); addEdge(edge.target, edge.source, { ...edge, reversed: true }); }
      for (const edge of this.graph.getEdgesByType(EdgeType.FOREIGN_KEY)) {
        const srcCol = this.graph.getNode(edge.source), tgtCol = this.graph.getNode(edge.target);
        if (srcCol?.modelId && tgtCol?.modelId) {
          const modelEdge = { ...edge, sourceColumn: srcCol.name, targetColumn: tgtCol.name };
          addEdge(srcCol.modelId, tgtCol.modelId, modelEdge); addEdge(tgtCol.modelId, srcCol.modelId, { ...modelEdge, reversed: true });
        }
      }
      return adj;
    }

    bfs(startId, endId, adjacency, maxHops) {
      const paths = [], queue = [{ nodeId: startId, path: [{ nodeId: startId, edge: null }], visited: new Set([startId]) }];
      while (queue.length > 0) {
        const { nodeId, path, visited } = queue.shift();
        if (nodeId === endId && path.length > 1) { paths.push(path); continue; }
        if (path.length > maxHops) continue;
        for (const { targetId, edge } of (adjacency.get(nodeId) || [])) {
          if (visited.has(targetId)) continue;
          const newVisited = new Set(visited); newVisited.add(targetId);
          queue.push({ nodeId: targetId, path: [...path, { nodeId: targetId, edge }], visited: newVisited });
        }
      }
      return paths;
    }

    pathToJoinPath(rawPath) {
      const tables = [], joins = []; let totalConf = 0;
      for (let i = 0; i < rawPath.length; i++) {
        const step = rawPath[i], node = this.graph.getNode(step.nodeId);
        if (node) tables.push(node.name);
        if (step.edge && i > 0) {
          const prevNode = this.graph.getNode(rawPath[i - 1].nodeId);
          joins.push({ sourceTable: prevNode?.name, targetTable: node?.name, sourceColumn: step.edge.sourceColumn || step.edge.fromColumn, targetColumn: step.edge.targetColumn || step.edge.toColumn, onClause: step.edge.predicate, confidence: step.edge.confidence || 0.5, suggestedJoinType: step.edge.joinType || 'LEFT', reversed: step.edge.reversed || false });
          totalConf += step.edge.confidence || 0.5;
        }
      }
      const avgConf = joins.length > 0 ? totalConf / joins.length : 0;
      return { tables, joins, hops: joins.length, score: avgConf - joins.length * 0.05, toSQL: function(joinType = 'LEFT') {
        const lines = ['SELECT', '  -- TODO: select columns', `FROM ${this.tables[0]} t0`];
        this.joins.forEach((j, i) => { lines.push(`${j.suggestedJoinType || joinType} JOIN ${j.targetTable} t${i + 1}`); lines.push(`  ON t${i}.${j.sourceColumn} = t${i + 1}.${j.targetColumn}`); });
        lines.push('WHERE 1=1', '  -- TODO: add filters');
        return lines.join('\n');
      }};
    }
  }

  // ============ WAREHOUSE CONNECTOR (Abstract Interface) ============
  class WarehouseConnector {
    constructor(config = {}) {
      this.config = config;
      this.dialect = config.dialect || 'presto';
      this.connected = false;
      this.catalog = new Map(); // schema.table -> columns
      this.auditLog = [];
    }

    // Abstract method - override in subclasses
    async connect() { throw new Error('connect() must be implemented by subclass'); }
    async disconnect() { this.connected = false; }
    async executeQuery(sql) { throw new Error('executeQuery() must be implemented by subclass'); }

    // Get columns for a table from information_schema
    async getTableColumns(schema, table) {
      const cacheKey = `${schema}.${table}`.toLowerCase();
      if (this.catalog.has(cacheKey)) {
        return this.catalog.get(cacheKey);
      }

      const sql = this.buildColumnsQuery(schema, table);
      this.logAudit('GET_COLUMNS', { schema, table, sql });
      
      try {
        const rows = await this.executeQuery(sql);
        const columns = rows.map(r => ({
          name: r.column_name || r.COLUMN_NAME,
          type: r.data_type || r.DATA_TYPE,
          nullable: (r.is_nullable || r.IS_NULLABLE) === 'YES',
          ordinalPosition: r.ordinal_position || r.ORDINAL_POSITION
        }));
        this.catalog.set(cacheKey, columns);
        return columns;
      } catch (e) {
        console.warn(`Failed to get columns for ${schema}.${table}:`, e);
        return null;
      }
    }

    // Get all tables in a schema
    async getSchemaTables(schema) {
      const sql = this.buildTablesQuery(schema);
      this.logAudit('GET_TABLES', { schema, sql });
      
      try {
        const rows = await this.executeQuery(sql);
        return rows.map(r => r.table_name || r.TABLE_NAME);
      } catch (e) {
        console.warn(`Failed to get tables for ${schema}:`, e);
        return [];
      }
    }

    // Build dialect-specific queries
    buildColumnsQuery(schema, table) {
      switch (this.dialect) {
        case 'snowflake':
          return `SELECT column_name, data_type, is_nullable, ordinal_position 
                  FROM ${schema}.information_schema.columns 
                  WHERE table_schema = '${schema}' AND table_name = '${table}' 
                  ORDER BY ordinal_position`;
        case 'bigquery':
          return `SELECT column_name, data_type, is_nullable, ordinal_position 
                  FROM \`${schema}.INFORMATION_SCHEMA.COLUMNS\` 
                  WHERE table_name = '${table}' 
                  ORDER BY ordinal_position`;
        case 'presto':
        case 'trino':
        default:
          return `SELECT column_name, data_type, is_nullable, ordinal_position 
                  FROM information_schema.columns 
                  WHERE table_schema = '${schema}' AND table_name = '${table}' 
                  ORDER BY ordinal_position`;
      }
    }

    buildTablesQuery(schema) {
      switch (this.dialect) {
        case 'snowflake':
          return `SELECT table_name FROM ${schema}.information_schema.tables WHERE table_schema = '${schema}'`;
        case 'bigquery':
          return `SELECT table_name FROM \`${schema}.INFORMATION_SCHEMA.TABLES\``;
        case 'presto':
        case 'trino':
        default:
          return `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'`;
      }
    }

    // Audit logging for bank compliance
    logAudit(action, details) {
      this.auditLog.push({
        timestamp: new Date().toISOString(),
        action,
        details,
        user: this.config.user || 'anonymous'
      });
    }

    getAuditLog() { return this.auditLog; }
    clearAuditLog() { this.auditLog = []; }

    // Profiling queries (aggregates only - bank safe)
    async getColumnUniqueness(schema, table, column) {
      const sql = `SELECT COUNT(*) as total, COUNT(DISTINCT ${column}) as distinct_count 
                   FROM ${schema}.${table}`;
      this.logAudit('PROFILE_UNIQUENESS', { schema, table, column, sql });
      
      try {
        const rows = await this.executeQuery(sql);
        if (rows.length > 0) {
          const total = parseInt(rows[0].total || rows[0].TOTAL);
          const distinct = parseInt(rows[0].distinct_count || rows[0].DISTINCT_COUNT);
          return { total, distinct, isUnique: total === distinct, uniquenessRatio: distinct / total };
        }
      } catch (e) {
        console.warn(`Failed to profile ${schema}.${table}.${column}:`, e);
      }
      return null;
    }

    async getReferentialIntegrity(factSchema, factTable, factCol, dimSchema, dimTable, dimCol) {
      const sql = `SELECT COUNT(*) as total, 
                   SUM(CASE WHEN d.${dimCol} IS NOT NULL THEN 1 ELSE 0 END) as matched
                   FROM ${factSchema}.${factTable} f
                   LEFT JOIN ${dimSchema}.${dimTable} d ON f.${factCol} = d.${dimCol}`;
      this.logAudit('PROFILE_RI', { factSchema, factTable, factCol, dimSchema, dimTable, dimCol, sql });
      
      try {
        const rows = await this.executeQuery(sql);
        if (rows.length > 0) {
          const total = parseInt(rows[0].total || rows[0].TOTAL);
          const matched = parseInt(rows[0].matched || rows[0].MATCHED);
          return { total, matched, integrityRatio: matched / total };
        }
      } catch (e) {
        console.warn(`Failed to check RI:`, e);
      }
      return null;
    }
  }

  // Mock connector for testing (no actual warehouse connection)
  class MockWarehouseConnector extends WarehouseConnector {
    constructor(config = {}) {
      super(config);
      this.mockData = config.mockData || {};
    }

    async connect() { 
      this.connected = true; 
      this.logAudit('CONNECT', { dialect: this.dialect });
      return true; 
    }

    async executeQuery(sql) {
      this.logAudit('EXECUTE', { sql });
      // Return mock data if available
      for (const [pattern, data] of Object.entries(this.mockData)) {
        if (sql.toLowerCase().includes(pattern.toLowerCase())) {
          return data;
        }
      }
      return [];
    }

    // Load mock catalog from dbt catalog.json or manual config
    loadMockCatalog(catalogData) {
      if (catalogData.nodes) {
        // dbt catalog.json format
        for (const [nodeId, node] of Object.entries(catalogData.nodes)) {
          if (node.columns) {
            const key = `${node.metadata?.schema || 'default'}.${node.metadata?.name || nodeId}`.toLowerCase();
            const columns = Object.entries(node.columns).map(([name, col], idx) => ({
              name: name,
              type: col.type || 'VARCHAR',
              nullable: true,
              ordinalPosition: col.index || idx + 1
            }));
            this.catalog.set(key, columns);
          }
        }
      } else {
        // Simple format: { "schema.table": [{ name, type }] }
        for (const [key, columns] of Object.entries(catalogData)) {
          this.catalog.set(key.toLowerCase(), columns);
        }
      }
      this.logAudit('LOAD_CATALOG', { tableCount: this.catalog.size });
    }
  }

  // ============ AUDIT LOGGER ============
  class AuditLogger {
    constructor(dbName = 'SQLCopilotAuditDB') {
      this.dbName = dbName;
      this.dbVersion = 1;
      this.db = null;
      this.buffer = [];
      this.flushInterval = null;
    }

    async open() {
      if (this.db) return this.db;
      
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.dbVersion);
        
        request.onerror = () => reject(request.error);
        
        request.onsuccess = () => {
          this.db = request.result;
          // Start periodic flush
          this.flushInterval = setInterval(() => this.flush(), 5000);
          resolve(this.db);
        };
        
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          
          if (!db.objectStoreNames.contains('auditLogs')) {
            const store = db.createObjectStore('auditLogs', { keyPath: 'id', autoIncrement: true });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('action', 'action', { unique: false });
            store.createIndex('user', 'user', { unique: false });
          }
        };
      });
    }

    log(action, details = {}, user = 'anonymous') {
      const entry = {
        timestamp: new Date().toISOString(),
        action,
        details,
        user,
        sessionId: this.getSessionId()
      };
      this.buffer.push(entry);
      
      // Flush immediately for critical actions
      if (['SCHEMA_CHANGE', 'EXPORT', 'WAREHOUSE_QUERY'].includes(action)) {
        this.flush();
      }
    }

    async flush() {
      if (this.buffer.length === 0) return;
      
      try {
        await this.open();
        const entries = [...this.buffer];
        this.buffer = [];
        
        const tx = this.db.transaction(['auditLogs'], 'readwrite');
        const store = tx.objectStore('auditLogs');
        
        for (const entry of entries) {
          store.add(entry);
        }
        
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) {
        console.warn('Audit flush failed:', e);
        // Re-add failed entries to buffer
        this.buffer.unshift(...entries);
      }
    }

    async query(filters = {}) {
      await this.open();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['auditLogs'], 'readonly');
        const store = tx.objectStore('auditLogs');
        const results = [];
        
        let request;
        if (filters.action) {
          request = store.index('action').openCursor(IDBKeyRange.only(filters.action));
        } else if (filters.user) {
          request = store.index('user').openCursor(IDBKeyRange.only(filters.user));
        } else {
          request = store.openCursor();
        }
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const entry = cursor.value;
            // Apply date filters
            if (filters.startDate && entry.timestamp < filters.startDate) {
              cursor.continue();
              return;
            }
            if (filters.endDate && entry.timestamp > filters.endDate) {
              cursor.continue();
              return;
            }
            results.push(entry);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    }

    async exportLogs(filters = {}) {
      const logs = await this.query(filters);
      this.log('EXPORT_AUDIT_LOGS', { count: logs.length, filters });
      return logs;
    }

    getSessionId() {
      if (!this._sessionId) {
        this._sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }
      return this._sessionId;
    }

    close() {
      if (this.flushInterval) {
        clearInterval(this.flushInterval);
      }
      this.flush();
      if (this.db) {
        this.db.close();
        this.db = null;
      }
    }
  }

  // ============ GRAPH PERSISTENCE (IndexedDB) ============
  class GraphStorage {
    constructor(dbName = 'SQLCopilotGraphDB') {
      this.dbName = dbName;
      this.dbVersion = 2; // Bumped for new stores
      this.db = null;
      this.dependencyDAG = new Map(); // model -> Set of downstream models
      this.reverseDependencyDAG = new Map(); // model -> Set of upstream models
    }

    async open() {
      if (this.db) return this.db;
      
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.dbVersion);
        
        request.onerror = () => reject(request.error);
        
        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };
        
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          
          // Store for graph snapshots
          if (!db.objectStoreNames.contains('graphs')) {
            const graphStore = db.createObjectStore('graphs', { keyPath: 'id' });
            graphStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
          
          // Store for file hashes (for incremental updates)
          if (!db.objectStoreNames.contains('fileHashes')) {
            const hashStore = db.createObjectStore('fileHashes', { keyPath: 'path' });
            hashStore.createIndex('hash', 'hash', { unique: false });
            hashStore.createIndex('modelName', 'modelName', { unique: false });
          }
          
          // Store for parsed schemas (cache)
          if (!db.objectStoreNames.contains('schemaCache')) {
            const cacheStore = db.createObjectStore('schemaCache', { keyPath: 'hash' });
            cacheStore.createIndex('modelName', 'modelName', { unique: false });
          }
          
          // Store for dependency DAG (for invalidation)
          if (!db.objectStoreNames.contains('dependencies')) {
            const depStore = db.createObjectStore('dependencies', { keyPath: 'modelName' });
            depStore.createIndex('upstream', 'upstream', { unique: false, multiEntry: true });
            depStore.createIndex('downstream', 'downstream', { unique: false, multiEntry: true });
          }
        };
      });
    }

    async saveGraph(graphBuilder, id = 'default') {
      await this.open();
      
      const graphData = graphBuilder.getGraph().toJSON();
      const record = {
        id,
        nodes: graphData.nodes,
        edges: graphData.edges,
        modelIndex: Array.from(graphBuilder.modelIndex.entries()),
        columnIndex: Array.from(graphBuilder.columnIndex.entries()),
        updatedAt: new Date().toISOString()
      };
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['graphs'], 'readwrite');
        const store = tx.objectStore('graphs');
        const request = store.put(record);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    }

    async loadGraph(id = 'default') {
      await this.open();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['graphs'], 'readonly');
        const store = tx.objectStore('graphs');
        const request = store.get(id);
        
        request.onsuccess = () => {
          const record = request.result;
          if (!record) {
            resolve(null);
            return;
          }
          
          // Reconstruct GraphBuilder
          const graph = new MetadataGraph();
          graph.fromJSON({ nodes: record.nodes, edges: record.edges });
          
          const graphBuilder = new GraphBuilder(graph);
          graphBuilder.modelIndex = new Map(record.modelIndex);
          graphBuilder.columnIndex = new Map(record.columnIndex);
          
          resolve(graphBuilder);
        };
        
        request.onerror = () => reject(request.error);
      });
    }

    // Save model dependencies for invalidation tracking
    async saveDependencies(modelName, upstream = [], downstream = []) {
      await this.open();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['dependencies'], 'readwrite');
        const store = tx.objectStore('dependencies');
        
        store.put({
          modelName: modelName.toLowerCase(),
          upstream: upstream.map(u => u.toLowerCase()),
          downstream: downstream.map(d => d.toLowerCase()),
          updatedAt: new Date().toISOString()
        });
        
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    // Get all downstream models that depend on a given model
    async getDownstreamModels(modelName) {
      await this.open();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['dependencies'], 'readonly');
        const store = tx.objectStore('dependencies');
        const index = store.index('upstream');
        const results = new Set();
        
        const request = index.openCursor(IDBKeyRange.only(modelName.toLowerCase()));
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            results.add(cursor.value.modelName);
            cursor.continue();
          } else {
            resolve(Array.from(results));
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    }

    // Get all models that need to be invalidated when a model changes
    async getInvalidationSet(changedModels) {
      const invalidated = new Set(changedModels.map(m => m.toLowerCase()));
      const queue = [...changedModels.map(m => m.toLowerCase())];
      
      while (queue.length > 0) {
        const model = queue.shift();
        const downstream = await this.getDownstreamModels(model);
        
        for (const dep of downstream) {
          if (!invalidated.has(dep)) {
            invalidated.add(dep);
            queue.push(dep);
          }
        }
      }
      
      return Array.from(invalidated);
    }

    // Build dependency DAG from a list of schemas
    async buildDependencyDAG(schemas) {
      await this.open();
      
      const tx = this.db.transaction(['dependencies'], 'readwrite');
      const store = tx.objectStore('dependencies');
      
      // Build reverse mapping (model -> downstream)
      const downstreamMap = new Map();
      
      for (const schema of schemas) {
        const modelName = schema.name.toLowerCase();
        const upstream = (schema.dependencies || []).map(d => d.split('.').pop().toLowerCase());
        
        // Track downstream for each upstream
        for (const up of upstream) {
          if (!downstreamMap.has(up)) {
            downstreamMap.set(up, new Set());
          }
          downstreamMap.get(up).add(modelName);
        }
        
        // Save this model's upstream dependencies
        store.put({
          modelName,
          upstream,
          downstream: [], // Will be updated below
          updatedAt: new Date().toISOString()
        });
      }
      
      // Update downstream for each model
      for (const [modelName, downstream] of downstreamMap) {
        const request = store.get(modelName);
        request.onsuccess = () => {
          const record = request.result || { modelName, upstream: [] };
          record.downstream = Array.from(downstream);
          record.updatedAt = new Date().toISOString();
          store.put(record);
        };
      }
      
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    // Check which files have changed and need reprocessing
    async getChangedFiles(files) {
      await this.open();
      
      const changed = [];
      const unchanged = [];
      
      for (const file of files) {
        const currentHash = GraphStorage.computeHash(file.content);
        const storedHash = await this.getFileHash(file.path);
        
        if (storedHash !== currentHash) {
          changed.push({ ...file, hash: currentHash, previousHash: storedHash });
        } else {
          unchanged.push({ ...file, hash: currentHash });
        }
      }
      
      return { changed, unchanged };
    }

    // Get files that need reprocessing due to dependency invalidation
    async getFilesToReprocess(files) {
      const { changed, unchanged } = await this.getChangedFiles(files);
      
      // Get model names from changed files
      const changedModels = changed.map(f => 
        f.path.split(/[/\\]/).pop().replace(/\.sql$/i, '').toLowerCase()
      );
      
      // Get all invalidated models (changed + downstream)
      const invalidated = await this.getInvalidationSet(changedModels);
      
      // Find unchanged files that are in the invalidation set
      const invalidatedUnchanged = unchanged.filter(f => {
        const modelName = f.path.split(/[/\\]/).pop().replace(/\.sql$/i, '').toLowerCase();
        return invalidated.includes(modelName);
      });
      
      return {
        changed,
        invalidated: invalidatedUnchanged,
        unchanged: unchanged.filter(f => !invalidatedUnchanged.includes(f)),
        invalidationSet: invalidated
      };
    }

    async saveFileHash(path, hash, schema) {
      await this.open();
      
      const modelName = schema?.name?.toLowerCase() || path.split(/[/\\]/).pop().replace(/\.sql$/i, '').toLowerCase();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['fileHashes', 'schemaCache'], 'readwrite');
        
        // Save file hash with model name for lookup
        const hashStore = tx.objectStore('fileHashes');
        hashStore.put({ path, hash, modelName, updatedAt: new Date().toISOString() });
        
        // Cache parsed schema
        if (schema) {
          const cacheStore = tx.objectStore('schemaCache');
          cacheStore.put({ hash, schema, modelName: schema.name });
        }
        
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    async getFileHash(path) {
      await this.open();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['fileHashes'], 'readonly');
        const store = tx.objectStore('fileHashes');
        const request = store.get(path);
        request.onsuccess = () => resolve(request.result?.hash || null);
        request.onerror = () => reject(request.error);
      });
    }

    async getCachedSchema(hash) {
      await this.open();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['schemaCache'], 'readonly');
        const store = tx.objectStore('schemaCache');
        const request = store.get(hash);
        request.onsuccess = () => resolve(request.result?.schema || null);
        request.onerror = () => reject(request.error);
      });
    }

    async clearAll() {
      await this.open();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['graphs', 'fileHashes', 'schemaCache'], 'readwrite');
        tx.objectStore('graphs').clear();
        tx.objectStore('fileHashes').clear();
        tx.objectStore('schemaCache').clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    // Compute content hash for incremental updates
    static computeHash(content) {
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(36);
    }
  }

  // Export to global
  global.SQLCopilotV2 = {
    ExprType, JoinType, NodeType, EdgeType, Confidence, SemanticRole, AggregationType,
    SQLParser, renderExpression, SchemaExtractor, DbtResolver, SQLPreprocessor,
    MetadataGraph, RelationshipInferenceEngine, JoinPathFinder, GraphBuilder, GraphStorage,
    WarehouseConnector, MockWarehouseConnector, AuditLogger
  };

})(typeof window !== 'undefined' ? window : this);
