const axios = require('axios');

/**
 * 股票概念成分股搜索服务
 * 使用阿里云 Qwen API 进行联网搜索并智能提取成分股
 */
class SearchService {
  constructor() {
    // Qwen API 配置
    this.apiConfig = {
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: process.env.QWEN_API_KEY || '',
      model: 'qwen3.5-plus'
    };
  }

  /**
   * 搜索并解析概念成分股
   * @param {string} conceptName - 概念名称
   * @param {number} stockCount - 股票数量（可选值：5, 10, 15, 20，默认10）
   * @returns {Promise<Array>} 成分股列表
   */
  async searchConceptStocks(conceptName, stockCount = 10) {
    console.log(`正在使用 Qwen API 联网搜索 "${conceptName}" 的成分股...`);

    const apiKey = this.apiConfig.apiKey;
    if (!apiKey) {
      throw new Error('未设置 QWEN_API_KEY 环境变量');
    }

    // 验证 stockCount
    const validCounts = [5, 10, 15, 20];
    if (!validCounts.includes(stockCount)) {
      stockCount = 10; // 默认值
    }

    // 使用 Qwen API 进行联网搜索
    const stocks = await this._aiSearchWithWebSearch(conceptName, stockCount);

    if (stocks.length === 0) {
      throw new Error('AI 搜索未返回有效股票数据');
    }

    console.log(`AI 联网搜索成功，找到 ${stocks.length} 只成分股`);
    return stocks;
  }

  /**
   * 使用 Qwen API 进行联网搜索并提取成分股
   * 支持流式响应处理
   */
  async _aiSearchWithWebSearch(conceptName, stockCount = 10) {
    // 构建 prompt
    let prompt = `
请搜索并返回【${conceptName}】概念股的中国A股核心上市公司。

要求：
1. 只返回中国A股市场（上海、深圳证券交易所）的股票
2. 股票代码必须是6位数字
3. 返回四个字段：code（代码）、name（中文名称）、market（SH/SZ）、reason（选中理由，简要说明该公司与概念的关联性，不超过50字）
4. 返回${stockCount}只该概念相关的近期热门强势股票
5. 如果不确定某只股票代码，请不要返回

返回JSON格式：
{
  "stocks": [
    {"code": "300136", "name": "信维通信", "market": "SZ", "reason": "是星链卫星互联网地面终端设备中核心连接器的独家供应商"}
  ]
}`;

    // 使用 Qwen API，支持流式响应
    const response = await axios.post(
      `${this.apiConfig.baseURL}/chat/completions`,
      {
        model: this.apiConfig.model,
        messages: [
          {
            role: 'system',
            content: '你是专业的中国A股股票分析助手。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        stream: true,
        top_p: 0.8,
        temperature: 0.7,
        extra_body: {
          enable_search: true,
          enable_thinking: false,
          thinking_budget: 4000
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiConfig.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000,
        responseType: 'stream'
      }
    );

    // 处理流式响应
    let content = '';
    for await (const chunk of response.data) {
      const lines = chunk.toString().split('\n').filter(line => line.trim() !== '' && line.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices && parsed.choices[0].delta && parsed.choices[0].delta.content) {
            content += parsed.choices[0].delta.content;
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }

    console.log('响应 content:', content);
    return this._extractJSONFromResponse(content);
  }

  /**
   * 从 AI 响应中提取 JSON 数组
   */
  _extractJSONFromResponse(content) {
    if (!content || typeof content !== 'string') {
      console.error('响应内容为空或不是字符串');
      return [];
    }

    // 清理内容：移除可能的 markdown 代码块标记
    let cleanedContent = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    let parsedData = null;

    // 尝试多种方式提取 JSON
    const extractMethods = [
      // 方法1: 直接解析整个内容
      () => {
        try {
          return JSON.parse(cleanedContent);
        } catch (e) {
          return null;
        }
      },
      // 方法2: 提取 {...} 格式的 JSON 对象（包含 stocks 字段）
      () => {
        const match = cleanedContent.match(/\{[\s\S]*"stocks"[\s\S]*\}/);
        if (match) {
          try {
            return JSON.parse(match[0]);
          } catch (e) {
            return null;
          }
        }
        return null;
      },
      // 方法3: 提取 JSON 数组
      () => {
        const match = cleanedContent.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (match) {
          try {
            return { stocks: JSON.parse(match[0]) };
          } catch (e) {
            return null;
          }
        }
        return null;
      }
    ];

    for (const method of extractMethods) {
      try {
        const result = method();
        if (result) {
          // 处理不同的响应格式
          let stocksArray = null;

          if (Array.isArray(result)) {
            // 直接是数组
            stocksArray = result;
          } else if (result.stocks && Array.isArray(result.stocks)) {
            // 包含 stocks 字段的对象
            stocksArray = result.stocks;
          }

          if (stocksArray && stocksArray.length > 0) {
            // 验证并过滤股票数据
            const validStocks = stocksArray.filter(item => {
              const isValid = this._isValidStock(item?.code, item?.name);
              return isValid;
            });

            return validStocks;
          }
        }
      } catch (e) {
        continue;
      }
    }

    console.error('所有提取方法都失败了');
    return [];
  }

  /**
   * 验证股票代码和名称是否有效
   */
  _isValidStock(code, name) {
    if (!code || !name) {
      return false;
    }

    // A股代码规则：6位数字
    if (!/^\d{6}$/.test(code)) {
      return false;
    }

    // 第一位判断市场
    const firstDigit = code[0];
    const validPrefix = ['0', '3', '6', '8'];
    if (!validPrefix.includes(firstDigit)) {
      return false;
    }

    // 排除 ST、*ST 等特殊处理股票
    if (name.includes('ST') || name.includes('退') || name.includes('*')) {
      return false;
    }

    // 排除一些明显不是股票的词
    const excludeWords = ['价格', '指数', '代码', '公告', '资讯', '新闻','有限'];
    if (excludeWords.some(word => name.includes(word))) {
      return false;
    }

    // 名称长度2-6个字符
    if (name.length < 2 || name.length > 7) {
      return false;
    }

    // 排除纯数字、包含特殊字符、或看起来像十六进制的内容
    if (/^[\d.,]+$/.test(name)) {
      return false;
    }
    if (/^[0-9a-fA-F.,]+$/.test(name) && name.length <= 6) {
      return false;
    }

    // 必须包含至少一个汉字（中文名称）
    if (!/[\u4e00-\u9fa5]/.test(name)) {
      return false;
    }

    return true;
  }
}

module.exports = new SearchService();
