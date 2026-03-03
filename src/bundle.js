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
        const ir = n.toUpperCase().startsWith('CREATE TABLE') && n.toUpperCase().includes(' AS ') 
          ? this.parseCTAS(n) : this.parseSelect(n);
        ir.originalSQL = sql; ir.dialect = this.dialect; ir.errors = this.errors;
        return ir;
      } catch (e) {
        this.errors.push({ type: 'PARSE_ERROR', message: e.message });
        return { type: 'ERROR', originalSQL: sql, errors: this.errors };
      }
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
    constructor() { this.catalog = null; }
    setCatalog(c) { this.catalog = c; }

    extract(ir, modelName, options = {}) {
      const { layer = null, description = null } = options;
      const targetTable = ir.targetTable || ir.targetView || { table: modelName };
      const columns = this.extractColumns(ir);
      const isAggregated = ir.groupBy && ir.groupBy.length > 0;
      const grainColumns = isAggregated ? this.extractGrainColumns(ir.groupBy, columns) : this.inferPK(columns);
      const deps = this.extractDeps(ir);
      const joinMeta = this.extractJoinMeta(ir.joins);
      const filters = (ir.filters || []).map(f => ({ expression: f, sql: renderExpression(f), columns: this.extractSrcCols(f) }));

      return {
        id: `model_${this.hash(modelName.toLowerCase())}`, name: targetTable.table || modelName, schema: targetTable.schema || null,
        database: targetTable.database || null, description, layer, columns, grainColumns, isAggregated, dependencies: deps,
        joinMetadata: joinMeta, filters, filtersNormalized: filters.map(f => f.sql), sourceType: ir.type,
        hasPartialLineage: ir.isPartial || false, extractedAt: new Date().toISOString()
      };
    }

    extractColumns(ir) {
      if (!ir.projections) return [];
      return ir.projections.map((proj, i) => {
        const expr = proj.expression;
        const srcCols = proj.sourceColumns || this.extractSrcCols(expr);
        const typeInfo = this.inferType(expr);
        const aggInfo = this.detectAgg(expr);
        const role = this.classifyRole(proj, aggInfo, ir.groupBy);
        return {
          id: `col_${this.hash(proj.alias.toLowerCase())}_${i}`, name: proj.alias, type: typeInfo.type, typeConfidence: typeInfo.confidence,
          expressionIR: expr, expressionSQL: renderExpression(expr), sourceColumns: srcCols, semanticRole: role,
          aggregationType: aggInfo.type, aggregationDistinct: aggInfo.distinct, nullable: aggInfo.type === AggregationType.COUNT ? false : null,
          isPK: false, isFK: false, isComputed: expr.type !== ExprType.COLUMN_REF, isPassthrough: srcCols.length === 1 && expr.type === ExprType.COLUMN_REF
        };
      });
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
    constructor() { this.manifest = null; this.models = new Map(); this.sources = new Map(); }
    load(manifest) { this.manifest = typeof manifest === 'string' ? JSON.parse(manifest) : manifest; this.indexNodes(); return this; }
    indexNodes() {
      if (!this.manifest?.nodes) return;
      for (const [uid, node] of Object.entries(this.manifest.nodes)) {
        if (node.resource_type === 'model') this.models.set(node.name.toLowerCase(), { uniqueId: uid, ...node });
      }
      if (this.manifest.sources) for (const [uid, src] of Object.entries(this.manifest.sources)) this.sources.set(`${src.source_name}.${src.name}`.toLowerCase(), { uniqueId: uid, ...src });
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
    getAllModels() { return Array.from(this.models.values()).map(n => ({ name: n.name, uniqueId: n.uniqueId, schema: n.schema, database: n.database, fqn: this.buildFQN(n), tags: n.tags || [], description: n.description || null })); }
    isLoaded() { return this.manifest !== null; }
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
    
    addNode(id, type, data = {}) {
      const node = { id, type, ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
      if (node.type === NodeType.COLUMN && node.modelId) {
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
    constructor(graph) { this.graph = graph; this.strategies = [new JoinUsageStrategy(), new NamingConventionStrategy()]; }
    
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
          existing.confidence = Math.min(1.0, existing.confidence + c.confidence * 0.3);
        } else {
          merged.set(key, { ...c, signals: [{ strategy: c.strategy, confidence: c.confidence }] });
        }
      }
      return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
    }
  }

  class JoinUsageStrategy {
    async infer(models, graph) {
      const candidates = [];
      for (const model of models) {
        for (const join of (model.joinMetadata || [])) {
          if (!join.predicate) continue;
          const cols = this.parseJoinPredicate(join.predicate);
          for (const { left, right } of cols) {
            candidates.push({
              from: { table: model.name, column: left.column }, to: { table: join.rightTable, column: right.column },
              type: EdgeType.JOINS_ON, confidence: Confidence.JOIN_USAGE, strategy: 'join_usage',
              explanation: `Found in SQL join: ${join.predicate}`
            });
          }
        }
      }
      return candidates;
    }
    parseJoinPredicate(pred) {
      const results = [];
      const eqMatch = pred.match(/(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/);
      if (eqMatch) results.push({ left: { table: eqMatch[1], column: eqMatch[2] }, right: { table: eqMatch[3], column: eqMatch[4] } });
      return results;
    }
  }

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

  // Export to global
  global.SQLCopilotV2 = {
    ExprType, JoinType, NodeType, EdgeType, Confidence, SemanticRole, AggregationType,
    SQLParser, renderExpression, SchemaExtractor, DbtResolver, SQLPreprocessor,
    MetadataGraph, RelationshipInferenceEngine, JoinPathFinder
  };

})(typeof window !== 'undefined' ? window : this);
