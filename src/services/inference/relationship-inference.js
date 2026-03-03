/**
 * Relationship Inference Engine
 * 
 * Infers relationships between tables using multiple strategies:
 * - Explicit constraints (DDL)
 * - Join usage analysis
 * - Naming conventions
 * - Cardinality profiling (optional)
 */

import { EdgeType, Confidence } from '../../graph/model.js';

/**
 * Relationship candidate from inference
 */
export class RelationshipCandidate {
  constructor(from, to, type, confidence, strategy, evidence = {}) {
    this.from = from;           // { table, column }
    this.to = to;               // { table, column }
    this.type = type;           // EdgeType
    this.confidence = confidence;
    this.strategy = strategy;   // Which strategy found this
    this.evidence = evidence;   // Supporting evidence
    this.signals = [];          // Accumulated signals from multiple strategies
  }
  
  addSignal(strategy, confidence, evidence) {
    this.signals.push({ strategy, confidence, evidence });
  }
  
  getKey() {
    return `${this.from.table}.${this.from.column}->${this.to.table}.${this.to.column}`;
  }
}

/**
 * Base class for inference strategies
 */
export class InferenceStrategy {
  constructor(name) {
    this.name = name;
  }
  
  async infer(models, catalog) {
    throw new Error('Subclass must implement infer()');
  }
}

/**
 * Strategy: Explicit Constraints
 * Extracts relationships from DDL constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE)
 */
export class ExplicitConstraintStrategy extends InferenceStrategy {
  constructor() {
    super('explicit_constraint');
  }
  
  async infer(models, catalog) {
    const candidates = [];
    
    for (const model of models) {
      // Check for explicit constraints in model metadata
      if (model.constraints) {
        for (const constraint of model.constraints) {
          if (constraint.type === 'FOREIGN_KEY') {
            candidates.push(new RelationshipCandidate(
              { table: model.name, column: constraint.column },
              { table: constraint.referencesTable, column: constraint.referencesColumn },
              EdgeType.FOREIGN_KEY,
              Confidence.EXPLICIT,
              this.name,
              { constraintName: constraint.name, ddl: constraint.ddl }
            ));
          }
        }
      }
      
      // Check for FK hints in column metadata
      for (const col of (model.columns || [])) {
        if (col.foreignKeyTo) {
          const [refTable, refCol] = col.foreignKeyTo.split('.');
          candidates.push(new RelationshipCandidate(
            { table: model.name, column: col.name },
            { table: refTable, column: refCol || 'id' },
            EdgeType.FOREIGN_KEY,
            Confidence.EXPLICIT,
            this.name,
            { source: 'column_metadata' }
          ));
        }
      }
    }
    
    return candidates;
  }
}

/**
 * Strategy: Join Usage Analysis
 * Extracts relationships from observed JOIN predicates in SQL
 */
export class JoinUsageStrategy extends InferenceStrategy {
  constructor() {
    super('join_usage');
  }
  
  async infer(models, catalog) {
    const candidateMap = new Map(); // key -> candidate with occurrence count
    
    for (const model of models) {
      // Skip if no join metadata
      if (!model.joinMetadata || model.joinMetadata.length === 0) continue;
      
      for (const join of model.joinMetadata) {
        // Extract equality predicates from join condition
        const predicates = this.extractEqualityPredicates(join.predicate, join.predicateColumns);
        
        for (const pred of predicates) {
          // Resolve table names (handle aliases)
          const leftTable = this.resolveTableName(pred.left.table, model, catalog);
          const rightTable = this.resolveTableName(pred.right.table, model, catalog);
          
          if (!leftTable || !rightTable) continue;
          
          const candidate = new RelationshipCandidate(
            { table: leftTable, column: pred.left.column },
            { table: rightTable, column: pred.right.column },
            EdgeType.JOINS_ON,
            Confidence.JOIN_USAGE,
            this.name,
            {
              joinType: join.type,
              foundIn: model.name,
              predicate: join.predicate
            }
          );
          
          const key = candidate.getKey();
          
          if (candidateMap.has(key)) {
            // Increment occurrence count
            const existing = candidateMap.get(key);
            existing.evidence.occurrences = (existing.evidence.occurrences || 1) + 1;
            existing.evidence.models = existing.evidence.models || [];
            existing.evidence.models.push(model.name);
          } else {
            candidate.evidence.occurrences = 1;
            candidate.evidence.models = [model.name];
            candidateMap.set(key, candidate);
          }
        }
      }
    }
    
    // Boost confidence based on occurrence frequency
    const candidates = Array.from(candidateMap.values());
    for (const c of candidates) {
      const occurrences = c.evidence.occurrences || 1;
      // More occurrences = higher confidence (max 0.9)
      c.confidence = Math.min(0.9, 0.5 + occurrences * 0.1);
    }
    
    return candidates;
  }
  
  extractEqualityPredicates(predicateStr, predicateColumns) {
    const predicates = [];
    
    if (!predicateStr) return predicates;
    
    // Simple pattern matching for equality joins
    // Handles: t1.col1 = t2.col2
    const equalityPattern = /(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/g;
    let match;
    
    while ((match = equalityPattern.exec(predicateStr)) !== null) {
      predicates.push({
        left: { table: match[1], column: match[2] },
        right: { table: match[3], column: match[4] }
      });
    }
    
    // Also try to parse from predicateColumns if available
    if (predicateColumns && predicateColumns.length >= 2) {
      // Assume pairs of columns are equality joins
      for (let i = 0; i < predicateColumns.length - 1; i += 2) {
        const left = this.parseColumnRef(predicateColumns[i]);
        const right = this.parseColumnRef(predicateColumns[i + 1]);
        
        if (left && right && left.table && right.table) {
          predicates.push({ left, right });
        }
      }
    }
    
    return predicates;
  }
  
  parseColumnRef(ref) {
    if (!ref) return null;
    const parts = ref.split('.');
    if (parts.length === 2) {
      return { table: parts[0], column: parts[1] };
    } else if (parts.length === 1) {
      return { table: null, column: parts[0] };
    }
    return null;
  }
  
  resolveTableName(aliasOrName, model, catalog) {
    if (!aliasOrName) return null;
    
    // Check if it's an alias in the current model's sources
    if (model.sources) {
      for (const source of model.sources) {
        if (source.alias === aliasOrName) {
          return source.table || source.name;
        }
      }
    }
    
    // Check catalog
    if (catalog && catalog.hasTable(aliasOrName)) {
      return aliasOrName;
    }
    
    // Return as-is (might be the actual table name)
    return aliasOrName;
  }
}

/**
 * Strategy: Naming Conventions
 * Infers relationships from column naming patterns
 */
export class NamingConventionStrategy extends InferenceStrategy {
  constructor() {
    super('naming_convention');
    
    // Patterns to match
    this.patterns = [
      // customer_id -> dim_customer.customer_id or customers.id
      {
        regex: /^(\w+)_id$/i,
        targetPatterns: [
          { table: 'dim_$1', column: '$1_id' },
          { table: '$1s', column: 'id' },
          { table: '$1', column: 'id' },
          { table: '$1', column: '$1_id' }
        ]
      },
      // fk_customer -> customers.id
      {
        regex: /^fk_(\w+)$/i,
        targetPatterns: [
          { table: '$1s', column: 'id' },
          { table: 'dim_$1', column: 'id' }
        ]
      },
      // user_key -> users.user_key
      {
        regex: /^(\w+)_key$/i,
        targetPatterns: [
          { table: '$1s', column: '$1_key' },
          { table: 'dim_$1', column: '$1_key' }
        ]
      }
    ];
  }
  
  async infer(models, catalog) {
    const candidates = [];
    const modelNames = new Set(models.map(m => m.name.toLowerCase()));
    
    for (const model of models) {
      for (const column of (model.columns || [])) {
        // Skip if already has explicit FK
        if (column.isFK || column.foreignKey) continue;
        
        for (const pattern of this.patterns) {
          const match = column.name.match(pattern.regex);
          if (!match) continue;
          
          for (const targetPattern of pattern.targetPatterns) {
            // Resolve pattern placeholders
            const targetTable = this.resolvePattern(targetPattern.table, match);
            const targetColumn = this.resolvePattern(targetPattern.column, match);
            
            // Check if target table exists
            if (modelNames.has(targetTable.toLowerCase()) || 
                (catalog && catalog.hasTable(targetTable))) {
              
              // Don't create self-referential relationships for simple patterns
              if (targetTable.toLowerCase() === model.name.toLowerCase() &&
                  targetColumn.toLowerCase() === column.name.toLowerCase()) {
                continue;
              }
              
              candidates.push(new RelationshipCandidate(
                { table: model.name, column: column.name },
                { table: targetTable, column: targetColumn },
                EdgeType.FOREIGN_KEY,
                Confidence.NAMING,
                this.name,
                {
                  pattern: pattern.regex.source,
                  matchedEntity: match[1]
                }
              ));
              
              // Only take first matching pattern
              break;
            }
          }
        }
      }
    }
    
    return candidates;
  }
  
  resolvePattern(pattern, match) {
    let result = pattern;
    for (let i = 1; i < match.length; i++) {
      result = result.replace(`$${i}`, match[i]);
    }
    return result;
  }
}

/**
 * Strategy: Layer Rules
 * Validates relationships based on data layer hierarchy
 */
export class LayerRulesStrategy extends InferenceStrategy {
  constructor() {
    super('layer_rules');
    
    // Layer hierarchy (higher number = more refined)
    this.layerOrder = {
      'raw': 0,
      'bronze': 0,
      'silver': 1,
      'gold': 2,
      'diamond': 3,
      'black': 4,
      'prediction': 2
    };
  }
  
  async infer(models, catalog) {
    // This strategy doesn't infer new relationships
    // It validates/adjusts confidence of existing ones
    return [];
  }
  
  validateRelationship(fromModel, toModel) {
    const fromLayer = this.layerOrder[fromModel.layer] ?? 1;
    const toLayer = this.layerOrder[toModel.layer] ?? 1;
    
    // Gold should not depend on raw (flag as suspicious)
    if (fromLayer > toLayer + 1) {
      return {
        valid: true,
        warning: `${fromModel.name} (${fromModel.layer}) depends on ${toModel.name} (${toModel.layer}) - skipping layers`,
        confidenceAdjustment: -0.1
      };
    }
    
    // Raw should not depend on gold (likely error)
    if (fromLayer < toLayer) {
      return {
        valid: false,
        warning: `${fromModel.name} (${fromModel.layer}) depends on ${toModel.name} (${toModel.layer}) - reverse dependency`,
        confidenceAdjustment: -0.3
      };
    }
    
    return { valid: true, confidenceAdjustment: 0 };
  }
}

/**
 * Main Relationship Inference Engine
 */
export class RelationshipInferenceEngine {
  constructor(graph, catalog = null) {
    this.graph = graph;
    this.catalog = catalog;
    
    // Initialize strategies
    this.strategies = [
      new ExplicitConstraintStrategy(),
      new JoinUsageStrategy(),
      new NamingConventionStrategy(),
      new LayerRulesStrategy()
    ];
  }
  
  /**
   * Run all inference strategies on models
   * @param {Array} models - Array of model schemas
   * @returns {Array} Merged and scored relationship candidates
   */
  async inferRelationships(models) {
    const allCandidates = [];
    
    // Run each strategy
    for (const strategy of this.strategies) {
      try {
        const candidates = await strategy.infer(models, this.catalog);
        allCandidates.push(...candidates);
      } catch (error) {
        console.warn(`Strategy ${strategy.name} failed:`, error);
      }
    }
    
    // Merge candidates from different strategies
    const merged = this.mergeCandidates(allCandidates);
    
    // Calculate final confidence scores
    const scored = this.scoreCandidates(merged);
    
    // Sort by confidence
    return scored.sort((a, b) => b.confidence - a.confidence);
  }
  
  /**
   * Merge candidates that refer to the same relationship
   */
  mergeCandidates(candidates) {
    const merged = new Map();
    
    for (const candidate of candidates) {
      const key = candidate.getKey();
      
      if (merged.has(key)) {
        // Add signal to existing candidate
        const existing = merged.get(key);
        existing.addSignal(
          candidate.strategy,
          candidate.confidence,
          candidate.evidence
        );
      } else {
        // New candidate
        candidate.addSignal(
          candidate.strategy,
          candidate.confidence,
          candidate.evidence
        );
        merged.set(key, candidate);
      }
    }
    
    return Array.from(merged.values());
  }
  
  /**
   * Calculate final confidence scores based on all signals
   */
  scoreCandidates(candidates) {
    const weights = {
      'explicit_constraint': 1.0,
      'join_usage': 0.7,
      'profiling_validated': 0.85,
      'naming_convention': 0.4,
      'layer_rules': 0.3
    };
    
    for (const candidate of candidates) {
      if (candidate.signals.length === 0) continue;
      
      // Weighted average of signals
      let totalWeight = 0;
      let weightedSum = 0;
      
      for (const signal of candidate.signals) {
        const weight = weights[signal.strategy] || 0.5;
        weightedSum += signal.confidence * weight;
        totalWeight += weight;
      }
      
      candidate.confidence = totalWeight > 0 
        ? weightedSum / totalWeight 
        : candidate.confidence;
      
      // Generate explanation
      candidate.explanation = this.generateExplanation(candidate);
    }
    
    return candidates;
  }
  
  /**
   * Generate human-readable explanation for a relationship
   */
  generateExplanation(candidate) {
    const parts = [];
    
    for (const signal of candidate.signals) {
      switch (signal.strategy) {
        case 'explicit_constraint':
          parts.push('Defined by explicit FK constraint');
          break;
        case 'join_usage':
          const occurrences = signal.evidence?.occurrences || 1;
          parts.push(`Found in ${occurrences} SQL join(s)`);
          break;
        case 'naming_convention':
          parts.push(`Inferred from naming pattern (${signal.evidence?.pattern})`);
          break;
        case 'profiling_validated':
          parts.push('Validated by data profiling');
          break;
      }
    }
    
    return parts.join('; ');
  }
  
  /**
   * Convert candidates to graph edges
   */
  candidatesToEdges(candidates, minConfidence = 0.3) {
    return candidates
      .filter(c => c.confidence >= minConfidence)
      .map(c => ({
        source: `${c.from.table}.${c.from.column}`,
        target: `${c.to.table}.${c.to.column}`,
        type: c.type,
        confidence: c.confidence,
        explanation: c.explanation,
        signals: c.signals.map(s => s.strategy)
      }));
  }
}

export default RelationshipInferenceEngine;
