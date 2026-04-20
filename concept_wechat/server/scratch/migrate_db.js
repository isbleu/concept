const Datastore = require('nedb-promises');
const path = require('path');

async function migrate() {
  const dbPath = path.join(__dirname, '../data/concepts.db');
  console.log('正在迁移数据库:', dbPath);
  
  const db = Datastore.create(dbPath);
  
  try {
    // 找出所有没有 status 字段的项目，并标记为 active
    const numUpdated = await db.update(
      { status: { $exists: false } }, 
      { $set: { status: 'active' } }, 
      { multi: true }
    );
    
    console.log(`✅ 成功将 ${numUpdated} 条老题材同步为 active 状态！`);
    
    // 同时也把 type 为空的项目补上 public 标签
    await db.update(
      { type: { $exists: false } },
      { $set: { type: 'public' } },
      { multi: true }
    );
    
    process.exit(0);
  } catch (err) {
    console.error('❌ 迁移失败:', err);
    process.exit(1);
  }
}

migrate();
