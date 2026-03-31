// Enhanced Schema Extractor with Improved Table/Variable Detection
// Addresses issues with dependency tracking and variable declaration detection

class EnhancedSchemaExtractor {
  constructor() {
    this.variableDeclarations = new Map(); // Track all declared variables
    this.variableUsage = new Map(); // Track variable usage
    this.tableDependencies = new Map(); // Enhanced table dependency tracking
    this.cteDependencies = new Map(); // CTE-specific dependency tracking
    this.columnLineage = new Map(); // Column-level lineage tracking
    this.unusedVariables = new Set(); // Variables declared but not used
    this.implicitDependencies = new Set(); // Dependencies not explicitly stated
  }

  // Enhanced variable detection - finds all variable declarations even if unused
  extractVariableDeclarations(sql) {
    const declarations = new Map();
    
    // Pattern matching for different variable declaration types
    const patterns = [
      // SET @variable = value
      /SET\s+@(\w+)\s*=\s*([^;]+)/gi,
      // DECLARE @variable TYPE
      /DECLARE\s+@(\w+)\s+(\w+(?:\([^)]+\))?)/gi,
      // :variable := value (PL/SQL style)
      /(\w+):\s*=\s*([^;]+)/gi,
      // LET variable = value (Spark SQL)
      /LET\s+(\w+)\s*=\s*([^;]+)/gi,
      // WITH variable AS (CTE)
      /WITH\s+(\w+)\s+AS\s*\(/gi,
      // CREATE TEMPORARY TABLE/FUNCTION
      /CREATE\s+(?:TEMPORARY\s+)?(?:TABLE|FUNCTION)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi
    ];

    sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').split(';').forEach(stmt => {
      stmt = stmt.trim();
      if (!stmt) return;

      patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(stmt)) !== null) {
          const varName = match[1];
          const varType = match[2] || 'INFERRED';
          const fullDeclaration = match[0];
          
          declarations.set(varName, {
            name: varName,
            type: varType,
            declaration: fullDeclaration,
            statement: stmt,
            lineNumber: this.getLineNumber(sql, match.index),
            isCTE: pattern.source.includes('WITH'),
            isTempTable: pattern.source.includes('CREATE'),
            isParameter: varName.startsWith('@'),
            usage: []
          });
        }
      });
    });

    return declarations;
  }

  // Enhanced variable usage detection
  extractVariableUsage(sql, declarations) {
    const usage = new Map();
    
    // Initialize usage tracking for all declared variables
    declarations.forEach((decl, name) => {
      usage.set(name, {
        ...decl,
        usage: [],
        isUsed: false,
        usageContexts: []
      });
    });

    // Find all variable references in the SQL
    declarations.forEach((decl, varName) => {
      const patterns = [
        new RegExp(`@${varName}\\b`, 'g'), // @variable
        new RegExp(`\\b${varName}\\b(?=\\s*AS|\\s*\\(|\\s*,|\\s*FROM|\\s*JOIN|\\s*WHERE|\\s*SELECT)`, 'g'), // variable AS
        new RegExp(`\\b${varName}\\b(?=\\s*\\.)`, 'g') // variable.column
      ];

      patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(sql)) !== null) {
          const context = this.getContext(sql, match.index);
          const usageInfo = {
            position: match.index,
            lineNumber: this.getLineNumber(sql, match.index),
            context: context,
            type: this.getUsageType(context, varName)
          };

          const varUsage = usage.get(varName);
          varUsage.usage.push(usageInfo);
          varUsage.usageContexts.push(context);
          varUsage.isUsed = true;
        }
      });
    });

    return usage;
  }

  // Enhanced table dependency detection
  extractTableDependencies(ir, declarations) {
    const dependencies = new Map();
    
    // Direct table references
    const extractDirectTables = (node, path = []) => {
      if (!node) return;
      
      if (node.type === 'table') {
        const tableName = this.buildQualifiedName(node);
        const dep = {
          table: tableName,
          alias: node.alias,
          type: 'direct',
          path: [...path, 'table'],
          confidence: 1.0,
          lineNumber: node.lineNumber || 0
        };
        
        if (!dependencies.has(tableName)) {
          dependencies.set(tableName, []);
        }
        dependencies.get(tableName).push(dep);
      }
      
      if (node.type === 'subquery') {
        extractDirectTables(node.query, [...path, 'subquery']);
      }
      
      if (node.type === 'join') {
        extractDirectTables(node.right, [...path, 'join']);
        if (node.predicate) {
          this.extractImplicitTables(node.predicate, dependencies, [...path, 'join_predicate']);
        }
      }
      
      if (node.sources) {
        node.sources.forEach((src, i) => {
          extractDirectTables(src, [...path, `sources[${i}]`]);
        });
      }
    };

    // Extract implicit table references from expressions
    const extractImplicitTables = (expr, deps, path) => {
      if (!expr) return;
      
      if (expr.type === 'column_ref' && expr.table) {
        const tableName = expr.table;
        const dep = {
          table: tableName,
          alias: null,
          type: 'implicit',
          path: path,
          confidence: 0.8,
          context: this.getExpressionContext(expr),
          lineNumber: expr.lineNumber || 0
        };
        
        if (!deps.has(tableName)) {
          deps.set(tableName, []);
        }
        deps.get(tableName).push(dep);
      }
      
      // Recursively check sub-expressions
      ['left', 'right', 'expression', 'args'].forEach(prop => {
        if (expr[prop]) {
          if (Array.isArray(expr[prop])) {
            expr[prop].forEach((item, i) => {
              extractImplicitTables(item, deps, [...path, `${prop}[${i}]`]);
            });
          } else {
            extractImplicitTables(expr[prop], deps, [...path, prop]);
          }
        }
      });
    };

    // CTE dependency tracking
    const extractCTEDependencies = (ctes) => {
      if (!ctes) return;
      
      Object.entries(ctes).forEach(([cteName, cteDef]) => {
        const cteDeps = new Set();
        
        // Extract tables from CTE definition
        extractDirectTables(cteDef, ['cte', cteName]);
        
        // Extract implicit dependencies from CTE expressions
        if (cteDef.projections) {
          cteDef.projections.forEach(proj => {
            extractImplicitTables(proj.expression, dependencies, ['cte', cteName, 'projection']);
          });
        }
        
        if (cteDef.filters) {
          cteDef.filters.forEach(filter => {
            extractImplicitTables(filter, dependencies, ['cte', cteName, 'filter']);
          });
        }
        
        this.cteDependencies.set(cteName, {
          definition: cteDef,
          dependencies: Array.from(cteDeps),
          isUsed: false,
          usage: []
        });
      });
    };

    // Process the IR
    extractDirectTables(ir, ['root']);
    extractCTEDependencies(ir.ctes);

    // Check CTE usage
    if (ir.ctes) {
      this.checkCTEUsage(ir, ir.ctes);
    }

    return dependencies;
  }

  // Enhanced column lineage tracking
  extractColumnLineage(ir, aliasMap) {
    const lineage = new Map();
    
    // Process each projection to trace column origins
    if (ir.projections) {
      ir.projections.forEach((proj, index) => {
        const columnName = proj.alias || `col_${index}`;
        const sources = this.extractColumnSources(proj.expression, aliasMap);
        
        lineage.set(columnName, {
          expression: proj.expression,
          sources: sources,
          transformations: this.extractTransformations(proj.expression),
          isComputed: proj.expression.type !== 'column_ref',
          isAggregated: this.isAggregated(proj.expression),
          lineage: this.buildLineageChain(sources, aliasMap)
        });
      });
    }
    
    return lineage;
  }

  // Extract column sources with enhanced resolution
  extractColumnSources(expr, aliasMap) {
    const sources = [];
    
    if (expr.type === 'column_ref') {
      const tableName = expr.table;
      const columnName = expr.column;
      
      // Try to resolve the table reference
      const resolvedTable = this.resolveTableReference(tableName, aliasMap);
      
      sources.push({
        table: resolvedTable || tableName,
        column: columnName,
        alias: tableName,
        confidence: resolvedTable ? 1.0 : 0.7,
        type: 'direct'
      });
    } else if (expr.type === 'function') {
      // Extract sources from function arguments
      if (expr.args) {
        expr.args.forEach(arg => {
          sources.push(...this.extractColumnSources(arg, aliasMap));
        });
      }
    } else if (expr.type === 'binary_op') {
      // Extract from both sides of binary operations
      sources.push(...this.extractColumnSources(expr.left, aliasMap));
      sources.push(...this.extractColumnSources(expr.right, aliasMap));
    } else if (expr.type === 'case') {
      // Extract from CASE expressions
      expr.conditions?.forEach(cond => {
        sources.push(...this.extractColumnSources(cond.when, aliasMap));
        sources.push(...this.extractColumnSources(cond.then, aliasMap));
      });
      if (expr.elseResult) {
        sources.push(...this.extractColumnSources(expr.elseResult, aliasMap));
      }
    }
    
    return this.deduplicateSources(sources);
  }

  // Resolve table references with multiple strategies
  resolveTableReference(tableName, aliasMap) {
    if (!tableName) return null;
    
    const lowerName = tableName.toLowerCase();
    
    // Strategy 1: Direct alias lookup
    if (aliasMap.has(lowerName)) {
      return aliasMap.get(lowerName);
    }
    
    // Strategy 2: Unqualified name lookup
    if (aliasMap.has(`${lowerName}_unqualified`)) {
      return aliasMap.get(`${lowerName}_unqualified`);
    }
    
    // Strategy 3: Schema-qualified lookup
    if (tableName.includes('.')) {
      const parts = tableName.split('.');
      if (parts.length === 2) {
        const schema = parts[0];
        const table = parts[1];
        const qualified = `${schema}.${table}`;
        if (aliasMap.has(qualified.toLowerCase())) {
          return aliasMap.get(qualified.toLowerCase());
        }
      }
    }
    
    // Strategy 4: Partial match (for incomplete references)
    for (const [alias, table] of aliasMap) {
      if (alias.includes(lowerName) || table.includes(lowerName)) {
        return table;
      }
    }
    
    return null;
  }

  // Helper methods
  getLineNumber(text, index) {
    return text.substring(0, index).split('\n').length;
  }

  getContext(text, index, windowSize = 50) {
    const start = Math.max(0, index - windowSize);
    const end = Math.min(text.length, index + windowSize);
    return text.substring(start, end);
  }

  getUsageType(context, varName) {
    if (context.includes('SELECT')) return 'selection';
    if (context.includes('WHERE')) return 'filter';
    if (context.includes('JOIN')) return 'join';
    if (context.includes('GROUP BY')) return 'grouping';
    if (context.includes('ORDER BY')) return 'ordering';
    if (context.includes('SET') || context.includes(':=')) return 'assignment';
    return 'unknown';
  }

  getExpressionContext(expr) {
    if (expr.type === 'function') return `function_${expr.name}`;
    if (expr.type === 'binary_op') return `binary_${expr.operator}`;
    return expr.type;
  }

  buildQualifiedName(table) {
    const parts = [];
    if (table.catalog) parts.push(table.catalog);
    if (table.schema) parts.push(table.schema);
    if (table.table) parts.push(table.table);
    return parts.join('.');
  }

  extractTransformations(expr) {
    const transformations = [];
    
    if (expr.type === 'function') {
      transformations.push({
        type: 'function',
        name: expr.name,
        args: expr.args?.length || 0
      });
    }
    
    if (expr.type === 'cast') {
      transformations.push({
        type: 'cast',
        targetType: expr.targetType
      });
    }
    
    if (expr.type === 'binary_op') {
      transformations.push({
        type: 'operation',
        operator: expr.operator
      });
    }
    
    return transformations;
  }

  isAggregated(expr) {
    if (expr.type === 'function') {
      const aggFunctions = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STDDEV', 'VARIANCE'];
      return aggFunctions.includes(expr.name.toUpperCase());
    }
    return false;
  }

  buildLineageChain(sources, aliasMap) {
    const chain = [];
    
    sources.forEach(source => {
      chain.push({
        table: source.table,
        column: source.column,
        confidence: source.confidence,
        path: [source.table, source.column]
      });
    });
    
    return chain;
  }

  deduplicateSources(sources) {
    const seen = new Set();
    return sources.filter(source => {
      const key = `${source.table}.${source.column}`;
      if (!seen.has(key)) {
        seen.add(key);
        return true;
      }
      return false;
    });
  }

  checkCTEUsage(ir, ctes) {
    const cteNames = new Set(Object.keys(ctes));
    
    // Check main query
    this.checkNodeCTEUsage(ir, cteNames);
    
    // Check other CTEs for cross-references
    Object.values(ctes).forEach(cte => {
      this.checkNodeCTEUsage(cte, cteNames);
    });
  }

  checkNodeCTEUsage(node, cteNames) {
    if (!node) return;
    
    if (node.type === 'table' && cteNames.has(node.table)) {
      const cteDep = this.cteDependencies.get(node.table);
      if (cteDep) {
        cteDep.isUsed = true;
        cteDep.usage.push({
          alias: node.alias,
          context: 'table_reference'
        });
      }
    }
    
    // Recursively check child nodes
    ['query', 'left', 'right', 'expression', 'sources', 'joins'].forEach(prop => {
      if (node[prop]) {
        if (Array.isArray(node[prop])) {
          node[prop].forEach(item => this.checkNodeCTEUsage(item, cteNames));
        } else {
          this.checkNodeCTEUsage(node[prop], cteNames);
        }
      }
    });
  }

  // Main extraction method
  extractEnhancedSchema(sql, ir, aliasMap) {
    const declarations = this.extractVariableDeclarations(sql);
    const usage = this.extractVariableUsage(sql, declarations);
    const tableDeps = this.extractTableDependencies(ir, declarations);
    const columnLineage = this.extractColumnLineage(ir, aliasMap);
    
    // Find unused variables
    declarations.forEach((decl, name) => {
      const usageInfo = usage.get(name);
      if (!usageInfo || !usageInfo.isUsed) {
        this.unusedVariables.add(name);
      }
    });
    
    return {
      variableDeclarations: Object.fromEntries(declarations),
      variableUsage: Object.fromEntries(usage),
      tableDependencies: Object.fromEntries(tableDeps),
      columnLineage: Object.fromEntries(columnLineage),
      cteDependencies: Object.fromEntries(this.cteDependencies),
      unusedVariables: Array.from(this.unusedVariables),
      metrics: {
        totalVariables: declarations.size,
        usedVariables: Array.from(usage.values()).filter(u => u.isUsed).length,
        unusedVariables: this.unusedVariables.size,
        totalTables: tableDeps.size,
        totalCTEs: this.cteDependencies.size,
        usedCTEs: Array.from(this.cteDependencies.values()).filter(cte => cte.isUsed).length
      }
    };
  }
}

// Export for use in main application
window.EnhancedSchemaExtractor = EnhancedSchemaExtractor;
