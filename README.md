# SQL Copilot

<div align="center">

![SQL Copilot](https://img.shields.io/badge/SQL-Copilot-6366f1?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAzQzguMTMgMyA1IDQuMTMgNSA1LjVWMTguNUM1IDE5Ljg3IDguMTMgMjEgMTIgMjFTMTkgMTkuODcgMTkgMTguNVY1LjVDMTkgNC4xMyAxNS44NyAzIDEyIDNNMTIgNUMxNS44NyA1IDE3IDUuOTkgMTcgNi41QzE3IDcuMDEgMTUuODcgOCAxMiA4UzcgNy4wMSA3IDYuNUM3IDUuOTkgOC4xMyA1IDEyIDVNMTcgMTguNUMxNyAxOS4wMSAxNS44NyAyMCAxMiAyMFM3IDE5LjAxIDcgMTguNVYxNS4zMUM4LjEzIDE2LjEyIDkuOTggMTYuNSAxMiAxNi41UzE1Ljg3IDE2LjEyIDE3IDE1LjMxVjE4LjVNMTcgMTMuMDZDMTUuODcgMTMuODcgMTQuMDIgMTQuMjUgMTIgMTQuMjVTOC4xMyAxMy44NyA3IDEzLjA2VjkuODFDOC4xMyAxMC42MiA5Ljk4IDExIDEyIDExUzE1Ljg3IDEwLjYyIDE3IDkuODFWMTMuMDZaIi8+PC9zdmc+)
![Version](https://img.shields.io/badge/version-0.2.3-22d3ee?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)

**Your AI-powered assistant for generating, optimizing, and managing SQL queries with an intelligent schema at your fingertips.**

[Features](#key-features) • [Getting Started](#getting-started) • [Usage Guide](#usage-guide) • [Architecture](#architecture) • [Contributing](#contributing)

</div>

---

## Overview

SQL Copilot is a comprehensive web application designed to revolutionize how data scientists and developers work with SQL. Built as a Single Page Application (SPA), it combines AI-powered query generation with intelligent schema management, creating a unified environment where your database knowledge grows alongside your work.

### The Core Value Proposition

1. **Progressive Schema ERD**: Build your database knowledge over time. Import schemas, detect tables from queries, and visually map all relationships in an interactive diagram that becomes your team's source of truth.

2. **Centralized SQL Library**: Keep all your team's queries in one searchable, organized place. Navigate folders like a file manager, categorize by data pipeline level, and instantly reference any query in conversations.

3. **AI-Powered Workflow**: From natural language to optimized SQL in seconds. The AI understands your schema context, suggests variable mappings, and iterates based on your feedback.

---

## Key Features

### SQL Generation Mode (5-Step Wizard)

A guided workflow that transforms natural language into production-ready SQL:

| Step | Description |
|------|-------------|
| **1. Query Input** | Describe what you need in plain English |
| **2. Logic Preview** | Review AI-generated calculation logic before SQL generation |
| **3. Variable Mapping** | Map placeholder variables to real schema columns with AI suggestions |
| **4. SQL Generation** | Get the final query with iterative chat refinement |
| **5. Export** | Copy to clipboard or run in AWS (coming soon) |

### Utility Modes

- **Optimize**: Get performance improvements with clear explanations for each optimization
- **Validate**: Scan queries for syntax errors with suggested fixes
- **Format**: Transform messy SQL into clean, readable, annotated code with inline comments
- **Explain**: Get detailed breakdowns with summaries and visualizations
- **Translate**: Convert queries between SQL dialects (Presto, Spark SQL, PySpark)

### Multi-Dialect Support

SQL Copilot supports multiple SQL dialects used in AWS:

| Dialect | AWS Service | Use Case |
|---------|-------------|----------|
| **Presto SQL** | Athena, QuickSight | Ad-hoc queries, BI |
| **Spark SQL** | EMR | Big data processing |
| **PySpark** | EMR Serverless | DataFrame-based ETL jobs |

All AI features are dialect-aware and generate syntax appropriate for your selected dialect.

### Schema ERD (Entity Relationship Diagram)

An interactive, D3.js-powered visualization of your database schema:

- **Visual Mapping**: Drag, zoom, and pan to explore relationships
- **Table Types**: Categorize tables by data pipeline level (Raw, Silver, Gold, Diamond, Black, Prediction)
- **AI-Assisted Editing**: Use natural language commands with `@table.column` references
- **Import/Export**: Support for JSON, CSV, and Excel formats
- **Auto-Detection**: Automatically detect tables and relationships from SQL queries

### SQL Query Library

A file-system-based query management system:

- **Native File Access**: Works directly with your local file system via File System Access API
- **Folder Navigation**: Browse and organize queries like a file manager
- **Table Type Classification**: Tag files with data pipeline levels
- **Process to ERD**: Bulk-analyze SQL files to populate your schema
- **Search & Filter**: Quickly find queries with full-text search

### Smart Context Features

- **`@table.column` References**: Mention schema elements in any chat for precise context
- **`@query:filename` References**: Include SQL files from your library as conversation context
- **Schema Context Injection**: All AI functions automatically receive your schema as context

---

## Getting Started

### Prerequisites

- A modern web browser (Chrome, Edge, or Firefox recommended for full File System Access API support)
- An OpenAI API key with access to GPT-5.1 models

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/jorgelmr01/SQL-Copilot.git
   cd SQL-Copilot
   ```

2. **Open the application**
   - Simply open `index.html` in your browser
   - Or serve it locally:
     ```bash
     # Using Python
     python -m http.server 8000
     
     # Using Node.js
     npx serve .
     ```

3. **Configure your API key**
   - Click the Settings icon in the header
   - Enter your OpenAI API key
   - Select your preferred model

### Configuration

| Setting | Description | Options |
|---------|-------------|---------|
| **API Key** | Your OpenAI API key | `sk-...` |
| **Model** | AI model selection | GPT-5.1 Codex Mini (Fast), GPT-5.1 Codex (Balanced), GPT-5.1 (Most Capable) |
| **SQL Library Path** | Working directory for SQL files | Any local folder |
| **Schema ERD** | Your database schema | Import JSON/CSV/Excel or build manually |

---

## Usage Guide

### SQL Generation Mode

1. **Enter your query description**
   ```
   "Get the total revenue by customer segment for Q4 2024, 
   excluding cancelled orders, with a breakdown by product category"
   ```

2. **Review the logic preview**
   - The AI generates a calculation logic preview showing the approach
   - Provide feedback to refine before SQL generation

3. **Map variables**
   - AI suggests schema columns for each placeholder
   - Accept suggestions, select manually from ERD, or define custom names
   - Skip to keep placeholder names

4. **Iterate on the SQL**
   - Chat with the AI to refine the query
   - Reference schema elements with `@table.column`
   - Include library queries with `@query:filename`

5. **Export your query**
   - Copy to clipboard
   - Save to library
   - Run in AWS (coming soon)

### Schema ERD Management

**Adding Tables:**
- Click "Add Table" button
- Import from JSON/CSV/Excel
- Process SQL files from library (auto-detection)
- Use AI chat: "Add a new table called users with columns id, email, created_at"

**Managing Relationships:**
- Click "Add Relationship" in toolbar
- Select source and target tables/columns
- Define relationship type (one-to-one, one-to-many, many-to-many)
- Or use AI: "Add a relationship from orders.customer_id to customers.id"

**Table Types:**
| Type | Level | Color | Description |
|------|-------|-------|-------------|
| Raw | 0 | Gray | Unprocessed source data |
| Prediction | - | Purple | ML model outputs |
| Silver | 1 | Silver | Cleaned/validated data |
| Gold | 2 | Gold | Business-ready aggregates |
| Diamond | 3 | Cyan | Premium analytics |
| Black | 4 | Dark | Final production tables |

### SQL Query Library

1. **Set Working Directory**
   - Click "Set Directory" in the library view
   - Select your SQL files folder
   - Directory persists via IndexedDB

2. **Organize Files**
   - Create subfolders for logical grouping
   - Rename files directly in the app
   - Toggle to show only SQL files

3. **Process to ERD**
   - Select one or more SQL files
   - Click "Process to ERD"
   - Review detected tables and columns
   - Confirm to add to schema

### Chat Commands & References

**Schema References (`@table.column`):**
```
"What's the data type of @users.email?"
"Join @orders with @customers.id"
```

**Query References (`@query:filename`):**
```
"Optimize @query:sales_report.sql"
"Explain what @query:customer_segments.sql does"
```

---

## Architecture

### Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | HTML5, CSS3, JavaScript (Vanilla) | Single Page Application |
| **Styling** | Tailwind CSS | Utility-first styling |
| **Visualization** | D3.js v7 | Interactive ERD graph |
| **Fonts** | Google Fonts (Space Grotesk, Noto Sans) | Typography |
| **Icons** | Material Symbols | UI iconography |
| **AI** | OpenAI API (GPT-5.1) | Query generation & assistance |
| **Storage** | File System Access API, IndexedDB, localStorage | Persistent data |
| **Excel Support** | SheetJS (xlsx) | Excel import/export |

### Application Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SQL Copilot SPA                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Header    │  │   Sidebar   │  │   Content   │             │
│  │  - Model    │  │  - Modes    │  │  - Views    │             │
│  │  - Settings │  │  - Context  │  │  - Modals   │             │
│  │  - Info     │  │  - Library  │  │  - Chat     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│                      Core Services                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  OpenAI     │  │ FileStorage │  │    State    │             │
│  │  Service    │  │   Service   │  │  Management │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│                      Data Layer                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ localStorage│  │  IndexedDB  │  │ File System │             │
│  │  (Settings) │  │  (Handles)  │  │ (SQL/ERD)   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Input → AI Service → Response Processing → UI Update → State Persistence
     ↑                                                            │
     └────────────────────────────────────────────────────────────┘
                           (Context Injection)
```

### File Structure

```
SQL-Copilot/
├── index.html          # Main application (SPA)
├── README.md           # This documentation
├── .sql-copilot/       # App data (created on first use)
│   └── erd-schema.json # Schema ERD data
└── [your-sql-folder]/  # User's SQL library directory
    ├── .sql-copilot-meta.json  # File metadata
    └── *.sql           # SQL query files
```

### State Management

The application uses a centralized state object (`AppState`) with the following structure:

```javascript
AppState = {
  // User settings
  apiKey: string,
  selectedModel: string,
  
  // Current session
  currentMode: string,
  currentStep: number,
  
  // SQL Generation workflow
  queryDescription: string,
  logicPreview: string,
  dummyVariables: string[],
  variableMappings: object,
  generatedSQL: string,
  chatHistory: array,
  
  // Context
  savedQueries: array,
  recentQueries: array
}
```

### ERD State

```javascript
ERDState = {
  tables: [
    {
      id: string,              // Deterministic hash-based ID
      name: string,
      description: string,
      tableType: string,       // raw, silver, gold, diamond, black, prediction
      schema_source: string,   // ctas_output, query_inferred
      is_stub: boolean,        // True for source tables inferred from queries
      is_aggregated: boolean,  // True if created with GROUP BY
      grain_columns: string[], // Composite key columns
      unique_key: string[],    // Same as grain_columns for aggregated tables
      filters: string[],       // WHERE conditions from the query
      columns: [
        {
          id: string,
          name: string,
          type: string,
          description: string,
          semantic_role: string,      // dimension | measure
          aggregation_type: string,   // count_distinct, sum, avg, ratio, etc.
          expression_sql: string,     // Exact SQL expression
          source_columns: string[],   // Fully qualified source columns
          inferred_from_query: boolean,
          type_confidence: number,    // 0-1
          inferred_from: string,      // Source expression for derived types
          isPK: boolean,
          isFK: boolean,
          nullable: boolean | null    // null = unknown
        }
      ],
      x: number,
      y: number
    }
  ],
  relationships: [
    {
      id: string,              // Deterministic hash-based ID
      from: { table: string, column: string },
      to: { table: string, column: string },
      type: string,            // lineage, join, many-to-one, etc.
      join_type: string,       // LEFT, INNER, RIGHT (for joins)
      on_sql: string,          // Exact ON clause
      cardinality: string,     // 1_to_many, many_to_1, 1_to_1
      confidence: number       // 0-1
    }
  ],
  selectedTable: string | null,
  selectedRelationship: string | null
}
```

---

## API Integration

### OpenAI API

SQL Copilot uses the OpenAI `/v1/responses` endpoint for GPT-5.1 models.

**Request Format:**
```javascript
{
  model: "gpt-5.1-codex",
  input: "User's prompt with context",
  instructions: "System instructions for the AI",
  max_output_tokens: 4096
}
```

**Supported Models:**
- `gpt-5.1-codex-mini` - Fast responses, good for simple tasks
- `gpt-5.1-codex` - Balanced performance (default)
- `gpt-5.1` - Most capable, best for complex queries

**Context Injection:**
All AI calls automatically include:
- Schema ERD (tables, columns, relationships)
- Relevant query history
- Referenced files via `@query:` syntax

### File System Access API

Used for persistent local storage of SQL files and ERD data.

**Capabilities:**
- Read/write files in user-selected directories
- Create folders and manage file hierarchy
- Persist directory handles via IndexedDB

**Browser Support:**
- Chrome 86+
- Edge 86+
- Opera 72+
- Firefox (partial, via polyfill)

---

## Customization Guide

### Adding New AI Features

1. **Create the UI** - Add HTML for input/output in the appropriate view section
2. **Add the handler function**:
   ```javascript
   async function myNewFeature() {
     const schemaContext = getSchemaContextForAI();
     const prompt = `Your prompt here. Schema: ${schemaContext}`;
     const result = await callOpenAI(prompt, 'Your system instructions');
     // Process and display result
   }
   ```
3. **Wire up the UI** - Add onclick handlers or form submissions

### Modifying AI Prompts

All AI prompts are defined inline in their respective functions. Key functions to modify:

| Function | Purpose | Location |
|----------|---------|----------|
| `generateLogic()` | Logic preview generation | SQL Generation Step 2 |
| `generateSQLQuery()` | SQL query generation | SQL Generation Step 4 |
| `optimizeSQL()` | Query optimization | Optimize mode |
| `validateSQL()` | Syntax validation | Validate mode |
| `formatSQL()` | Query formatting | Format mode |
| `explainSQL()` | Query explanation | Explain mode |
| `sendERDChatCommand()` | ERD AI chat | Schema ERD view |

### Styling Customization

**Color Palette (Tailwind Config):**
```javascript
colors: {
  primary: '#6366f1',      // Indigo - primary actions
  'primary-dark': '#4f46e5',
  accent: '#22d3ee',       // Cyan - highlights
  surface: '#1e1e2e',      // Dark background
  'surface-light': '#2a2a3e',
  'surface-lighter': '#3a3a4e',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444'
}
```

**Adding New Themes:**
1. Modify the Tailwind config in `<script id="tailwind-config">`
2. Update CSS custom properties if needed
3. Consider adding a theme toggle in settings

### Adding New Table Types

1. Add to the `TABLE_TYPES` constant:
   ```javascript
   const TABLE_TYPES = {
     // ... existing types
     'custom': { level: 5, label: 'Custom', color: 'pink' }
   };
   ```
2. Add corresponding CSS class:
   ```css
   .table-type-custom { background: rgba(236, 72, 153, 0.2); border-color: #ec4899; }
   ```

---

## Roadmap

### Coming Soon

- **AWS Integration**: Execute queries directly and see results in real-time
- **Query History**: Track all executed queries with results
- **Team Collaboration**: Share schemas and queries with team members
- **Query Templates**: Save and reuse common query patterns
- **Performance Analytics**: Track query performance over time

### Future Considerations

- Multi-database support (PostgreSQL, MySQL, etc.)
- Version control for schema changes
- Query scheduling and automation
- Export to BI tools (Tableau, Power BI)
- Mobile-responsive design improvements

---

## Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes**
4. **Test thoroughly** in multiple browsers
5. **Submit a pull request**

### Code Style Guidelines

- Use vanilla JavaScript (no frameworks)
- Follow existing naming conventions
- Add comments for complex logic
- Test with all three GPT-5.1 model variants

### Reporting Issues

Please include:
- Browser and version
- Steps to reproduce
- Expected vs actual behavior
- Console errors (if any)

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Changelog

### v1.2.1 (Current)

**Schema Extraction Overhaul - Production Ready:**

- **Column-Level Lineage**: Each computed column now includes:
  - `semantic_role`: dimension or measure classification
  - `aggregation_type`: count_distinct, sum, avg, ratio, etc.
  - `expression_sql`: exact SQL expression for reproducibility
  - `source_columns`: fully qualified column references
  
- **Grain Metadata**: Aggregated tables now capture:
  - `grain_columns`: GROUP BY columns that form the composite key
  - `unique_key`: Explicit unique key for downstream joins
  - `filters`: Captured WHERE conditions for query reproducibility

- **Dialect-Aware Type Inference**:
  - DATE_TRUNC correctly returns TIMESTAMP (not DATE) for Presto
  - NUMERIC normalized to DECIMAL(38,10) for Presto/Spark
  - Type confidence scores for derived columns
  - PySpark type mappings (IntegerType, StringType, etc.)

- **Enhanced Join Metadata**:
  - `join_type`: LEFT, INNER, RIGHT
  - `on_sql`: Exact ON clause expression
  - `cardinality`: 1_to_many, many_to_1, 1_to_1

- **Smart Nullability Inference**:
  - COUNT expressions: always NOT NULL
  - SUM(COALESCE(x,0)): NOT NULL
  - Ratios with NULLIF: nullable (division by zero)
  - PKs enforced as NOT NULL

- **Deterministic IDs**: Hash-based stable IDs for tables, columns, and relationships (enables versioning/diffing)

- **CTE Filtering**: CTE aliases (k, bu, ac, ff, ft) no longer pollute the schema as fake tables

- **UI Enhancements**:
  - Filters section in table side panel
  - Semantic role badges (M=Measure, D=Dimension)
  - Expression SQL tooltips
  - Aggregation type display

### v0.2.0

**New Features:**
- **SQL Dialect Support**: Added dialect selector for Presto SQL (Athena), Spark SQL (EMR), and PySpark (EMR Serverless)
- **Translate Mode**: New tool to convert queries between different SQL dialects with detailed translation notes
- **Enhanced Syntax Highlighting**: Comprehensive color-coded SQL highlighting with support for:
  - Keywords, functions, strings, numbers, operators
  - Comments (single-line and block)
  - Dummy variables with distinct purple highlighting
  - PySpark DataFrame methods
- **Responsive 4K Layout**: Fluid design that adapts to widescreen and 4K displays
- **Format with Annotations**: Format tool now adds inline comments explaining query logic

**Improvements:**
- **Stricter Variable Control**: Logic preview now declares ALL variables upfront; SQL generation only uses mapped variables
- **Dialect-Aware AI**: All AI prompts include dialect context for accurate syntax generation
- **Better Variable Mapping**: Comprehensive {{placeholder}} format with validation

### v0.1.0

- Initial release with SQL Generation, Optimize, Validate, Format, and Explain modes
- Schema ERD with D3.js visualization
- SQL Query Library with file system access
- Welcome modal and documentation

---

## Acknowledgments

- [OpenAI](https://openai.com) for GPT-5.1 models
- [D3.js](https://d3js.org) for visualization capabilities
- [Tailwind CSS](https://tailwindcss.com) for styling utilities
- [SheetJS](https://sheetjs.com) for Excel support
- [Google Fonts](https://fonts.google.com) for typography

---

<div align="center">

**Built with ❤️ for data scientists and SQL enthusiasts**

[Report Bug](https://github.com/jorgelmr01/SQL-Copilot/issues) • [Request Feature](https://github.com/jorgelmr01/SQL-Copilot/issues)

</div>
