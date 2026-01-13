# 股票概念题材管理系统 - 实施计划

## 项目概述
构建一个股票概念/题材管理系统，用户输入概念名称（如"SpaceX概念股"），系统自动获取成分股列表，并实时显示个股行情涨跌。

## 技术架构

### 方案选择
- **后端**: Node.js + Express
- **前端**: HTML + Tailwind CSS（轻量级Web界面）
- **数据存储**: JSON 文件存储（简单易维护）
- **AI搜索**: 网页搜索 + AI解析
- **行情数据**: 新浪财经API / 东方财富API（免费）

### 项目结构
```
concept/
├── src/
│   ├── server.js          # Express服务器
│   ├── routes/            # API路由
│   │   └── concepts.js    # 概念相关API
│   ├── services/          # 业务逻辑
│   │   ├── searchService.js    # AI搜索成分股
│   │   └── stockService.js     # 获取股票行情
│   ├── data/              # 数据存储
│   │   └── concepts.json  # 概念库数据
│   └── public/            # 前端资源
│       ├── index.html     # 主页面
│       └── app.js         # 前端逻辑
├── package.json
└── PLAN.md
```

## 核心功能模块

### 1. 概念管理模块
- 创建新概念
- 存储概念和成分股列表
- 查询所有概念
- 删除概念

### 2. AI搜索成分股模块
- 输入：概念名称
- 处理：调用搜索API获取相关结果，使用AI解析提取股票代码
- 输出：成分股列表（股票代码、名称）

### 3. 股票行情模块
- 批量获取股票实时行情
- 数据：股票代码、名称、当前价、涨跌幅、涨跌额
- 自动刷新（可选）

### 4. 用户界面
- 输入框：输入概念名称
- 按钮："搜索并添加"
- 列表：显示所有概念及其成分股
- 实时行情显示：红涨绿跌

## API设计

### POST /api/concepts
创建新概念并搜索成分股

### GET /api/concepts
获取所有概念列表

### GET /api/concepts/:id/stocks
获取指定概念的成分股行情

### DELETE /api/concepts/:id
删除概念

### GET /api/stock/quote
获取单只股票行情

## 实施步骤

1. **初始化项目**
   - 创建 package.json
   - 安装依赖：express, axios, cheerio

2. **实现数据存储层**
   - concepts.json 结构设计
   - 读写操作封装

3. **实现搜索服务**
   - 集成搜索API
   - AI解析提取股票信息

4. **实现股票行情服务**
   - 调用行情API
   - 数据格式化

5. **实现后端API**
   - Express路由
   - 业务逻辑整合

6. **实现前端界面**
   - 概念输入和展示
   - 实时行情显示
   - 自动刷新机制

## 数据结构示例

```json
{
  "concepts": [
    {
      "id": "concept_001",
      "name": "SpaceX概念股",
      "createdAt": "2025-01-09T12:00:00Z",
      "stocks": [
        {
          "code": "600519",
          "name": "贵州茅台",
          "market": "SH"
        }
      ]
    }
  ]
}
```

## 股票行情API选项

1. **新浪财经** (推荐 - 免费)
   - http://hq.sinajs.cn/list=股票代码
   - 示例：sh600519, sz000001

2. **东方财富**
   - API需要爬虫

3. **腾讯财经**
   - http://qt.gtimg.cn/q=股票代码
