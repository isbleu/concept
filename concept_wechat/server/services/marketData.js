const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { spawn, exec } = require('child_process');
const EventEmitter = require('events');
const axios = require('axios');
const dbPath = path.join(__dirname, '../data/quotes.db');

class MarketEmitter extends EventEmitter {}
const marketEmitter = new MarketEmitter();

// 初始化数据库连接
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('SQLite connection error:', err);
  else {
    console.log('✅ SQLite 行情数据库已就绪 (WAL 模式)');
    db.run('PRAGMA journal_mode = WAL'); // 开启 WAL 模式，允许并发读写
    db.configure('busyTimeout', 5000);   // 设置繁忙重试时间
  }
});

// 初始化表结构
const initDb = () => {
  db.serialize(() => {
    // 初始化持久化高频行情表（不再每次启动时清空）
    db.run(`CREATE TABLE IF NOT EXISTS stock_quotes (
      code TEXT PRIMARY KEY,
      name TEXT,
      price REAL,
      open REAL,
      pre_close REAL,
      high REAL,
      low REAL,
      pct_change REAL,
      volume REAL,
      amount REAL,
      year TEXT,
      avg_profit REAL,
      last_updated DATETIME
    )`);
    
    // 创建低频量化打分表 (RPG 五维等)
    db.run(`CREATE TABLE IF NOT EXISTS rpg_attributes (
      code TEXT PRIMARY KEY,
      target_pos INTEGER,
      net_main REAL,
      main_ratio REAL,
      pe_ttm REAL,
      dv_ttm REAL,
      up_limit_days INTEGER,
      turnover_mean REAL,
      profit_growth REAL,
      VIT INTEGER,
      STR INTEGER,
      MP INTEGER,
      AGI INTEGER,
      INT_score INTEGER,
      last_rpg_updated DATETIME
    )`);
  });
};

initDb();

// ==========================================
// 🔧 V3.1 状态机：内存缓存 + 版本控制 + 交易日历
// ==========================================

const codeCache = {
  codes: [],
  version: 0,
  isTradeDay: false,
  _tradeDayCheckedDate: null,  // 记录上次检查日期，避免重复查
};

/**
 * 判断当前是否处于 A 股交易时段
 * 早盘: 09:15 - 11:35, 午盘: 12:55 - 15:05
 */
const isMarketOpen = () => {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const t = h * 60 + m; // 转为分钟数方便比较
  return (t >= 555 && t <= 695) || (t >= 775 && t <= 905);
  // 09:15=555, 11:35=695, 12:55=775, 15:05=905
};

/**
 * 通过 Tushare HTTP API 查询今天是否为交易日
 * 每天只查询一次，结果缓存在内存中
 */
const syncTradeCalendar = async () => {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  
  // 如果今天已经查过了，直接返回
  if (codeCache._tradeDayCheckedDate === today) return;

  const token = process.env.TUSHARE_TOKEN;
  if (!token) {
    console.warn('⚠️ [TradeCalendar] 未找到 TUSHARE_TOKEN，默认按交易日处理');
    codeCache.isTradeDay = true;
    return;
  }

  try {
    const resp = await axios.post('http://api.tushare.pro', {
      api_name: 'trade_cal',
      token: token,
      params: { start_date: today, end_date: today, exchange: 'SSE' },
      fields: 'cal_date,is_open'
    }, { timeout: 10000 });

    const items = resp.data?.data?.items || [];
    if (items.length > 0) {
      codeCache.isTradeDay = items[0][1] === 1;
      codeCache._tradeDayCheckedDate = today;
      console.log(`📅 [TradeCalendar] ${today} ${codeCache.isTradeDay ? '✅ 交易日' : '🔴 非交易日'}`);
    }
  } catch (err) {
    console.error('❌ [TradeCalendar] 查询失败:', err.message);
    // 查询失败时默认为交易日，宁可多跑不可错过
    codeCache.isTradeDay = true;
  }
};

/**
 * 全量重建代码缓存（启动时 / 增删改后调用）
 * 包含事件监听机制：比对发现增量新股时，派发一次异步的高频及低频补齐任务。
 */
const refreshCodeCache = async () => {
  const { conceptDb } = require('../db');
  try {
    const newCodes = await conceptDb.getAllActiveCodes();
    const isFirstLoad = codeCache.version === 0;
    
    // 提取增量集合 (newCodes - codeCache.codes)
    const oldCodes = codeCache.codes || [];
    const addedCodes = newCodes.filter(c => !oldCodes.includes(c));

    codeCache.codes = newCodes;
    codeCache.version++;
    console.log(`🔄 [CodeCache] 全量重建至 v${codeCache.version}，共 ${codeCache.codes.length} 只股票`);

    if (addedCodes.length > 0) {
      console.log(`✨ [AutoSync] 发现 ${addedCodes.length} 只新股票 (${addedCodes.slice(0, 3).join(',')}...)，派发秒级插队同步...`);
      
      // 开启纯血异步微任务：脱离主流程执行，绝对不阻塞原有的前后端 HTTP 交互
      setTimeout(() => {
        // 1. 发起即时的高频行情拦截
        module.exports.syncFromSource(addedCodes)
          .catch(err => console.error('❌ [AutoSync] 高频插队失败:', err));

        // 2. 测算沉重但却必备的低频打分
        module.exports.syncRpgData(addedCodes)
          .catch(err => console.error('❌ [AutoSync] 低频 RPG 补齐失败:', err));
      }, 0);
    }

  } catch (err) {
    console.error('❌ [CodeCache] 刷新失败:', err.message);
  }
};

/**
 * 获取当前配置（供 Python Worker 轮询）
 * @param {number} clientVersion - Worker 端当前持有的版本号
 */
const getWorkerConfig = async (clientVersion) => {
  // 每次被查询时，顺便刷新交易日历（内部有去重，不会重复请求）
  await syncTradeCalendar();

  const changed = clientVersion !== codeCache.version;
  return {
    changed,
    version: codeCache.version,
    isMarketOpen: isMarketOpen(),
    isTradeDay: codeCache.isTradeDay,
    ...(changed ? { codes: codeCache.codes } : {})
  };
};

/**
 * 接收 Python Worker POST 的行情数据
 * 升级版：处理 { data, isMinuteCandle, timestamp } 载荷
 */
const handleWorkerUpdate = (payload) => {
  if (!payload || !payload.data || !Array.isArray(payload.data)) return;

  const { data, isMinuteCandle, timestamp } = payload;
  const now = new Date();
  const tradeDate = timestamp ? timestamp.split(' ')[0] : now.toISOString().split('T')[0];
  const tradeTime = timestamp ? timestamp.split(' ')[1].substring(0, 5).replace(':', '') : now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0');

  // 1. 立即触发 SSE 推送
  marketEmitter.emit('market_update', data);

  // 2. 异步落库到 stock_quotes (覆盖最新价格)
  const stmtQuotes = db.prepare(`REPLACE INTO stock_quotes 
    (code, name, price, open, pre_close, high, low, pct_change, volume, amount, last_updated) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  
  db.serialize(() => {
    data.forEach(item => {
      stmtQuotes.run(
        item.code, item.name, item.price, item.open, item.pre_close, 
        item.high, item.low, item.pct_change, item.volume, item.amount, 
        timestamp || now.toISOString().replace('T', ' ').substring(0, 19)
      );
    });
    stmtQuotes.finalize();

    // 3. 如果是分钟边界，落库到 stock_intraday (持久化分时)
    if (isMinuteCandle) {
      console.log(`💾 [MarketData] 正在持久化分钟分时快照 (${tradeDate} ${tradeTime})...`);
      const stmtIntra = db.prepare(`INSERT OR REPLACE INTO stock_intraday 
        (code, price, vol, amount, trade_date, trade_time) 
        VALUES (?, ?, ?, ?, ?, ?)`);
      
      data.forEach(item => {
        stmtIntra.run(item.code, item.price, item.volume, item.amount, tradeDate, tradeTime);
      });
      stmtIntra.finalize();
    }
  });
};

/**
 * 核心同步逻辑：驱动 Python 脚本
 * @param {Array} codes - 股票代码列表 ['600000.SH', '000001.SZ']
 */
const syncFromSource = (codes) => {
  if (!codes || codes.length === 0) {
    console.log('ℹ️ 跳过同步: 没有活跃的股票代码');
    return Promise.resolve();
  }
  
  console.log(`📡 正在尝试同步 ${codes.length} 只股票: ${codes.slice(0, 3).join(',')}...`);
  
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', [
      path.join(__dirname, 'market_sync.py'),
      codes.join(',')
    ], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => stdout += data.toString());
    pythonProcess.stderr.on('data', (data) => stderr += data.toString());

    // 增加超时控制：防止同步任务挂掉导致阻塞
    const timeout = setTimeout(() => {
      pythonProcess.kill();
      reject('Market Sync Timeout after 60s');
    }, 60000);

    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        console.error('Market Sync Error:', stderr);
        return reject(stderr);
      }
      try {
        const result = JSON.parse(stdout);
        // 处理非交易时间的正常跳过
        if (result.info) {
           console.log(`⏸️ ${result.info}`);
           return resolve([]);
        }
        if (result.error) return reject(result.error);
        if (!Array.isArray(result)) return reject('Invalid JSON format');
        
        // 批量更新到 SQLite
        const stmt = db.prepare(`REPLACE INTO stock_quotes 
          (code, name, price, open, pre_close, high, low, pct_change, volume, amount, year, avg_profit, last_updated) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        
        db.serialize(() => {
          result.forEach(item => {
            stmt.run(
              item.code, item.name, item.price, item.open, item.pre_close, item.high, item.low, 
              item.pct_change, item.volume, item.amount, item.year, item.avg_profit, item.last_updated
            );
          });
          stmt.finalize();
        });
        
        console.log(`📡 同步完成: ${result.length} 只股票已更新`);
        // 触发 SSE 推送事件
        marketEmitter.emit('market_update', result);
        resolve(result);
      } catch (e) {
        reject('Failed to parse sync output: ' + stdout);
      }
    });
  });
};

const updateBenchmarks = () => {
  return new Promise((resolve, reject) => {
    const pyPath = path.join(__dirname, 'update_rpg_benchmarks.py');
    exec(`python "${pyPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('Benchmark Update Error:', stderr);
        return reject(error);
      }
      console.log('Benchmark Update Output:', stdout);
      resolve();
    });
  });
};

/**
 * 核心同步逻辑：驱动低频量化及 RPG 评分 Python 脚本
 */
const syncRpgData = (codes) => {
  if (!codes || codes.length === 0) return Promise.resolve();
  console.log(`🛡️ 正在尝试生成 ${codes.length} 只股票的 RPG 属性...`);
  
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', [
      path.join(__dirname, 'calc_rpg_factors.py'),
      codes.join(',')
    ], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => stdout += data.toString());
    pythonProcess.stderr.on('data', (data) => stderr += data.toString());

    // 较长超时，拉取历史数据较慢
    const timeout = setTimeout(() => {
      pythonProcess.kill();
      reject('RPG Sync Timeout after 5 mins');
    }, 300000);

    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(stderr);
      
      try {
        const result = JSON.parse(stdout);
        // 批量更新到 SQLite (增加 NaN 安全处理)
        const stmt = db.prepare(`REPLACE INTO rpg_attributes 
          (code, target_pos, net_main, main_ratio, pe_ttm, dv_ttm, up_limit_days, turnover_mean, profit_growth, VIT, STR, MP, AGI, INT_score, last_rpg_updated) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const localDate = new Date(now.getTime() - offset);
        const nowStr = localDate.toISOString().replace('T', ' ').substring(0, 19);

        // 辅助：处理 SQLite 不支持的 NaN
        const clean = (val) => (isNaN(val) || val === undefined) ? null : val;

        db.serialize(() => {
          result.forEach(item => {
            stmt.run(
              item.code, item.target_pos, clean(item.net_main), clean(item.main_ratio), 
              clean(item.pe_ttm), clean(item.dv_ttm), item.up_limit_days, clean(item.turnover_mean), clean(item.profit_growth),
              item.VIT, item.STR, item.MP, item.AGI, item.INT, nowStr
            );
          });
          stmt.finalize();
        });
        
        console.log(`🛡️ RPG 低频评分计算完成: ${result.length} 只股票已更新`);
        resolve(result);
      } catch (e) {
        reject('Failed to parse RPG output: ' + stdout);
      }
    });
  });
};

/**
 * 获取全量低频 RPG 属性 Map (供前端内存融合)
 */
const getAllAttributes = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM rpg_attributes`, (err, rows) => {
      if (err) return reject(err);
      const map = {};
      rows.forEach(r => {
        map[r.code] = r;
      });
      resolve(map);
    });
  });
};

/**
 * 联合查询，获取大屏所有宽表数据
 */
const getAllStocksData = () => {
  return new Promise((resolve, reject) => {
    const activeCodes = codeCache.codes || [];
    if (activeCodes.length === 0) return resolve([]);

    const placeholders = activeCodes.map(() => '?').join(',');
    db.all(`
      SELECT s.code, s.name, s.price, s.open, s.pre_close, s.high, s.low, s.pct_change, s.volume, s.amount, s.last_updated,
             r.target_pos, r.net_main, r.main_ratio, r.VIT, r.STR, r.MP, r.AGI, r.INT_score, r.last_rpg_updated,
             r.pe_ttm, r.dv_ttm, r.up_limit_days, r.turnover_mean, r.profit_growth
      FROM stock_quotes s
      LEFT JOIN rpg_attributes r ON s.code = r.code
      WHERE s.code IN (${placeholders})
    `, activeCodes, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

/**
 * 查询行列数据
 * @param {Array} codes - 股票代码列表
 */
const getQuotes = (codes) => {
  return new Promise((resolve, reject) => {
    if (!codes || codes.length === 0) return resolve([]);
    const placeholders = codes.map(() => '?').join(',');
    db.all(`SELECT * FROM stock_quotes WHERE code IN (${placeholders})`, codes, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

/**
 * [V7] 指数合成引擎：获取今日分钟级分时图
 * 采用“基点法”：1. 相对价格系数 2. 加权 3. 1000基准
 */
const getConceptIntraday = async (conceptId) => {
  console.log(`🔍 [Synthesizer] 正在合成今日分时: ${conceptId}`);
  
  // 1. 获取成分股池及其权重
  // 直接利用本文件内置的 db (quotes.db) 查询
  const stocks = await new Promise((resolve, reject) => {
    db.all(`
      SELECT cs.code, sm.weight_factor as weight, q.pre_close
      FROM concept_stocks cs
      JOIN stocks_meta sm ON cs.code = sm.code
      LEFT JOIN stock_quotes q ON cs.code = q.code
      WHERE cs.concept_id = ?
    `, [conceptId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

  console.log(`🔍 [Synthesizer] 查得 ${stocks.length} 只成分股`);
  if (stocks.length === 0) return [];

  // 获取今日分时数据
  const today = new Date().toISOString().split('T')[0];
  const codes = stocks.map(s => s.code);
  const placeholders = codes.map(() => '?').join(',');
  
  const rawData = await new Promise((resolve, reject) => {
    db.all(`
      SELECT code, price, trade_time 
      FROM stock_intraday 
      WHERE trade_date = ? AND code IN (${placeholders})
      ORDER BY trade_time ASC
    `, [today, ...codes], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log(`🔍 [Synthesizer] 查得 ${rawData.length} 条分钟行情记录`);
  if (rawData.length === 0) {
    return [{ time: "0930", value: 1000 }];
  }

  // 2. 按时间点分组聚合
  const timeMap = {};
  rawData.forEach(row => {
    if (!timeMap[row.trade_time]) timeMap[row.trade_time] = [];
    timeMap[row.trade_time].push(row);
  });

  // 权重字典
  const weightMap = {};
  const preCloseMap = {};
  stocks.forEach(s => {
    weightMap[s.code] = s.weight || 1.0;
    preCloseMap[s.code] = s.pre_close || 0;
  });

  // 3. 计算指数
  const result = Object.keys(timeMap).sort().map(time => {
    const points = timeMap[time];
    let sumWeight = 0;
    let weightedFactor = 0;

    points.forEach(p => {
      const w = weightMap[p.code];
      const pc = preCloseMap[p.code];
      if (pc > 0 && p.price > 0) {
        sumWeight += w;
        weightedFactor += (p.price / pc) * w;
      }
    });

    const indexValue = sumWeight > 0 ? (weightedFactor / sumWeight) * 1000 : 1000;
    return { time, value: parseFloat(indexValue.toFixed(2)) };
  });

  return result;
};

/**
 * [V7] 指数合成引擎：回溯合成 60 日历史 K 线
 * 从 warehouse.db 抓取历史。
 */
const getConceptDailyKLine = async (conceptId) => {
  console.log(`🔍 [Synthesizer] 正在回溯 60 日 K 线: ${conceptId}`);
  
  // 1. 基本元数据 (直接利用本地 db)
  const stocks = await new Promise((resolve, reject) => {
    db.all(`
      SELECT cs.code, sm.weight_factor as weight
      FROM concept_stocks cs
      JOIN stocks_meta sm ON cs.code = sm.code
      WHERE cs.concept_id = ?
    `, [conceptId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

  console.log(`🔍 [Synthesizer] 历史回溯涉及 ${stocks.length} 只股票`);
  if (stocks.length === 0) return [];

  const codes = stocks.map(s => s.code);
  const weightMap = {};
  stocks.forEach(s => { weightMap[s.code] = s.weight || 1.0; });

  // 2. 访问仓库 (历史库)
  const whPath = path.join(__dirname, 'warehouse.db');
  console.log(`🔍 [Synthesizer] 正在链接仓库: ${whPath}`);
  const whDb = new sqlite3.Database(whPath, sqlite3.OPEN_READONLY);

  return new Promise((resolve, reject) => {
    const placeholders = codes.map(() => '?').join(',');
    // 获取最近 60 个交易日的所有成分股收盘价
    whDb.all(`
      SELECT trade_date, ts_code as code, close 
      FROM historical_daily 
      WHERE ts_code IN (${placeholders})
      ORDER BY trade_date DESC LIMIT ?
    `, [...codes, codes.length * 60], (err, rows) => {
      whDb.close();
      if (err) return reject(err);

      if (rows.length === 0) return resolve([]);

      // 3. 聚合
      const dateMap = {};
      rows.forEach(r => {
        if (!dateMap[r.trade_date]) dateMap[r.trade_date] = [];
        dateMap[r.trade_date].push(r);
      });

      const dates = Object.keys(dateMap).sort();
      const finalK = [];

      // 回溯计算时，我们以“最后一天”为基准 1000 (反向推算比较复杂，此处正向加权更直观)
      // 但为了满足用户“反推”需求，我们需要建立连续的涨跌链条。
      
      // 简单实现：每日算出加权涨幅，然后从 1000 开始累乘。
      // 但其实直接对每日的 (Close/BaseClose) 加权是最稳的。
      // 我们假设“回溯第一天（60天前）”为基点。
      
      dates.forEach((date, idx) => {
        const points = dateMap[date];
        let sumWeight = 0;
        let weightedPrice = 0;
        let sumPreWeight = 0;
        let weightedPrePrice = 0;

        // 注意：historical_daily 通常不直接存 pre_close，需要通过位移获得，
        // 或者简单地：Index(d) / Index(d-1) = Σ(Weight * (Price(d)/Price(d-1)))
        // 实际上：最健壮的是 Index(d) = Base * Σ(Weight * Price_i_d / Price_i_base)
        
        // 简化方案：为了展示趋势，我们直接对收盘价进行加权标准化
        // 算出在该题材下，当日的加权价格因子。
        let numerator = 0;
        let denominator = 0;
        points.forEach(p => {
          const w = weightMap[p.code];
          numerator += p.close * w;
          denominator += w; 
        });

        finalK.push({
          date: date,
          value: parseFloat((numerator / denominator).toFixed(2)) // 这只是绝对值，前端需自行处理百分比或我们进行二次归一
        });
      });

      // 归一化处理：让最后一天（昨天）等于 1000
      if (finalK.length > 0) {
        const lastVal = finalK[finalK.length - 1].value;
        const normalized = finalK.map(k => ({
          date: k.date,
          value: parseFloat(((k.value / lastVal) * 1000).toFixed(2))
        }));
        resolve(normalized);
      } else {
        resolve([]);
      }
    });
  });
};

/**
 * [V7] 自愈清理逻辑
 * 只有在交易日且过了 08:30 时，才执行清空小于今日的数据。
 */
const cleanupIntradayData = async () => {
  try {
    await syncTradeCalendar();
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentTime = now.getHours() * 100 + now.getMinutes();

    if (!codeCache.isTradeDay) {
        console.log('🛌 [Cleanup] 今日非交易日，保留历史分时供复盘。');
        return;
    }

    if (currentTime < 830) {
        console.log('⏳ [Cleanup] 尚未到 08:30，继续保留昨日分时。');
        return;
    }

    console.log('🧹 [Cleanup] 交易日 08:30 已过，正在清理旧分时数据...');
    db.run(`DELETE FROM stock_intraday WHERE trade_date < ?`, [today], (err) => {
      if (err) console.error('❌ [Cleanup] 清理失败:', err);
      else console.log('✅ [Cleanup] 旧分时数据已清空。');
    });
  } catch (err) {
    console.error('❌ [Cleanup] 自愈自检异常:', err);
  }
};

/**
 * 仓库增量同步：驱动 sync_warehouse.py 自动补齐缺口
 */
const syncWarehouseData = () => {
  console.log('📦 启动数据仓库自动化补齐自检...');
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', [
      path.join(__dirname, 'sync_warehouse.py')
    ], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => stdout += data.toString());
    pythonProcess.stderr.on('data', (data) => stderr += data.toString());

    // 追赶可能涉及多日，给 10 分钟超时
    const timeout = setTimeout(() => {
      pythonProcess.kill();
      reject('Warehouse Sync Timeout after 10 mins');
    }, 600000);

    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(stderr);
      console.log(`📦 仓库自检/追赶完成: ${stdout.trim()}`);
      resolve(stdout);
    });
  });
};

/**
 * V6: 全量 A 股名录同步：驱动 sync_stock_basic.py
 * 每日执行一次，填充 stocks_meta 表
 */
const syncStockBasic = () => {
  console.log('📋 启动全量 A 股名录同步...');
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', [
      path.join(__dirname, 'sync_stock_basic.py')
    ], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => stdout += data.toString());
    pythonProcess.stderr.on('data', (data) => stderr += data.toString());

    const timeout = setTimeout(() => {
      pythonProcess.kill();
      reject('StockBasic Sync Timeout after 2 mins');
    }, 120000);

    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(stderr);
      console.log(`📋 全量名录同步完成: ${stdout.trim()}`);
      resolve(stdout);
    });
  });
};

/**
 * 首次开荒：强制阻断式全市场60天历史K线初始化
 */
const initHistoricalDb = () => {
  console.log('🚧 启动极其庞大的首发全市场历史数据(60日)同步...');
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', [
      path.join(__dirname, 'init_historical_db.py')
    ], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';

    // 将子进程的输出实时打到控制台，因为这一步极其漫长
    pythonProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      stdout += msg;
      process.stdout.write(`  [Init_Historical] ${msg}`);
    });
    pythonProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      stderr += msg;
      process.stderr.write(`  [Init_Historical ERR] ${msg}`);
    });

    // 允许 15 分钟的超长超时
    const timeout = setTimeout(() => {
      pythonProcess.kill();
      reject('Init_Historical Timeout after 15 mins');
    }, 900000);

    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(stderr);
      console.log('🚧 首发历史数据同步彻底完成!');
      resolve(stdout);
    });
  });
};

/**
 * 检查 warehouse.db 的状态
 */
const checkWarehouseInitStatus = () => {
  return new Promise((resolve) => {
    const whDbPath = path.join(__dirname, 'warehouse.db');
    const whDb = new sqlite3.Database(whDbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return resolve(false); // 连文件都没有，肯定没好
      
      whDb.get("SELECT value FROM sys_sync_status WHERE key = 'last_historical_date'", (err, row) => {
        whDb.close();
        if (err || !row) resolve(false);
        else resolve(true);
      });
    });
  });
};


/**
 * 日常安全追赶联动包装器：先追赶历史日线缺口，完毕后再联动更新当天的 RPG 打分。
 */
const runWarehouseCatchup = async () => {
  try {
    await syncWarehouseData();
    // 追赶完毕，调用测算
    const codes = codeCache.codes || [];
    if (codes.length > 0) {
      console.log(`🛡️ 追赶仓储完毕，立即触发对 ${codes.length} 只热点股的 RPG 雷达测算...`);
      await syncRpgData(codes);
      marketEmitter.emit('rpg_updated', { timestamp: new Date() });
    }
  } catch (err) {
    console.error('❌ 历史仓储追赶或RPG雷达重审异常:', err);
  }
};

module.exports = {
  syncFromSource,
  getQuotes,
  syncRpgData,
  syncWarehouseData,
  syncStockBasic,
  updateBenchmarks,
  getAllAttributes,
  getAllStocksData,
  marketEmitter,
  // V3.1 新增
  refreshCodeCache,
  getWorkerConfig,
  handleWorkerUpdate,
  syncTradeCalendar,
  codeCache,
  // V7 新增暴露
  initHistoricalDb,
  checkWarehouseInitStatus,
  runWarehouseCatchup,
  getConceptIntraday,
  getConceptDailyKLine,
  cleanupIntradayData,
};
