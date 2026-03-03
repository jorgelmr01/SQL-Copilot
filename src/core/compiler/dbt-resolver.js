/**
 * dbt Manifest Resolver
 * 
 * Integrates with dbt's manifest.json to resolve:
 * - ref('model_name') -> fully qualified table name
 * - source('source_name', 'table_name') -> fully qualified table name
 * - Model dependencies and lineage
 * - Compiled SQL retrieval
 */

/**
 * dbt Manifest Resolver class
 * Parses and queries dbt manifest.json for model resolution
 */
export class DbtResolver {
  constructor() {
    this.manifest = null;
    this.models = new Map();      // model_name -> node
    this.sources = new Map();     // source.table -> node
    this.seeds = new Map();       // seed_name -> node
    this.snapshots = new Map();   // snapshot_name -> node
    this.macros = new Map();      // macro_name -> node
    this.exposures = new Map();   // exposure_name -> node
    this.metrics = new Map();     // metric_name -> node
  }

  /**
   * Load and parse a dbt manifest.json file
   * @param {Object|string} manifest - Manifest object or JSON string
   */
  load(manifest) {
    if (typeof manifest === 'string') {
      this.manifest = JSON.parse(manifest);
    } else {
      this.manifest = manifest;
    }

    this.indexNodes();
    return this;
  }

  /**
   * Index all nodes by type for fast lookup
   */
  indexNodes() {
    if (!this.manifest?.nodes) return;

    // Index nodes
    for (const [uniqueId, node] of Object.entries(this.manifest.nodes)) {
      const name = node.name.toLowerCase();
      
      switch (node.resource_type) {
        case 'model':
          this.models.set(name, { uniqueId, ...node });
          break;
        case 'seed':
          this.seeds.set(name, { uniqueId, ...node });
          break;
        case 'snapshot':
          this.snapshots.set(name, { uniqueId, ...node });
          break;
      }
    }

    // Index sources
    if (this.manifest.sources) {
      for (const [uniqueId, source] of Object.entries(this.manifest.sources)) {
        const key = `${source.source_name}.${source.name}`.toLowerCase();
        this.sources.set(key, { uniqueId, ...source });
      }
    }

    // Index macros
    if (this.manifest.macros) {
      for (const [uniqueId, macro] of Object.entries(this.manifest.macros)) {
        this.macros.set(macro.name.toLowerCase(), { uniqueId, ...macro });
      }
    }

    // Index exposures
    if (this.manifest.exposures) {
      for (const [uniqueId, exposure] of Object.entries(this.manifest.exposures)) {
        this.exposures.set(exposure.name.toLowerCase(), { uniqueId, ...exposure });
      }
    }

    // Index metrics
    if (this.manifest.metrics) {
      for (const [uniqueId, metric] of Object.entries(this.manifest.metrics)) {
        this.metrics.set(metric.name.toLowerCase(), { uniqueId, ...metric });
      }
    }
  }

  /**
   * Resolve a ref() call to a fully qualified table name
   * @param {string} modelName - The model name from ref('model_name')
   * @param {string} packageName - Optional package name from ref('package', 'model')
   * @returns {Object} Resolved table info
   */
  resolveRef(modelName, packageName = null) {
    const key = modelName.toLowerCase();
    
    // Try models first
    let node = this.models.get(key);
    
    // Try seeds
    if (!node) {
      node = this.seeds.get(key);
    }
    
    // Try snapshots
    if (!node) {
      node = this.snapshots.get(key);
    }

    if (!node) {
      return {
        resolved: false,
        original: modelName,
        error: `Model '${modelName}' not found in manifest`
      };
    }

    // Build fully qualified name
    const fqn = this.buildFQN(node);

    return {
      resolved: true,
      original: modelName,
      uniqueId: node.uniqueId,
      schema: node.schema,
      database: node.database,
      alias: node.alias || node.name,
      fqn: fqn,
      materializedAs: node.config?.materialized || 'view',
      columns: this.extractColumns(node),
      dependencies: node.depends_on?.nodes || [],
      tags: node.tags || [],
      meta: node.meta || {}
    };
  }

  /**
   * Resolve a source() call to a fully qualified table name
   * @param {string} sourceName - The source name
   * @param {string} tableName - The table name within the source
   * @returns {Object} Resolved source info
   */
  resolveSource(sourceName, tableName) {
    const key = `${sourceName}.${tableName}`.toLowerCase();
    const node = this.sources.get(key);

    if (!node) {
      return {
        resolved: false,
        original: `${sourceName}.${tableName}`,
        error: `Source '${sourceName}.${tableName}' not found in manifest`
      };
    }

    const fqn = this.buildFQN(node);

    return {
      resolved: true,
      original: `${sourceName}.${tableName}`,
      uniqueId: node.uniqueId,
      schema: node.schema,
      database: node.database,
      identifier: node.identifier || node.name,
      fqn: fqn,
      columns: this.extractColumns(node),
      freshness: node.freshness || null,
      loader: node.loader || null,
      meta: node.meta || {}
    };
  }

  /**
   * Build a fully qualified name from a node
   */
  buildFQN(node) {
    const parts = [];
    
    if (node.database) {
      parts.push(node.database);
    }
    
    if (node.schema) {
      parts.push(node.schema);
    }
    
    parts.push(node.alias || node.identifier || node.name);
    
    return parts.join('.');
  }

  /**
   * Extract column information from a node
   */
  extractColumns(node) {
    if (!node.columns) return [];

    return Object.entries(node.columns).map(([name, col]) => ({
      name: name,
      description: col.description || null,
      dataType: col.data_type || null,
      meta: col.meta || {},
      tags: col.tags || [],
      tests: col.tests || []
    }));
  }

  /**
   * Get compiled SQL for a model
   * @param {string} modelName - The model name
   * @returns {string|null} Compiled SQL or null
   */
  getCompiledSQL(modelName) {
    const key = modelName.toLowerCase();
    const node = this.models.get(key);
    
    if (!node) return null;
    
    // compiled_code is available in dbt >= 1.3
    // compiled_sql is the older field name
    return node.compiled_code || node.compiled_sql || null;
  }

  /**
   * Get raw SQL for a model
   * @param {string} modelName - The model name
   * @returns {string|null} Raw SQL or null
   */
  getRawSQL(modelName) {
    const key = modelName.toLowerCase();
    const node = this.models.get(key);
    
    if (!node) return null;
    
    return node.raw_code || node.raw_sql || null;
  }

  /**
   * Get all upstream dependencies for a model
   * @param {string} modelName - The model name
   * @param {number} depth - Maximum depth to traverse (default: Infinity)
   * @returns {Set<string>} Set of upstream model unique IDs
   */
  getUpstream(modelName, depth = Infinity) {
    const key = modelName.toLowerCase();
    const node = this.models.get(key);
    
    if (!node) return new Set();
    
    const upstream = new Set();
    const queue = [{ id: node.uniqueId, currentDepth: 0 }];
    const visited = new Set();
    
    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift();
      
      if (visited.has(id) || currentDepth > depth) continue;
      visited.add(id);
      
      const currentNode = this.manifest.nodes[id] || this.manifest.sources?.[id];
      if (!currentNode) continue;
      
      const deps = currentNode.depends_on?.nodes || [];
      for (const depId of deps) {
        upstream.add(depId);
        queue.push({ id: depId, currentDepth: currentDepth + 1 });
      }
    }
    
    return upstream;
  }

  /**
   * Get all downstream dependents for a model
   * @param {string} modelName - The model name
   * @param {number} depth - Maximum depth to traverse (default: Infinity)
   * @returns {Set<string>} Set of downstream model unique IDs
   */
  getDownstream(modelName, depth = Infinity) {
    const key = modelName.toLowerCase();
    const node = this.models.get(key);
    
    if (!node) return new Set();
    
    // Build reverse dependency map
    const reverseDeps = new Map();
    for (const [id, n] of Object.entries(this.manifest.nodes)) {
      const deps = n.depends_on?.nodes || [];
      for (const depId of deps) {
        if (!reverseDeps.has(depId)) {
          reverseDeps.set(depId, new Set());
        }
        reverseDeps.get(depId).add(id);
      }
    }
    
    const downstream = new Set();
    const queue = [{ id: node.uniqueId, currentDepth: 0 }];
    const visited = new Set();
    
    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift();
      
      if (visited.has(id) || currentDepth > depth) continue;
      visited.add(id);
      
      const dependents = reverseDeps.get(id) || new Set();
      for (const depId of dependents) {
        downstream.add(depId);
        queue.push({ id: depId, currentDepth: currentDepth + 1 });
      }
    }
    
    return downstream;
  }

  /**
   * Get all models in the manifest
   * @returns {Array} Array of model info objects
   */
  getAllModels() {
    return Array.from(this.models.values()).map(node => ({
      name: node.name,
      uniqueId: node.uniqueId,
      schema: node.schema,
      database: node.database,
      fqn: this.buildFQN(node),
      materializedAs: node.config?.materialized || 'view',
      tags: node.tags || [],
      description: node.description || null,
      path: node.path || null
    }));
  }

  /**
   * Get all sources in the manifest
   * @returns {Array} Array of source info objects
   */
  getAllSources() {
    return Array.from(this.sources.values()).map(node => ({
      sourceName: node.source_name,
      tableName: node.name,
      uniqueId: node.uniqueId,
      schema: node.schema,
      database: node.database,
      fqn: this.buildFQN(node),
      description: node.description || null,
      loader: node.loader || null
    }));
  }

  /**
   * Check if manifest is loaded
   */
  isLoaded() {
    return this.manifest !== null;
  }

  /**
   * Get manifest metadata
   */
  getMetadata() {
    if (!this.manifest) return null;
    
    return {
      dbtVersion: this.manifest.metadata?.dbt_version,
      projectName: this.manifest.metadata?.project_name,
      generatedAt: this.manifest.metadata?.generated_at,
      invocationId: this.manifest.metadata?.invocation_id,
      modelCount: this.models.size,
      sourceCount: this.sources.size,
      seedCount: this.seeds.size,
      snapshotCount: this.snapshots.size
    };
  }
}

/**
 * SQL Preprocessor
 * Handles Jinja templating and dbt macro resolution
 */
export class SQLPreprocessor {
  constructor(dbtResolver = null) {
    this.dbtResolver = dbtResolver;
    this.variables = {};
    this.extractedRefs = [];
    this.extractedSources = [];
    this.unresolvedMacros = [];
  }

  /**
   * Set variables for Jinja expansion
   */
  setVariables(vars) {
    this.variables = { ...this.variables, ...vars };
  }

  /**
   * Set the dbt resolver
   */
  setDbtResolver(resolver) {
    this.dbtResolver = resolver;
  }

  /**
   * Compile SQL by resolving refs, sources, and variables
   * @param {string} rawSQL - Raw SQL with Jinja/dbt syntax
   * @param {Object} context - Additional context variables
   * @returns {Object} Compilation result
   */
  compile(rawSQL, context = {}) {
    this.extractedRefs = [];
    this.extractedSources = [];
    this.unresolvedMacros = [];
    
    let sql = rawSQL;
    const allVars = { ...this.variables, ...context };
    
    // 1. Resolve ref() calls
    sql = this.resolveRefs(sql);
    
    // 2. Resolve source() calls
    sql = this.resolveSources(sql);
    
    // 3. Expand simple variables {{ var('name') }} and {{ var_name }}
    sql = this.expandVariables(sql, allVars);
    
    // 4. Handle config blocks (remove them)
    sql = this.stripConfigBlocks(sql);
    
    // 5. Strip remaining Jinja control flow (mark as partial)
    const { cleanSQL, hasPartialLineage, strippedBlocks } = this.stripJinjaBlocks(sql);
    
    return {
      compiledSQL: cleanSQL.trim(),
      originalSQL: rawSQL,
      isPartial: hasPartialLineage,
      refs: this.extractedRefs,
      sources: this.extractedSources,
      unresolvedMacros: this.unresolvedMacros,
      strippedBlocks: strippedBlocks
    };
  }

  /**
   * Resolve ref() calls using dbt manifest
   */
  resolveRefs(sql) {
    // Match {{ ref('model_name') }} or {{ ref("model_name") }}
    const refPattern = /\{\{\s*ref\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;
    
    return sql.replace(refPattern, (match, modelName) => {
      if (this.dbtResolver) {
        const resolved = this.dbtResolver.resolveRef(modelName);
        this.extractedRefs.push(resolved);
        
        if (resolved.resolved) {
          return resolved.fqn;
        }
      }
      
      // Fallback: use model name as-is
      this.extractedRefs.push({
        resolved: false,
        original: modelName,
        error: 'No dbt resolver available'
      });
      
      return modelName;
    });
  }

  /**
   * Resolve source() calls using dbt manifest
   */
  resolveSources(sql) {
    // Match {{ source('source_name', 'table_name') }}
    const sourcePattern = /\{\{\s*source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;
    
    return sql.replace(sourcePattern, (match, sourceName, tableName) => {
      if (this.dbtResolver) {
        const resolved = this.dbtResolver.resolveSource(sourceName, tableName);
        this.extractedSources.push(resolved);
        
        if (resolved.resolved) {
          return resolved.fqn;
        }
      }
      
      // Fallback: use source.table format
      this.extractedSources.push({
        resolved: false,
        original: `${sourceName}.${tableName}`,
        error: 'No dbt resolver available'
      });
      
      return `${sourceName}.${tableName}`;
    });
  }

  /**
   * Expand Jinja variables
   */
  expandVariables(sql, vars) {
    // Match {{ var('name') }} or {{ var("name") }}
    let result = sql.replace(/\{\{\s*var\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g, (match, varName) => {
      if (varName in vars) {
        const value = vars[varName];
        return typeof value === 'string' ? `'${value}'` : String(value);
      }
      return match; // Keep original if not found
    });
    
    // Match simple {{ variable_name }}
    result = result.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, varName) => {
      // Skip if it looks like a macro call
      if (varName === 'ref' || varName === 'source' || varName === 'config') {
        return match;
      }
      
      if (varName in vars) {
        const value = vars[varName];
        return typeof value === 'string' ? `'${value}'` : String(value);
      }
      return match;
    });
    
    return result;
  }

  /**
   * Strip dbt config blocks
   */
  stripConfigBlocks(sql) {
    // Remove {{ config(...) }}
    return sql.replace(/\{\{\s*config\s*\([^)]*\)\s*\}\}/g, '');
  }

  /**
   * Strip Jinja control flow blocks
   */
  stripJinjaBlocks(sql) {
    const strippedBlocks = [];
    let hasPartialLineage = false;
    let cleanSQL = sql;
    
    // Strip {% if %} ... {% endif %} blocks
    const ifPattern = /\{%\s*if\s+[\s\S]*?%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
    cleanSQL = cleanSQL.replace(ifPattern, (match, content) => {
      hasPartialLineage = true;
      strippedBlocks.push({ type: 'if', original: match });
      // Keep the content but mark as conditional
      return `/* CONDITIONAL: */ ${content}`;
    });
    
    // Strip {% for %} ... {% endfor %} blocks
    const forPattern = /\{%\s*for\s+[\s\S]*?%\}([\s\S]*?)\{%\s*endfor\s*%\}/g;
    cleanSQL = cleanSQL.replace(forPattern, (match, content) => {
      hasPartialLineage = true;
      strippedBlocks.push({ type: 'for', original: match });
      return `/* LOOP: */ ${content}`;
    });
    
    // Strip remaining Jinja tags
    const tagPattern = /\{%[\s\S]*?%\}/g;
    cleanSQL = cleanSQL.replace(tagPattern, (match) => {
      strippedBlocks.push({ type: 'tag', original: match });
      return '';
    });
    
    // Strip remaining Jinja expressions (macros we couldn't resolve)
    const exprPattern = /\{\{[\s\S]*?\}\}/g;
    cleanSQL = cleanSQL.replace(exprPattern, (match) => {
      this.unresolvedMacros.push(match);
      strippedBlocks.push({ type: 'expression', original: match });
      return '/* UNRESOLVED_MACRO */';
    });
    
    return { cleanSQL, hasPartialLineage, strippedBlocks };
  }
}

export default DbtResolver;
