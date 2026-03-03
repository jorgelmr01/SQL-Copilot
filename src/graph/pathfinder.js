/**
 * Join Path Finder
 * 
 * Finds optimal join paths between tables using graph traversal.
 * Generates SQL skeletons for recommended joins.
 */

import { EdgeType, NodeType } from './model.js';

/**
 * Join Path result
 */
export class JoinPath {
  constructor(tables, joins, score) {
    this.tables = tables;      // Array of table names in order
    this.joins = joins;        // Array of join info objects
    this.score = score;        // Path score (higher = better)
    this.hops = joins.length;  // Number of joins
  }
  
  /**
   * Generate SQL skeleton for this join path
   * @param {string} defaultJoinType - Default join type (LEFT, INNER, etc.)
   * @param {Object} options - Generation options
   * @returns {string} SQL skeleton
   */
  toSQL(defaultJoinType = 'LEFT', options = {}) {
    const { 
      includeColumns = true,
      columnPlaceholder = '-- TODO: select columns',
      filterPlaceholder = '-- TODO: add filters'
    } = options;
    
    const lines = [];
    
    // SELECT clause
    lines.push('SELECT');
    if (includeColumns) {
      lines.push(`  ${columnPlaceholder}`);
    }
    
    // FROM clause with first table
    const firstTable = this.tables[0];
    lines.push(`FROM ${firstTable} t0`);
    
    // JOIN clauses
    this.joins.forEach((join, i) => {
      const joinType = join.suggestedJoinType || defaultJoinType;
      const alias = `t${i + 1}`;
      const targetTable = join.targetTable;
      
      lines.push(`${joinType} JOIN ${targetTable} ${alias}`);
      lines.push(`  ON ${this.renderJoinCondition(join, `t${i}`, alias)}`);
    });
    
    // WHERE clause placeholder
    lines.push('WHERE 1=1');
    lines.push(`  ${filterPlaceholder}`);
    
    return lines.join('\n');
  }
  
  /**
   * Render join condition
   */
  renderJoinCondition(join, leftAlias, rightAlias) {
    if (join.onClause) {
      // Replace table names with aliases
      let clause = join.onClause;
      clause = clause.replace(new RegExp(`\\b${join.sourceTable}\\b`, 'g'), leftAlias);
      clause = clause.replace(new RegExp(`\\b${join.targetTable}\\b`, 'g'), rightAlias);
      return clause;
    }
    
    // Default: column equality
    return `${leftAlias}.${join.sourceColumn} = ${rightAlias}.${join.targetColumn}`;
  }
  
  /**
   * Get explanation of this join path
   */
  getExplanation() {
    const parts = [`Join path from ${this.tables[0]} to ${this.tables[this.tables.length - 1]}:`];
    
    for (let i = 0; i < this.joins.length; i++) {
      const join = this.joins[i];
      const conf = join.confidence ? ` (confidence: ${(join.confidence * 100).toFixed(0)}%)` : '';
      parts.push(`  ${i + 1}. ${join.sourceTable}.${join.sourceColumn} → ${join.targetTable}.${join.targetColumn}${conf}`);
    }
    
    return parts.join('\n');
  }
}

/**
 * Join Path Finder class
 */
export class JoinPathFinder {
  constructor(graph) {
    this.graph = graph;
  }
  
  /**
   * Find join paths between two tables
   * @param {string} fromTable - Source table name
   * @param {string} toTable - Target table name
   * @param {Object} options - Search options
   * @returns {Array<JoinPath>} Array of possible paths, sorted by score
   */
  findPaths(fromTable, toTable, options = {}) {
    const {
      maxHops = 5,
      minConfidence = 0.3,
      preferredJoinType = 'LEFT',
      includeReverse = true
    } = options;
    
    // Find model nodes
    const fromNode = this.findModelNode(fromTable);
    const toNode = this.findModelNode(toTable);
    
    if (!fromNode || !toNode) {
      return [];
    }
    
    // Build adjacency list from relationship edges
    const adjacency = this.buildAdjacency(minConfidence, includeReverse);
    
    // Find all paths using BFS
    const rawPaths = this.bfs(fromNode.id, toNode.id, adjacency, maxHops);
    
    // Convert to JoinPath objects with scoring
    const paths = rawPaths.map(path => this.pathToJoinPath(path, preferredJoinType));
    
    // Sort by score (higher is better) then by hops (fewer is better)
    return paths.sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.1) {
        return b.score - a.score;
      }
      return a.hops - b.hops;
    });
  }
  
  /**
   * Find the best single path between two tables
   * @param {string} fromTable - Source table name
   * @param {string} toTable - Target table name
   * @param {Object} options - Search options
   * @returns {JoinPath|null} Best path or null
   */
  findBestPath(fromTable, toTable, options = {}) {
    const paths = this.findPaths(fromTable, toTable, options);
    return paths.length > 0 ? paths[0] : null;
  }
  
  /**
   * Find model node by table name
   */
  findModelNode(tableName) {
    const models = this.graph.getNodesByType(NodeType.MODEL);
    
    // Try exact match first
    let node = models.find(m => m.name === tableName);
    if (node) return node;
    
    // Try case-insensitive match
    const lowerName = tableName.toLowerCase();
    node = models.find(m => m.name.toLowerCase() === lowerName);
    if (node) return node;
    
    // Try matching just the table part (ignore schema)
    const parts = tableName.split('.');
    const justTable = parts[parts.length - 1].toLowerCase();
    node = models.find(m => {
      const mParts = m.name.split('.');
      return mParts[mParts.length - 1].toLowerCase() === justTable;
    });
    
    return node || null;
  }
  
  /**
   * Build adjacency list from graph edges
   */
  buildAdjacency(minConfidence, includeReverse) {
    const adjacency = new Map(); // nodeId -> Array<{ targetId, edge }>
    
    // Get all relationship edges
    const joinEdges = this.graph.getEdgesByType(EdgeType.JOINS_ON);
    const fkEdges = this.graph.getEdgesByType(EdgeType.FOREIGN_KEY);
    
    const addEdge = (sourceId, targetId, edge) => {
      // Filter by confidence
      if (edge.confidence && edge.confidence < minConfidence) return;
      
      if (!adjacency.has(sourceId)) {
        adjacency.set(sourceId, []);
      }
      adjacency.get(sourceId).push({ targetId, edge });
    };
    
    // Process JOINS_ON edges (model to model)
    for (const edge of joinEdges) {
      addEdge(edge.source, edge.target, edge);
      if (includeReverse) {
        addEdge(edge.target, edge.source, { ...edge, reversed: true });
      }
    }
    
    // Process FOREIGN_KEY edges (column to column)
    // Need to map to model level
    for (const edge of fkEdges) {
      const sourceCol = this.graph.getNode(edge.source);
      const targetCol = this.graph.getNode(edge.target);
      
      if (sourceCol?.modelId && targetCol?.modelId) {
        const modelEdge = {
          ...edge,
          sourceColumn: sourceCol.name,
          targetColumn: targetCol.name,
          sourceModelId: sourceCol.modelId,
          targetModelId: targetCol.modelId
        };
        
        addEdge(sourceCol.modelId, targetCol.modelId, modelEdge);
        if (includeReverse) {
          addEdge(targetCol.modelId, sourceCol.modelId, { ...modelEdge, reversed: true });
        }
      }
    }
    
    return adjacency;
  }
  
  /**
   * BFS to find all paths
   */
  bfs(startId, endId, adjacency, maxHops) {
    const paths = [];
    const queue = [{ 
      nodeId: startId, 
      path: [{ nodeId: startId, edge: null }],
      visited: new Set([startId])
    }];
    
    while (queue.length > 0) {
      const { nodeId, path, visited } = queue.shift();
      
      // Check if we've reached the destination
      if (nodeId === endId && path.length > 1) {
        paths.push(path);
        continue;
      }
      
      // Check hop limit
      if (path.length > maxHops) continue;
      
      // Explore neighbors
      const neighbors = adjacency.get(nodeId) || [];
      
      for (const { targetId, edge } of neighbors) {
        if (visited.has(targetId)) continue;
        
        const newVisited = new Set(visited);
        newVisited.add(targetId);
        
        queue.push({
          nodeId: targetId,
          path: [...path, { nodeId: targetId, edge }],
          visited: newVisited
        });
      }
    }
    
    return paths;
  }
  
  /**
   * Convert raw path to JoinPath object
   */
  pathToJoinPath(rawPath, preferredJoinType) {
    const tables = [];
    const joins = [];
    let totalConfidence = 0;
    
    for (let i = 0; i < rawPath.length; i++) {
      const step = rawPath[i];
      const node = this.graph.getNode(step.nodeId);
      
      if (node) {
        tables.push(node.name);
      }
      
      if (step.edge && i > 0) {
        const prevNode = this.graph.getNode(rawPath[i - 1].nodeId);
        
        joins.push({
          sourceTable: prevNode?.name,
          targetTable: node?.name,
          sourceColumn: step.edge.sourceColumn || step.edge.fromColumn,
          targetColumn: step.edge.targetColumn || step.edge.toColumn,
          onClause: step.edge.predicate || step.edge.onClause,
          confidence: step.edge.confidence || 0.5,
          suggestedJoinType: this.suggestJoinType(step.edge, preferredJoinType),
          reversed: step.edge.reversed || false
        });
        
        totalConfidence += step.edge.confidence || 0.5;
      }
    }
    
    // Calculate path score
    const avgConfidence = joins.length > 0 ? totalConfidence / joins.length : 0;
    const hopPenalty = joins.length * 0.05; // Slight penalty for more hops
    const score = avgConfidence - hopPenalty;
    
    return new JoinPath(tables, joins, score);
  }
  
  /**
   * Suggest join type based on relationship metadata
   */
  suggestJoinType(edge, defaultType) {
    // If edge has explicit join type, use it
    if (edge.joinType) return edge.joinType;
    
    // If it's a FK relationship, suggest LEFT JOIN (fact to dim)
    if (edge.type === EdgeType.FOREIGN_KEY) {
      return 'LEFT';
    }
    
    // If cardinality is known
    if (edge.cardinality) {
      if (edge.cardinality === 'one-to-one') return 'INNER';
      if (edge.cardinality === 'many-to-one') return 'LEFT';
      if (edge.cardinality === 'one-to-many') return 'LEFT';
    }
    
    return defaultType;
  }
  
  /**
   * Get all tables reachable from a starting table
   * @param {string} fromTable - Starting table name
   * @param {number} maxHops - Maximum distance
   * @returns {Array} Array of { table, distance, path }
   */
  getReachableTables(fromTable, maxHops = 3) {
    const fromNode = this.findModelNode(fromTable);
    if (!fromNode) return [];
    
    const adjacency = this.buildAdjacency(0.3, true);
    const reachable = [];
    const visited = new Set([fromNode.id]);
    const queue = [{ nodeId: fromNode.id, distance: 0, path: [fromTable] }];
    
    while (queue.length > 0) {
      const { nodeId, distance, path } = queue.shift();
      
      if (distance > 0) {
        const node = this.graph.getNode(nodeId);
        if (node) {
          reachable.push({
            table: node.name,
            distance,
            path
          });
        }
      }
      
      if (distance >= maxHops) continue;
      
      const neighbors = adjacency.get(nodeId) || [];
      for (const { targetId } of neighbors) {
        if (visited.has(targetId)) continue;
        visited.add(targetId);
        
        const targetNode = this.graph.getNode(targetId);
        queue.push({
          nodeId: targetId,
          distance: distance + 1,
          path: [...path, targetNode?.name]
        });
      }
    }
    
    return reachable.sort((a, b) => a.distance - b.distance);
  }
}

/**
 * Query Template Generator
 * Generates common query patterns from schema
 */
export class QueryTemplateGenerator {
  constructor(graph, pathFinder) {
    this.graph = graph;
    this.pathFinder = pathFinder;
  }
  
  /**
   * Generate aggregation query template
   * @param {string} factTable - Fact table name
   * @param {Array} dimensions - Dimension table names
   * @param {Array} measures - Measure column names
   * @returns {Object} Query template with SQL and explanation
   */
  generateAggregation(factTable, dimensions, measures) {
    const lines = ['SELECT'];
    const groupByColumns = [];
    const joinClauses = [];
    let aliasCounter = 0;
    
    // Get fact table node
    const factNode = this.pathFinder.findModelNode(factTable);
    if (!factNode) {
      return { sql: null, error: `Fact table ${factTable} not found` };
    }
    
    const factAlias = `t${aliasCounter++}`;
    
    // Add dimension columns
    for (const dimTable of dimensions) {
      const path = this.pathFinder.findBestPath(factTable, dimTable);
      
      if (path && path.joins.length > 0) {
        // Get dimension columns
        const dimNode = this.pathFinder.findModelNode(dimTable);
        const dimColumns = this.graph.getColumnsForModel(dimNode?.id);
        
        // Find dimension columns (non-key, non-measure)
        const dimCols = dimColumns
          .filter(c => c.semanticRole === 'dimension' || 
                      (!c.isPK && !c.isFK && c.semanticRole !== 'measure'))
          .slice(0, 3);
        
        const dimAlias = `t${aliasCounter}`;
        
        for (const col of dimCols) {
          lines.push(`  ${dimAlias}.${col.name},`);
          groupByColumns.push(`${dimAlias}.${col.name}`);
        }
        
        // Add join
        const join = path.joins[path.joins.length - 1];
        joinClauses.push({
          type: join.suggestedJoinType || 'LEFT',
          table: dimTable,
          alias: dimAlias,
          on: `${factAlias}.${join.sourceColumn} = ${dimAlias}.${join.targetColumn}`
        });
        
        aliasCounter++;
      }
    }
    
    // Add measure columns
    const factColumns = this.graph.getColumnsForModel(factNode.id);
    
    for (const measureName of measures) {
      const col = factColumns.find(c => c.name === measureName);
      
      if (col) {
        const aggType = col.aggregationType || 'SUM';
        lines.push(`  ${aggType.toUpperCase()}(${factAlias}.${measureName}) AS ${measureName},`);
      } else {
        lines.push(`  SUM(${factAlias}.${measureName}) AS ${measureName},`);
      }
    }
    
    // Remove trailing comma from last line
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
    
    // FROM clause
    lines.push(`FROM ${factTable} ${factAlias}`);
    
    // JOIN clauses
    for (const join of joinClauses) {
      lines.push(`${join.type} JOIN ${join.table} ${join.alias}`);
      lines.push(`  ON ${join.on}`);
    }
    
    // GROUP BY
    if (groupByColumns.length > 0) {
      lines.push('GROUP BY');
      lines.push('  ' + groupByColumns.join(',\n  '));
    }
    
    return {
      sql: lines.join('\n'),
      explanation: `Aggregation query joining ${factTable} to ${dimensions.join(', ')} with measures: ${measures.join(', ')}`
    };
  }
  
  /**
   * Generate a simple select template for a table
   * @param {string} tableName - Table name
   * @param {Object} options - Options
   * @returns {Object} Query template
   */
  generateSelect(tableName, options = {}) {
    const { limit = 100, includeAllColumns = false } = options;
    
    const node = this.pathFinder.findModelNode(tableName);
    if (!node) {
      return { sql: null, error: `Table ${tableName} not found` };
    }
    
    const columns = this.graph.getColumnsForModel(node.id);
    const lines = ['SELECT'];
    
    if (includeAllColumns && columns.length > 0) {
      const colNames = columns.map(c => `  ${c.name}`).join(',\n');
      lines.push(colNames);
    } else {
      lines.push('  *');
    }
    
    lines.push(`FROM ${tableName}`);
    lines.push('WHERE 1=1');
    lines.push('  -- TODO: add filters');
    
    if (limit) {
      lines.push(`LIMIT ${limit}`);
    }
    
    return {
      sql: lines.join('\n'),
      explanation: `Simple select from ${tableName}`
    };
  }
}

export default JoinPathFinder;
