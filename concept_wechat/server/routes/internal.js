const express = require('express');
const router = express.Router();
const marketData = require('../services/marketData');

/**
 * GET /api/internal/config?v=N
 * Python Worker 每轮循环调用此接口获取最新配置
 * - 如果版本号一致，返回 { changed: false } + 状态
 * - 如果版本号不一致，额外返回完整的 codes 列表
 */
router.get('/config', async (req, res) => {
  try {
    const clientVersion = parseInt(req.query.v) || -1;
    const config = await marketData.getWorkerConfig(clientVersion);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/internal/market-update
 * Python Worker 每轮抓取完行情后 POST 数据到此接口
 * Node.js 负责：立即 SSE 推送 + 异步 SQLite 落库
 */
router.post('/market-update', (req, res) => {
  try {
    const payload = req.body;
    marketData.handleWorkerUpdate(payload);
    const count = (payload && payload.data) ? payload.data.length : 0;
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Python Backfill 脚本采集完历史分时后 POST 到此接口
 */
router.post('/market-backfill', async (req, res) => {
  try {
    const { data } = req.body; 
    console.log(`[API_IN] Received path /market-backfill | Data count: ${data ? data.length : 'NULL'} | Type: ${typeof data}`);
    
    if (!data || !Array.isArray(data)) {
      console.error('[API_ERR] Data is not an array or missing');
      return res.status(400).json({ error: 'Invalid data format' });
    }
    
    // 调用处理逻辑并捕获返回值（异步等待落库完成）
    const result = await marketData.handleBackfillUpdate(data);
    
    res.json({ success: true, count: data.length, processed: result });
  } catch (err) {
    console.error(`[API_EXCEPTION] ${err.stack}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
