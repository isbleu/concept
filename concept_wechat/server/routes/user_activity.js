const express = require('express');
const router = express.Router();
const { conceptDb } = require('../db');
const marketData = require('../services/marketData');

// ============================================================
// POST /api/user/follow-toggle
// 切换关注/取关某个题材
// ============================================================
router.post('/follow-toggle', async (req, res) => {
  try {
    const { userId, conceptId } = req.body;
    if (!userId || !conceptId) {
      return res.status(400).json({ error: 'Missing userId or conceptId' });
    }

    // 检查用户是否存在
    const user = await conceptDb.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    // 检查是否已关注
    const existing = await conceptDb.get(
      'SELECT * FROM user_follows WHERE user_id = ? AND concept_id = ?',
      [userId, conceptId]
    );

    if (existing) {
      // 取关
      await conceptDb.run(
        'DELETE FROM user_follows WHERE user_id = ? AND concept_id = ?',
        [userId, conceptId]
      );
      res.json({ success: true, action: 'unfollowed', conceptId });
    } else {
      // 关注
      const now = new Date().toISOString();
      // 获取当前最大排序值
      const maxOrder = await conceptDb.get(
        'SELECT MAX(follow_order) as max_order FROM user_follows WHERE user_id = ?',
        [userId]
      );
      const nextOrder = (maxOrder?.max_order || 0) + 1;

      await conceptDb.run(
        'INSERT INTO user_follows (user_id, concept_id, follow_order, created_at) VALUES (?, ?, ?, ?)',
        [userId, conceptId, nextOrder, now]
      );
      res.json({ success: true, action: 'followed', conceptId });
    }
  } catch (err) {
    console.error('Follow toggle error:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// ============================================================
// GET /api/user/followed-concepts?userId=xxx
// 获取用户关注的题材列表（含行情快照）
// ============================================================
router.get('/followed-concepts', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // 查出用户关注的所有题材（包含公共和私有）
    const concepts = await conceptDb.all(`
      SELECT c.*, uf.follow_order
      FROM concepts c
      INNER JOIN user_follows uf ON c.id = uf.concept_id
      WHERE uf.user_id = ? AND c.status = 'active'
      ORDER BY uf.follow_order ASC
    `, [userId]);

    res.json({ success: true, data: concepts.map(c => ({
      _id: c.id,
      name: c.name,
      description: c.description,
      type: c.type,
      hotScore: c.hot_score,
      followOrder: c.follow_order
    })) });
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// ============================================================
// POST /api/user/generate-private
// 用户级 AI 生成：消耗积分，存入私有题材库
// ============================================================
router.post('/generate-private', async (req, res) => {
  try {
    const { userId, keyword, count = 10 } = req.body;
    if (!userId || !keyword) {
      return res.status(400).json({ error: 'Missing userId or keyword' });
    }

    // 1. 检查积分
    const user = await conceptDb.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.points < 10) {
      return res.status(403).json({ error: '积分不足', currentPoints: user.points, required: 10 });
    }

    // 2. 调用 AI 引擎
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

    pythonProcess.on('close', async (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: 'AI engine error', message: errorData });
      }

      try {
        const aiResult = JSON.parse(outputData.trim());

        // 3. 扣除积分（事务性）
        await conceptDb.changePoints(userId, -10, `AI 生成私有题材: ${keyword}`);

        // 4. 存入 concepts 为 private 题材
        const newId = conceptDb.genId();
        const now = new Date().toISOString();
        await conceptDb.transaction(async () => {
          await conceptDb.run(
            'INSERT INTO concepts (id, name, description, type, owner_id, hot_score, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [newId, aiResult.name || keyword, aiResult.description || '', 'private', userId, 100, 'active', now, now]
          );

          // 写入成分股
          if (aiResult.stocks && Array.isArray(aiResult.stocks)) {
            for (const s of aiResult.stocks) {
              if (!s.code) continue;
              
              const normalizedCode = conceptDb.normalizeCode(s.code);
              s.code = normalizedCode;

              await conceptDb.run(
                'INSERT OR REPLACE INTO concept_stocks (concept_id, code, reason) VALUES (?, ?, ?)',
                [newId, s.code, s.reason || '']
              );
              // 占位到 stocks_meta
              if (s.name) {
                await conceptDb.run(
                  'INSERT OR IGNORE INTO stocks_meta (code, name, updated_at) VALUES (?, ?, ?)',
                  [s.code, s.name, now]
                );
              }
            }
          }
        });

        // 5. 自动关注该私有题材
        await conceptDb.run(
          'INSERT OR IGNORE INTO user_follows (user_id, concept_id, follow_order, created_at) VALUES (?, ?, 0, ?)',
          [userId, newId, now]
        );

        // 6. 刷新缓存
        marketData.refreshCodeCache();

        // 获取更新后的积分
        const updatedUser = await conceptDb.get('SELECT points FROM users WHERE id = ?', [userId]);

        res.json({
          success: true,
          data: {
            conceptId: newId,
            name: aiResult.name || keyword,
            stocks: aiResult.stocks || [],
            remainingPoints: updatedUser.points
          }
        });
      } catch (err) {
        console.error('Private concept save error:', err);
        res.status(500).json({ error: err.message || 'Failed to save private concept' });
      }
    });
  } catch (err) {
    console.error('Generate private error:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// ============================================================
// GET /api/user/points?userId=xxx
// 获取用户积分和流水
// ============================================================
router.get('/points', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const user = await conceptDb.get('SELECT points FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    const logs = await conceptDb.all(
      'SELECT delta, reason, created_at FROM point_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [userId]
    );

    res.json({ success: true, data: { points: user.points, logs } });
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

module.exports = router;
