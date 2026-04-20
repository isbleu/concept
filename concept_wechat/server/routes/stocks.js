const express = require('express');
const router = express.Router();
const { conceptDb } = require('../db');
const marketData = require('../services/marketData');

// GET /api/stocks/:code
// 获取股票详情：元数据 + 实时行情 + RPG 属性
router.get('/:code', async (req, res) => {
  try {
    const code = conceptDb.normalizeCode(req.params.code);
    
    // 从 stocks_meta 获取基础信息
    const meta = await conceptDb.get(
      'SELECT * FROM stocks_meta WHERE code = ?', [code]
    );
    
    if (!meta) {
      return res.status(404).json({ error: 'Stock not found in meta database' });
    }

    // 从行情表获取实时数据
    const quotes = await marketData.getQuotes([code]);
    const quote = quotes[0] || {};

    res.json({ 
      success: true, 
      data: {
        ...meta,
        price: quote.price || null,
        open: quote.open || null,
        high: quote.high || null,
        low: quote.low || null,
        pre_close: quote.pre_close || null,
        pct_change: quote.pct_change || 0,
        volume: quote.volume || null,
        amount: quote.amount || null,
        last_market_update: quote.last_updated || null
      }
    });
  } catch (err) {
    console.error('Stock detail error:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// GET /api/stocks/search/:keyword
// 全局搜索股票（基于 stocks_meta 全量名录，支持代码/名称/首字母）
router.get('/search/:keyword', async (req, res) => {
  try {
    const keyword = req.params.keyword;
    const isAscii = /^[\x00-\x7F]*$/.test(keyword);
    
    // 如果全由字母和数字组成，增加首字母匹配 (小写)
    let sql = `SELECT code, name, industry, market, py FROM stocks_meta 
               WHERE code LIKE ? OR name LIKE ?`;
    let params = [`%${keyword}%`, `%${keyword}%`];

    if (isAscii) {
      sql += ` OR py LIKE ?`;
      params.push(`${keyword.toLowerCase()}%`); 
      // 对于拼音搜索，推荐前缀匹配 ^keyword 代替全模糊，提高精度，也更符合直觉
    }
    
    sql += ` LIMIT 20`;

    const results = await conceptDb.all(sql, params);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
