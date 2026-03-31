// ERD Virtualization for Performance with Large Schemas
// Implements viewport-based rendering and virtual DOM updates

class ERDVirtualizer {
  constructor() {
    this.viewport = { x: 0, y: 0, width: 0, height: 0 };
    this.visibleTables = new Set();
    this.visibleRelationships = new Set();
    this.lastRenderedTables = new Set();
    this.lastRenderedRelationships = new Set();
    this.virtualizationThreshold = 50; // Enable virtualization for 50+ tables
    this.tableCache = new Map();
    this.relationshipCache = new Map();
  }

  // Update viewport bounds
  updateViewport(svgElement, zoomTransform) {
    const rect = svgElement.getBoundingClientRect();
    const k = zoomTransform.k;
    const tx = zoomTransform.x;
    const ty = zoomTransform.y;
    
    this.viewport = {
      x: -tx / k,
      y: -ty / k,
      width: rect.width / k,
      height: rect.height / k
    };
  }

  // Check if table is in viewport
  isTableVisible(table) {
    const tableX = table.x || 0;
    const tableY = table.y || 0;
    const tableWidth = 200; // Standard table width
    const tableHeight = 100 + (table.columns?.length || 0) * 25; // Dynamic height
    
    return !(
      tableX + tableWidth < this.viewport.x ||
      tableX > this.viewport.x + this.viewport.width ||
      tableY + tableHeight < this.viewport.y ||
      tableY > this.viewport.y + this.viewport.height
    );
  }

  // Check if relationship is visible (both tables visible or line crosses viewport)
  isRelationshipVisible(relationship, tables) {
    const fromTable = tables.find(t => t.id === relationship.from.table);
    const toTable = tables.find(t => t.id === relationship.to.table);
    
    if (!fromTable || !toTable) return false;
    
    // If either table is visible, show relationship
    if (this.visibleTables.has(fromTable.id) || this.visibleTables.has(toTable.id)) {
      return true;
    }
    
    // Check if relationship line crosses viewport
    const fromX = fromTable.x || 0;
    const fromY = fromTable.y || 0;
    const toX = toTable.x || 0;
    const toY = toTable.y || 0;
    
    // Simple bounding box check for the line
    const minX = Math.min(fromX, toX);
    const maxX = Math.max(fromX, toX);
    const minY = Math.min(fromY, toY);
    const maxY = Math.max(fromY, toY);
    
    return !(
      maxX < this.viewport.x ||
      minX > this.viewport.x + this.viewport.width ||
      maxY < this.viewport.y ||
      minY > this.viewport.y + this.viewport.height
    );
  }

  // Calculate visible elements
  calculateVisibility(tables, relationships) {
    this.visibleTables.clear();
    this.visibleRelationships.clear();
    
    // Always show all tables if below threshold
    if (tables.length < this.virtualizationThreshold) {
      tables.forEach(t => this.visibleTables.add(t.id));
      relationships.forEach(r => this.visibleRelationships.add(r.id));
      return;
    }
    
    // Calculate visible tables
    tables.forEach(table => {
      if (this.isTableVisible(table)) {
        this.visibleTables.add(table.id);
      }
    });
    
    // Calculate visible relationships
    relationships.forEach(rel => {
      if (this.isRelationshipVisible(rel, tables)) {
        this.visibleRelationships.add(rel.id);
      }
    });
  }

  // Get tables to render (newly visible + always visible selected)
  getTablesToRender(tables, selectedTableId) {
    const toRender = new Set();
    
    // Always render selected table
    if (selectedTableId) {
      toRender.add(selectedTableId);
    }
    
    // Add newly visible tables
    this.visibleTables.forEach(tableId => {
      if (!this.lastRenderedTables.has(tableId)) {
        toRender.add(tableId);
      }
    });
    
    // Add tables that were visible but need update
    this.lastRenderedTables.forEach(tableId => {
      if (this.visibleTables.has(tableId)) {
        toRender.add(tableId);
      }
    });
    
    return Array.from(toRender);
  }

  // Get relationships to render
  getRelationshipsToRender(relationships) {
    const toRender = new Set();
    
    // Add newly visible relationships
    this.visibleRelationships.forEach(relId => {
      if (!this.lastRenderedRelationships.has(relId)) {
        toRender.add(relId);
      }
    });
    
    // Add relationships that were visible but need update
    this.lastRenderedRelationships.forEach(relId => {
      if (this.visibleRelationships.has(relId)) {
        toRender.add(relId);
      }
    });
    
    return Array.from(toRender);
  }

  // Update last rendered sets
  updateLastRendered() {
    this.lastRenderedTables = new Set(this.visibleTables);
    this.lastRenderedRelationships = new Set(this.visibleRelationships);
  }

  // Get performance metrics
  getMetrics() {
    return {
      visibleTables: this.visibleTables.size,
      visibleRelationships: this.visibleRelationships.size,
      totalTables: this.lastRenderedTables.size,
      virtualizationEnabled: this.lastRenderedTables.size >= this.virtualizationThreshold
    };
  }

  // Clear caches when needed
  clearCache() {
    this.tableCache.clear();
    this.relationshipCache.clear();
    this.lastRenderedTables.clear();
    this.lastRenderedRelationships.clear();
  }
}

// Global virtualizer instance
window.ERDVirtualizer = new ERDVirtualizer();
