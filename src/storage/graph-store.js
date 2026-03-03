/**
 * Graph Store
 * 
 * IndexedDB-based persistent storage for the metadata graph.
 * Provides efficient querying with indexes.
 */

const DB_NAME = 'SQLCopilotGraphDB';
const DB_VERSION = 2;

/**
 * Store names
 */
const Stores = {
  NODES: 'nodes',
  EDGES: 'edges',
  ARTIFACTS: 'artifacts',
  METADATA: 'metadata'
};

/**
 * GraphStore class
 * Handles persistence of the metadata graph to IndexedDB
 */
export class GraphStore {
  constructor() {
    this.db = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the database
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) return;
    
    this.db = await this.openDB();
    this.isInitialized = true;
  }

  /**
   * Open or create the IndexedDB database
   * @returns {Promise<IDBDatabase>}
   */
  openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };
      
      request.onsuccess = () => {
        resolve(request.result);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Nodes store
        if (!db.objectStoreNames.contains(Stores.NODES)) {
          const nodesStore = db.createObjectStore(Stores.NODES, { keyPath: 'id' });
          nodesStore.createIndex('by_type', 'type', { unique: false });
          nodesStore.createIndex('by_model', 'modelId', { unique: false });
          nodesStore.createIndex('by_layer', 'layer', { unique: false });
          nodesStore.createIndex('by_name', 'name', { unique: false });
        }
        
        // Edges store
        if (!db.objectStoreNames.contains(Stores.EDGES)) {
          const edgesStore = db.createObjectStore(Stores.EDGES, { keyPath: 'id' });
          edgesStore.createIndex('by_source', 'source', { unique: false });
          edgesStore.createIndex('by_target', 'target', { unique: false });
          edgesStore.createIndex('by_type', 'type', { unique: false });
          edgesStore.createIndex('by_source_type', ['source', 'type'], { unique: false });
        }
        
        // Artifacts store (ASTs, compiled SQL, hashes)
        if (!db.objectStoreNames.contains(Stores.ARTIFACTS)) {
          const artifactsStore = db.createObjectStore(Stores.ARTIFACTS, { keyPath: 'hash' });
          artifactsStore.createIndex('by_model', 'modelId', { unique: false });
          artifactsStore.createIndex('by_type', 'artifactType', { unique: false });
        }
        
        // Metadata store (settings, version info)
        if (!db.objectStoreNames.contains(Stores.METADATA)) {
          db.createObjectStore(Stores.METADATA, { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Ensure database is initialized
   */
  async ensureInit() {
    if (!this.isInitialized) {
      await this.init();
    }
  }

  // ==================== NODE OPERATIONS ====================

  /**
   * Save a node
   * @param {Object} node - Node to save
   * @returns {Promise<void>}
   */
  async saveNode(node) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.NODES, 'readwrite');
      const store = tx.objectStore(Stores.NODES);
      
      const request = store.put(node);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save multiple nodes in a batch
   * @param {Array} nodes - Nodes to save
   * @returns {Promise<void>}
   */
  async batchSaveNodes(nodes) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.NODES, 'readwrite');
      const store = tx.objectStore(Stores.NODES);
      
      let completed = 0;
      let hasError = false;
      
      for (const node of nodes) {
        const request = store.put(node);
        request.onsuccess = () => {
          completed++;
          if (completed === nodes.length && !hasError) {
            resolve();
          }
        };
        request.onerror = () => {
          if (!hasError) {
            hasError = true;
            reject(request.error);
          }
        };
      }
      
      if (nodes.length === 0) resolve();
    });
  }

  /**
   * Get a node by ID
   * @param {string} id - Node ID
   * @returns {Promise<Object|null>}
   */
  async getNode(id) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.NODES, 'readonly');
      const store = tx.objectStore(Stores.NODES);
      
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all nodes
   * @returns {Promise<Array>}
   */
  async getAllNodes() {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.NODES, 'readonly');
      const store = tx.objectStore(Stores.NODES);
      
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get nodes by type
   * @param {string} type - Node type
   * @returns {Promise<Array>}
   */
  async getNodesByType(type) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.NODES, 'readonly');
      const store = tx.objectStore(Stores.NODES);
      const index = store.index('by_type');
      
      const request = index.getAll(type);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get nodes by model ID (for columns)
   * @param {string} modelId - Model ID
   * @returns {Promise<Array>}
   */
  async getNodesByModel(modelId) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.NODES, 'readonly');
      const store = tx.objectStore(Stores.NODES);
      const index = store.index('by_model');
      
      const request = index.getAll(modelId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a node
   * @param {string} id - Node ID
   * @returns {Promise<void>}
   */
  async deleteNode(id) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.NODES, 'readwrite');
      const store = tx.objectStore(Stores.NODES);
      
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== EDGE OPERATIONS ====================

  /**
   * Save an edge
   * @param {Object} edge - Edge to save
   * @returns {Promise<void>}
   */
  async saveEdge(edge) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.EDGES, 'readwrite');
      const store = tx.objectStore(Stores.EDGES);
      
      const request = store.put(edge);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save multiple edges in a batch
   * @param {Array} edges - Edges to save
   * @returns {Promise<void>}
   */
  async batchSaveEdges(edges) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.EDGES, 'readwrite');
      const store = tx.objectStore(Stores.EDGES);
      
      let completed = 0;
      let hasError = false;
      
      for (const edge of edges) {
        const request = store.put(edge);
        request.onsuccess = () => {
          completed++;
          if (completed === edges.length && !hasError) {
            resolve();
          }
        };
        request.onerror = () => {
          if (!hasError) {
            hasError = true;
            reject(request.error);
          }
        };
      }
      
      if (edges.length === 0) resolve();
    });
  }

  /**
   * Get all edges
   * @returns {Promise<Array>}
   */
  async getAllEdges() {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.EDGES, 'readonly');
      const store = tx.objectStore(Stores.EDGES);
      
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get edges by source
   * @param {string} sourceId - Source node ID
   * @returns {Promise<Array>}
   */
  async getEdgesBySource(sourceId) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.EDGES, 'readonly');
      const store = tx.objectStore(Stores.EDGES);
      const index = store.index('by_source');
      
      const request = index.getAll(sourceId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get edges by target
   * @param {string} targetId - Target node ID
   * @returns {Promise<Array>}
   */
  async getEdgesByTarget(targetId) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.EDGES, 'readonly');
      const store = tx.objectStore(Stores.EDGES);
      const index = store.index('by_target');
      
      const request = index.getAll(targetId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get edges by type
   * @param {string} type - Edge type
   * @returns {Promise<Array>}
   */
  async getEdgesByType(type) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.EDGES, 'readonly');
      const store = tx.objectStore(Stores.EDGES);
      const index = store.index('by_type');
      
      const request = index.getAll(type);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete an edge
   * @param {string} id - Edge ID
   * @returns {Promise<void>}
   */
  async deleteEdge(id) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.EDGES, 'readwrite');
      const store = tx.objectStore(Stores.EDGES);
      
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete edges by source
   * @param {string} sourceId - Source node ID
   * @returns {Promise<number>} Number of deleted edges
   */
  async deleteEdgesBySource(sourceId) {
    await this.ensureInit();
    
    const edges = await this.getEdgesBySource(sourceId);
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.EDGES, 'readwrite');
      const store = tx.objectStore(Stores.EDGES);
      
      let deleted = 0;
      let hasError = false;
      
      for (const edge of edges) {
        const request = store.delete(edge.id);
        request.onsuccess = () => {
          deleted++;
          if (deleted === edges.length && !hasError) {
            resolve(deleted);
          }
        };
        request.onerror = () => {
          if (!hasError) {
            hasError = true;
            reject(request.error);
          }
        };
      }
      
      if (edges.length === 0) resolve(0);
    });
  }

  // ==================== ARTIFACT OPERATIONS ====================

  /**
   * Save an artifact (AST, compiled SQL, etc.)
   * @param {Object} artifact - Artifact to save
   * @returns {Promise<void>}
   */
  async saveArtifact(artifact) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.ARTIFACTS, 'readwrite');
      const store = tx.objectStore(Stores.ARTIFACTS);
      
      const request = store.put(artifact);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get an artifact by hash
   * @param {string} hash - Content hash
   * @returns {Promise<Object|null>}
   */
  async getArtifact(hash) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.ARTIFACTS, 'readonly');
      const store = tx.objectStore(Stores.ARTIFACTS);
      
      const request = store.get(hash);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get artifacts by model
   * @param {string} modelId - Model ID
   * @returns {Promise<Array>}
   */
  async getArtifactsByModel(modelId) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.ARTIFACTS, 'readonly');
      const store = tx.objectStore(Stores.ARTIFACTS);
      const index = store.index('by_model');
      
      const request = index.getAll(modelId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== METADATA OPERATIONS ====================

  /**
   * Save metadata
   * @param {string} key - Metadata key
   * @param {*} value - Metadata value
   * @returns {Promise<void>}
   */
  async setMetadata(key, value) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.METADATA, 'readwrite');
      const store = tx.objectStore(Stores.METADATA);
      
      const request = store.put({ key, value, updatedAt: new Date().toISOString() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get metadata
   * @param {string} key - Metadata key
   * @returns {Promise<*>}
   */
  async getMetadata(key) {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(Stores.METADATA, 'readonly');
      const store = tx.objectStore(Stores.METADATA);
      
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== BULK OPERATIONS ====================

  /**
   * Load entire graph from storage
   * @returns {Promise<Object>} Graph data
   */
  async loadGraph() {
    await this.ensureInit();
    
    const [nodes, edges] = await Promise.all([
      this.getAllNodes(),
      this.getAllEdges()
    ]);
    
    return { nodes, edges };
  }

  /**
   * Save entire graph to storage
   * @param {Object} graph - Graph with nodes and edges arrays
   * @returns {Promise<void>}
   */
  async saveGraph(graph) {
    await this.ensureInit();
    
    // Clear existing data
    await this.clearAll();
    
    // Save nodes and edges
    await Promise.all([
      this.batchSaveNodes(graph.nodes || []),
      this.batchSaveEdges(graph.edges || [])
    ]);
    
    // Save metadata
    await this.setMetadata('lastSaved', new Date().toISOString());
  }

  /**
   * Clear all data
   * @returns {Promise<void>}
   */
  async clearAll() {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        [Stores.NODES, Stores.EDGES, Stores.ARTIFACTS],
        'readwrite'
      );
      
      tx.objectStore(Stores.NODES).clear();
      tx.objectStore(Stores.EDGES).clear();
      tx.objectStore(Stores.ARTIFACTS).clear();
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get storage statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    await this.ensureInit();
    
    const [nodes, edges, lastSaved] = await Promise.all([
      this.getAllNodes(),
      this.getAllEdges(),
      this.getMetadata('lastSaved')
    ]);
    
    // Count by type
    const nodesByType = {};
    for (const node of nodes) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }
    
    const edgesByType = {};
    for (const edge of edges) {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
    }
    
    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      nodesByType,
      edgesByType,
      lastSaved
    };
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }
}

/**
 * Artifact Store
 * Content-addressable storage for caching parsed SQL
 */
export class ArtifactStore {
  constructor(graphStore) {
    this.graphStore = graphStore;
  }

  /**
   * Compute hash of content
   * @param {string} content - Content to hash
   * @returns {Promise<string>} Hash string
   */
  async hashContent(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Get or compute an artifact
   * @param {string} content - Source content
   * @param {string} artifactType - Type of artifact (e.g., 'ir', 'schema')
   * @param {Function} computeFn - Function to compute artifact if not cached
   * @returns {Promise<Object>} Artifact data
   */
  async getOrCompute(content, artifactType, computeFn) {
    const hash = await this.hashContent(content);
    
    // Try to get from cache
    const cached = await this.graphStore.getArtifact(hash);
    if (cached && cached.artifactType === artifactType) {
      return cached.data;
    }
    
    // Compute and cache
    const data = await computeFn(content);
    
    await this.graphStore.saveArtifact({
      hash,
      artifactType,
      data,
      createdAt: new Date().toISOString()
    });
    
    return data;
  }

  /**
   * Check if artifact exists
   * @param {string} content - Source content
   * @returns {Promise<boolean>}
   */
  async has(content) {
    const hash = await this.hashContent(content);
    const artifact = await this.graphStore.getArtifact(hash);
    return artifact !== null;
  }

  /**
   * Invalidate artifact
   * @param {string} content - Source content
   * @returns {Promise<void>}
   */
  async invalidate(content) {
    const hash = await this.hashContent(content);
    await this.graphStore.deleteArtifact?.(hash);
  }
}

export default GraphStore;
