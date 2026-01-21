// API基础URL
const API_BASE = '/api';

// Safari兼容性辅助函数
function padZero(num) {
  return num < 10 ? '0' + num : num.toString();
}

// 版本标识 - 用于确认代码已更新
console.log('=== app.js v11 loaded ===');

// 状态管理
let concepts = [];
let deletedConcepts = [];  // 已删除概念列表
let isTrashView = false;   // 当前视图状态
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

// 图表相关变量
let chartInstance = null;
let currentChartType = 'minute';
let currentStockCode = null;
let hoverTimer = null;
let hideTimer = null;
let chartCache = {}; // 缓存图表数据 {code: {type: {data, timestamp}}}

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

      // 更新按钮文字和数量
      updateButtons();
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

    if (result.success) {
      updateConceptQuotes(conceptId, result.data, forceRebuild);
    }
  } catch (error) {
    console.error(`加载概念 ${conceptId} 行情失败:`, error);
  }
}

// 更新概念行情显示
function updateConceptQuotes(conceptId, data, forceRebuild = false) {
  const container = document.querySelector(`[data-concept-id="${conceptId}"]`);
  if (!container) return;

  const stocksContainer = container.querySelector('.stocks-container');
  if (!stocksContainer) return;

  // 获取原始概念数据（包含 reason 字段）
  const concept = concepts.find(c => c.id === conceptId);
  const originalStocks = concept && concept.stocks ? concept.stocks : [];

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
      reason: originalStock && originalStock.reason ? originalStock.reason : ''
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
    (function() {
      const priceEl = existingStockItems[0].querySelector('[data-field="price"]');
      return !priceEl || !priceEl.textContent.includes('.');
    })()
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
    html += sortedQuotes.map(quote => {
      const jsCode = escapeJs(quote.code);
      const jsName = escapeJs(quote.name);
      const htmlCode = escapeHtml(quote.code);
      const htmlName = escapeHtml(quote.name);
      const htmlReason = escapeHtml(quote.reason || '');

      return `
      <div class="stock-item fade-in" data-code="${htmlCode}">
        <div class="border-b border-gray-700 last:border-0">
          <!-- 股票信息行 -->
          <div class="grid grid-cols-[1fr_1fr_4rem_4rem_5rem] gap-2 py-2 items-center text-xs">
            <div class="min-w-0">
              <div class="font-medium text-xs truncate cursor-pointer hover:text-blue-400 transition-colors"
                   onmouseenter="showChartPopup('${jsCode}', '${jsName}', this)"
                   onmouseleave="delayHideChart()">
                ${htmlName || '-'}
              </div>
              <div class="text-xs text-gray-500">${htmlCode}</div>
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
          ${showReason && htmlReason ? `
            <div class="stock-reason text-blue-400 text-xs py-1 px-2">${htmlReason}</div>
          ` : ''}
        </div>
      </div>
    `;
    }).join('');
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
  if (data.avgChangePercent !== undefined) {
    // 缓存板块涨幅用于排序
    const oldChange = conceptChangePercent[conceptId];
    conceptChangePercent[conceptId] = data.avgChangePercent;

    const conceptChangeEl = container.querySelector('.concept-change');
    if (conceptChangeEl) {
      const change = data.avgChangePercent;
      const sign = change > 0 ? '+' : '';
      const text = `(${sign}${change.toFixed(2)}%)`;
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
// 图表相关函数
window.showChartPopup = showChartPopup;
window.hideChartPopup = hideChartPopup;
window.switchChartType = switchChartType;
window.closeChart = closeChart;
// 回收站相关函数
window.restoreConcept = restoreConcept;
window.permanentlyDeleteConcept = permanentlyDeleteConcept;
window.toggleTrashView = toggleTrashView;

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

// 更新按钮文字和数量的统一函数
function updateButtons() {
  // 更新折叠按钮
  const collapseBtn = document.getElementById('collapseBtn');
  if (collapseBtn) {
    const count = isTrashView ? deletedConcepts.length : concepts.length;
    collapseBtn.textContent = `${globalCollapsed ? '展开全部' : '折叠全部'} (${count})`;
    // 在回收站视图中禁用折叠按钮
    collapseBtn.disabled = isTrashView;
    // 添加禁用样式
    if (isTrashView) {
      collapseBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      collapseBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }

  // 更新回收站按钮
  const trashBtn = document.getElementById('trashBtn');
  if (trashBtn) {
    if (isTrashView) {
      trashBtn.textContent = '返回列表';
    } else {
      trashBtn.textContent = `🗑️ 回收站 (${deletedConcepts.length})`;
    }
  }
}

// 切换全局折叠/展开状态
function toggleGlobalCollapse() {
  globalCollapsed = !globalCollapsed;

  // 切换所有板块的股票列表显示
  const containers = document.querySelectorAll('.stocks-container');
  containers.forEach(container => {
    container.style.display = globalCollapsed ? 'none' : '';
  });

  // 只更新折叠按钮文字，不调用 updateButtons() 避免影响回收站按钮状态
  const collapseBtn = document.getElementById('collapseBtn');
  if (collapseBtn) {
    const count = isTrashView ? deletedConcepts.length : concepts.length;
    collapseBtn.textContent = `${globalCollapsed ? '展开全部' : '折叠全部'} (${count})`;
  }
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

// ====== 图表相关函数 ======

// 转义HTML内容（用于显示）
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 转义JavaScript字符串（用于事件处理器）
function escapeJs(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// 显示图表悬浮框
function showChartPopup(stockCode, stockName, element) {
  const popup = document.getElementById('chartPopup');
  const title = document.getElementById('chartTitle');

  if (!popup) {
    console.error('chartPopup element not found!');
    return;
  }

  currentStockCode = stockCode;
  title.textContent = stockName;

  // 计算位置
  const rect = element.getBoundingClientRect();
  const popupWidth = 350; // 预估宽度
  const popupHeight = 400; // 预估高度

  let left = rect.left;
  let top = rect.bottom + 10;

  // 防止超出右边界
  if (left + popupWidth > window.innerWidth) {
    left = window.innerWidth - popupWidth - 20;
  }

  // 防止超出下边界
  if (top + popupHeight > window.innerHeight) {
    top = rect.top - popupHeight - 10;
  }

  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.display = 'block';

  // 延迟加载（避免鼠标快速划过时频繁请求）
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    loadChartData(stockCode, currentChartType);
  }, 300);
}

// 隐藏图表悬浮框（立即隐藏）
function hideChartPopup() {
  clearTimeout(hoverTimer);
  clearTimeout(hideTimer);
  const popup = document.getElementById('chartPopup');
  if (popup) {
    popup.style.display = 'none';
  }
}

// 延迟隐藏弹窗（给用户时间移动鼠标到弹窗上）
function delayHideChart() {
  clearTimeout(hoverTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    const popup = document.getElementById('chartPopup');
    if (popup) {
      popup.style.display = 'none';
    }
  }, 300);
}

// 取消隐藏定时器（当鼠标进入弹窗时）
function cancelHideTimer() {
  clearTimeout(hoverTimer);
  clearTimeout(hideTimer);
}

// 调度隐藏（当鼠标离开弹窗时）
function scheduleHide() {
  clearTimeout(hoverTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    const popup = document.getElementById('chartPopup');
    popup.style.display = 'none';
  }, 200);
}

// 加载图表数据
async function loadChartData(code, type) {
  const loading = document.getElementById('chartLoading');
  const chartDiv = document.getElementById('stockChart');

  if (!loading || !chartDiv) {
    console.error('Chart elements not found!');
    return;
  }

  // 检查缓存（5分钟内有效）
  const cacheKey = `${code}_${type}`;
  const now = Date.now();
  if (chartCache[cacheKey] && (now - chartCache[cacheKey].timestamp < 300000)) {
    renderChart(chartCache[cacheKey].data, type);
    return;
  }

  loading.style.display = 'block';
  chartDiv.style.display = 'none';

  try {
    // 格式化股票代码（添加市场前缀）
    const formattedCode = formatStockCodeForChart(code);
    const apiType = type === 'minute' ? 'minute' : 'daily';
    const response = await fetch(`/api/charts/${apiType}/${formattedCode}`);
    const result = await response.json();

    if (result.success) {
      // 缓存数据
      chartCache[cacheKey] = {
        data: result.data,
        timestamp: now
      };
      renderChart(result.data, type);
    } else {
      console.error('图表API错误:', result.error);
      loading.textContent = '加载失败';
    }
  } catch (error) {
    console.error('加载图表异常:', error);
    loading.textContent = '加载失败';
  } finally {
    loading.style.display = 'none';
    chartDiv.style.display = 'block';

    // 确保图表在显示后正确调整尺寸
    setTimeout(function() {
      if (chartInstance) {
        chartInstance.resize();
      }
    }, 100);
  }
}

// 格式化股票代码（用于图表API）
function formatStockCodeForChart(code) {
  // 如果已经有sh/sz前缀，直接返回
  if (code.toLowerCase().startsWith('sh') || code.toLowerCase().startsWith('sz')) {
    return code.toLowerCase();
  }

  // 否则根据代码首位添加前缀
  const first = code.charAt(0);
  if (first === '6' || first === '8' || first === '9') {
    return 'sh' + code;
  } else {
    return 'sz' + code;
  }
}

// 渲染图表
function renderChart(data, type) {
  if (typeof echarts === 'undefined') {
    console.error('ECharts library not loaded!');
    return;
  }

  if (chartInstance) {
    chartInstance.dispose();
  }

  const chartDiv = document.getElementById('stockChart');
  if (!chartDiv) {
    console.error('Chart div not found!');
    return;
  }

  try {
    chartInstance = echarts.init(chartDiv);

    const option = type === 'minute'
      ? getMinuteChartOption(data)
      : getDailyChartOption(data);

    if (!option) {
      console.error('图表配置为空');
      return;
    }

    chartInstance.setOption(option);

    // 延迟调用 resize 确保容器尺寸已确定
    setTimeout(function() {
      if (chartInstance) {
        chartInstance.resize();
      }
    }, 50);
  } catch (error) {
    console.error('渲染图表失败:', error);
  }
}

// 分时图配置
function getMinuteChartOption(data) {
  if (!data || !data.times || !data.prices || data.times.length === 0) {
    console.error('分时数据为空:', data);
    return null;
  }

  // 转换价格为数字
  const numericPrices = data.prices.map(p => parseFloat(p));

  // 使用昨日收盘价作为基准
  const prevClose = data.prevClose || numericPrices[0];

  // 使用当日最高价和最低价计算涨跌幅
  // 优先使用API返回的dayHigh和dayLow，如果没有则从分时数据中计算
  const maxPrice = data.dayHigh ? data.dayHigh : Math.max(...numericPrices);
  const minPrice = data.dayLow ? data.dayLow : Math.min(...numericPrices);

  const maxChangeUp = ((maxPrice - prevClose) / prevClose * 100);
  const maxChangeDown = ((minPrice - prevClose) / prevClose * 100);

  // 计算边界的最大涨跌幅 = max(abs(最高价-昨收)/昨收, abs(最低价-昨收)/昨收)
  const maxChange = Math.max(Math.abs(maxChangeUp), Math.abs(maxChangeDown));

  // 生成10个等比例区间的刻度
  // 注意：数组从大到小排列（索引0是最大值，索引10是最小值）
  const tickCount = 10;
  const percentTicks = [];
  const priceTicks = [];

  for (let i = tickCount; i >= 0; i--) {
    const percent = -maxChange + (maxChange * 2 / tickCount) * i;
    percentTicks.push(parseFloat(percent.toFixed(2)));
    // 对应的价格 = 昨收 * (1 + 百分比/100)
    const price = prevClose * (1 + percent / 100);
    priceTicks.push(price);
  }

  // 数组索引0是最大值，索引tickCount是最小值
  // priceTicks[0] = 最高价格（对应+maxChange%）
  // priceTicks[tickCount] = 最低价格（对应-maxChange%）
  // priceTicks[tickCount/2] = 昨收（对应0%）

  // 横坐标：显示全天时间轴，每30分钟一个标记
  const fullDayTimes = [];
  const startTime = 9 * 60 + 30; // 9:30
  const morningEnd = 11 * 60 + 30; // 11:30
  const afternoonStart = 13 * 60; // 13:00
  const endTime = 15 * 60; // 15:00

  for (let t = startTime; t <= morningEnd; t += 30) {
    fullDayTimes.push(`${padZero(Math.floor(t / 60))}:${padZero(t % 60)}`);
  }
  for (let t = afternoonStart; t <= endTime; t += 30) {
    fullDayTimes.push(`${padZero(Math.floor(t / 60))}:${padZero(t % 60)}`);
  }

  // 构建分段数据用于颜色渲染
  // 检测穿过昨收价的转折点，添加桥接点避免断层
  const abovePrevCloseData = [];
  const belowPrevCloseData = [];
  const times = data.times;

  let lastAbove = null; // 上一个点是否高于昨收

  for (let i = 0; i < numericPrices.length; i++) {
    const price = numericPrices[i];
    const time = times[i];
    const isAbove = price >= prevClose;

    // 检测是否穿过昨收价（发生转折）
    if (lastAbove !== null && lastAbove !== isAbove) {
      // 发生转折，添加桥接点：昨收价
      abovePrevCloseData.push([time, prevClose]);
      belowPrevCloseData.push([time, prevClose]);
    }

    if (isAbove) {
      abovePrevCloseData.push([time, price]);
      belowPrevCloseData.push([time, null]);
    } else {
      abovePrevCloseData.push([time, null]);
      belowPrevCloseData.push([time, price]);
    }

    lastAbove = isAbove;
  }

  return {
    backgroundColor: 'transparent',
    grid: {
      left: 60,
      right: 60,
      top: 20,
      bottom: 30
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross'
      },
      formatter: function(params) {
        if (params && params.length > 0) {
          const validParams = params.filter(p => p.value && p.value[1] !== null);
          if (validParams.length > 0) {
            const price = validParams[0].value[1];
            const change = ((price - prevClose) / prevClose * 100).toFixed(2);
            const color = change >= 0 ? '#ff4d4f' : '#22c55e';
            const sign = change >= 0 ? '+' : '';
            return `${validParams[0].value[0]}<br/>价格: ${price.toFixed(2)}<br/>涨跌: <span style="color:${color}">${sign}${change}%</span>`;
          }
        }
        return '';
      }
    },
    xAxis: {
      type: 'category',
      data: data.times,
      axisLine: { lineStyle: { color: '#6b7280' } },
      axisLabel: {
        color: '#9ca3af',
        interval: function(index, value) {
          // 只显示特定时间点
          return fullDayTimes.includes(value);
        }
      },
      axisTick: { show: false },
      axisPointer: {
        label: {
          formatter: function(params) {
            // 横轴显示时间
            return params.value;
          }
        }
      }
    },
    yAxis: [
      {
        type: 'value',
        scale: false,
        min: prevClose * (1 - maxChange / 100),
        max: prevClose * (1 + maxChange / 100),
        interval: (prevClose * maxChange / 100) * 2 / 10,
        position: 'left',
        axisLine: { lineStyle: { color: '#6b7280' } },
        axisLabel: {
          color: '#9ca3af',
          formatter: function(value) {
            return value.toFixed(2);
          }
        },
        axisPointer: {
          label: {
            formatter: function(params) {
              // 显示价格（保留两位小数）和涨跌幅百分比
              const price = parseFloat(params.value);
              if (!isNaN(price)) {
                const change = ((price - prevClose) / prevClose * 100).toFixed(2);
                const sign = change >= 0 ? '+' : '';
                return `${price.toFixed(2)} (${sign}${change}%)`;
              }
              return params.value;
            }
          }
        },
        splitLine: {
          lineStyle: { color: '#374151', type: 'dashed' }
        }
      },
      {
        type: 'value',
        scale: false,
        min: -maxChange,
        max: maxChange,
        interval: maxChange * 2 / 10,
        position: 'right',
        axisLine: { lineStyle: { color: '#6b7280' } },
        axisLabel: {
          color: function(value) {
            return value >= 0 ? '#ff4d4f' : '#22c55e';
          },
          formatter: function(value) {
            return Math.abs(value).toFixed(2) + '%';
          }
        },
        axisPointer: {
          label: {
            show: false  // 隐藏右轴的 axisPointer 标签
          }
        },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '高于昨收',
        type: 'line',
        data: abovePrevCloseData,
        smooth: true,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: '#ff4d4f', width: 1.5 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255, 77, 79, 0.3)' },
              { offset: 1, color: 'rgba(255, 77, 79, 0.05)' }
            ]
          }
        }
      },
      {
        name: '低于昨收',
        type: 'line',
        data: belowPrevCloseData,
        smooth: true,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: '#22c55e', width: 1.5 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(34, 197, 94, 0.05)' },
              { offset: 1, color: 'rgba(34, 197, 94, 0.3)' }
            ]
          }
        }
      },
      {
        // 0%基准线（昨日收盘价）
        type: 'line',
        data: Array(numericPrices.length).fill(prevClose),
        lineStyle: {
          color: '#6b7280',
          type: 'dashed',
          width: 1
        },
        symbol: 'none',
        z: 0
      }
    ]
  };
}

// K线图配置
function getDailyChartOption(data) {
  // 保存完整数据（包含隐藏的第0天）用于计算涨幅
  const fullKlineData = data.klineData;
  const fullDates = data.dates;

  // 去掉第0天（隐藏），只显示后30天
  const displayKlineData = fullKlineData.slice(1);
  const displayDates = fullDates.slice(1);

  return {
    backgroundColor: 'transparent',
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: function(params) {
        const dataIndex = params[0].dataIndex;
        const klineData = params[0].data;
        const date = params[0].name;

        // ECharts candlestick tooltip data format:
        // 实际格式是 [index, open, close, low, high, volume]
        let open, close, low, high;
        if (Array.isArray(klineData)) {
          // klineData是数组: [index, open, close, low, high, volume]
          open = klineData[1];
          close = klineData[2];
          low = klineData[3];
          high = klineData[4];
        } else if (klineData.value && Array.isArray(klineData.value)) {
          // klineData.value也是数组: [index, open, close, low, high, volume]
          open = klineData.value[1];
          close = klineData.value[2];
          low = klineData.value[3];
          high = klineData.value[4];
        }

        // 计算相对前一日涨幅（使用完整数据的索引+1，因为第0天被隐藏了）
        const actualIndex = dataIndex + 1; // 实际在完整数据中的索引
        let changeInfo = '';
        if (actualIndex > 0 && actualIndex < fullKlineData.length) {
          const prevClose = fullKlineData[actualIndex - 1][1]; // 前一日收盘价
          const currentClose = close; // 当前收盘价
          const change = currentClose - prevClose;
          const changePercent = (change / prevClose * 100).toFixed(2);

          const percentText = changePercent >= 0 ? `+${changePercent}%` : `${changePercent}%`;
          const colorClass = change >= 0 ? 'color: #ef4444;' : 'color: #22c55e;';

          changeInfo = `<div style="${colorClass}font-weight:600;margin-bottom:8px;">涨幅: ${percentText}</div>`;
        }

        return `${date}<br/>${changeInfo}开盘: ${open}<br/>收盘: ${close}<br/>最低: ${low}<br/>最高: ${high}`;
      }
    },
    xAxis: {
      type: 'category',
      data: displayDates,
      axisLine: { lineStyle: { color: '#4b5563' } },
      axisLabel: {
        color: '#9ca3af',
        formatter: function(value) {
          // 只显示月-日
          return value.substring(5);
        }
      }
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { lineStyle: { color: '#4b5563' } },
      axisLabel: {
        color: '#9ca3af',
        formatter: function(value) {
          // 保留2位小数
          return value.toFixed(2);
        }
      },
      splitLine: { lineStyle: { color: '#374151' } }
    },
    series: [{
      type: 'candlestick',
      data: displayKlineData,
      itemStyle: {
        color: '#ef4444',
        color0: '#22c55e',
        borderColor: '#ef4444',
        borderColor0: '#22c55e'
      }
    }]
  };
}

// 切换图表类型
function switchChartType(type, evt) {
  currentChartType = type;

  // 更新Tab样式
  document.querySelectorAll('.chart-tab').forEach(tab => {
    tab.classList.remove('active');
    if (tab.dataset.type === type) {
      tab.classList.add('active');
    }
  });

  // 重新加载数据
  if (currentStockCode) {
    loadChartData(currentStockCode, type);
  }

  // 阻止事件冒泡，防止触发hideChartPopup
  if (evt) {
    evt.stopPropagation();
  }
}

// 关闭图表
function closeChart() {
  hideChartPopup();
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
  html += stocks.map(stock => {
    const jsCode = escapeJs(stock.code);
    const jsName = escapeJs(stock.name);
    const htmlCode = escapeHtml(stock.code);
    const htmlName = escapeHtml(stock.name);
    const htmlReason = escapeHtml(stock.reason || '');
    return `
    <div class="stock-item fade-in" data-code="${htmlCode}">
      <div class="border-b border-gray-700 last:border-0">
        <!-- 股票信息行 -->
        <div class="grid grid-cols-[1fr_1fr_4rem_4rem_5rem] gap-2 py-2 items-center text-xs">
          <div class="min-w-0">
            <div class="font-medium text-xs truncate cursor-pointer hover:text-blue-400 transition-colors"
                 onmouseenter="showChartPopup('${jsCode}', '${jsName}', this)"
                 onmouseleave="delayHideChart()">
              ${htmlName || '-'}
            </div>
            <div class="text-xs text-gray-500">${htmlCode}</div>
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
        ${showReasonState && htmlReason ? `
          <div class="stock-reason text-blue-400 text-xs py-1 px-2">${htmlReason}</div>
        ` : ''}
      </div>
    </div>
  `;
  }).join('');

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
            成分股: ${concept.stocks ? concept.stocks.length : 0} 只
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
      // 更新按钮
      updateButtons();
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
  const concept = concepts.find(c => c.id === conceptId);
  if (!concept) return;
  if (!confirm(`确定要删除"${concept.name}"板块吗？`)) return;

  try {
    const response = await fetch(`${API_BASE}/concepts/${conceptId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      concepts = concepts.filter(c => c.id !== conceptId);
      renderConcepts();
      // 更新按钮（同时需要更新回收站数量）
      deletedConcepts.push(result.data); // 添加到回收站数组
      updateButtons();
    } else {
      alert('删除失败: ' + result.error);
    }
  } catch (error) {
    console.error('删除概念失败:', error);
    alert('删除失败，请重试');
  }
}

// ====== 回收站相关函数 ======

// 加载回收站列表
async function loadDeletedConcepts() {
  try {
    const response = await fetch(`${API_BASE}/concepts/trash`);
    const result = await response.json();
    if (result.success) {
      deletedConcepts = result.data;
    }
  } catch (error) {
    console.error('加载回收站失败:', error);
  }
}

// 渲染回收站视图
function renderDeletedConcepts() {
  if (deletedConcepts.length === 0) {
    elements.conceptsList.innerHTML = '<div class="text-center text-gray-500 py-12">回收站为空</div>';
    return;
  }

  elements.conceptsList.innerHTML = deletedConcepts.map(concept => {
    const htmlName = escapeHtml(concept.name);
    const deletedAt = new Date(concept.deletedAt).toLocaleString('zh-CN');
    return `
    <div class="concept-card bg-gray-700 rounded-lg overflow-hidden fade-in" data-concept-id="${concept.id}">
      <div class="p-4 border-b border-gray-600 flex justify-between items-center">
        <div>
          <h3 class="text-lg font-semibold">${htmlName}</h3>
          <div class="text-sm text-gray-400">删除于: ${deletedAt}</div>
          <div class="text-xs text-gray-500">成分股: ${concept.stocks ? concept.stocks.length : 0} 只</div>
        </div>
        <div class="space-x-2">
          <button onclick="restoreConcept('${concept.id}')" class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">恢复</button>
          <button onclick="permanentlyDeleteConcept('${concept.id}')" class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">永久删除</button>
        </div>
      </div>
    </div>
  `;
  }).join('');
}

// 恢复概念
async function restoreConcept(conceptId) {
  const concept = deletedConcepts.find(c => c.id === conceptId);
  if (!concept) return;
  if (!confirm(`确定要恢复"${concept.name}"板块吗？`)) return;

  try {
    const response = await fetch(`${API_BASE}/concepts/trash/restore/${conceptId}`, {
      method: 'POST'
    });

    const result = await response.json();

    if (result.success) {
      deletedConcepts = deletedConcepts.filter(c => c.id !== conceptId);
      await loadConcepts();
      renderDeletedConcepts();
      // 更新按钮
      updateButtons();
      if (deletedConcepts.length === 0) {
        toggleTrashView();
      }
    } else {
      alert('恢复失败: ' + result.error);
    }
  } catch (error) {
    console.error('恢复概念失败:', error);
    alert('恢复失败，请重试');
  }
}

// 永久删除概念
async function permanentlyDeleteConcept(conceptId) {
  const concept = deletedConcepts.find(c => c.id === conceptId);
  if (!concept) return;
  if (!confirm(`确定要永久删除"${concept.name}"板块吗？此操作不可恢复！`)) return;

  try {
    const response = await fetch(`${API_BASE}/concepts/trash/${conceptId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      deletedConcepts = deletedConcepts.filter(c => c.id !== conceptId);
      renderDeletedConcepts();
      // 更新按钮
      updateButtons();
      if (deletedConcepts.length === 0) {
        toggleTrashView();
      }
    } else {
      alert('永久删除失败: ' + result.error);
    }
  } catch (error) {
    console.error('永久删除概念失败:', error);
    alert('永久删除失败，请重试');
  }
}

// 切换回收站视图
async function toggleTrashView() {
  isTrashView = !isTrashView;

  if (isTrashView) {
    await loadDeletedConcepts();
    renderDeletedConcepts();
    elements.form.classList.add('hidden');
  } else {
    renderConcepts();
    // 应用折叠状态（如果已设置）
    if (globalCollapsed) {
      const containers = document.querySelectorAll('.stocks-container');
      containers.forEach(container => {
        container.style.display = 'none';
      });
    }
    elements.form.classList.remove('hidden');
  }

  // 使用统一函数更新按钮
  updateButtons();
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

