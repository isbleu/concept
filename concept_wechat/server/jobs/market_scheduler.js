const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const db = require('../db');
const marketData = require('../services/marketData');

// ==========================================
// V3.1: Python Worker 进程管理 (常驻高频守护)
// ==========================================
const { spawn } = require('child_process');

let workerProcess = null;
let workerRestartCount = 0;
const MAX_RESTART = 5;

const startWorker = () => {
  const workerPath = path.join(__dirname, '../services/market_worker.py');
  
  console.log('🐍 [Worker] 正在启动 Python 行情守卫...');
  
  workerProcess = spawn('python', [workerPath], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  workerProcess.stdout.on('data', (data) => {
    // 转发 Python Worker 的日志到 Node.js 控制台
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => console.log(line));
  });

  workerProcess.stderr.on('data', (data) => {
    console.error(`🐍 [Worker STDERR] ${data.toString().trim()}`);
  });

  workerProcess.on('close', (code) => {
    console.log(`🐍 [Worker] 进程退出，退出码: ${code}`);
    workerProcess = null;
    
    // 自动重启（有上限）
    if (workerRestartCount < MAX_RESTART) {
      workerRestartCount++;
      const delay = Math.min(workerRestartCount * 10, 60) * 1000; // 递增延迟
      console.log(`🔄 [Worker] 将在 ${delay/1000}s 后尝试第 ${workerRestartCount} 次重启...`);
      setTimeout(startWorker, delay);
    } else {
      console.error(`❌ [Worker] 已达最大重启次数 (${MAX_RESTART})，请手动检查`);
    }
  });
};

// ==========================================
// Phase A: 阻断式首发开荒引擎与宕机补偿 (Bootstrapper & Auto-Healer)
// ==========================================
const bootstrap = async () => {
  console.log('🚀 [BOOTSTRAP] 正在初始化系统底层防线与时序自愈验证...');

  // ---------------------------------------------------------
  // Step 1: 全量图谱更新 (兜底补全兼顾每次开机追新)
  // ---------------------------------------------------------
  try {
    console.log('📋 [BOOTSTRAP 1/5] 执行A股全景名录同步 (兜底与自愈)...');
    await marketData.syncStockBasic();
  } catch (err) {
    console.error('❌ [BOOTSTRAP 1/5] 名录更新异常，但继续放行:', err);
  }

  // ---------------------------------------------------------
  // Step 2: 热点池缓存与交易日历预热
  // ---------------------------------------------------------
  try {
    console.log('🗂️ [BOOTSTRAP 2/5] 正在挂载交易日历与内存池...');
    await marketData.refreshCodeCache();
    await marketData.syncTradeCalendar();
  } catch (err) {
    console.error('❌ [BOOTSTRAP 2/5] 缓存或日历挂载异常:', err);
  }

  // ---------------------------------------------------------
  // Step 2.5: 分时数据自愈清理 (针对 08:30 宕机或周末复盘)
  // ---------------------------------------------------------
  try {
    console.log('🧹 [BOOTSTRAP 2.5/5] 执行分时数据自愈检查...');
    await marketData.cleanupIntradayData();
  } catch (err) {
    console.error('❌ [BOOTSTRAP 2.5/5] 分时清理异常:', err);
  }

  // ---------------------------------------------------------
  // Step 3: 白纸级服务器底座 60 天重扫判定
  // ---------------------------------------------------------
  try {
    const hasStatus = await marketData.checkWarehouseInitStatus();
    if (!hasStatus) {
      console.log('🚧 [BOOTSTRAP 3/5] 数据仓储一贫如洗！强制阻断，执行60天历史K基底重构...');
      await marketData.initHistoricalDb();
    } else {
      console.log('🚧 [BOOTSTRAP 3/5] 60日历史基底状态 OK');
    }
  } catch (err) {
    console.error('❌ [BOOTSTRAP 3/5] 底座重构失败 💣 阻断:', err);
    throw err;
  }

  // ---------------------------------------------------------
  // Step 4: 宕机补偿 - 追赶近期缺口并重置今日 RPG
  // ---------------------------------------------------------
  try {
    console.log('🩹 [BOOTSTRAP 4/5] 启动宕机自动追赶补偿(Auto-Heal)...');
    // 如果今天没开机错过16:00，开机这一下自动追回欠缺的K线并附带重算战力
    await marketData.runWarehouseCatchup();
    console.log('🩹 [BOOTSTRAP 4/5] 缺口补偿校验完毕！');
  } catch (err) {
    console.error('❌ [BOOTSTRAP 4/5] 补偿任务异常:', err);
  }

  // ---------------------------------------------------------
  // Step 5: 全局战力标尺定期校准
  // ---------------------------------------------------------
  try {
    const benchmarkPath = path.join(__dirname, '../services/rpg_benchmarks.json');
    const now = new Date();
    const isSunday = now.getDay() === 0;
    
    let shouldUpdate = !fs.existsSync(benchmarkPath);
    if (!shouldUpdate && isSunday) {
        // 如果是周日，且今天还没更新过，则更新
        const stats = fs.statSync(benchmarkPath);
        const lastModifiedDate = stats.mtime.toISOString().split('T')[0];
        const todayStr = now.toISOString().split('T')[0];
        if (lastModifiedDate !== todayStr) {
            shouldUpdate = true;
        }
    }

    if (shouldUpdate) {
      console.log('📏 [BOOTSTRAP 5/5] 检测到系统处于初始化态或周日巡检期，开始重构全局测算标尺...');
      await marketData.updateBenchmarks();
    } else {
      console.log('📏 [BOOTSTRAP 5/5] 战力标尺无须变动 OK');
    }
  } catch (err) {
    console.error('❌ [BOOTSTRAP 5/5] 标尺校准失败:', err);
  }

  console.log('🎉 [BOOTSTRAP] 系统自愈与防线铺设完毕，允许起航！');
};

// ==========================================
// Phase B: 精准定时调度网 (Cron Scheduler)
// ==========================================
const mountCronJobs = () => {
  console.log('⏱️ [CRON] 调度护城河已拉起');

  // 每日 08:30：分时数据环境复位 (带有交易日判断)
  cron.schedule('30 8 * * *', async () => {
    console.log('⏱️ [CRON 08:30] 触发今日分时数据环境复位...');
    await marketData.cleanupIntradayData();
  });

  // 工作日每日 08:45：更新全股名录与成分股权重
  cron.schedule('45 8 * * 1-5', async () => {
    console.log('⏱️ [CRON 08:45] 触发全市场图谱更新...');
    try {
      await marketData.syncStockBasic();
      await marketData.syncTradeCalendar();
    } catch (e) {
      console.error('❌ [CRON 08:45] 名录更新失败:', e);
    }
  });

  // 工作日每日 16:00 与 18:30 (分班校验，防止券商推送迟延): 安全追赶仓储落库并重算战力
  const catchupTask = async (phaseId) => {
    console.log(`⏱️ [CRON ${phaseId}] 触发仓储追赶与重计算流...`);
    await marketData.runWarehouseCatchup();
  };
  cron.schedule('0 16 * * 1-5', () => catchupTask('16:00 初猎'));
  cron.schedule('30 18 * * 1-5', () => catchupTask('18:30 复盘'));

  // 每周日凌晨 02:00：全天候标尺刻度更新 (防死锁牛熊基准)
  cron.schedule('0 2 * * 0', async () => {
    console.log('⏱️ [CRON Sun 02:00] 触发系统级标尺基准重建...');
    try {
      await marketData.updateBenchmarks();
    } catch (e) {
      console.error('❌ [CRON Sun 02:00] 基准标尺更新失败:', e);
    }
  });
};

// ==========================================
// 主启动入口
// ==========================================
const start = async () => {
  try {
    // 1. 同步执行底层检查流程
    await bootstrap();
    
    // 2. 拉起常驻进程 (守护微秒级高频请求)
    startWorker();
    
    // 3. 开始精准的时间调度拦截网
    mountCronJobs();
  } catch (err) {
    console.error('💣 [FATAL ERROR] Bootstrap 开荒阶段遭遇致命挫折，停止常规调度启动！', err);
    // 此处可调用 process.exit(1) 重启应用层，但为免陷入 Docker 重启死循环，只维持阻塞。
  }
};

// 保留暴露方法供其它地方调用
const getUniqueCodesFromDb = () => {
  return marketData.codeCache.codes || [];
};

module.exports = { start, getUniqueCodesFromDb };
