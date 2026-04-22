const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { spawn, exec } = require('child_process');
const EventEmitter = require('events');
const axios = require('axios');
const dbPath = path.join(__dirname, '../data/quotes.db');

class MarketEmitter extends EventEmitter {}
const marketEmitter = new MarketEmitter();

// 获取统一数据库连接 (共享 db.js 的配置，包括 WAL 和 30s 超时)
const { conceptDb, warehouseDb } = require('../db');
const db = conceptDb.raw;

// [V14.1] 由 db.js 统一管理初始化，此处保留钩子备用
const initDb = () => {
    // 基础表由 db.js 创建，此处仅确保 rpg_attributes 等扩展表存在
    db.serialize(() => {
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
        (code, price, volume, amount, trade_date, trade_time) 
        VALUES (?, ?, ?, ?, ?, ?)`);
      
      data.forEach(item => {
        stmtIntra.run(item.code, item.price, item.volume, item.amount, tradeDate, tradeTime);
      });
      stmtIntra.finalize();
    }
  });
};

/**
 * 接收 Python Backfill 推送的历史批量分时数据
 * [V14.2] 升级为 Promise 架构，确保数据写回磁盘
 */
const handleBackfillUpdate = async (data) => {
  if (!data || !Array.isArray(data)) return 0;

  const dbPath = path.resolve(__dirname, '../data/quotes.db');
  console.log(`[DB_WRITE] Target path: ${dbPath} | Connection state: ${db ? 'ACTIVE' : 'NULL'}`);

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
          if (err) console.error('[DB_ERR] BEGIN failed:', err);
      });

      const stmt = db.prepare(`INSERT OR REPLACE INTO stock_intraday 
        (code, price, volume, amount, trade_date, trade_time) 
        VALUES (?, ?, ?, ?, ?, ?)`);

      data.forEach((r, idx) => {
        const volume = r.volume !== undefined ? r.volume : (r.vol || 0);
        stmt.run(r.code, r.price, volume, r.amount, r.trade_date, r.trade_time, (err) => {
            if (err && idx < 5) console.error(`[DB_ERR] Row ${idx} failed:`, err);
        });
      });

      stmt.finalize();

      db.run('COMMIT', (err) => {
        if (err) {
          console.error('❌ [Backfill] COMMIT ERROR:', err.message);
          db.run('ROLLBACK');
          reject(err);
        } else {
          console.log(`✅ [Backfill] Transaction Finalized: ${data.length} rows`);
          resolve(data.length);
        }
      });
    });
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

    // 增加超时控制
    const timeout = setTimeout(() => {
      pythonProcess.kill();
      reject('Market Sync Timeout after 60s');
    }, 60000);

    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        return reject(new Error('Market Sync process error'));
      }
      // [V13.0] 数据由 Python 脚本主动推送到 /market-update，这里仅负责生命周期闭环
      console.log(`📡 [Sync] 同步脚本执行完毕 (已触发异步自愈回溯)`);
      
      // 异步触发自愈回溯
      runIntradayBackfill(codes)
        .catch(err => console.error('🩹 [Backfill] 失败:', err.message));

      resolve();
    });
  });
};

/**
 * 核心日内回溯：补全今日历史分钟线
 */
const runIntradayBackfill = async (codes) => {
  if (!codes || codes.length === 0) return;
  console.log(`🩹 [Backfill] 正在为 ${codes.length} 只股票回溯补全今日分时数据...`);

  return new Promise((resolve, reject) => {
    const py = spawn('python', [
      path.join(__dirname, 'market_backfill.py'),
      codes.join(',')
    ], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

    // [V13.0] 协议升级：数据通过 HTTP 推送，此处不再监听 stdout
    py.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ [Backfill] 生命周期管理: 回补进程正常退出`);
        resolve();
      } else {
        reject(new Error(`Backfill process exited with code ${code}`));
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
 * 获取概念指数的日内分时数据 (V8 升级版)
 * 采用“实时复权对准法”，计算 Σ(Weight * Price / PreClose) / ΣWeight
 */
const getConceptIntraday = async (conceptId) => {
  return new Promise((resolve, reject) => {
    console.log(`[I-Trace] >>> 开始合成题材分时: ${conceptId}`);
    
    // 1. 查找成分股及其权重
    const query = `
      WITH BasicInfo AS (
        SELECT cs.code as stock_code, sm.weight_factor, sq.pre_close
        FROM concept_stocks cs
        JOIN stocks_meta sm ON cs.code = sm.code
        JOIN stock_quotes sq ON cs.code = sq.code
        WHERE cs.concept_id = ?
      )
      SELECT 
        si.trade_time as time,
        1000 * SUM((si.price / bi.pre_close) * bi.weight_factor) / SUM(bi.weight_factor) as value,
        SUM(si.volume) as volume,
        SUM(si.amount) as amount
      FROM stock_intraday si
      JOIN BasicInfo bi ON si.code = bi.stock_code
      WHERE si.trade_date = (SELECT MAX(trade_date) FROM stock_intraday)
      GROUP BY si.trade_time
      ORDER BY si.trade_time ASC
    `;

    db.all(query, [conceptId], (err, rows) => {
      if (err) {
        console.error(`[I-Trace] 合成分时 SQL 失败: ${err.message}`);
        return reject(err);
      }
      
      console.log(`[I-Trace] 分时原始数据返回: ${rows?.length || 0} 行`);
      
      if (!rows || rows.length === 0) {
        // 进一步查查 BasicInfo 是否有东西
        db.all(`SELECT cs.code FROM concept_stocks cs WHERE cs.concept_id = ?`, [conceptId], (err2, csRows) => {
           console.log(`[I-Trace] 题材成分股核查: ${csRows?.length || 0} 只`);
           resolve([]);
        });
        return;
      }

      const formatted = rows.map(r => ({
        time: r.time,
        value: parseFloat(r.value.toFixed(2)),
        amount: Math.round(r.amount),
        pct_chg: parseFloat(((r.value / 1000 - 1) * 100).toFixed(2))
      }));
      
      console.log(`[I-Trace] <<< 题材分时吐出: ${formatted.length} 点`);
      resolve(formatted);
    });
  });
};

const getConceptDailyKLine = async (conceptId) => {
  return new Promise((resolve) => {
    console.log(`[K-Trace] >>> 开始合成题材 K 线: ${conceptId}`);
    
    db.all(`SELECT sm.code, sm.weight_factor, sm.adj_factor FROM stocks_meta sm JOIN concept_stocks cs ON sm.code = cs.code WHERE cs.concept_id = ?`, [conceptId], async (err, stocks) => {
      if (err) {
        console.error(`[K-Trace] 获取成分股失败: ${err.message}`);
        return resolve([]);
      }
      if (!stocks || stocks.length === 0) {
        console.warn(`[K-Trace] 未找到题材 ${conceptId} 的成分股`);
        return resolve([]);
      }

      const codeArr = stocks.map(s => s.code);
      const codes = codeArr.map(c => `'${c}'`).join(',');
      const weightMap = {};
      const metaAdjMap = {}; 
      stocks.forEach(s => {
        weightMap[s.code] = s.weight_factor || 1.0;
        metaAdjMap[s.code] = s.adj_factor || 1.0;
      });

      console.log(`[K-Trace] 成分股加载完毕: ${stocks.length} 只`);

      // 使用共享的 warehouseDb 连接，避免 ad-hoc 连接导致的 busy 错误
      const query = `
        SELECT trade_date, ts_code as code, open, high, low, close, amount, adj_factor
        FROM historical_daily
        WHERE ts_code IN (${codes})
        AND trade_date IN (
          SELECT DISTINCT trade_date FROM historical_daily 
          ORDER BY trade_date DESC LIMIT 61
        )
        ORDER BY trade_date ASC
      `;

      warehouseDb.all(query, [], async (err, historyRows) => {
        if (err) {
          console.error(`[K-Trace] 查询 historical_daily 失败: ${err.message}`);
          return resolve([]);
        }

        console.log(`[K-Trace] 仓储数据返回: ${historyRows?.length || 0} 行`);
        if (!historyRows || historyRows.length === 0) return resolve([]);

        const dateGroups = {};
        historyRows.forEach(r => {
          if (!dateGroups[r.trade_date]) dateGroups[r.trade_date] = [];
          dateGroups[r.trade_date].push(r);
        });

        const sortedDates = Object.keys(dateGroups).sort();
        console.log(`[K-Trace] 历史日期范围: ${sortedDates[0]} ~ ${sortedDates[sortedDates.length-1]} (共 ${sortedDates.length} 天)`);
        
        if (sortedDates.length < 2) {
          console.warn(`[K-Trace] 历史数据不足 2 天，无法锚定基准`);
          return resolve([]);
        }

        const refPoints = {};
        dateGroups[sortedDates[0]].forEach(r => {
          refPoints[r.code] = r.close * r.adj_factor;
        });

        const finalK = [];
        // 1. 合成历史部分 (D-60 到 D-1)
        for (let i = 1; i < sortedDates.length; i++) {
          const date = sortedDates[i];
          const pts = dateGroups[date];
          let totalW = 0, sO = 0, sH = 0, sL = 0, sC = 0, sAmount = 0;
          
          pts.forEach(p => {
            const w = weightMap[p.code];
            const base = refPoints[p.code];
            if (!base) return;
            totalW += w;
            sO += (p.open * p.adj_factor / base) * w;
            sH += (p.high * p.adj_factor / base) * w;
            sL += (p.low * p.adj_factor / base) * w;
            sC += (p.close * p.adj_factor / base) * w;
            sAmount += p.amount;
          });

          if (totalW > 0) {
            finalK.push({
              date,
              open: parseFloat((sO / totalW * 1000).toFixed(2)),
              high: parseFloat((sH / totalW * 1000).toFixed(2)),
              low: parseFloat((sL / totalW * 1000).toFixed(2)),
              close: parseFloat((sC / totalW * 1000).toFixed(2)),
              amount: Math.round(sAmount * 1000)
            });
          }
        }

        console.log(`[K-Trace] 历史 K 线合成完毕: ${finalK.length} 根`);

        // 2. 实时缝合
        const lastHistoryDate = sortedDates[sortedDates.length - 1];
        const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
        
        if (lastHistoryDate < todayStr) {
          console.log(`[K-Trace] 尝试缝合今日实时数据 (${todayStr})`);
          try {
            const realQuotes = await new Promise((res) => {
              db.all(`SELECT code, open, high, low, price, amount FROM stock_quotes WHERE code IN (${codes})`, (err, r) => res(r || []));
            });

            console.log(`[K-Trace] 实时行情返回: ${realQuotes.length} 只`);
            if (realQuotes.length > 0) {
              let totalW = 0, sO = 0, sH = 0, sL = 0, sC = 0, sAmount = 0;
              realQuotes.forEach(q => {
                const w = weightMap[q.code];
                const base = refPoints[q.code];
                const adj = metaAdjMap[q.code]; 
                if (!base || q.open <= 0) return;
                
                totalW += w;
                sO += (q.open * adj / base) * w;
                sH += (q.high * adj / base) * w;
                sL += (q.low * adj / base) * w;
                sC += (q.price * adj / base) * w;
                sAmount += q.amount;
              });

              if (totalW > 0) {
                finalK.push({
                  date: todayStr,
                  open: parseFloat((sO / totalW * 1000).toFixed(2)),
                  high: parseFloat((sH / totalW * 1000).toFixed(2)),
                  low: parseFloat((sL / totalW * 1000).toFixed(2)),
                  close: parseFloat((sC / totalW * 1000).toFixed(2)),
                  amount: Math.round(sAmount),
                  isRealtime: true 
                });
                console.log(`[K-Trace] 今日实时柱缝合成功`);
              } else {
                console.warn(`[K-Trace] 今日实时数据有效权重为 0`);
              }
            }
          } catch (e) {
            console.error('[K-Trace] 今日实时柱缝合失败:', e);
          }
        }

        // 3. 计算收益率
        for (let i = 0; i < finalK.length; i++) {
          const prevClose = (i === 0) ? 1000 : finalK[i - 1].close;
          finalK[i].pct_chg = parseFloat(((finalK[i].close / prevClose - 1) * 100).toFixed(2));
        }
        console.log(`[K-Trace] <<< 题材 K 线吐出: ${finalK.length} 点`);
        resolve(finalK);
      });
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
  handleBackfillUpdate,
};
