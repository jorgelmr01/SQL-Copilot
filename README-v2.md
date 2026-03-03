# SQL Copilot v2 - Compiler-Style ERD & SQL Library

A complete rebuild of the ERD schema and SQL library using a compiler-style architecture for production-grade metadata extraction, lineage tracking, and query assistance.

## What's New in v2

### Compiler-Style Pipeline
Instead of relying on AI inference for schema extraction, v2 implements a proper compiler pipeline:

1. **SQL Parser** → Parses SQL into an Abstract Syntax Tree (AST)
2. **Canonical IR** → Transforms AST into a normalized Intermediate Representation
3. **Schema Extractor** → Extracts columns, types, and lineage from IR
4. **Metadata Graph** → Stores entities and relationships in a queryable graph
5. **Relationship Inference** → Infers FK relationships from multiple signals

### Key Features

- **Multi-dialect SQL parsing** (Presto/Trino, Spark SQL, PostgreSQL)
- **dbt manifest integration** for `ref()` and `source()` resolution
- **Column-level lineage** tracking through expressions
- **Relationship inference** with confidence scoring
- **Join Path Finder** for query assistance
- **IndexedDB persistence** for browser-based storage

## Architecture

```
src/
├── core/
│   ├── parser/           # SQL parsing & AST → IR transformation
│   ├── compiler/         # dbt resolver, Jinja preprocessing
│   ├── analyzer/         # Schema extraction, lineage tracing
│   └── catalog/          # Type resolution, schema registry
├── graph/
│   ├── model.js          # Node/edge types, graph operations
│   └── pathfinder.js     # Join path algorithms
├── services/
│   ├── ingestion.js      # File/dbt ingestion orchestration
│   └── inference/        # Relationship inference strategies
├── storage/
│   └── graph-store.js    # IndexedDB persistence
└── index.js              # Main API exports
```

## Quick Start

### Parse SQL and Extract Schema

```javascript
import { SQLParser, SchemaExtractor } from './src/index.js';

const parser = new SQLParser('presto');
const extractor = new SchemaExtractor();

const sql = `
  SELECT 
    customer_id,
    COUNT(*) as order_count,
    SUM(total_amount) as total_revenue
  FROM orders
  GROUP BY customer_id
`;

const ir = parser.parse(sql);
const schema = extractor.extract(ir, 'customer_orders', { layer: 'gold' });

console.log(schema.columns);
// [
//   { name: 'customer_id', type: 'BIGINT', semanticRole: 'dimension' },
//   { name: 'order_count', type: 'BIGINT', aggregationType: 'count' },
//   { name: 'total_revenue', type: 'DECIMAL', aggregationType: 'sum' }
// ]
```

### dbt Integration

```javascript
import { DbtResolver, SQLPreprocessor } from './src/index.js';

// Load dbt manifest
const resolver = new DbtResolver();
resolver.load(manifestJson);

// Compile SQL with ref() resolution
const preprocessor = new SQLPreprocessor(resolver);
const result = preprocessor.compile(`
  SELECT * FROM {{ ref('stg_orders') }}
  WHERE order_date >= {{ var('start_date') }}
`);

console.log(result.compiledSQL);
// SELECT * FROM analytics.staging.stg_orders WHERE order_date >= '2024-01-01'
```

### Relationship Inference

```javascript
import { MetadataGraph, RelationshipInferenceEngine } from './src/index.js';

const graph = new MetadataGraph();
// ... add models to graph ...

const inference = new RelationshipInferenceEngine(graph);
const candidates = await inference.inferRelationships(models);

// Returns relationships with confidence scores:
// [
//   { from: {table: 'orders', column: 'customer_id'},
//     to: {table: 'customers', column: 'id'},
//     confidence: 0.85,
//     explanation: 'Found in 3 SQL join(s); Inferred from naming pattern' }
// ]
```

### Join Path Finder

```javascript
import { JoinPathFinder } from './src/index.js';

const pathFinder = new JoinPathFinder(graph);
const paths = pathFinder.findPaths('fact_orders', 'dim_products');

// Get SQL skeleton for best path
const sql = paths[0].toSQL('LEFT');
// SELECT
//   -- TODO: select columns
// FROM fact_orders t0
// LEFT JOIN dim_products t1
//   ON t0.product_id = t1.product_id
// WHERE 1=1
```

## Demo

Open `demo.html` in a browser to test the compiler pipeline interactively:

- **SQL Parser** - Parse SQL and view the IR
- **dbt Integration** - Compile SQL with ref() resolution
- **Relationship Inference** - Infer relationships from sample models
- **Join Path Finder** - Find join paths between tables

## Node Types

| Type | Description |
|------|-------------|
| `model` | Table, view, or dbt model |
| `column` | Individual column |
| `source` | External data source |
| `expression` | Complex calculation |

## Edge Types

| Type | Description |
|------|-------------|
| `depends_on` | Model → upstream model (data lineage) |
| `produces` | Model → column (ownership) |
| `derives_from` | Column → source column(s) (column lineage) |
| `joins_on` | Model → Model (with join predicate) |
| `foreign_key` | Column → Column (FK relationship) |

## Confidence Scoring

Relationships are scored based on evidence:

| Source | Confidence |
|--------|------------|
| Explicit DDL constraint | 1.0 |
| Data profiling validated | 0.85 |
| Observed in SQL joins | 0.7 |
| Naming convention match | 0.4 |

## Roadmap

- [ ] Enhanced UI components (ERD view, lineage DAG)
- [ ] Warehouse info_schema integration
- [ ] Data profiling for cardinality validation
- [ ] Incremental processing with hash-based caching
- [ ] Export to Mermaid/PlantUML

## Migration from v1

The v2 modules are designed to work alongside the existing v1 codebase. The new `src/` directory contains all v2 modules, while the original `index.html` remains functional.

To migrate:
1. Use the new parser/extractor for schema detection
2. Store results in the new graph model
3. Gradually replace AI-based inference with compiler-based extraction
