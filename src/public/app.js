// API基础URL
const API_BASE = '/api';

// 版本标识 - 用于确认代码已更新
console.log('=== app.js v8 (fix grid sort + highlight change) loaded ===');

// 状态管理
let concepts = [];
let refreshInterval = null;
const REFRESH_INTERVAL = 5000; // 5秒刷新一次

// 排序状态管理（每个概念独立管理）
const sortStates = {}; // { conceptId: { field: 'price'|'change'|'changePercent'|'amount', order: 'asc'|'desc' } }

// 入选理由显示状态（每个概念独立管理）
const showReasonStates = {}; // { conceptId: boolean }

// 全局折叠状态
let globalCollapsed = false; // 全局折叠/展开状态

// 全局排序方向（板块涨幅排序）
let globalSortOrder = 'desc'; // 'asc' 或 'desc'

// 板块涨幅缓存（用于排序）
const conceptChangePercent = {}; // { conceptId: number }

// 格式化成交额（API返回的单位是"万"）
function formatAmount(amount) {
  if (!amount || amount === 0) return '-';
  if (amount >= 1e8) {
    return (amount / 1e8).toFixed(2) + '亿';
  }
  return (amount /10000).toFixed(0) + '万';
}

// DOM元素
const elements = {
  form: document.getElementById('addConceptForm'),
  conceptInput: document.getElementById('conceptName'),
  addBtn: document.getElementById('addBtn'),
  conceptsList: document.getElementById('conceptsList'),
  loading: document.getElementById('loading'),
  emptyState: document.getElementById('emptyState')
};

// 初始化
async function init() {
  setupEventListeners();
  await loadConcepts();
  startAutoRefresh();
}

// 设置事件监听
function setupEventListeners() {
  elements.form.addEventListener('submit', handleAddConcept);
}

// 加载所有概念
async function loadConcepts() {
  showLoading(true);
  try {
    const response = await fetch(`${API_BASE}/concepts`);
    const result = await response.json();

    if (result.success) {
      concepts = result.data;
      renderConcepts();

      // 加载每个概念的行情
      for (const concept of concepts) {
        await loadConceptQuotes(concept.id);
      }

      // 所有概念行情加载完成后，按涨幅排序
      setTimeout(() => {
        reorderConceptCards();
      }, 100);
    }
  } catch (error) {
    console.error('加载概念失败:', error);
  } finally {
    showLoading(false);
  }
}

// 加载单个概念的行情
async function loadConceptQuotes(conceptId, forceRebuild = false) {
  try {
    const response = await fetch(`${API_BASE}/concepts/${conceptId}/stocks`);
    const result = await response.json();

    console.log('API response for concept', conceptId, ':', result);

    if (result.success) {
      updateConceptQuotes(conceptId, result.data, forceRebuild);
    }
  } catch (error) {
    console.error(`加载概念 ${conceptId} 行情失败:`, error);
  }
}

// 更新概念行情显示
function updateConceptQuotes(conceptId, data, forceRebuild = false) {
  console.log('updateConceptQuotes called with data:', data, 'forceRebuild:', forceRebuild);
  const container = document.querySelector(`[data-concept-id="${conceptId}"]`);
  if (!container) return;

  const stocksContainer = container.querySelector('.stocks-container');
  if (!stocksContainer) return;

  // 获取原始概念数据（包含 reason 字段）
  const concept = concepts.find(c => c.id === conceptId);
  const originalStocks = concept?.stocks || [];

  if (data.quotes.length === 0) {
    stocksContainer.innerHTML = `
      <div class="text-gray-500 text-center py-4">
        暂无成分股数据
      </div>
    `;
    return;
  }

  // 合并行情数据和原始股票数据（保留 reason 字段）
  const mergedQuotes = data.quotes.map(quote => {
    const originalStock = originalStocks.find(s => s.code === quote.code);
    return {
      ...quote,
      reason: originalStock?.reason || ''
    };
  });

  // 检查是否已经有股票列表（判断是否为首次加载）
  const existingStockItems = stocksContainer.querySelectorAll('.stock-item');
  const isFirstLoad = existingStockItems.length === 0;

  // 获取当前排序状态
  const sortState = sortStates[conceptId] || { field: 'amount', order: 'desc' };

  // 对数据进行排序
  const sortedQuotes = [...mergedQuotes].sort((a, b) => {
    const aVal = a[sortState.field] || 0;
    const bVal = b[sortState.field] || 0;
    return sortState.order === 'asc' ? aVal - bVal : bVal - aVal;
  });

  // 检查是否需要完全重建（首次加载 或 现有数据是占位符 或 强制重建）
  const needsRebuild = forceRebuild || isFirstLoad || (
    existingStockItems.length > 0 &&
    !existingStockItems[0].querySelector('[data-field="price"]')?.textContent.includes('.')
  );

  if (needsRebuild) {
    // 首次加载或数据是占位符：渲染完整HTML（带fade-in动画）
    const showReason = showReasonStates[conceptId] || false;

    // 先添加表头（带排序功能）
    let html = `
      <div class="stock-header">
        <div class="text-xs">名称</div>
        <div class="text-right text-xs sortable ${sortState.field === 'price' ? 'active' : ''}" onclick="sortStocks('${conceptId}', 'price', event)">
          价格 <span class="sort-indicator">${getSortIndicator('price', sortState)}</span>
        </div>
        <div class="text-right text-xs sortable ${sortState.field === 'change' ? 'active' : ''}" onclick="sortStocks('${conceptId}', 'change', event)">
          涨跌 <span class="sort-indicator">${getSortIndicator('change', sortState)}</span>
        </div>
        <div class="text-right text-xs sortable ${sortState.field === 'changePercent' ? 'active' : ''}" onclick="sortStocks('${conceptId}', 'changePercent', event)">
          涨幅 <span class="sort-indicator">${getSortIndicator('changePercent', sortState)}</span>
        </div>
        <div class="text-right text-xs sortable ${sortState.field === 'amount' ? 'active' : ''}" onclick="sortStocks('${conceptId}', 'amount', event)">
          成交额 <span class="sort-indicator">${getSortIndicator('amount', sortState)}</span>
        </div>
      </div>
    `;
    // 再添加股票列表
    html += sortedQuotes.map(quote => `
      <div class="stock-item fade-in" data-code="${quote.code}">
        <div class="border-b border-gray-700 last:border-0">
          <!-- 股票信息行 -->
          <div class="grid grid-cols-[1fr_1fr_4rem_4rem_5rem] gap-2 py-2 items-center text-xs">
            <div class="min-w-0">
              <div class="font-medium text-xs truncate">${quote.name || '-'}</div>
              <div class="text-xs text-gray-500">${quote.code}</div>
            </div>
            <div class="text-right">
              <div class="font-medium ${getStatusClass(quote)}" data-field="price">
                ${quote.price > 0 ? quote.price.toFixed(2) : '-'}
              </div>
            </div>
            <div class="text-right">
              <div class="${getStatusClass(quote)}" data-field="change">
                ${quote.change > 0 ? '+' : ''}${quote.change.toFixed(2)}
              </div>
            </div>
            <div class="text-right">
              <div class="${getStatusClass(quote)} highlight-change" data-field="changePercent">
                ${quote.changePercent > 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%
              </div>
            </div>
            <div class="text-right">
              <div class="${getStatusClass(quote)}" data-field="amount">
                ${formatAmount(quote.amount)}
              </div>
            </div>
          </div>
          <!-- 入选理由行（单独一行） -->
          ${showReason && quote.reason ? `
            <div class="stock-reason text-blue-400 text-xs py-1 px-2">${quote.reason}</div>
          ` : ''}
        </div>
      </div>
    `).join('');
    stocksContainer.innerHTML = html;
  } else {
    // 后续刷新：只更新价格数值，不重建HTML
    mergedQuotes.forEach(quote => {
      const stockItem = stocksContainer.querySelector(`.stock-item[data-code="${quote.code}"]`);
      if (!stockItem) return;

      // 更新价格
      const priceEl = stockItem.querySelector('[data-field="price"]');
      if (priceEl) {
        priceEl.textContent = quote.price > 0 ? quote.price.toFixed(2) : '-';
        updateElementClass(priceEl, getStatusClass(quote));
      }

      // 更新涨跌额
      const changeEl = stockItem.querySelector('[data-field="change"]');
      if (changeEl) {
        changeEl.textContent = `${quote.change > 0 ? '+' : ''}${quote.change.toFixed(2)}`;
        updateElementClass(changeEl, getStatusClass(quote));
      }

      // 更新涨跌幅
      const changePercentEl = stockItem.querySelector('[data-field="changePercent"]');
      if (changePercentEl) {
        changePercentEl.textContent = `${quote.changePercent > 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`;
        updateElementClass(changePercentEl, getStatusClass(quote));
      }

      // 更新成交额
      const amountEl = stockItem.querySelector('[data-field="amount"]');
      if (amountEl) {
        amountEl.textContent = formatAmount(quote.amount);
        updateElementClass(amountEl, getStatusClass(quote));
      }
    });
  }

  // 更新时间
  const timeElement = container.querySelector('.update-time');
  if (timeElement) {
    timeElement.textContent = formatTime(data.updateTime);
  }

  // 更新板块涨幅
  console.log('updateConceptQuotes: data.avgChangePercent =', data.avgChangePercent, 'conceptId =', conceptId);
  if (data.avgChangePercent !== undefined) {
    // 缓存板块涨幅用于排序
    const oldChange = conceptChangePercent[conceptId];
    conceptChangePercent[conceptId] = data.avgChangePercent;

    const conceptChangeEl = container.querySelector('.concept-change');
    console.log('conceptChangeEl found:', conceptChangeEl, 'in container:', container);
    if (conceptChangeEl) {
      const change = data.avgChangePercent;
      const sign = change > 0 ? '+' : '';
      const text = `(${sign}${change.toFixed(2)}%)`;
      console.log('Setting concept change text to:', text);
      conceptChangeEl.textContent = text;
      // 更新颜色类
      updateElementClass(conceptChangeEl, getStatusClass({ change }));
    }

    // 如果板块涨幅发生变化且不是首次加载，触发重新排序
    if (oldChange !== undefined && oldChange !== data.avgChangePercent) {
      // 使用防抖延迟重新排序，避免频繁重排
      if (window._sortTimeout) clearTimeout(window._sortTimeout);
      window._sortTimeout = setTimeout(() => {
        reorderConceptCards();
      }, 500);
    }
  }
}

// 辅助函数：更新元素的CSS类（移除旧的涨跌类和Tailwind颜色类，添加新的）
function updateElementClass(element, newClass) {
  const hasHighlight = element.classList.contains('highlight-change');
  element.classList.remove('up', 'down', 'flat');
  // 移除 Tailwind 的文字颜色类（text-gray-xxx, text-red-xxx, text-green-xxx等）
  const classes = element.className.split(' ');
  const filteredClasses = classes.filter(c => !c.startsWith('text-'));
  element.className = filteredClasses.join(' ');
  // 添加新的涨跌类
  element.classList.add(newClass);
  // 保留 highlight-change 类
  if (hasHighlight) element.classList.add('highlight-change');
}

// 获取排序指示器
function getSortIndicator(field, sortState) {
  if (sortState.field !== field) return '⇅';
  return sortState.order === 'asc' ? '↑' : '↓';
}

// 排序股票列表
function sortStocks(conceptId, field, event) {
  console.log('sortStocks called:', conceptId, field);
  event.preventDefault();
  event.stopPropagation();

  const currentSort = sortStates[conceptId] || { field: 'amount', order: 'desc' };

  // 如果点击的是当前排序列，则切换排序方向
  if (currentSort.field === field) {
    sortStates[conceptId] = {
      field: field,
      order: currentSort.order === 'asc' ? 'desc' : 'asc'
    };
  } else {
    // 点击新列，默认降序
    sortStates[conceptId] = {
      field: field,
      order: 'desc'
    };
  }

  console.log('New sort state:', sortStates[conceptId]);

  // 重新加载行情以应用排序，强制重建HTML
  loadConceptQuotes(conceptId, true);
}

// 确保函数在全局作用域中可访问
window.sortStocks = sortStocks;
window.refreshConcept = refreshConcept;
window.deleteConcept = deleteConcept;
window.toggleReason = toggleReason;
window.toggleGlobalCollapse = toggleGlobalCollapse;
window.toggleSortOrder = toggleSortOrder;

// 按板块涨幅重排序卡片（使用 CSS order，无闪烁）
function reorderConceptCards() {
  const container = elements.conceptsList;
  if (!container) return;

  // 获取所有卡片并按涨幅排序
  const cards = Array.from(container.querySelectorAll('.concept-card'));
  cards.sort((a, b) => {
    const idA = a.dataset.conceptId;
    const idB = b.dataset.conceptId;
    const changeA = conceptChangePercent[idA] || -9999;
    const changeB = conceptChangePercent[idB] || -9999;
    return globalSortOrder === 'desc' ? changeB - changeA : changeA - changeB;
  });

  // 使用 CSS order 属性排序（不移动 DOM 元素，避免重排）
  cards.forEach((card, index) => {
    card.style.order = index;
  });
}

// 切换入选理由显示
function toggleReason(conceptId) {
  showReasonStates[conceptId] = !showReasonStates[conceptId];

  // 更新按钮文字
  const container = document.querySelector(`[data-concept-id="${conceptId}"]`);
  if (container) {
    const toggleBtn = container.querySelector('button[onclick^="toggleReason"]');
    if (toggleBtn) {
      const showReason = showReasonStates[conceptId];
      toggleBtn.textContent = showReason ? '隐藏' : '理由';
      toggleBtn.title = showReason ? '隐藏理由' : '显示理由';
    }
  }

  // 重新渲染当前概念的股票列表
  loadConceptQuotes(conceptId, true);
}

// 切换全局折叠/展开状态
function toggleGlobalCollapse() {
  globalCollapsed = !globalCollapsed;
  const btn = document.getElementById('collapseBtn');
  if (btn) {
    btn.textContent = globalCollapsed ? '展开全部' : '折叠全部';
  }

  // 切换所有板块的股票列表显示
  const containers = document.querySelectorAll('.stocks-container');
  containers.forEach(container => {
    container.style.display = globalCollapsed ? 'none' : '';
  });
}

// 切换全局排序方向
function toggleSortOrder() {
  globalSortOrder = globalSortOrder === 'desc' ? 'asc' : 'desc';
  const btn = document.getElementById('sortOrderBtn');
  if (btn) {
    btn.textContent = globalSortOrder === 'desc' ? '倒序 ↓' : '正序 ↑';
  }
  // 重新排序
  reorderConceptCards();
}

// 获取涨跌状态样式类
function getStatusClass(quote) {
  if (quote.change > 0) return 'up';
  if (quote.change < 0) return 'down';
  return 'flat';
}

// 渲染股票列表（含理由）- 初始渲染时使用
function renderStocksList(stocks, conceptId, showReason = false) {
  if (!stocks || stocks.length === 0) {
    return '<div class="text-gray-500 text-center py-2 text-sm">暂无成分股数据</div>';
  }

  const showReasonState = showReasonStates[conceptId] || showReason;

  // 先添加表头（带排序功能）
  let html = `
    <div class="stock-header">
      <div class="text-xs">名称</div>
      <div class="text-right text-xs sortable" onclick="sortStocks('${conceptId}', 'price', event)">
        价格 <span class="sort-indicator">⇅</span>
      </div>
      <div class="text-right text-xs sortable" onclick="sortStocks('${conceptId}', 'change', event)">
        涨跌 <span class="sort-indicator">⇅</span>
      </div>
      <div class="text-right text-xs sortable" onclick="sortStocks('${conceptId}', 'changePercent', event)">
        涨幅 <span class="sort-indicator">⇅</span>
      </div>
      <div class="text-right text-xs sortable" onclick="sortStocks('${conceptId}', 'amount', event)">
        成交额 <span class="sort-indicator">⇅</span>
      </div>
    </div>
  `;
  // 再添加股票列表
  html += stocks.map(stock => `
    <div class="stock-item fade-in" data-code="${stock.code}">
      <div class="border-b border-gray-700 last:border-0">
        <!-- 股票信息行 -->
        <div class="grid grid-cols-[1fr_1fr_4rem_4rem_5rem] gap-2 py-2 items-center text-xs">
          <div class="min-w-0">
            <div class="font-medium text-xs truncate">${stock.name || '-'}</div>
            <div class="text-xs text-gray-500">${stock.code}</div>
          </div>
          <div class="text-right">
            <div class="font-medium text-gray-400" data-field="price">-</div>
          </div>
          <div class="text-right">
            <div class="text-gray-400" data-field="change">-</div>
          </div>
          <div class="text-right">
            <div class="text-gray-400 highlight-change" data-field="changePercent">-</div>
          </div>
          <div class="text-right">
            <div class="text-gray-400" data-field="amount">-</div>
          </div>
        </div>
        <!-- 入选理由行（单独一行） -->
        ${showReasonState && stock.reason ? `
          <div class="stock-reason text-blue-400 text-xs py-1 px-2">${stock.reason}</div>
        ` : ''}
      </div>
    </div>
  `).join('');

  return html;
}

// 格式化时间
function formatTime(isoString) {
  if (!isoString) return '-';

  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// 渲染概念列表
function renderConcepts() {
  if (concepts.length === 0) {
    elements.conceptsList.innerHTML = '';
    elements.emptyState.classList.remove('hidden');
    return;
  }

  elements.emptyState.classList.add('hidden');

  // 按板块涨幅排序（根据全局排序方向）
  const sortedConcepts = [...concepts].sort((a, b) => {
    const changeA = conceptChangePercent[a.id] || -9999;
    const changeB = conceptChangePercent[b.id] || -9999;
    return globalSortOrder === 'desc' ? changeB - changeA : changeA - changeB;
  });

  elements.conceptsList.innerHTML = sortedConcepts.map(concept => {
    const showReason = showReasonStates[concept.id] || false;
    const change = conceptChangePercent[concept.id];
    const changeText = change !== undefined ? `(${change > 0 ? '+' : ''}${change.toFixed(2)}%)` : '-';

    return `
    <div class="concept-card bg-gray-800 rounded-lg overflow-hidden fade-in flex flex-col" data-concept-id="${concept.id}">
      <div class="p-3 border-b border-gray-700 flex justify-between items-center shrink-0">
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-bold truncate">
            ${concept.name}
            <span class="ml-2 text-sm concept-change" data-concept-id="${concept.id}">${changeText}</span>
          </h2>
          <p class="text-xs text-gray-400">
            成分股: ${concept.stocks?.length || 0} 只
            <span class="mx-1">|</span>
            更新: <span class="update-time">-</span>
          </p>
        </div>
        <div class="flex gap-1 shrink-0 ml-2">
          <button
            onclick="toggleReason('${concept.id}')"
            class="bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-sm transition-colors"
            title="${showReason ? '隐藏理由' : '显示理由'}"
          >
            ${showReason ? '隐藏' : '理由'}
          </button>
          <button
            onclick="refreshConcept('${concept.id}')"
            class="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-sm transition-colors"
            title="刷新"
          >
            刷新
          </button>
          <button
            onclick="deleteConcept('${concept.id}')"
            class="bg-red-600 hover:bg-red-700 px-2 py-1 rounded text-sm transition-colors"
            title="删除"
          >
            删除
          </button>
        </div>
      </div>
      <div class="stocks-container p-2 flex-1 overflow-auto" style="max-height: 400px;">
        ${renderStocksList(concept.stocks || [], concept.id, showReason)}
      </div>
    </div>
  `;
  }).join('');
}

// 添加概念
async function handleAddConcept(e) {
  e.preventDefault();
  
  const name = elements.conceptInput.value.trim();
  if (!name) return;

  setAddingState(true);

  try {
    const response = await fetch(`${API_BASE}/concepts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    const result = await response.json();
    
    if (result.success) {
      concepts.push(result.data);
      renderConcepts();
      await loadConceptQuotes(result.data.id);
      elements.conceptInput.value = '';
    } else {
      alert('添加失败: ' + result.error);
    }
  } catch (error) {
    console.error('添加概念失败:', error);
    alert('添加失败，请重试');
  } finally {
    setAddingState(false);
  }
}

// 刷新单个概念行情
async function refreshConcept(conceptId) {
  // 直接刷新，不再显示"刷新中..."（现在是平滑更新）
  await loadConceptQuotes(conceptId);
}

// 删除概念
async function deleteConcept(conceptId) {
  if (!confirm('确定要删除这个概念吗？')) return;

  try {
    const response = await fetch(`${API_BASE}/concepts/${conceptId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      concepts = concepts.filter(c => c.id !== conceptId);
      renderConcepts();
    } else {
      alert('删除失败: ' + result.error);
    }
  } catch (error) {
    console.error('删除概念失败:', error);
    alert('删除失败，请重试');
  }
}

// 显示/隐藏加载状态
function showLoading(show) {
  elements.loading.classList.toggle('hidden', !show);
}

// 设置添加按钮状态
function setAddingState(adding) {
  elements.addBtn.disabled = adding;
  elements.addBtn.textContent = adding ? '搜索中...' : '搜索并添加';
}

// 开始自动刷新
function startAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }

  refreshInterval = setInterval(() => {
    concepts.forEach(concept => {
      loadConceptQuotes(concept.id);
    });
  }, REFRESH_INTERVAL);
}

// 停止自动刷新
function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// 页面可见性变化时控制刷新
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAutoRefresh();
  } else {
    startAutoRefresh();
  }
});

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
});

// 启动应用
init();
