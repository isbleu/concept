// 加载环境变量
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// API路由
app.use('/api/concepts', require('./routes/concepts'));
app.use('/api/charts', require('./routes/charts'));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 静态文件和SPA回退
app.use(express.static(path.join(__dirname, 'public')));

// SPA路由处理 - 所有其他路由返回index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
app.listen(PORT, () => {
  const aiEnabled = process.env.GLM_API_KEY ? '已启用' : '未启用 (使用内置库)';
  console.log(`
╔════════════════════════════════════════╗
║   股票概念题材管理系统                  ║
║                                        ║
║   服务器运行中...                       ║
║   http://localhost:${PORT}              ║
║                                        ║
║   AI 联网搜索: ${aiEnabled.padEnd(18)} ║
╚════════════════════════════════════════╝
  `);
});

// Netlify Functions export
const serverless = require('serverless-http');
module.exports.handler = serverless(app);
