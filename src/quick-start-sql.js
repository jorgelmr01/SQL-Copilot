// Quick Start SQL Generation UI
// Provides instant SQL generation from mapped schema

function showQuickStartSQL() {
  if (!ERDState.tables || ERDState.tables.length === 0) {
    showToast('Please load schema first', 'warning');
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'quick-start-modal';
  modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-surface rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
      <div class="flex items-center justify-between p-4 border-b border-surface-lighter">
        <div>
          <h2 class="text-xl font-bold flex items-center gap-2">
            <span class="material-symbols-outlined text-accent">bolt</span>
            Quick Start SQL Generator
          </h2>
          <p class="text-sm text-gray-400 mt-1">Generate production-ready SQL from your mapped schema</p>
        </div>
        <button onclick="document.getElementById('quick-start-modal').remove()" 
                class="text-gray-400 hover:text-white transition-colors">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      
      <div class="flex flex-1 overflow-hidden">
        <!-- Query Type Selector -->
        <div class="w-64 border-r border-surface-lighter overflow-y-auto bg-surface-light p-4">
          <h3 class="text-sm font-semibold text-gray-400 mb-3">Query Type</h3>
          <div class="space-y-2">
            <button onclick="selectQuickStartType('select')" 
                    class="quick-start-type-btn w-full text-left p-3 bg-surface hover:bg-surface-lighter rounded-lg transition-colors border-l-4 border-primary"
                    data-type="select">
              <div class="flex items-center gap-2 mb-1">
                <span class="material-symbols-outlined text-sm text-primary">list</span>
                <span class="font-medium text-sm">Basic SELECT</span>
              </div>
              <p class="text-xs text-gray-500">Simple table query</p>
            </button>
            
            <button onclick="selectQuickStartType('aggregate')" 
                    class="quick-start-type-btn w-full text-left p-3 bg-surface-light hover:bg-surface rounded-lg transition-colors border-l-4 border-transparent"
                    data-type="aggregate">
              <div class="flex items-center gap-2 mb-1">
                <span class="material-symbols-outlined text-sm text-purple-400">functions</span>
                <span class="font-medium text-sm">Aggregation</span>
              </div>
              <p class="text-xs text-gray-500">GROUP BY with metrics</p>
            </button>
            
            <button onclick="selectQuickStartType('join')" 
                    class="quick-start-type-btn w-full text-left p-3 bg-surface-light hover:bg-surface rounded-lg transition-colors border-l-4 border-transparent"
                    data-type="join">
              <div class="flex items-center gap-2 mb-1">
                <span class="material-symbols-outlined text-sm text-blue-400">call_merge</span>
                <span class="font-medium text-sm">JOIN Query</span>
              </div>
              <p class="text-xs text-gray-500">Multi-table joins</p>
            </button>
            
            <button onclick="selectQuickStartType('cte')" 
                    class="quick-start-type-btn w-full text-left p-3 bg-surface-light hover:bg-surface rounded-lg transition-colors border-l-4 border-transparent"
                    data-type="cte">
              <div class="flex items-center gap-2 mb-1">
                <span class="material-symbols-outlined text-sm text-green-400">account_tree</span>
                <span class="font-medium text-sm">CTE Pattern</span>
              </div>
              <p class="text-xs text-gray-500">WITH clause example</p>
            </button>
            
            <button onclick="selectQuickStartType('window')" 
                    class="quick-start-type-btn w-full text-left p-3 bg-surface-light hover:bg-surface rounded-lg transition-colors border-l-4 border-transparent"
                    data-type="window">
              <div class="flex items-center gap-2 mb-1">
                <span class="material-symbols-outlined text-sm text-orange-400">view_week</span>
                <span class="font-medium text-sm">Window Functions</span>
              </div>
              <p class="text-xs text-gray-500">ROW_NUMBER, RANK, etc.</p>
            </button>
          </div>
        </div>
        
        <!-- Generated SQL Display -->
        <div class="flex-1 flex flex-col overflow-hidden">
          <div class="p-4 bg-surface-light/50 border-b border-surface-lighter">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm font-medium text-white" id="quick-start-title">Basic SELECT Query</div>
                <div class="text-xs text-gray-500 mt-1" id="quick-start-desc">Ready to paste into Athena/Presto</div>
              </div>
              <div class="flex items-center gap-2">
                <select id="quick-start-dialect" onchange="regenerateQuickStart()" 
                        class="bg-surface border border-surface-lighter rounded px-2 py-1 text-sm">
                  <option value="presto">Presto/Athena</option>
                  <option value="spark">Spark SQL</option>
                  <option value="bigquery">BigQuery</option>
                </select>
              </div>
            </div>
          </div>
          
          <div class="flex-1 overflow-auto p-4">
            <pre id="quick-start-sql" class="bg-surface-light rounded-lg p-4 text-sm font-mono text-accent whitespace-pre-wrap">-- Select a query type to generate SQL</pre>
          </div>
          
          <div class="p-4 border-t border-surface-lighter bg-surface-light/50">
            <div id="quick-start-hints" class="text-xs text-gray-500 mb-3 hidden"></div>
            <div class="flex gap-2">
              <button onclick="copyQuickStartSQL()" 
                      class="px-4 py-2 bg-primary hover:bg-primary-dark rounded-lg text-sm font-semibold transition-colors flex items-center gap-2">
                <span class="material-symbols-outlined text-sm">content_copy</span>
                Copy to Clipboard
              </button>
              <button onclick="openInQuery()" 
                      class="px-4 py-2 bg-accent hover:bg-accent/80 text-black rounded-lg text-sm font-semibold transition-colors flex items-center gap-2">
                <span class="material-symbols-outlined text-sm">edit_note</span>
                Edit in Query Mode
              </button>
              <button onclick="regenerateQuickStart()" 
                      class="px-4 py-2 bg-surface-lighter hover:bg-surface-light rounded-lg text-sm transition-colors flex items-center gap-2">
                <span class="material-symbols-outlined text-sm">refresh</span>
                Regenerate
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Auto-generate first query
  selectQuickStartType('select');
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

let currentQuickStartType = 'select';

function selectQuickStartType(type) {
  currentQuickStartType = type;
  
  // Update button styles
  document.querySelectorAll('.quick-start-type-btn').forEach(btn => {
    if (btn.dataset.type === type) {
      btn.classList.remove('bg-surface-light', 'border-transparent');
      btn.classList.add('bg-surface', 'border-primary');
    } else {
      btn.classList.add('bg-surface-light', 'border-transparent');
      btn.classList.remove('bg-surface', 'border-primary');
    }
  });
  
  generateQuickStartSQL(type);
}

function generateQuickStartSQL(type) {
  const enhancedTemplates = new window.EnhancedTemplateSystem();
  enhancedTemplates.setSchemaContext(ERDState.tables, ERDState.relationships);
  
  const dialect = document.getElementById('quick-start-dialect')?.value || 'presto';
  const generator = new window.SmartCodeGenerator(dialect);
  generator.setSchemaContext(ERDState.tables, ERDState.relationships, AppState.schemaColumns);
  
  // Generate base SQL
  let sql = enhancedTemplates.generateQuickStart(type);
  
  // Apply production enhancements
  const processed = generator.generateProductionSQL(sql, {}, {
    addComments: true,
    addOptimizationHints: true,
    validateSchema: false, // Skip validation for quick-start templates
    formatCode: true,
    addMetadata: true,
    metadata: {
      title: getQuickStartTitle(type),
      description: `Quick Start ${type} query`,
      author: 'SQL Copilot'
    }
  });
  
  // Update UI
  document.getElementById('quick-start-sql').textContent = processed.sql;
  document.getElementById('quick-start-title').textContent = getQuickStartTitle(type);
  document.getElementById('quick-start-desc').textContent = getQuickStartDescription(type, dialect);
  
  // Show hints
  const hintsDiv = document.getElementById('quick-start-hints');
  if (processed.hints.length > 0) {
    hintsDiv.classList.remove('hidden');
    hintsDiv.innerHTML = `💡 <strong>Hints:</strong> ${processed.hints.map(h => h.message).join(', ')}`;
  } else {
    hintsDiv.classList.add('hidden');
  }
  
  // Store for copying
  window.currentQuickStartSQL = processed.sql;
}

function getQuickStartTitle(type) {
  const titles = {
    select: 'Basic SELECT Query',
    aggregate: 'Aggregation Query',
    join: 'JOIN Query',
    cte: 'CTE Pattern Query',
    window: 'Window Functions Query'
  };
  return titles[type] || 'SQL Query';
}

function getQuickStartDescription(type, dialect) {
  const dialectName = dialect === 'presto' ? 'Athena/Presto' : 
                     dialect === 'spark' ? 'Spark SQL' : 
                     dialect === 'bigquery' ? 'BigQuery' : dialect;
  
  const descriptions = {
    select: `Simple SELECT query for ${dialectName}`,
    aggregate: `GROUP BY aggregation for ${dialectName}`,
    join: `Multi-table JOIN for ${dialectName}`,
    cte: `WITH clause pattern for ${dialectName}`,
    window: `Window functions for ${dialectName}`
  };
  return descriptions[type] || `Ready to paste into ${dialectName}`;
}

function regenerateQuickStart() {
  generateQuickStartSQL(currentQuickStartType);
  showToast('SQL regenerated', 'success');
}

function copyQuickStartSQL() {
  const sql = window.currentQuickStartSQL;
  if (sql) {
    navigator.clipboard.writeText(sql);
    showToast('SQL copied to clipboard!', 'success');
  }
}

function openInQuery() {
  const sql = window.currentQuickStartSQL;
  if (sql) {
    document.getElementById('quick-start-modal').remove();
    navigateToMode('query');
    
    setTimeout(() => {
      const queryInput = document.getElementById('chat-input');
      if (queryInput) {
        queryInput.value = `Modify this SQL:\n\n${sql}`;
        queryInput.focus();
      }
    }, 100);
    
    showToast('SQL loaded in Query mode', 'success');
  }
}

// Export for use in main application
if (typeof window !== 'undefined') {
  window.showQuickStartSQL = showQuickStartSQL;
  window.selectQuickStartType = selectQuickStartType;
  window.regenerateQuickStart = regenerateQuickStart;
  window.copyQuickStartSQL = copyQuickStartSQL;
  window.openInQuery = openInQuery;
}
