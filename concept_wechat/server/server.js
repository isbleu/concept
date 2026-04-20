const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db'); // 初始化 SQLite 统一数据库

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// 静态文件、心跳检测等逻辑
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Admin 登录接口
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.AUTH_USERNAME || 'admin';
  const adminPass = process.env.AUTH_PASSWORD || '123456';

  if (username === adminUser && password === adminPass) {
    // 简单模拟一个 Token
    res.json({ 
      success: true, 
      token: `admin_session_${Date.now()}_${Math.random().toString(36).substr(2)}` 
    });
  } else {
    res.status(401).json({ success: false, error: '账号或密码错误' });
  }
});

// 引入行情服务调度器
const marketScheduler = require('./jobs/market_scheduler');

// 引入路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/concepts', require('./routes/concepts'));
app.use('/api/stocks', require('./routes/stocks'));
app.use('/api/market', require('./routes/market')); // SSE 实时行情路由
app.use('/api/user', require('./routes/user_activity')); // V6: 用户业务路由

// V3.1: 内部 API 路由（仅限本地 Python Worker 通信）
app.use('/api/internal', (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    next();
  } else {
    res.status(403).json({ error: 'Internal API: Access denied' });
  }
}, require('./routes/internal'));

// 启动行情同步服务
console.log('🔍 环境预检: TUSHARE_TOKEN 为', process.env.TUSHARE_TOKEN ? `${process.env.TUSHARE_TOKEN.substring(0, 4)}***` : '未找到');
marketScheduler.start();

app.listen(PORT, () => {
  console.log(`🚀 服务运行在 http://localhost:${PORT}`);
});
