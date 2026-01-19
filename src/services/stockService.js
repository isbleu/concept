const axios = require('axios');

/**
 * 股票行情服务
 * 支持多个数据源，自动切换
 */
class StockService {
  constructor() {
    // 多个数据源（腾讯API优先，对停牌股票处理更准确）
    this.sources = [
      { name: 'tencent', baseUrl: 'http://qt.gtimg.cn', format: 'tencent' },
      { name: 'sina', baseUrl: 'http://hq.sinajs.cn', format: 'sina' }
    ];
    this.currentSource = 0;
  }

  /**
   * 获取当前数据源
   */
  _getSource() {
    return this.sources[this.currentSource];
  }

  /**
   * 切换到下一个数据源
   */
  _switchSource() {
    this.currentSource = (this.currentSource + 1) % this.sources.length;
  }

  /**
   * 格式化股票代码为新浪API格式
   * sh600519 或 sz000001
   */
  _formatStockCode(code, market) {
    const prefix = market ? market.toLowerCase() : this._getMarketPrefix(code);
    return `${prefix}${code}`;
  }

  /**
   * 根据股票代码获取市场前缀
   */
  _getMarketPrefix(code) {
    const firstDigit = code[0];
    if (firstDigit === '6' || firstDigit === '8') {
      return 'sh';
    }
    return 'sz';
  }

  /**
   * 获取单只股票行情
   * @param {string} code - 股票代码
   * @param {string} market - 市场代码 (SH/SZ)
   * @returns {Promise<Object>} 股票行情数据
   */
  async getStockQuote(code, market) {
    // 尝试多个数据源
    for (let attempt = 0; attempt < this.sources.length; attempt++) {
      const source = this._getSource();

      try {
        const formattedCode = this._formatStockCode(code, market);
        const url = `${source.baseUrl}/list=${formattedCode}`;

        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9'
          }
        });

        // 根据数据源格式解析
        if (source.format === 'sina') {
          return this._parseSinaResponse(response.data, code);
        } else if (source.format === 'tencent') {
          return this._parseTencentResponse(response.data, code);
        }
      } catch (error) {
        console.error(`${source.name} 获取股票 ${code} 失败:`, error.message);
        if (error.response?.status === 403) {
          // 限流，切换数据源
        }
        this._switchSource();
        await this._delay(500);
      }
    }

    // 所有数据源都失败
    console.warn(`所有数据源均失败，股票 ${code} 返回占位数据`);
    return this._getErrorQuote(code);
  }

  /**
   * 批量获取股票行情
   * @param {Array} stocks - 股票列表 [{code, market, name}]
   * @returns {Promise<Array>} 股票行情列表
   */
  async getBatchQuotes(stocks) {
    if (!stocks || stocks.length === 0) {
      return [];
    }

    // 尝试多个数据源
    for (let attempt = 0; attempt < this.sources.length; attempt++) {
      const source = this._getSource();

      try {
        const quotes = await this._fetchFromSource(stocks, source);
        return quotes;
      } catch (error) {
        console.error(`${source.name} 数据源失败:`, error.message);
        if (error.response?.status === 403) {
          // 限流，切换数据源
        }
        this._switchSource();
        // 添加延迟避免快速切换
        await this._delay(500);
      }
    }

    // 所有数据源都失败，返回错误数据
    console.warn('所有数据源均失败，返回占位数据');
    return stocks.map(s => this._getErrorQuote(s.code, s.name));
  }

  /**
   * 从指定数据源获取行情
   */
  async _fetchFromSource(stocks, source) {
    const codes = stocks.map(s => this._formatStockCode(s.code, s.market));
    let url, response;

    if (source.format === 'sina') {
      // 新浪财经
      url = `${source.baseUrl}/list=${codes.join(',')}`;
      response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Referer': 'http://finance.sina.com.cn'
        }
      });

      // 解析新浪响应
      const lines = response.data.trim().split('\n');
      return stocks.map((s, i) => this._parseSinaResponse(lines[i] || '', s.code, s.name));

    } else if (source.format === 'tencent') {
      // 腾讯财经
      url = `${source.baseUrl}/q=${codes.join(',')}`;
      response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Referer': 'http://stockapp.finance.qq.com'
        }
      });

      // 解析腾讯响应
      const lines = response.data.trim().split('\n');
      return stocks.map((s, i) => this._parseTencentResponse(lines[i] || '', s.code, s.name));
    }
  }

  /**
   * 解析腾讯财经响应
   */
  _parseTencentResponse(data, code, name) {
    try {
      // 格式: v_sh600519="600519,贵州茅台,1705.00,..."
      const match = data.match(/="([^"]+)"/);
      if (!match || match[1] === '') {
        return this._getErrorQuote(code, name);
      }

      const fields = match[1].split('~');
      // 腾讯格式: 代码,名称,当前价,昨收,开盘,最高,最低,买一,卖一,...

      const stockName = name || fields[1] || '';
      const price = parseFloat(fields[3]) || 0;
      const preClose = parseFloat(fields[4]) || 0;
      const open = parseFloat(fields[5]) || 0;
      const high = parseFloat(fields[33]) || 0;
      const low = parseFloat(fields[34]) || 0;
      const volume = parseInt(fields[36]) || 0;
      const amount = parseFloat(fields[37]) || 0;  // 成交额（万元）
      const date = fields[30] || '';
      const time = fields[31] || '';

      const change = price - preClose;
      const changePercent = preClose > 0 ? ((change / preClose) * 100) : 0;

      return {
        code,
        name: stockName,
        price,
        preClose,
        open,
        high,
        low,
        change: parseFloat(change.toFixed(2)),
        changePercent: parseFloat(changePercent.toFixed(2)),
        volume: volume * 100,
        amount: amount * 10000,  // 万元转元
        updateTime: date && time ? `${date} ${time}` : '',
        status: price === 0 ? 'stopped' : 'normal'
      };
    } catch (error) {
      return this._getErrorQuote(code, name);
    }
  }

  /**
   * 延迟函数
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 解析新浪API响应数据
   * 数据格式：var hq_str_sh600519="贵州茅台,1705.00,1708.00,..."
   */
  _parseSinaResponse(data, code, name) {
    try {
      // 提取引号内的数据
      const match = data.match(/="([^"]+)"/);
      if (!match || match[1] === '') {
        return this._getErrorQuote(code, name);
      }

      const fields = match[1].split(',');

      // 新浪数据字段说明：
      // 0:名称 1:开盘 2:昨收 3:当前价 4:最高 5:最低 6:买一 7:卖一
      // 8:成交量(手) 9:成交额(万) 10:买一量 11:买一价 12:买二量 13:买二价 ...
      // 30:日期 31:时间

      const stockName = name || fields[0] || '';
      const open = parseFloat(fields[1]) || 0;
      const preClose = parseFloat(fields[2]) || 0;
      const price = parseFloat(fields[3]) || 0;
      const high = parseFloat(fields[4]) || 0;
      const low = parseFloat(fields[5]) || 0;
      const volume = parseInt(fields[8]) || 0; // 手
      const amount = parseFloat(fields[9]) || 0; // 万
      const date = fields[30] || '';
      const time = fields[31] || '';

      // 计算涨跌
      const change = price - preClose;
      const changePercent = preClose > 0 ? ((change / preClose) * 100) : 0;

      // 判断状态
      let status = 'normal';
      // 检测停牌：价格为0且开盘、最高、最低都为0，说明是停牌状态
      // 停牌时新浪API返回price=0，应该用preClose作为显示价格
      if (price === 0 && open === 0 && high === 0 && low === 0) {
        status = 'stopped'; // 停牌
        // 停牌时用昨收价作为当前价，涨跌为0
        return {
          code,
          name: stockName,
          price: preClose,  // 停牌时显示昨收价
          preClose,
          open,
          high,
          low,
          change: 0,
          changePercent: 0,
          volume: volume * 100, // 转换为股
          amount: amount, // 转换为元
          updateTime: date && time ? `${date} ${time}` : '',
          status
        };
      } else if (date === '' || time === '') {
        status = 'closed'; // 盘后
      }

      return {
        code,
        name: stockName,
        price,
        preClose,
        open,
        high,
        low,
        change: parseFloat(change.toFixed(2)),
        changePercent: parseFloat(changePercent.toFixed(2)),
        volume: volume * 100, // 转换为股
        amount: amount , // 转换为元
        updateTime: date && time ? `${date} ${time}` : '',
        status
      };
    } catch (error) {
      console.error('解析股票数据失败:', error.message);
      return this._getErrorQuote(code, name);
    }
  }

  /**
   * 获取错误状态的股票数据
   */
  _getErrorQuote(code, name) {
    return {
      code,
      name: name || '',
      price: 0,
      preClose: 0,
      open: 0,
      high: 0,
      low: 0,
      change: 0,
      changePercent: 0,
      volume: 0,
      amount: 0,
      updateTime: '',
      status: 'error'
    };
  }

  /**
   * 判断股票是否上涨
   */
  isUp(quote) {
    return quote.change > 0;
  }

  /**
   * 判断股票是否下跌
   */
  isDown(quote) {
    return quote.change < 0;
  }

  /**
   * 判断股票是否平盘
   */
  isFlat(quote) {
    return quote.change === 0;
  }

  /**
   * 获取涨跌颜色类名（用于前端显示）
   */
  getColorClass(quote) {
    if (this.isUp(quote)) return 'up'; // 红色
    if (this.isDown(quote)) return 'down'; // 绿色
    return 'flat'; // 灰色
  }
}

module.exports = new StockService();
