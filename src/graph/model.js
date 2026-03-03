/**
 * Metadata Graph Model
 * 
 * Defines node and edge types for the metadata graph.
 * Provides graph operations for lineage, relationships, and pathfinding.
 */

/**
 * Node types in the metadata graph
 */
export const NodeType = {
  MODEL: 'model',       // Table, view, or dbt model
  COLUMN: 'column',     // Individual column
  EXPRESSION: 'expr',   // Complex calculation/expression
  DATASET: 'dataset',   // Grouping concept (domain)
  SOURCE: 'source'      // External data source
};

/**
 * Edge types in the metadata graph
 */
export const EdgeType = {
  // Model-level relationships
  DEPENDS_ON: 'depends_on',           // Model -> upstream model (data lineage)
  
  // Column-level relationships
  PRODUCES: 'produces',               // Model -> column (ownership)
  DERIVES_FROM: 'derives_from',       // Column -> source column(s) (column lineage)
  
  // Schema relationships
  JOINS_ON: 'joins_on',               // Model -> Model (with join predicate)
  FOREIGN_KEY: 'foreign_key',         // Column -> Column (FK relationship)
  PRIMARY_KEY: 'primary_key',         // Column -> Model (PK designation)
  
  // Semantic relationships
  SAME_AS: 'same_as',                 // Column equivalence across models
  AGGREGATES: 'aggregates',           // Measure -> dimension grain
  BELONGS_TO: 'belongs_to'            // Model -> Dataset (domain grouping)
};

/**
 * Confidence levels for inferred relationships
 */
export const Confidence = {
  EXPLICIT: 1.0,        // From explicit DDL constraint
  PROFILED: 0.85,       // Validated by data profiling
  JOIN_USAGE: 0.7,      // Observed in SQL joins
  NAMING: 0.4,          // Inferred from naming conventions
  GUESS: 0.2            // Low-confidence heuristic
};

/**
 * Metadata Graph class
 * In-memory graph with indexing for fast queries
 */
export class MetadataGraph {
  constructor() {
    // Primary storage
    this.nodes = new Map();     // id -> node
    this.edges = [];            // Array of edge objects
    
    // Indexes for fast lookup
    this.indexes = {
      nodesByType: new Map(),           // type -> Set<id>
      nodesByModel: new Map(),          // modelId -> Set<columnId>
      edgesBySource: new Map(),         // sourceId -> Array<edge>
      edgesByTarget: new Map(),         // targetId -> Array<edge>
      edgesByType: new Map(),           // type -> Array<edge>
      edgesBySourceAndType: new Map()   // `${sourceId}:${type}` -> Array<edge>
    };
    
    // Metadata
    this.version = 1;
    this.lastModified = null;
  }

  // ==================== NODE OPERATIONS ====================

  /**
   * Add a node to the graph
   * @param {string} id - Unique node identifier
   * @param {string} type - Node type from NodeType enum
   * @param {Object} data - Node data/properties
   * @returns {Object} The created node
   */
  addNode(id, type, data = {}) {
    const node = {
      id,
      type,
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.nodes.set(id, node);
    this.indexNode(node);
    this.lastModified = new Date().toISOString();
    
    return node;
  }

  /**
   * Update an existing node
   * @param {string} id - Node identifier
   * @param {Object} data - Properties to update
   * @returns {Object|null} Updated node or null if not found
   */
  updateNode(id, data) {
    const node = this.nodes.get(id);
    if (!node) return null;
    
    // Remove from indexes before update
    this.unindexNode(node);
    
    // Update properties
    Object.assign(node, data, {
      updatedAt: new Date().toISOString()
    });
    
    // Re-index
    this.indexNode(node);
    this.lastModified = new Date().toISOString();
    
    return node;
  }

  /**
   * Remove a node and its connected edges
   * @param {string} id - Node identifier
   * @returns {boolean} True if removed
   */
  removeNode(id) {
    const node = this.nodes.get(id);
    if (!node) return false;
    
    // Remove connected edges
    this.edges = this.edges.filter(edge => {
      if (edge.source === id || edge.target === id) {
        this.unindexEdge(edge);
        return false;
      }
      return true;
    });
    
    // Remove node
    this.unindexNode(node);
    this.nodes.delete(id);
    this.lastModified = new Date().toISOString();
    
    return true;
  }

  /**
   * Get a node by ID
   * @param {string} id - Node identifier
   * @returns {Object|null} Node or null
   */
  getNode(id) {
    return this.nodes.get(id) || null;
  }

  /**
   * Get all nodes of a specific type
   * @param {string} type - Node type
   * @returns {Array} Array of nodes
   */
  getNodesByType(type) {
    const ids = this.indexes.nodesByType.get(type) || new Set();
    return Array.from(ids).map(id => this.nodes.get(id)).filter(Boolean);
  }

  /**
   * Get all columns for a model
   * @param {string} modelId - Model node ID
   * @returns {Array} Array of column nodes
   */
  getColumnsForModel(modelId) {
    const ids = this.indexes.nodesByModel.get(modelId) || new Set();
    return Array.from(ids).map(id => this.nodes.get(id)).filter(Boolean);
  }

  // ==================== EDGE OPERATIONS ====================

  /**
   * Add an edge to the graph
   * @param {string} sourceId - Source node ID
   * @param {string} targetId - Target node ID
   * @param {string} type - Edge type from EdgeType enum
   * @param {Object} data - Edge data/properties
   * @returns {Object} The created edge
   */
  addEdge(sourceId, targetId, type, data = {}) {
    const edge = {
      id: `${sourceId}->${targetId}:${type}`,
      source: sourceId,
      target: targetId,
      type,
      ...data,
      createdAt: new Date().toISOString()
    };
    
    // Check for duplicate
    const existing = this.edges.find(e => e.id === edge.id);
    if (existing) {
      // Update existing edge
      Object.assign(existing, data, { updatedAt: new Date().toISOString() });
      return existing;
    }
    
    this.edges.push(edge);
    this.indexEdge(edge);
    this.lastModified = new Date().toISOString();
    
    return edge;
  }

  /**
   * Remove an edge
   * @param {string} edgeId - Edge identifier
   * @returns {boolean} True if removed
   */
  removeEdge(edgeId) {
    const index = this.edges.findIndex(e => e.id === edgeId);
    if (index === -1) return false;
    
    const edge = this.edges[index];
    this.unindexEdge(edge);
    this.edges.splice(index, 1);
    this.lastModified = new Date().toISOString();
    
    return true;
  }

  /**
   * Get edges from a source node
   * @param {string} sourceId - Source node ID
   * @param {string} type - Optional edge type filter
   * @returns {Array} Array of edges
   */
  getEdgesFromSource(sourceId, type = null) {
    if (type) {
      const key = `${sourceId}:${type}`;
      return this.indexes.edgesBySourceAndType.get(key) || [];
    }
    return this.indexes.edgesBySource.get(sourceId) || [];
  }

  /**
   * Get edges to a target node
   * @param {string} targetId - Target node ID
   * @param {string} type - Optional edge type filter
   * @returns {Array} Array of edges
   */
  getEdgesToTarget(targetId, type = null) {
    const edges = this.indexes.edgesByTarget.get(targetId) || [];
    if (type) {
      return edges.filter(e => e.type === type);
    }
    return edges;
  }

  /**
   * Get all edges of a specific type
   * @param {string} type - Edge type
   * @returns {Array} Array of edges
   */
  getEdgesByType(type) {
    return this.indexes.edgesByType.get(type) || [];
  }

  // ==================== LINEAGE QUERIES ====================

  /**
   * Get upstream nodes (dependencies)
   * @param {string} nodeId - Starting node ID
   * @param {number} depth - Maximum traversal depth
   * @param {Array} edgeTypes - Edge types to follow
   * @returns {Array} Array of upstream nodes with depth info
   */
  getUpstream(nodeId, depth = Infinity, edgeTypes = [EdgeType.DEPENDS_ON, EdgeType.DERIVES_FROM]) {
    const result = [];
    const visited = new Set();
    const queue = [{ id: nodeId, currentDepth: 0 }];
    
    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift();
      
      if (visited.has(id) || currentDepth > depth) continue;
      visited.add(id);
      
      // Get edges where this node is the source (depends on target)
      const edges = this.getEdgesFromSource(id);
      
      for (const edge of edges) {
        if (!edgeTypes.includes(edge.type)) continue;
        
        const targetNode = this.getNode(edge.target);
        if (targetNode && !visited.has(edge.target)) {
          result.push({
            node: targetNode,
            edge: edge,
            depth: currentDepth + 1
          });
          queue.push({ id: edge.target, currentDepth: currentDepth + 1 });
        }
      }
    }
    
    return result;
  }

  /**
   * Get downstream nodes (dependents)
   * @param {string} nodeId - Starting node ID
   * @param {number} depth - Maximum traversal depth
   * @param {Array} edgeTypes - Edge types to follow
   * @returns {Array} Array of downstream nodes with depth info
   */
  getDownstream(nodeId, depth = Infinity, edgeTypes = [EdgeType.DEPENDS_ON, EdgeType.DERIVES_FROM]) {
    const result = [];
    const visited = new Set();
    const queue = [{ id: nodeId, currentDepth: 0 }];
    
    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift();
      
      if (visited.has(id) || currentDepth > depth) continue;
      visited.add(id);
      
      // Get edges where this node is the target (source depends on this)
      const edges = this.getEdgesToTarget(id);
      
      for (const edge of edges) {
        if (!edgeTypes.includes(edge.type)) continue;
        
        const sourceNode = this.getNode(edge.source);
        if (sourceNode && !visited.has(edge.source)) {
          result.push({
            node: sourceNode,
            edge: edge,
            depth: currentDepth + 1
          });
          queue.push({ id: edge.source, currentDepth: currentDepth + 1 });
        }
      }
    }
    
    return result;
  }

  /**
   * Get column-level lineage for a specific column
   * @param {string} columnId - Column node ID
   * @returns {Object} Lineage tree
   */
  getColumnLineage(columnId) {
    const column = this.getNode(columnId);
    if (!column) return null;
    
    const lineage = {
      column: column,
      sources: []
    };
    
    // Get DERIVES_FROM edges
    const derivesFrom = this.getEdgesFromSource(columnId, EdgeType.DERIVES_FROM);
    
    for (const edge of derivesFrom) {
      const sourceColumn = this.getNode(edge.target);
      if (sourceColumn) {
        // Recursively get lineage
        const sourceLineage = this.getColumnLineage(edge.target);
        lineage.sources.push({
          column: sourceColumn,
          edge: edge,
          upstream: sourceLineage?.sources || []
        });
      }
    }
    
    return lineage;
  }

  // ==================== RELATIONSHIP QUERIES ====================

  /**
   * Find join path between two models
   * @param {string} fromModelId - Source model ID
   * @param {string} toModelId - Target model ID
   * @param {number} maxHops - Maximum number of joins
   * @returns {Array} Array of possible paths
   */
  findJoinPath(fromModelId, toModelId, maxHops = 5) {
    const paths = [];
    const visited = new Set();
    
    const dfs = (currentId, path, hops) => {
      if (hops > maxHops) return;
      if (currentId === toModelId) {
        paths.push([...path]);
        return;
      }
      if (visited.has(currentId)) return;
      
      visited.add(currentId);
      
      // Get JOINS_ON and FOREIGN_KEY edges
      const joinEdges = [
        ...this.getEdgesFromSource(currentId, EdgeType.JOINS_ON),
        ...this.getEdgesToTarget(currentId, EdgeType.JOINS_ON),
        ...this.getEdgesFromSource(currentId, EdgeType.FOREIGN_KEY),
        ...this.getEdgesToTarget(currentId, EdgeType.FOREIGN_KEY)
      ];
      
      for (const edge of joinEdges) {
        const nextId = edge.source === currentId ? edge.target : edge.source;
        const nextNode = this.getNode(nextId);
        
        if (nextNode && nextNode.type === NodeType.MODEL) {
          path.push({ edge, node: nextNode });
          dfs(nextId, path, hops + 1);
          path.pop();
        }
      }
      
      visited.delete(currentId);
    };
    
    dfs(fromModelId, [], 0);
    
    // Sort by path length and confidence
    return paths.sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      const aConf = a.reduce((sum, p) => sum + (p.edge.confidence || 0.5), 0) / a.length;
      const bConf = b.reduce((sum, p) => sum + (p.edge.confidence || 0.5), 0) / b.length;
      return bConf - aConf;
    });
  }

  /**
   * Get all relationships for a model
   * @param {string} modelId - Model node ID
   * @returns {Object} Relationships grouped by type
   */
  getModelRelationships(modelId) {
    const relationships = {
      joins: [],
      foreignKeys: [],
      dependencies: [],
      dependents: []
    };
    
    // Joins
    const joinEdges = [
      ...this.getEdgesFromSource(modelId, EdgeType.JOINS_ON),
      ...this.getEdgesToTarget(modelId, EdgeType.JOINS_ON)
    ];
    
    for (const edge of joinEdges) {
      const otherId = edge.source === modelId ? edge.target : edge.source;
      const otherNode = this.getNode(otherId);
      if (otherNode) {
        relationships.joins.push({ edge, model: otherNode });
      }
    }
    
    // Foreign keys (from columns of this model)
    const columns = this.getColumnsForModel(modelId);
    for (const col of columns) {
      const fkEdges = this.getEdgesFromSource(col.id, EdgeType.FOREIGN_KEY);
      for (const edge of fkEdges) {
        const targetCol = this.getNode(edge.target);
        if (targetCol) {
          relationships.foreignKeys.push({
            edge,
            fromColumn: col,
            toColumn: targetCol
          });
        }
      }
    }
    
    // Dependencies
    const depEdges = this.getEdgesFromSource(modelId, EdgeType.DEPENDS_ON);
    for (const edge of depEdges) {
      const depNode = this.getNode(edge.target);
      if (depNode) {
        relationships.dependencies.push({ edge, model: depNode });
      }
    }
    
    // Dependents
    const dependentEdges = this.getEdgesToTarget(modelId, EdgeType.DEPENDS_ON);
    for (const edge of dependentEdges) {
      const depNode = this.getNode(edge.source);
      if (depNode) {
        relationships.dependents.push({ edge, model: depNode });
      }
    }
    
    return relationships;
  }

  // ==================== INDEXING ====================

  /**
   * Index a node for fast lookup
   */
  indexNode(node) {
    // By type
    if (!this.indexes.nodesByType.has(node.type)) {
      this.indexes.nodesByType.set(node.type, new Set());
    }
    this.indexes.nodesByType.get(node.type).add(node.id);
    
    // Columns by model
    if (node.type === NodeType.COLUMN && node.modelId) {
      if (!this.indexes.nodesByModel.has(node.modelId)) {
        this.indexes.nodesByModel.set(node.modelId, new Set());
      }
      this.indexes.nodesByModel.get(node.modelId).add(node.id);
    }
  }

  /**
   * Remove node from indexes
   */
  unindexNode(node) {
    // By type
    const typeSet = this.indexes.nodesByType.get(node.type);
    if (typeSet) typeSet.delete(node.id);
    
    // Columns by model
    if (node.type === NodeType.COLUMN && node.modelId) {
      const modelSet = this.indexes.nodesByModel.get(node.modelId);
      if (modelSet) modelSet.delete(node.id);
    }
  }

  /**
   * Index an edge for fast lookup
   */
  indexEdge(edge) {
    // By source
    if (!this.indexes.edgesBySource.has(edge.source)) {
      this.indexes.edgesBySource.set(edge.source, []);
    }
    this.indexes.edgesBySource.get(edge.source).push(edge);
    
    // By target
    if (!this.indexes.edgesByTarget.has(edge.target)) {
      this.indexes.edgesByTarget.set(edge.target, []);
    }
    this.indexes.edgesByTarget.get(edge.target).push(edge);
    
    // By type
    if (!this.indexes.edgesByType.has(edge.type)) {
      this.indexes.edgesByType.set(edge.type, []);
    }
    this.indexes.edgesByType.get(edge.type).push(edge);
    
    // By source and type
    const key = `${edge.source}:${edge.type}`;
    if (!this.indexes.edgesBySourceAndType.has(key)) {
      this.indexes.edgesBySourceAndType.set(key, []);
    }
    this.indexes.edgesBySourceAndType.get(key).push(edge);
  }

  /**
   * Remove edge from indexes
   */
  unindexEdge(edge) {
    // By source
    const sourceEdges = this.indexes.edgesBySource.get(edge.source);
    if (sourceEdges) {
      const idx = sourceEdges.findIndex(e => e.id === edge.id);
      if (idx !== -1) sourceEdges.splice(idx, 1);
    }
    
    // By target
    const targetEdges = this.indexes.edgesByTarget.get(edge.target);
    if (targetEdges) {
      const idx = targetEdges.findIndex(e => e.id === edge.id);
      if (idx !== -1) targetEdges.splice(idx, 1);
    }
    
    // By type
    const typeEdges = this.indexes.edgesByType.get(edge.type);
    if (typeEdges) {
      const idx = typeEdges.findIndex(e => e.id === edge.id);
      if (idx !== -1) typeEdges.splice(idx, 1);
    }
    
    // By source and type
    const key = `${edge.source}:${edge.type}`;
    const sourceTypeEdges = this.indexes.edgesBySourceAndType.get(key);
    if (sourceTypeEdges) {
      const idx = sourceTypeEdges.findIndex(e => e.id === edge.id);
      if (idx !== -1) sourceTypeEdges.splice(idx, 1);
    }
  }

  // ==================== SERIALIZATION ====================

  /**
   * Export graph to JSON
   * @returns {Object} Serializable graph data
   */
  toJSON() {
    return {
      version: this.version,
      lastModified: this.lastModified,
      nodes: Array.from(this.nodes.values()),
      edges: this.edges
    };
  }

  /**
   * Import graph from JSON
   * @param {Object} data - Graph data from toJSON()
   */
  fromJSON(data) {
    this.clear();
    
    this.version = data.version || 1;
    this.lastModified = data.lastModified;
    
    // Add nodes
    for (const node of (data.nodes || [])) {
      this.nodes.set(node.id, node);
      this.indexNode(node);
    }
    
    // Add edges
    for (const edge of (data.edges || [])) {
      this.edges.push(edge);
      this.indexEdge(edge);
    }
  }

  /**
   * Clear all data
   */
  clear() {
    this.nodes.clear();
    this.edges = [];
    
    for (const index of Object.values(this.indexes)) {
      if (index instanceof Map) {
        index.clear();
      }
    }
    
    this.lastModified = new Date().toISOString();
  }

  // ==================== STATISTICS ====================

  /**
   * Get graph statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const nodesByType = {};
    for (const [type, ids] of this.indexes.nodesByType) {
      nodesByType[type] = ids.size;
    }
    
    const edgesByType = {};
    for (const [type, edges] of this.indexes.edgesByType) {
      edgesByType[type] = edges.length;
    }
    
    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.length,
      nodesByType,
      edgesByType,
      lastModified: this.lastModified
    };
  }
}

export default MetadataGraph;
