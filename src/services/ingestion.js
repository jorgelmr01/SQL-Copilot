/**
 * Ingestion Service
 * 
 * Handles ingestion of SQL files, dbt projects, and schema definitions.
 * Coordinates parsing, compilation, and schema extraction.
 */

import { SQLParser } from '../core/parser/sql-parser.js';
import { DbtResolver, SQLPreprocessor } from '../core/compiler/dbt-resolver.js';
import { SchemaExtractor } from '../core/analyzer/schema-extractor.js';
import { MetadataGraph, NodeType, EdgeType } from '../graph/model.js';

/**
 * Layer detection patterns
 */
const LAYER_PATTERNS = {
  raw: [/\/raw\//i, /^raw\./i, /^raw_/i, /\/bronze\//i, /^bronze\./i],
  silver: [/\/silver\//i, /^silver\./i, /\/staging\//i, /^stg_/i],
  gold: [/\/gold\//i, /^gold\./i, /\/mart\//i, /^mart_/i, /^dim_/i, /^fact_/i],
  diamond: [/\/diamond\//i, /^diamond\./i, /\/semantic\//i],
  black: [/\/black\//i, /^black\./i],
  prediction: [/\/prediction\//i, /^prediction\./i, /\/ml\//i, /^ml_/i]
};

/**
 * Ingestion Service class
 */
export class IngestionService {
  constructor(options = {}) {
    this.parser = new SQLParser(options.dialect || 'presto');
    this.preprocessor = new SQLPreprocessor();
    this.extractor = new SchemaExtractor();
    this.graph = options.graph || new MetadataGraph();
    
    // dbt integration
    this.dbtResolver = null;
    
    // Processing stats
    this.stats = {
      filesProcessed: 0,
      modelsCreated: 0,
      relationshipsInferred: 0,
      errors: [],
      warnings: []
    };
  }

  /**
   * Set SQL dialect
   */
  setDialect(dialect) {
    this.parser.setDialect(dialect);
  }

  /**
   * Load dbt manifest for ref/source resolution
   * @param {Object|string} manifest - dbt manifest.json content
   */
  loadDbtManifest(manifest) {
    this.dbtResolver = new DbtResolver();
    this.dbtResolver.load(manifest);
    this.preprocessor.setDbtResolver(this.dbtResolver);
    
    return this.dbtResolver.getMetadata();
  }

  /**
   * Ingest a single SQL file
   * @param {string} sql - SQL content
   * @param {string} filePath - File path (for naming and layer detection)
   * @param {Object} options - Ingestion options
   * @returns {Object} Ingestion result
   */
  async ingestSQL(sql, filePath, options = {}) {
    const {
      modelName = this.extractModelName(filePath),
      layer = this.detectLayer(filePath),
      description = null,
      skipPreprocessing = false
    } = options;

    try {
      // Step 1: Preprocess (resolve refs, expand variables)
      let processedSQL = sql;
      let compilationResult = null;
      
      if (!skipPreprocessing) {
        compilationResult = this.preprocessor.compile(sql);
        processedSQL = compilationResult.compiledSQL;
      }

      // Step 2: Parse to IR
      const ir = this.parser.parse(processedSQL);
      
      if (ir.type === 'ERROR') {
        this.stats.errors.push({
          file: filePath,
          error: ir.errors[0]?.message || 'Parse error'
        });
        return { success: false, error: ir.errors, filePath };
      }

      // Step 3: Extract schema
      const schema = this.extractor.extract(ir, modelName, { layer, description });
      
      // Add compilation metadata
      if (compilationResult) {
        schema.refs = compilationResult.refs;
        schema.sources = compilationResult.sources;
        schema.hasPartialLineage = compilationResult.isPartial;
        schema.originalSQL = sql;
        schema.compiledSQL = processedSQL;
      }

      // Step 4: Add to graph
      this.addModelToGraph(schema, ir);

      this.stats.filesProcessed++;
      this.stats.modelsCreated++;

      return {
        success: true,
        model: schema,
        ir: ir,
        filePath
      };

    } catch (error) {
      this.stats.errors.push({
        file: filePath,
        error: error.message
      });
      return { success: false, error: error.message, filePath };
    }
  }

  /**
   * Ingest multiple SQL files
   * @param {Array} files - Array of { content, path } objects
   * @param {Object} options - Ingestion options
   * @returns {Object} Batch ingestion results
   */
  async ingestBatch(files, options = {}) {
    const results = {
      successful: [],
      failed: [],
      totalFiles: files.length
    };

    // First pass: parse all files and collect model names
    const modelNames = new Set();
    
    for (const file of files) {
      const modelName = this.extractModelName(file.path);
      modelNames.add(modelName.toLowerCase());
    }

    // Second pass: ingest with model name resolution
    for (const file of files) {
      const result = await this.ingestSQL(file.content, file.path, options);
      
      if (result.success) {
        results.successful.push(result);
      } else {
        results.failed.push(result);
      }
    }

    // Third pass: resolve cross-model dependencies
    this.resolveDependencies();

    return results;
  }

  /**
   * Ingest from dbt manifest (uses compiled SQL from manifest)
   * @param {Object} manifest - dbt manifest.json
   * @returns {Object} Ingestion results
   */
  async ingestFromDbtManifest(manifest) {
    // Load manifest for resolution
    this.loadDbtManifest(manifest);
    
    const results = {
      successful: [],
      failed: [],
      totalModels: 0
    };

    // Get all models from manifest
    const models = this.dbtResolver.getAllModels();
    results.totalModels = models.length;

    for (const model of models) {
      // Get compiled SQL
      const compiledSQL = this.dbtResolver.getCompiledSQL(model.name);
      
      if (!compiledSQL) {
        results.failed.push({
          model: model.name,
          error: 'No compiled SQL available'
        });
        continue;
      }

      // Detect layer from path or tags
      let layer = this.detectLayerFromDbtModel(model);

      // Ingest the compiled SQL
      const result = await this.ingestSQL(compiledSQL, model.path || model.name, {
        modelName: model.name,
        layer: layer,
        description: model.description,
        skipPreprocessing: true // Already compiled
      });

      if (result.success) {
        // Add dbt-specific metadata
        result.model.dbtUniqueId = model.uniqueId;
        result.model.dbtTags = model.tags;
        result.model.materializedAs = model.materializedAs;
        
        results.successful.push(result);
      } else {
        results.failed.push({
          model: model.name,
          error: result.error
        });
      }
    }

    // Also ingest sources
    const sources = this.dbtResolver.getAllSources();
    for (const source of sources) {
      this.addSourceToGraph(source);
    }

    // Resolve dependencies using dbt's dependency info
    this.resolveDbtDependencies();

    return results;
  }

  /**
   * Add a model to the graph
   */
  addModelToGraph(schema, ir) {
    // Create model node
    const modelNode = this.graph.addNode(schema.id, NodeType.MODEL, {
      name: schema.name,
      schema: schema.schema,
      database: schema.database,
      description: schema.description,
      layer: schema.layer,
      grainColumns: schema.grainColumns,
      isAggregated: schema.isAggregated,
      filters: schema.filtersNormalized,
      sourceType: schema.sourceType
    });

    // Create column nodes
    for (const col of schema.columns) {
      const colNode = this.graph.addNode(col.id, NodeType.COLUMN, {
        name: col.name,
        modelId: schema.id,
        type: col.type,
        typeConfidence: col.typeConfidence,
        semanticRole: col.semanticRole,
        aggregationType: col.aggregationType,
        nullable: col.nullable,
        isPK: schema.grainColumns?.includes(col.name),
        isFK: col.isFK,
        expressionSQL: col.expressionSQL,
        sourceColumns: col.sourceColumns,
        isComputed: col.isComputed,
        isPassthrough: col.isPassthrough
      });

      // Add PRODUCES edge (model -> column)
      this.graph.addEdge(schema.id, col.id, EdgeType.PRODUCES);
    }

    // Add DEPENDS_ON edges for table dependencies
    for (const dep of schema.dependencies) {
      // Try to find the dependency in the graph
      const depId = this.findModelId(dep);
      if (depId) {
        this.graph.addEdge(schema.id, depId, EdgeType.DEPENDS_ON, {
          dependencyName: dep
        });
      }
    }

    // Add JOINS_ON edges from join metadata
    for (const join of (schema.joinMetadata || [])) {
      if (join.rightTable) {
        const rightId = this.findModelId(join.rightTable);
        if (rightId) {
          this.graph.addEdge(schema.id, rightId, EdgeType.JOINS_ON, {
            joinType: join.type,
            predicate: join.predicate,
            predicateColumns: join.predicateColumns
          });
        }
      }
    }

    return modelNode;
  }

  /**
   * Add a dbt source to the graph
   */
  addSourceToGraph(source) {
    const sourceId = `source_${source.sourceName}_${source.tableName}`;
    
    this.graph.addNode(sourceId, NodeType.SOURCE, {
      name: source.fqn,
      sourceName: source.sourceName,
      tableName: source.tableName,
      schema: source.schema,
      database: source.database,
      description: source.description,
      layer: 'raw'
    });

    // Add columns if available
    for (const col of (source.columns || [])) {
      const colId = `${sourceId}_col_${col.name}`;
      this.graph.addNode(colId, NodeType.COLUMN, {
        name: col.name,
        modelId: sourceId,
        type: col.dataType,
        description: col.description
      });
      
      this.graph.addEdge(sourceId, colId, EdgeType.PRODUCES);
    }

    return sourceId;
  }

  /**
   * Resolve dependencies across all models
   */
  resolveDependencies() {
    const models = this.graph.getNodesByType(NodeType.MODEL);
    
    for (const model of models) {
      // Get columns for this model
      const columns = this.graph.getColumnsForModel(model.id);
      
      for (const col of columns) {
        if (!col.sourceColumns || col.sourceColumns.length === 0) continue;
        
        // Try to resolve each source column
        for (const sourceRef of col.sourceColumns) {
          const resolved = this.resolveColumnReference(sourceRef, model);
          
          if (resolved) {
            // Add DERIVES_FROM edge
            this.graph.addEdge(col.id, resolved.columnId, EdgeType.DERIVES_FROM, {
              sourceRef: sourceRef
            });
          }
        }
      }
    }
  }

  /**
   * Resolve dbt-specific dependencies
   */
  resolveDbtDependencies() {
    if (!this.dbtResolver) return;
    
    const models = this.graph.getNodesByType(NodeType.MODEL);
    
    for (const model of models) {
      if (!model.dbtUniqueId) continue;
      
      // Get upstream dependencies from dbt
      const upstream = this.dbtResolver.getUpstream(model.name, 1);
      
      for (const depId of upstream) {
        // Find the model in our graph
        const depNode = Array.from(this.graph.nodes.values())
          .find(n => n.dbtUniqueId === depId);
        
        if (depNode) {
          this.graph.addEdge(model.id, depNode.id, EdgeType.DEPENDS_ON, {
            source: 'dbt_manifest'
          });
        }
      }
    }
  }

  /**
   * Resolve a column reference to a graph node
   */
  resolveColumnReference(ref, contextModel) {
    // Parse reference (table.column or just column)
    const parts = ref.split('.');
    let tableName, columnName;
    
    if (parts.length >= 2) {
      tableName = parts[parts.length - 2];
      columnName = parts[parts.length - 1];
    } else {
      columnName = parts[0];
    }
    
    // Handle wildcards
    if (columnName === '*') return null;
    
    // Find the source model
    let sourceModelId = null;
    
    if (tableName) {
      sourceModelId = this.findModelId(tableName);
    }
    
    if (!sourceModelId) {
      // Try to find in dependencies of context model
      const deps = this.graph.getEdgesFromSource(contextModel.id, EdgeType.DEPENDS_ON);
      for (const dep of deps) {
        const depModel = this.graph.getNode(dep.target);
        if (depModel) {
          const cols = this.graph.getColumnsForModel(dep.target);
          const matchingCol = cols.find(c => c.name.toLowerCase() === columnName.toLowerCase());
          if (matchingCol) {
            return { modelId: dep.target, columnId: matchingCol.id };
          }
        }
      }
    } else {
      // Find column in the specific model
      const cols = this.graph.getColumnsForModel(sourceModelId);
      const matchingCol = cols.find(c => c.name.toLowerCase() === columnName.toLowerCase());
      if (matchingCol) {
        return { modelId: sourceModelId, columnId: matchingCol.id };
      }
    }
    
    return null;
  }

  /**
   * Find model ID by name
   */
  findModelId(name) {
    const models = this.graph.getNodesByType(NodeType.MODEL);
    const sources = this.graph.getNodesByType(NodeType.SOURCE);
    const allNodes = [...models, ...sources];
    
    const lowerName = name.toLowerCase();
    
    // Try exact match
    let node = allNodes.find(m => m.name.toLowerCase() === lowerName);
    if (node) return node.id;
    
    // Try matching just table name (ignore schema)
    const parts = name.split('.');
    const justTable = parts[parts.length - 1].toLowerCase();
    
    node = allNodes.find(m => {
      const mParts = m.name.split('.');
      return mParts[mParts.length - 1].toLowerCase() === justTable;
    });
    
    return node?.id || null;
  }

  /**
   * Extract model name from file path
   */
  extractModelName(filePath) {
    if (!filePath) return 'unknown';
    
    // Get filename without extension
    const parts = filePath.replace(/\\/g, '/').split('/');
    const filename = parts[parts.length - 1];
    return filename.replace(/\.(sql|py)$/i, '');
  }

  /**
   * Detect layer from file path
   */
  detectLayer(filePath) {
    if (!filePath) return null;
    
    const normalizedPath = filePath.toLowerCase();
    
    for (const [layer, patterns] of Object.entries(LAYER_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(normalizedPath)) {
          return layer;
        }
      }
    }
    
    return null;
  }

  /**
   * Detect layer from dbt model metadata
   */
  detectLayerFromDbtModel(model) {
    // Check tags first
    if (model.tags) {
      for (const tag of model.tags) {
        const lowerTag = tag.toLowerCase();
        if (LAYER_PATTERNS[lowerTag]) {
          return lowerTag;
        }
      }
    }
    
    // Check path
    if (model.path) {
      return this.detectLayer(model.path);
    }
    
    // Check schema name
    if (model.schema) {
      const lowerSchema = model.schema.toLowerCase();
      for (const layer of Object.keys(LAYER_PATTERNS)) {
        if (lowerSchema.includes(layer)) {
          return layer;
        }
      }
    }
    
    return null;
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      ...this.stats,
      graphStats: this.graph.getStats()
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      filesProcessed: 0,
      modelsCreated: 0,
      relationshipsInferred: 0,
      errors: [],
      warnings: []
    };
  }

  /**
   * Get the metadata graph
   */
  getGraph() {
    return this.graph;
  }
}

export default IngestionService;
