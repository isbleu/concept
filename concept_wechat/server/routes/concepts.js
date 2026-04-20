const express = require('express');
const router = express.Router();
const { conceptDb } = require('../db');
const marketData = require('../services/marketData');

/**
 * 内部辅助：将概念行 + 成分股行组装为前端期望的格式
 * 前端期望: { _id, name, description, stocks: [{code, name, reason}], ... }
 * 
 * V6: name 通过 JOIN stocks_meta 获取，不再从 concept_stocks 中取
 */
const assembleConceptWithStocks = async (concept, quotesMap = {}) => {
  // JOIN stocks_meta 获取 name
  const stocks = await conceptDb.all(`
    SELECT cs.code, COALESCE(sm.name, cs.code) AS name, cs.reason
    FROM concept_stocks cs
    LEFT JOIN stocks_meta sm ON cs.code = sm.code
    WHERE cs.concept_id = ?
  `, [concept.id]);

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
      open: quote.open || null,
      high: quote.high || null,
      low: quote.low || null,
      pre_close: quote.pre_close || null,
      volume: quote.volume || null,
      amount: quote.amount || null,
      pct_change: quote.pct_change || 0,
      last_market_update: quote.last_updated || null
    };
  });

  return {
    _id: concept.id,
    name: concept.name,
    description: concept.description,
    type: concept.type,
    ownerId: concept.owner_id || null,
    hotScore: concept.hot_score,
    status: concept.status || 'active',
    stocks: enrichedStocks,
    avg_pct_change: validStocks > 0 ? (totalChange / validStocks).toFixed(2) : 0,
    createdAt: concept.created_at,
    updatedAt: concept.updated_at
  };
};

/**
 * 内部辅助：批量写入成分股
 * V6: 不再写入 name，同时 UPSERT stocks_meta 保证元数据存在
 */
const insertStocks = async (conceptId, stocks) => {
  if (!stocks || !Array.isArray(stocks) || stocks.length === 0) return;
  for (const s of stocks) {
    if (!s.code) continue;
    
    // 强制增加后缀，确保全数据库代码格式统一
    const normalizedCode = conceptDb.normalizeCode(s.code);
    s.code = normalizedCode;

    // 写入关联关系（不含 name）
    await conceptDb.run(
      'INSERT OR REPLACE INTO concept_stocks (concept_id, code, reason) VALUES (?, ?, ?)',
      [conceptId, s.code, s.reason || '']
    );
    // 如果 stocks_meta 中不存在该代码，插入一条占位记录
    // 后续 sync_stock_basic 会自动补全 name/industry 等字段
    if (s.name) {
      await conceptDb.run(
        'INSERT OR IGNORE INTO stocks_meta (code, name, updated_at) VALUES (?, ?, ?)',
        [s.code, s.name, new Date().toISOString()]
      );
    }
  }
};

// ============================================================
// GET /api/concepts/admin-list
// 管理员专用：获取全量题材列表，支持 status 筛选
// ============================================================
router.get('/admin-list', async (req, res) => {
  try {
    const { status = 'active', keyword } = req.query;
    
    // 只查 public 类型 (admin-list 不显示用户私有题材)
    let sql = "SELECT * FROM concepts WHERE status = ? AND type = 'public'";
    let params = [status];
    
    if (keyword) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    
    sql += ' ORDER BY updated_at DESC';
    
    const concepts = await conceptDb.all(sql, params);
    
    // 收集所有代码用于行情注水
    const allCodes = new Set();
    const conceptStocksMap = {};
    for (const c of concepts) {
      // V6: JOIN stocks_meta 获取 name
      const stocks = await conceptDb.all(`
        SELECT cs.code, COALESCE(sm.name, cs.code) AS name, cs.reason
        FROM concept_stocks cs
        LEFT JOIN stocks_meta sm ON cs.code = sm.code
        WHERE cs.concept_id = ?
      `, [c.id]);
      conceptStocksMap[c.id] = stocks;
      stocks.forEach(s => { if (s.code) allCodes.add(conceptDb.normalizeCode(s.code)); });
    }
    
    // 从行情库注水
    let quotesMap = {};
    if (allCodes.size > 0) {
      const quotes = await marketData.getQuotes(Array.from(allCodes));
      quotesMap = quotes.reduce((acc, q) => ({ ...acc, [q.code]: q }), {});
    }

    // 组装响应
    const mappedConcepts = concepts.map(c => {
      const stocks = conceptStocksMap[c.id] || [];
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
          code: s.code, name: s.name, reason: s.reason,
          price: quote.price || null, open: quote.open || null,
          high: quote.high || null, low: quote.low || null,
          pre_close: quote.pre_close || null,
          volume: quote.volume || null, amount: quote.amount || null,
          pct_change: quote.pct_change || 0,
          last_market_update: quote.last_updated || null
        };
      });

      return {
        _id: c.id, name: c.name, description: c.description,
        type: c.type, hotScore: c.hot_score,
        status: c.status || 'active',
        stocks: enrichedStocks,
        avg_pct_change: validStocks > 0 ? (totalChange / validStocks).toFixed(2) : 0,
        createdAt: c.created_at, updatedAt: c.updated_at
      };
    });
    
    res.json({ success: true, data: mappedConcepts });
  } catch (err) {
    console.error('❌ [AdminList] 错误:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// ============================================================
// GET /api/concepts/export
// ============================================================
router.get('/export', async (req, res) => {
  try {
    const concepts = await conceptDb.all(
      "SELECT * FROM concepts WHERE status != 'deleted' ORDER BY updated_at DESC"
    );
    const result = [];
    for (const c of concepts) {
      const stocks = await conceptDb.all(`
        SELECT cs.code, COALESCE(sm.name, cs.code) AS name, cs.reason
        FROM concept_stocks cs
        LEFT JOIN stocks_meta sm ON cs.code = sm.code
        WHERE cs.concept_id = ?
      `, [c.id]);
      result.push({
        _id: c.id, name: c.name, description: c.description,
        stocks, type: c.type, hotScore: c.hot_score,
        status: c.status, createdAt: c.created_at, updatedAt: c.updated_at
      });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=concepts_backup.json');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Export failed' });
  }
});

// ============================================================
// GET /api/concepts/:id
// ============================================================
router.get('/:id', async (req, res) => {
  try {
    const concept = await conceptDb.get('SELECT * FROM concepts WHERE id = ?', [req.params.id]);
    if (!concept) return res.status(404).json({ error: 'Concept not found' });
    const assembled = await assembleConceptWithStocks(concept);
    res.json({ success: true, data: assembled });
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// ============================================================
// PATCH /api/concepts/:id/status
// ============================================================
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'deleted'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await conceptDb.run(
      'UPDATE concepts SET status = ?, updated_at = ? WHERE id = ?',
      [status, new Date().toISOString(), req.params.id]
    );
    // 更新内存缓存
    marketData.refreshCodeCache();
    res.json({ success: true, message: `Status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// ============================================================
// DELETE /api/concepts/:id (物理删除)
// ============================================================
router.delete('/:id', async (req, res) => {
  try {
    const concept = await conceptDb.get('SELECT * FROM concepts WHERE id = ?', [req.params.id]);
    if (!concept) return res.status(404).json({ error: 'Not found' });
    if (concept.status !== 'deleted') {
      return res.status(403).json({ error: '只有在回收站中的题材才能彻底删除' });
    }
    
    // CASCADE 会自动删 concept_stocks
    await conceptDb.run('DELETE FROM concepts WHERE id = ?', [req.params.id]);
    // 全量重建缓存（因为删除后可能有代码在其他概念中仍然活跃）
    marketData.refreshCodeCache();
    res.json({ success: true, message: 'Permanently deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// ============================================================
// POST /api/concepts/generate-ai (Admin AI 生成 -> 公共题材库)
// ============================================================
router.post('/generate-ai', async (req, res) => {
  const { keyword, count = 10 } = req.body;
  if (!keyword) return res.status(400).json({ error: 'Keyword is required' });

  const { spawn } = require('child_process');
  const path = require('path');
  
  const pythonProcess = spawn('python', [
    path.join(__dirname, '../ai_engine.py'),
    keyword, count
  ], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

  let outputData = '';
  let errorData = '';

  pythonProcess.stdout.on('data', (data) => { outputData += data.toString(); });
  pythonProcess.stderr.on('data', (data) => { errorData += data.toString(); });

  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      console.error('Python execution error:', errorData);
      return res.status(500).json({ error: 'AI engine error', message: errorData });
    }
    try {
      const result = JSON.parse(outputData.trim());
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ error: 'Failed to parse AI output', raw: outputData });
    }
  });
});

// ============================================================
// POST /api/concepts (保存/创建/编辑)
// ============================================================
router.post('/', async (req, res) => {
  try {
    const { id, name, description, stocks, type = 'public', hotScore = 100, isOverwrite = false } = req.body;
    const now = new Date().toISOString();

    // 1. 编辑已有项目 (带 ID)
    if (id) {
      await conceptDb.transaction(async () => {
        await conceptDb.run(
          'UPDATE concepts SET name = ?, description = ?, hot_score = ?, updated_at = ? WHERE id = ?',
          [name, description, hotScore, now, id]
        );
        await conceptDb.run('DELETE FROM concept_stocks WHERE concept_id = ?', [id]);
        await insertStocks(id, stocks);
      });
      const concept = await conceptDb.get('SELECT * FROM concepts WHERE id = ?', [id]);
      const assembled = await assembleConceptWithStocks(concept);
      marketData.refreshCodeCache();
      return res.json({ success: true, data: assembled });
    }

    // 2. 重名检测
    const existing = await conceptDb.get(
      "SELECT * FROM concepts WHERE name = ? AND status != 'deleted'", [name]
    );

    if (existing && !isOverwrite) {
      return res.json({ 
        success: false, 
        conflict: existing.status || 'active', 
        message: `题材【${name}】已存在，是否确认覆盖？` 
      });
    }

    // 3. 覆盖写入
    if (isOverwrite && existing) {
      await conceptDb.transaction(async () => {
        await conceptDb.run(
          'UPDATE concepts SET name = ?, description = ?, hot_score = ?, status = ?, updated_at = ? WHERE id = ?',
          [name, description, hotScore, 'active', now, existing.id]
        );
        await conceptDb.run('DELETE FROM concept_stocks WHERE concept_id = ?', [existing.id]);
        await insertStocks(existing.id, stocks);
      });
      const concept = await conceptDb.get('SELECT * FROM concepts WHERE id = ?', [existing.id]);
      const assembled = await assembleConceptWithStocks(concept);
      marketData.refreshCodeCache();
      return res.json({ success: true, data: assembled });
    }

    // 4. 全新创建
    const newId = conceptDb.genId();
    await conceptDb.transaction(async () => {
      await conceptDb.run(
        'INSERT INTO concepts (id, name, description, type, hot_score, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [newId, name, description, type, hotScore, 'active', now, now]
      );
      await insertStocks(newId, stocks);
    });
    const concept = await conceptDb.get('SELECT * FROM concepts WHERE id = ?', [newId]);
    const assembled = await assembleConceptWithStocks(concept);
    // 更新缓存
    marketData.refreshCodeCache();
    return res.json({ success: true, data: assembled });

  } catch (err) {
    console.error('Save Concept Error:', err);
    res.status(500).json({ error: 'Save failed' });
  }
});

// ============================================================
// POST /api/concepts/batch (批量导入)
// ============================================================
router.post('/batch', async (req, res) => {
  try {
    const concepts = req.body;
    if (!Array.isArray(concepts)) {
      return res.status(400).json({ error: '数据格式错误，预期为 JSON 数组' });
    }

    const results = { success: 0, skipped: 0, errors: 0 };
    const now = new Date().toISOString();

    for (const item of concepts) {
      try {
        const { name, description, stocks, hotScore = 100 } = item;
        const existing = await conceptDb.get(
          "SELECT id FROM concepts WHERE name = ? AND status != 'deleted'", [name]
        );
        
        if (existing) {
          results.skipped++;
          continue;
        }

        const newId = conceptDb.genId();
        await conceptDb.transaction(async () => {
          await conceptDb.run(
            'INSERT INTO concepts (id, name, description, type, hot_score, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [newId, name, description, 'public', hotScore, 'active', now, now]
          );
          await insertStocks(newId, stocks);
        });
        results.success++;
      } catch (e) {
        results.errors++;
      }
    }
    // 批量导入后全量刷新缓存
    marketData.refreshCodeCache();
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ error: 'Batch import failed' });
  }
});

module.exports = router;
