const express = require('express');
const router = express.Router();
const dataService = require('../services/dataService');
const searchService = require('../services/searchService');
const stockService = require('../services/stockService');
const authMiddleware = require('../middleware/auth');

// 启动日志 - 验证代码已更新
console.log('=== concepts.js v4 loaded ===');

/**
 * GET /api/concepts
 * 获取所有概念列表
 */
router.get('/', async (req, res) => {
  try {
    const concepts = await dataService.getAllConcepts();
    res.json({
      success: true,
      data: concepts
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/concepts/:id
 * 获取单个概念详情
 */
router.get('/:id', async (req, res) => {
  try {
    const concept = await dataService.getConceptById(req.params.id);
    if (!concept) {
      return res.status(404).json({
        success: false,
        error: '概念不存在'
      });
    }
    res.json({
      success: true,
      data: concept
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/concepts
 * 创建新概念并搜索成分股（需要认证）
 * Body: { name: string }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: '概念名称不能为空'
      });
    }

    // 搜索成分股
    const stocks = await searchService.searchConceptStocks(name.trim());

    // 创建概念
    const concept = await dataService.createConcept(name.trim(), stocks);

    res.json({
      success: true,
      data: concept,
      message: `成功创建概念"${name}"，找到 ${stocks.length} 只成分股`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/concepts/:id/stocks
 * 获取概念的成分股实时行情
 */
router.get('/:id/stocks', async (req, res) => {
  console.log('=== API /:id/stocks called for concept ===', req.params.id);
  try {
    const concept = await dataService.getConceptById(req.params.id);
    if (!concept) {
      return res.status(404).json({
        success: false,
        error: '概念不存在'
      });
    }

    if (!concept.stocks || concept.stocks.length === 0) {
      return res.json({
        success: true,
        data: {
          concept: concept.name,
          quotes: []
        }
      });
    }

    // 批量获取行情
    const quotes = await stockService.getBatchQuotes(concept.stocks);

    // 计算板块涨幅（成分股涨幅的平均值）
    let totalChangePercent = 0;
    let validCount = 0;
    quotes.forEach(quote => {
      // 只统计有价格的股票
      if (quote.price > 0) {
        totalChangePercent += quote.changePercent;
        validCount++;
      }
    });
    const avgChangePercent = validCount > 0 ? totalChangePercent / validCount : 0;

    console.log('=== Backend avgChangePercent ===', avgChangePercent, 'validCount:', validCount);

    const responseData = {
      success: true,
      data: {
        concept: concept.name,
        conceptId: concept.id,
        quotes,
        avgChangePercent: parseFloat(avgChangePercent.toFixed(2)),
        updateTime: new Date().toISOString()
      }
    };

    console.log('=== Response data.avgChangePercent ===', responseData.data.avgChangePercent);

    res.json(responseData);
  } catch (error) {
    console.error('=== API Error ===', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/concepts/:id
 * 删除概念（需要认证）
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await dataService.deleteConcept(req.params.id);
    res.json({
      success: true,
      message: '概念已删除'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/concepts/:id
 * 更新概念（重新搜索成分股，需要认证）
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: '概念名称不能为空'
      });
    }

    // 重新搜索成分股
    const stocks = await searchService.searchConceptStocks(name.trim());

    // 更新概念
    const concept = await dataService.updateConceptStocks(req.params.id, stocks);

    if (!concept) {
      return res.status(404).json({
        success: false,
        error: '概念不存在'
      });
    }

    res.json({
      success: true,
      data: concept,
      message: `已更新概念"${name}"，找到 ${stocks.length} 只成分股`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
