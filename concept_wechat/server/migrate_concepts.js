/**
 * migrate_concepts.js - NeDB → SQLite 概念数据迁移脚本
 * 
 * 用法: node migrate_concepts.js
 * 
 * 功能:
 * 1. 读取 NeDB 的 concepts.db 文件
 * 2. 将每个 concept 拆分写入 SQLite 的 concepts 表和 concept_stocks 表
 * 3. 自动跳过已迁移的数据（基于 name 去重）
 */

const Datastore = require('nedb-promises');
const path = require('path');
const db = require('./db');
const { conceptDb } = db;

const dataDir = path.join(__dirname, 'data');

async function migrate() {
  console.log('🚀 开始 NeDB → SQLite 概念数据迁移...\n');

  // 1. 加载 NeDB 数据
  const nedbConcepts = Datastore.create({
    filename: path.join(dataDir, 'concepts.db'),
    autoload: true
  });

  const allConcepts = await nedbConcepts.find({});
  console.log(`📦 在 NeDB 中找到 ${allConcepts.length} 个概念\n`);

  if (allConcepts.length === 0) {
    console.log('ℹ️ 没有需要迁移的数据');
    return;
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const concept of allConcepts) {
    try {
      // 检查是否已迁移
      const existing = await conceptDb.get(
        'SELECT id FROM concepts WHERE name = ?', [concept.name]
      );
      
      if (existing) {
        skipped++;
        continue;
      }

      const id = concept._id || conceptDb.genId();
      const now = new Date().toISOString();

      await conceptDb.transaction(async () => {
        // 写入概念主表
        await conceptDb.run(
          `INSERT INTO concepts (id, name, description, type, hot_score, status, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            concept.name || '',
            concept.description || '',
            concept.type || 'public',
            concept.hotScore || 100,
            concept.status || 'active',
            concept.createdAt ? new Date(concept.createdAt).toISOString() : now,
            concept.updatedAt ? new Date(concept.updatedAt).toISOString() : now
          ]
        );

        // 写入成分股关联表
        if (concept.stocks && Array.isArray(concept.stocks)) {
          for (const stock of concept.stocks) {
            if (!stock.code) continue;
            await conceptDb.run(
              'INSERT OR IGNORE INTO concept_stocks (concept_id, code, name, reason) VALUES (?, ?, ?, ?)',
              [id, stock.code, stock.name || '', stock.reason || '']
            );
          }
        }
      });

      migrated++;
      console.log(`  ✅ [${migrated}] ${concept.name} (${(concept.stocks || []).length} 只成分股)`);

    } catch (err) {
      errors++;
      console.error(`  ❌ 迁移失败: ${concept.name} - ${err.message}`);
    }
  }

  console.log('\n========== 迁移完成 ==========');
  console.log(`✅ 成功迁移: ${migrated} 个概念`);
  console.log(`⏭️ 已跳过:   ${skipped} 个 (已存在)`);
  console.log(`❌ 失败:     ${errors} 个`);

  // 验证
  const totalConcepts = await conceptDb.all('SELECT COUNT(*) as cnt FROM concepts');
  const totalStocks = await conceptDb.all('SELECT COUNT(DISTINCT code) as cnt FROM concept_stocks');
  console.log(`\n📊 SQLite 当前状态:`);
  console.log(`   概念总数: ${totalConcepts[0].cnt}`);
  console.log(`   去重股票: ${totalStocks[0].cnt}`);
}

migrate().then(() => {
  console.log('\n🏁 迁移脚本执行完毕');
  process.exit(0);
}).catch(err => {
  console.error('💥 迁移脚本崩溃:', err);
  process.exit(1);
});
