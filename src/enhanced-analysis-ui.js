// Enhanced Analysis UI for Variable and Dependency Display
// Provides detailed visualization of enhanced schema extraction results

class EnhancedAnalysisUI {
  constructor() {
    this.currentTable = null;
    this.currentSchema = null;
  }

  // Show enhanced table details panel
  showEnhancedTableDetails(table, schema) {
    this.currentTable = table;
    this.currentSchema = schema;
    
    const modal = document.getElementById('enhanced-table-modal') || this.createModal();
    
    const enhancedData = schema.enhancedMetadata;
    const variableAnalysis = schema.variableAnalysis || {};
    const dependencyAnalysis = schema.dependencyAnalysis || {};
    const columnLineage = schema.columnLineage || {};
    
    let html = `
      <div class="p-6">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-xl font-semibold">Enhanced Analysis: ${table.name}</h2>
          <button onclick="this.closest('.modal-backdrop').classList.add('hidden')" 
                  class="text-gray-400 hover:text-gray-600">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        
        <!-- Overview Metrics -->
        <div class="grid grid-cols-4 gap-4 mb-6">
          <div class="bg-surface-light p-3 rounded-lg">
            <div class="text-2xl font-bold text-primary">${enhancedData?.metrics?.totalVariables || 0}</div>
            <div class="text-sm text-gray-500">Variables</div>
          </div>
          <div class="bg-surface-light p-3 rounded-lg">
            <div class="text-2xl font-bold text-accent">${enhancedData?.metrics?.totalTables || 0}</div>
            <div class="text-sm text-gray-500">Dependencies</div>
          </div>
          <div class="bg-surface-light p-3 rounded-lg">
            <div class="text-2xl font-bold text-warning">${enhancedData?.metrics?.unusedVariables || 0}</div>
            <div class="text-sm text-gray-500">Unused</div>
          </div>
          <div class="bg-surface-light p-3 rounded-lg">
            <div class="text-2xl font-bold text-success">${enhancedData?.metrics?.totalCTEs || 0}</div>
            <div class="text-sm text-gray-500">CTEs</div>
          </div>
        </div>
        
        <!-- Tabs -->
        <div class="border-b border-surface-light mb-4">
          <nav class="flex space-x-8">
            <button onclick="window.enhancedUI.showTab('variables')" 
                    class="tab-btn py-2 px-1 border-b-2 border-primary font-medium text-primary" 
                    data-tab="variables">
              Variables (${Object.keys(variableAnalysis).length})
            </button>
            <button onclick="window.enhancedUI.showTab('dependencies')" 
                    class="tab-btn py-2 px-1 border-b-2 border-transparent font-medium text-gray-500 hover:text-gray-700" 
                    data-tab="dependencies">
              Dependencies (${Object.keys(dependencyAnalysis).length})
            </button>
            <button onclick="window.enhancedUI.showTab('lineage')" 
                    class="tab-btn py-2 px-1 border-b-2 border-transparent font-medium text-gray-500 hover:text-gray-700" 
                    data-tab="lineage">
              Column Lineage (${Object.keys(columnLineage).length})
            </button>
            <button onclick="window.enhancedUI.showTab('ctes')" 
                    class="tab-btn py-2 px-1 border-b-2 border-transparent font-medium text-gray-500 hover:text-gray-700" 
                    data-tab="ctes">
              CTEs (${Object.keys(enhancedData?.cteDependencies || {}).length})
            </button>
          </nav>
        </div>
        
        <!-- Tab Content -->
        <div id="tab-content">
          ${this.renderVariablesTab(variableAnalysis)}
        </div>
      </div>
    `;
    
    modal.querySelector('.modal-content').innerHTML = html;
    modal.classList.remove('hidden');
  }

  // Render variables tab
  renderVariablesTab(variableAnalysis) {
    const variables = Object.values(variableAnalysis);
    const usedVars = variables.filter(v => v.isUsed);
    const unusedVars = variables.filter(v => !v.isUsed);
    
    return `
      <div class="space-y-4">
        ${usedVars.length > 0 ? `
          <div>
            <h3 class="text-lg font-medium mb-3 text-green-600">Used Variables (${usedVars.length})</h3>
            <div class="space-y-2">
              ${usedVars.map(variable => this.renderVariableCard(variable, true)).join('')}
            </div>
          </div>
        ` : ''}
        
        ${unusedVars.length > 0 ? `
          <div>
            <h3 class="text-lg font-medium mb-3 text-orange-600">Unused Variables (${unusedVars.length})</h3>
            <div class="space-y-2">
              ${unusedVars.map(variable => this.renderVariableCard(variable, false)).join('')}
            </div>
          </div>
        ` : ''}
        
        ${variables.length === 0 ? `
          <div class="text-center py-8 text-gray-500">
            <span class="material-symbols-outlined text-4xl mb-2">code</span>
            <p>No variables detected in this query</p>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Render individual variable card
  renderVariableCard(variable, isUsed) {
    const statusColor = isUsed ? 'text-green-600' : 'text-orange-600';
    const statusIcon = isUsed ? 'check_circle' : 'warning';
    
    return `
      <div class="bg-surface-light p-4 rounded-lg border-l-4 ${isUsed ? 'border-green-500' : 'border-orange-500'}">
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined ${statusColor}">${statusIcon}</span>
            <code class="font-mono text-sm bg-surface px-2 py-1 rounded">${variable.name}</code>
            <span class="text-xs text-gray-500">${variable.type}</span>
          </div>
          <div class="flex items-center gap-2 text-xs text-gray-500">
            ${variable.isCTE ? '<span class="bg-purple-100 text-purple-700 px-2 py-1 rounded">CTE</span>' : ''}
            ${variable.isTempTable ? '<span class="bg-blue-100 text-blue-700 px-2 py-1 rounded">Temp Table</span>' : ''}
            ${variable.isParameter ? '<span class="bg-gray-100 text-gray-700 px-2 py-1 rounded">Parameter</span>' : ''}
          </div>
        </div>
        
        ${variable.declaration ? `
          <div class="mb-2">
            <div class="text-xs text-gray-500 mb-1">Declaration:</div>
            <code class="text-xs bg-surface p-2 rounded block">${variable.declaration}</code>
          </div>
        ` : ''}
        
        ${isUsed && variable.usage.length > 0 ? `
          <div>
            <div class="text-xs text-gray-500 mb-1">Usage (${variable.usage.length} times):</div>
            <div class="space-y-1">
              ${variable.usage.slice(0, 3).map(usage => `
                <div class="text-xs bg-surface p-2 rounded">
                  <span class="text-gray-500">Line ${usage.lineNumber}:</span> 
                  <span class="text-gray-700">${usage.context}</span>
                  <span class="text-xs text-gray-400 ml-2">(${usage.type})</span>
                </div>
              `).join('')}
              ${variable.usage.length > 3 ? `
                <div class="text-xs text-gray-500 italic">... and ${variable.usage.length - 3} more</div>
              ` : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Render dependencies tab
  renderDependenciesTab(dependencyAnalysis) {
    const dependencies = Object.entries(dependencyAnalysis);
    
    return `
      <div class="space-y-4">
        ${dependencies.map(([tableName, deps]) => `
          <div class="bg-surface-light p-4 rounded-lg">
            <h4 class="font-medium mb-2 flex items-center gap-2">
              <span class="material-symbols-outlined text-primary">table_chart</span>
              <code>${tableName}</code>
              <span class="text-xs text-gray-500">(${deps.length} references)</span>
            </h4>
            <div class="space-y-2">
              ${deps.map(dep => this.renderDependency(dep)).join('')}
            </div>
          </div>
        `).join('')}
        
        ${dependencies.length === 0 ? `
          <div class="text-center py-8 text-gray-500">
            <span class="material-symbols-outlined text-4xl mb-2">link</span>
            <p>No table dependencies detected</p>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Render individual dependency
  renderDependency(dep) {
    const typeColors = {
      direct: 'text-green-600',
      implicit: 'text-blue-600'
    };
    
    return `
      <div class="flex items-center justify-between p-2 bg-surface rounded">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-sm ${typeColors[dep.type] || 'text-gray-600'}">
            ${dep.type === 'direct' ? 'link' : 'find_in_page'}
          </span>
          <span class="text-sm">${dep.type}</span>
          ${dep.alias ? `<code class="text-xs bg-surface-light px-1 rounded">${dep.alias}</code>` : ''}
        </div>
        <div class="text-xs text-gray-500">
          Line ${dep.lineNumber} • Confidence ${(dep.confidence * 100).toFixed(0)}%
        </div>
      </div>
    `;
  }

  // Render column lineage tab
  renderLineageTab(columnLineage) {
    const columns = Object.entries(columnLineage);
    
    return `
      <div class="space-y-4">
        ${columns.map(([columnName, lineage]) => `
          <div class="bg-surface-light p-4 rounded-lg">
            <h4 class="font-medium mb-2 flex items-center gap-2">
              <span class="material-symbols-outlined text-primary">account_tree</span>
              <code>${columnName}</code>
              ${lineage.isAggregated ? '<span class="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">Aggregated</span>' : ''}
              ${lineage.isComputed ? '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Computed</span>' : ''}
            </h4>
            
            ${lineage.sources.length > 0 ? `
              <div class="mb-2">
                <div class="text-xs text-gray-500 mb-1">Source Columns:</div>
                <div class="flex flex-wrap gap-1">
                  ${lineage.sources.map(source => `
                    <span class="text-xs bg-surface px-2 py-1 rounded border border-surface-light">
                      <code>${source.table}.${source.column}</code>
                    </span>
                  `).join('')}
                </div>
              </div>
            ` : ''}
            
            ${lineage.transformations.length > 0 ? `
              <div class="mb-2">
                <div class="text-xs text-gray-500 mb-1">Transformations:</div>
                <div class="flex flex-wrap gap-1">
                  ${lineage.transformations.map(trans => `
                    <span class="text-xs bg-accent/10 text-accent px-2 py-1 rounded">
                      ${trans.type === 'function' ? `🔧 ${trans.name}()` : 
                        trans.type === 'cast' ? `🔄 CAST(${trans.targetType})` :
                        trans.type === 'operation' ? `⚡ ${trans.operator}` : trans.type}
                    </span>
                  `).join('')}
                </div>
              </div>
            ` : ''}
            
            ${lineage.lineage.length > 0 ? `
              <div>
                <div class="text-xs text-gray-500 mb-1">Lineage Path:</div>
                <div class="text-xs bg-surface p-2 rounded font-mono">
                  ${lineage.lineage.map(path => path.join(' → ')).join(' | ')}
                </div>
              </div>
            ` : ''}
          </div>
        `).join('')}
        
        ${columns.length === 0 ? `
          <div class="text-center py-8 text-gray-500">
            <span class="material-symbols-outlined text-4xl mb-2">schema</span>
            <p>No column lineage detected</p>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Render CTEs tab
  renderCTEsTab(cteDependencies) {
    const ctes = Object.entries(cteDependencies);
    
    return `
      <div class="space-y-4">
        ${ctes.map(([cteName, cteInfo]) => `
          <div class="bg-surface-light p-4 rounded-lg">
            <h4 class="font-medium mb-2 flex items-center gap-2">
              <span class="material-symbols-outlined text-primary">data_object</span>
              <code>${cteName}</code>
              <span class="text-xs ${cteInfo.isUsed ? 'text-green-600' : 'text-orange-600'}">
                ${cteInfo.isUsed ? '✓ Used' : '⚠ Unused'}
              </span>
            </h4>
            
            ${cteInfo.dependencies.length > 0 ? `
              <div class="mb-2">
                <div class="text-xs text-gray-500 mb-1">Dependencies:</div>
                <div class="flex flex-wrap gap-1">
                  ${cteInfo.dependencies.map(dep => `
                    <span class="text-xs bg-surface px-2 py-1 rounded border border-surface-light">
                      ${dep}
                    </span>
                  `).join('')}
                </div>
              </div>
            ` : ''}
            
            ${cteInfo.usage.length > 0 ? `
              <div>
                <div class="text-xs text-gray-500 mb-1">Usage:</div>
                <div class="space-y-1">
                  ${cteInfo.usage.map(usage => `
                    <div class="text-xs bg-surface p-2 rounded">
                      ${usage.alias ? `as <code>${usage.alias}</code>` : 'direct reference'} 
                      <span class="text-gray-400">(${usage.context})</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        `).join('')}
        
        ${ctes.length === 0 ? `
          <div class="text-center py-8 text-gray-500">
            <span class="material-symbols-outlined text-4xl mb-2">view_comfy</span>
            <p>No CTEs detected</p>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Switch between tabs
  showTab(tabName) {
    const tabs = document.querySelectorAll('.tab-btn');
    const content = document.getElementById('tab-content');
    
    // Update tab buttons
    tabs.forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('border-primary', 'text-primary');
        tab.classList.remove('border-transparent', 'text-gray-500');
      } else {
        tab.classList.remove('border-primary', 'text-primary');
        tab.classList.add('border-transparent', 'text-gray-500');
      }
    });
    
    // Update content
    const analysis = this.currentSchema.enhancedMetadata;
    switch (tabName) {
      case 'variables':
        content.innerHTML = this.renderVariablesTab(analysis.variableAnalysis || {});
        break;
      case 'dependencies':
        content.innerHTML = this.renderDependenciesTab(analysis.dependencyAnalysis || {});
        break;
      case 'lineage':
        content.innerHTML = this.renderLineageTab(analysis.columnLineage || {});
        break;
      case 'ctes':
        content.innerHTML = this.renderCTEsTab(analysis.cteDependencies || {});
        break;
    }
  }

  // Create modal if it doesn't exist
  createModal() {
    const modal = document.createElement('div');
    modal.id = 'enhanced-table-modal';
    modal.className = 'modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-50 hidden flex items-center justify-center';
    modal.innerHTML = `
      <div class="modal-content bg-surface rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl border border-surface-light">
        <!-- Content will be inserted here -->
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }
}

// Global instance
window.enhancedUI = new EnhancedAnalysisUI();
