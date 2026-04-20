const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// ======== SQLite 统一数据库 ========
const quotesDbPath = path.join(dataDir, 'quotes.db');
const sqliteDb = new sqlite3.Database(quotesDbPath);
sqliteDb.run('PRAGMA journal_mode = WAL');
sqliteDb.run('PRAGMA foreign_keys = ON');
sqliteDb.configure('busyTimeout', 5000);

// ======== 建表 ========
sqliteDb.serialize(() => {
  // ---------- 用户体系 (替代 NeDB users) ----------
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    openid TEXT UNIQUE NOT NULL,
    nickname TEXT DEFAULT '股海冒险者',
    points INTEGER DEFAULT 100,
    created_at DATETIME,
    last_login DATETIME
  )`);

  sqliteDb.run(`CREATE TABLE IF NOT EXISTS point_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT,
    created_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ---------- 全量股票元数据 (每日 stock_basic 同步) ----------
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS stocks_meta (
    code TEXT PRIMARY KEY,
    name TEXT,
    industry TEXT,
    market TEXT,
    list_date TEXT,
    weight_factor REAL DEFAULT 0,
    py TEXT,
    updated_at DATETIME
  )`);

  // ---------- 概念/题材体系 ----------
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS concepts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'public',
    owner_id TEXT,
    hot_score INTEGER DEFAULT 100,
    status TEXT DEFAULT 'active',
    created_at DATETIME,
    updated_at DATETIME
  )`);

  // concept_stocks: 去掉冗余的 name 字段，通过 JOIN stocks_meta 获取
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS concept_stocks (
    concept_id TEXT NOT NULL,
    code TEXT NOT NULL,
    reason TEXT,
    PRIMARY KEY (concept_id, code),
    FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
  )`);

  // ---------- 用户自选关注 ----------
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS user_follows (
    user_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    follow_order INTEGER DEFAULT 0,
    created_at DATETIME,
    PRIMARY KEY (user_id, concept_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (concept_id) REFERENCES concepts(id)
  )`);

  // ---------- V6 存量迁移（在索引之前执行） ----------
  // 给旧的 concepts 表补上 owner_id 列（如果缺失）
  // ALTER TABLE 如果列已存在会报错，用回调静默忽略
  sqliteDb.run("ALTER TABLE concepts ADD COLUMN owner_id TEXT", () => {});
  // 给旧的 stocks_meta 表补上 py 列（如果缺失）
  sqliteDb.run("ALTER TABLE stocks_meta ADD COLUMN py TEXT", () => {});

  // ---------- 索引 ----------
  sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_concepts_status ON concepts(status)`);
  sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_concepts_owner ON concepts(owner_id)`);
  sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_cs_code ON concept_stocks(code)`);
  sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_uf_user ON user_follows(user_id)`);
  sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_users_openid ON users(openid)`);
  sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_point_logs_user ON point_logs(user_id)`);
  sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_stocks_meta_name ON stocks_meta(name)`);
  sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_stocks_meta_py ON stocks_meta(py)`);
  
  // ---------- V7: 分时图持久化 (分钟级) ----------
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS stock_intraday (
    code TEXT NOT NULL,
    price REAL,
    vol REAL,
    amount REAL,
    trade_date TEXT NOT NULL,
    trade_time TEXT NOT NULL,
    PRIMARY KEY (code, trade_date, trade_time)
  )`);
  sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_intra_search ON stock_intraday(trade_date, code)`);

});

// ======== conceptDb: Promise 化工具对象 ========
const conceptDb = {
  /** 生成短 UUID */
  genId: () => crypto.randomBytes(8).toString('hex'),

  /** 执行 SQL (INSERT/UPDATE/DELETE) */
  run: (sql, params = []) => new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  }),

  /** 查询单行 */
  get: (sql, params = []) => new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  }),

  /** 查询多行 */
  all: (sql, params = []) => new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  }),

  /** 事务执行 */
  transaction: async (fn) => {
    await conceptDb.run('BEGIN TRANSACTION');
    try {
      const result = await fn();
      await conceptDb.run('COMMIT');
      return result;
    } catch (err) {
      await conceptDb.run('ROLLBACK');
      throw err;
    }
  },

  // ======== 股票代码工具 ========

  /** 标准化股票代码（补全后缀） */
  normalizeCode: (code) => {
    if (!code) return '';
    if (code.includes('.')) return code.toUpperCase();
    if (code.startsWith('6')) return code + '.SH';
    if (code.startsWith('0') || code.startsWith('3')) return code + '.SZ';
    if (code.startsWith('4') || code.startsWith('8')) return code + '.BJ';
    return code;
  },

  /** 获取全部活跃股票代码（自动补全后缀） */
  getAllActiveCodes: () => conceptDb.all(`
    SELECT DISTINCT cs.code FROM concept_stocks cs
    INNER JOIN concepts c ON cs.concept_id = c.id
    WHERE c.status = 'active'
  `).then(rows => rows.map(r => conceptDb.normalizeCode(r.code))),

  // ======== 用户相关查询 ========

  /** 通过 openid 查找用户 */
  findUserByOpenid: (openid) => conceptDb.get(
    'SELECT * FROM users WHERE openid = ?', [openid]
  ),

  /** 创建新用户 */
  createUser: (openid, nickname = '股海冒险者') => {
    const id = conceptDb.genId();
    const now = new Date().toISOString();
    return conceptDb.run(
      'INSERT INTO users (id, openid, nickname, points, created_at, last_login) VALUES (?, ?, ?, 100, ?, ?)',
      [id, openid, nickname, now, now]
    ).then(() => conceptDb.get('SELECT * FROM users WHERE id = ?', [id]));
  },

  /** 更新用户最后登录时间 */
  updateLastLogin: (userId) => conceptDb.run(
    'UPDATE users SET last_login = ? WHERE id = ?',
    [new Date().toISOString(), userId]
  ),

  /** 扣除/增加积分（带流水记录，事务性） */
  changePoints: async (userId, delta, reason) => {
    return conceptDb.transaction(async () => {
      // 检查余额
      const user = await conceptDb.get('SELECT points FROM users WHERE id = ?', [userId]);
      if (!user) throw new Error('用户不存在');
      if (user.points + delta < 0) throw new Error('积分不足');

      await conceptDb.run(
        'UPDATE users SET points = points + ? WHERE id = ?',
        [delta, userId]
      );
      await conceptDb.run(
        'INSERT INTO point_logs (user_id, delta, reason, created_at) VALUES (?, ?, ?, ?)',
        [userId, delta, reason, new Date().toISOString()]
      );
      return { newBalance: user.points + delta };
    });
  },

  /** 获取用户关注的所有股票代码集合 (供 SSE 过滤器使用) */
  getUserWatchlistCodes: async (userId) => {
    const rows = await conceptDb.all(`
      SELECT DISTINCT cs.code FROM concept_stocks cs
      INNER JOIN user_follows uf ON cs.concept_id = uf.concept_id
      WHERE uf.user_id = ?
    `, [userId]);
    return new Set(rows.map(r => conceptDb.normalizeCode(r.code)));
  },

  /** 底层 SQLite 连接（供 marketData.js 等直接使用） */
  raw: sqliteDb,
};

// ======== 兼容层：导出格式保持与旧 db 一致 ========
const db = { conceptDb };

console.log('✅ SQLite 统一数据库已就绪 (ALL-IN-ONE: users + concepts + stocks_meta)');

module.exports = db;
