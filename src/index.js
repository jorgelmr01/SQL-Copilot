/**
 * SQL Copilot v2 - Main Entry Point
 * 
 * Expert-grade ERD & SQL Library with compiler-style metadata extraction.
 * 
 * This module exports the core API for:
 * - SQL parsing and schema extraction
 * - dbt manifest integration
 * - Metadata graph management
 * - Relationship inference
 * - Join path finding
 */

// Core modules
export { SQLParser, renderExpression, IRNodeType, ExprType, JoinType } from './core/parser/sql-parser.js';
export { DbtResolver, SQLPreprocessor } from './core/compiler/dbt-resolver.js';
export { SchemaExtractor, SemanticRole, AggregationType } from './core/analyzer/schema-extractor.js';

// Graph modules
export { MetadataGraph, NodeType, EdgeType, Confidence } from './graph/model.js';
export { JoinPathFinder, JoinPath, QueryTemplateGenerator } from './graph/pathfinder.js';

// Storage
export { GraphStore, ArtifactStore } from './storage/graph-store.js';

// Services
export { IngestionService } from './services/ingestion.js';
export { 
  RelationshipInferenceEngine,
  RelationshipCandidate,
  ExplicitConstraintStrategy,
  JoinUsageStrategy,
  NamingConventionStrategy
} from './services/inference/relationship-inference.js';

/**
 * SQLCopilot - Main facade class
 * Provides a simplified API for common operations
 */
export class SQLCopilot {
  constructor(options = {}) {
    this.dialect = options.dialect || 'presto';
    
    // Initialize components lazily
    this._graph = null;
    this._store = null;
    this._ingestion = null;
    this._inference = null;
    this._pathFinder = null;
  }

  /**
   * Get the metadata graph (lazy initialization)
   */
  get graph() {
    if (!this._graph) {
      const { MetadataGraph } = require('./graph/model.js');
      this._graph = new MetadataGraph();
    }
    return this._graph;
  }

  /**
   * Get the graph store (lazy initialization)
   */
  get store() {
    if (!this._store) {
      const { GraphStore } = require('./storage/graph-store.js');
      this._store = new GraphStore();
    }
    return this._store;
  }

  /**
   * Get the ingestion service (lazy initialization)
   */
  get ingestion() {
    if (!this._ingestion) {
      const { IngestionService } = require('./services/ingestion.js');
      this._ingestion = new IngestionService({
        dialect: this.dialect,
        graph: this.graph
      });
    }
    return this._ingestion;
  }

  /**
   * Get the inference engine (lazy initialization)
   */
  get inference() {
    if (!this._inference) {
      const { RelationshipInferenceEngine } = require('./services/inference/relationship-inference.js');
      this._inference = new RelationshipInferenceEngine(this.graph);
    }
    return this._inference;
  }

  /**
   * Get the path finder (lazy initialization)
   */
  get pathFinder() {
    if (!this._pathFinder) {
      const { JoinPathFinder } = require('./graph/pathfinder.js');
      this._pathFinder = new JoinPathFinder(this.graph);
    }
    return this._pathFinder;
  }

  /**
   * Initialize the system (load from storage)
   */
  async init() {
    await this.store.init();
    
    // Load graph from storage
    const data = await this.store.loadGraph();
    if (data.nodes.length > 0 || data.edges.length > 0) {
      this.graph.fromJSON(data);
    }
    
    return this;
  }

  /**
   * Save current state to storage
   */
  async save() {
    await this.store.saveGraph(this.graph.toJSON());
  }

  /**
   * Ingest a SQL file
   * @param {string} sql - SQL content
   * @param {string} path - File path
   * @param {Object} options - Options
   */
  async ingestSQL(sql, path, options = {}) {
    return this.ingestion.ingestSQL(sql, path, options);
  }

  /**
   * Ingest multiple SQL files
   * @param {Array} files - Array of { content, path }
   */
  async ingestBatch(files) {
    return this.ingestion.ingestBatch(files);
  }

  /**
   * Load and process a dbt manifest
   * @param {Object} manifest - dbt manifest.json content
   */
  async loadDbtManifest(manifest) {
    return this.ingestion.ingestFromDbtManifest(manifest);
  }

  /**
   * Infer relationships between tables
   */
  async inferRelationships() {
    const models = this.graph.getNodesByType('model');
    const candidates = await this.inference.inferRelationships(models);
    
    // Add high-confidence relationships to graph
    for (const candidate of candidates) {
      if (candidate.confidence >= 0.5) {
        this.graph.addEdge(
          `${candidate.from.table}.${candidate.from.column}`,
          `${candidate.to.table}.${candidate.to.column}`,
          candidate.type,
          {
            confidence: candidate.confidence,
            explanation: candidate.explanation,
            signals: candidate.signals.map(s => s.strategy)
          }
        );
      }
    }
    
    return candidates;
  }

  /**
   * Find join path between two tables
   * @param {string} fromTable - Source table
   * @param {string} toTable - Target table
   */
  findJoinPath(fromTable, toTable, options = {}) {
    return this.pathFinder.findPaths(fromTable, toTable, options);
  }

  /**
   * Get SQL skeleton for joining tables
   * @param {string} fromTable - Source table
   * @param {string} toTable - Target table
   */
  getJoinSQL(fromTable, toTable, options = {}) {
    const paths = this.findJoinPath(fromTable, toTable, options);
    if (paths.length === 0) return null;
    return paths[0].toSQL(options.joinType || 'LEFT', options);
  }

  /**
   * Get all tables in the graph
   */
  getTables() {
    return this.graph.getNodesByType('model');
  }

  /**
   * Get columns for a table
   * @param {string} tableName - Table name
   */
  getColumns(tableName) {
    const model = this.graph.getNodesByType('model')
      .find(m => m.name.toLowerCase() === tableName.toLowerCase());
    
    if (!model) return [];
    return this.graph.getColumnsForModel(model.id);
  }

  /**
   * Get upstream lineage for a table
   * @param {string} tableName - Table name
   * @param {number} depth - Max depth
   */
  getUpstream(tableName, depth = 3) {
    const model = this.graph.getNodesByType('model')
      .find(m => m.name.toLowerCase() === tableName.toLowerCase());
    
    if (!model) return [];
    return this.graph.getUpstream(model.id, depth);
  }

  /**
   * Get downstream dependents for a table
   * @param {string} tableName - Table name
   * @param {number} depth - Max depth
   */
  getDownstream(tableName, depth = 3) {
    const model = this.graph.getNodesByType('model')
      .find(m => m.name.toLowerCase() === tableName.toLowerCase());
    
    if (!model) return [];
    return this.graph.getDownstream(model.id, depth);
  }

  /**
   * Get column-level lineage
   * @param {string} tableName - Table name
   * @param {string} columnName - Column name
   */
  getColumnLineage(tableName, columnName) {
    const model = this.graph.getNodesByType('model')
      .find(m => m.name.toLowerCase() === tableName.toLowerCase());
    
    if (!model) return null;
    
    const columns = this.graph.getColumnsForModel(model.id);
    const column = columns.find(c => c.name.toLowerCase() === columnName.toLowerCase());
    
    if (!column) return null;
    return this.graph.getColumnLineage(column.id);
  }

  /**
   * Get graph statistics
   */
  getStats() {
    return this.graph.getStats();
  }

  /**
   * Clear all data
   */
  async clear() {
    this.graph.clear();
    await this.store.clearAll();
  }

  /**
   * Export graph to JSON
   */
  exportJSON() {
    return this.graph.toJSON();
  }

  /**
   * Import graph from JSON
   */
  importJSON(data) {
    this.graph.fromJSON(data);
  }
}

// Default export
export default SQLCopilot;
