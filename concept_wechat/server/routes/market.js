const express = require('express');
const router = express.Router();
const marketData = require('../services/marketData');
const { conceptDb } = require('../db');
const { marketEmitter } = marketData;

// ============================================================
// GET /api/market/stream
// V6: SSE 端点 - 支持动态过滤（万能过滤器）
// Query: ?userId=xxx 或 ?conceptIds=id1,id2,id3
// ============================================================
router.get('/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { userId, conceptIds } = req.query;

  // 构建该连接的"白名单"代码集合
  let activeCodesSet = null; // null = 全量推送（admin 大屏）

  if (userId) {
    // 用户模式：只推送该用户关注的题材下的股票
    try {
      activeCodesSet = await conceptDb.getUserWatchlistCodes(userId);
      console.log(`🔗 [SSE] 用户 ${userId} 连入，监听 ${activeCodesSet.size} 只股票`);
    } catch (err) {
      console.error('SSE filter init error:', err);
    }
  } else if (conceptIds) {
    // 视口模式：只推送指定题材下的股票
    try {
      const ids = conceptIds.split(',').filter(Boolean);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = await conceptDb.all(
          `SELECT DISTINCT code FROM concept_stocks WHERE concept_id IN (${placeholders})`,
          ids
        );
        activeCodesSet = new Set(rows.map(r => conceptDb.normalizeCode(r.code)));
        console.log(`🔗 [SSE] 视口模式连入，监听 ${activeCodesSet.size} 只股票 (${ids.length} 个题材)`);
      }
    } catch (err) {
      console.error('SSE viewport filter error:', err);
    }
  } else {
    console.log('🔗 [SSE] 全量模式连入（Admin 大屏）');
  }

  // 心跳维持连接
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  // 万能过滤器核心逻辑
  const onMarketUpdate = (data) => {
    if (!data || data.length === 0) return;

    let filtered = data;
    if (activeCodesSet) {
      // 精准过滤：只推送白名单内的股票
      filtered = data.filter(item => activeCodesSet.has(item.code));
    }

    if (filtered.length > 0) {
      res.write(`data: ${JSON.stringify(filtered)}\n\n`);
    }
  };

  marketEmitter.on('market_update', onMarketUpdate);

  // 支持动态更新视口（客户端可以通过重连或另一个 API 更新白名单）
  // 这里保留扩展接口，将来可改为 WebSocket 双向通信

  req.on('close', () => {
    console.log('❌ [SSE] 客户端断开行情流');
    clearInterval(heartbeat);
    marketEmitter.off('market_update', onMarketUpdate);
  });
});

// ============================================================
// GET /api/market/rpg-master
// Admin 大屏：高低频全息宽表数据
// ============================================================
router.get('/rpg-master', async (req, res) => {
  try {
    const data = await marketData.getAllStocksData();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/market/attributes
// 全量低频属性 Map
// ============================================================
router.get('/attributes', async (req, res) => {
  try {
    const data = await marketData.getAllAttributes();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/market/user-hub
// V6: 轻量级用户首页 - 渐进式加载
// Body: { userId, conceptIds?: [...], limit?: 10, offset?: 0 }
// ============================================================
router.post('/user-hub', async (req, res) => {
  try {
    const { userId, conceptIds, limit = 10, offset = 0 } = req.body;

    let targetConceptIds;

    if (conceptIds && conceptIds.length > 0) {
      // 视口模式：前端指定要加载的题材 ID
      targetConceptIds = conceptIds;
    } else if (userId) {
      // 用户模式：加载用户关注的题材（分页）
      const follows = await conceptDb.all(
        `SELECT concept_id FROM user_follows 
         WHERE user_id = ? 
         ORDER BY follow_order ASC 
         LIMIT ? OFFSET ?`,
        [userId, limit, offset]
      );
      targetConceptIds = follows.map(f => f.concept_id);
    } else {
      return res.status(400).json({ error: 'Missing userId or conceptIds' });
    }

    if (targetConceptIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // 批量获取题材详情 + 成分股 + 实时行情
    const result = [];
    const allCodes = new Set();

    // 1. 收集所有涉及的代码
    const conceptStocksMap = {};
    for (const cid of targetConceptIds) {
      const stocks = await conceptDb.all(`
        SELECT cs.code, COALESCE(sm.name, cs.code) AS name, cs.reason
        FROM concept_stocks cs
        LEFT JOIN stocks_meta sm ON cs.code = sm.code
        WHERE cs.concept_id = ?
      `, [cid]);
      conceptStocksMap[cid] = stocks;
      stocks.forEach(s => allCodes.add(conceptDb.normalizeCode(s.code)));
    }

    // 2. 批量查询行情（一次 SQL，高效）
    let quotesMap = {};
    if (allCodes.size > 0) {
      const quotes = await marketData.getQuotes(Array.from(allCodes));
      quotesMap = quotes.reduce((acc, q) => ({ ...acc, [q.code]: q }), {});
    }

    // 3. 组装每个题材的数据
    for (const cid of targetConceptIds) {
      const concept = await conceptDb.get('SELECT * FROM concepts WHERE id = ?', [cid]);
      if (!concept) continue;

      const stocks = conceptStocksMap[cid] || [];
      let totalChange = 0;
      let validStocks = 0;

      const enrichedStocks = stocks.map(s => {
        const normalized = conceptDb.normalizeCode(s.code);
        const quote = quotesMap[normalized] || {};
        if (quote.pct_change != null) {
          totalChange += quote.pct_change;
          validStocks++;
        }
        return {
          code: s.code,
          name: s.name,
          reason: s.reason,
          price: quote.price || null,
          pct_change: quote.pct_change || 0,
          volume: quote.volume || null,
          amount: quote.amount || null,
        };
      });

      result.push({
        _id: concept.id,
        name: concept.name,
        description: concept.description,
        type: concept.type,
        hotScore: concept.hot_score,
        stocks: enrichedStocks,
        avg_pct_change: validStocks > 0 ? (totalChange / validStocks).toFixed(2) : 0,
      });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('User hub error:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// ============================================================
// GET /api/market/concept/intraday/:id
// [V7] 题材成分股合成：今日分钟级分时线
// ============================================================
router.get('/concept/intraday/:id', async (req, res) => {
  try {
    const data = await marketData.getConceptIntraday(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/market/concept/daily-k/:id
// [V7] 题材成分股合成：60日历史 K 线
// ============================================================
router.get('/concept/daily-k/:id', async (req, res) => {
  try {
    const data = await marketData.getConceptDailyKLine(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
