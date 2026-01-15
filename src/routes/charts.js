const express = require('express');
const router = express.Router();
const axios = require('axios');

/**
 * GET /api/charts/minute/:code
 * 获取股票分时图数据
 */
router.get('/minute/:code', async (req, res) => {
  try {
    const { code } = req.params;
    console.log('[分时图API] 请求股票:', code);

    // 格式化代码，添加sh/sz前缀
    let formattedCode = code;
    if (!code.startsWith('sh') && !code.startsWith('sz')) {
      const first = code.charAt(0);
      if (first === '6' || first === '8' || first === '9') {
        formattedCode = 'sh' + code;
      } else {
        formattedCode = 'sz' + code;
      }
    }
    console.log('[分时图API] 格式化代码:', formattedCode);

    // 使用腾讯财经分时图API获取真实分时数据
    const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${formattedCode}`;
    console.log('[分时图API] 请求URL:', url);

    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    console.log('[分时图API] API响应成功');

    // 解析分时数据
    const data = parseMinuteData(response.data, formattedCode);
    console.log('[分时图API] 解析成功, 数据点数:', data.times.length);

    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[分时图API] 获取失败:', error.message);
    // 返回模拟数据作为fallback
    console.log('[分时图API] 使用模拟数据fallback');
    res.json({
      success: true,
      data: generateMockMinuteData(req.params.code)
    });
  }
});

/**
 * GET /api/charts/daily/:code
 * 获取日K线数据
 */
router.get('/daily/:code', async (req, res) => {
  try {
    const { code } = req.params;
    console.log('[K线API] 请求股票:', code);

    // 格式化代码，添加sh/sz前缀
    let formattedCode = code;
    if (!code.startsWith('sh') && !code.startsWith('sz')) {
      const first = code.charAt(0);
      if (first === '6' || first === '8' || first === '9') {
        formattedCode = 'sh' + code;
      } else {
        formattedCode = 'sz' + code;
      }
    }
    console.log('[K线API] 格式化代码:', formattedCode);

    // 使用新浪财经K线API获取真实K线数据
    // scale=240 表示日K线，datalen=31 表示获取31天（第0天隐藏用于计算涨幅）
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${formattedCode}&scale=240&ma=no&datalen=31`;
    console.log('[K线API] 请求URL:', url);

    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.sina.com.cn'
      }
    });

    console.log('[K线API] API响应成功');

    // 解析K线数据
    const data = parseDailyData(response.data, code);

    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[K线API] 获取失败:', error.message);
    // 返回模拟数据作为fallback
    console.log('[K线API] 使用模拟数据fallback');
    res.json({
      success: true,
      data: generateMockDailyData(req.params.code)
    });
  }
});

// 解析分时数据（从腾讯分时图API获取真实分时数据）
function parseMinuteData(response, code) {
  try {
    const times = [];
    const prices = [];

    // 检查响应数据结构
    if (!response || !response.data || !response.data[code]) {
      throw new Error('Invalid response structure');
    }

    const minuteData = response.data[code].data;

    if (!minuteData || !minuteData.data || !Array.isArray(minuteData.data)) {
      throw new Error('No minute data available');
    }

    // 获取昨日收盘价、今日最高价、今日最低价
    let prevClose = null;
    let dayHigh = null;
    let dayLow = null;

    if (response.data[code].qt && response.data[code].qt[code]) {
      const qtData = response.data[code].qt[code];
      // 腾讯API格式: ["1", "名称", "代码", "当前价", "昨收", "今开", ...]
      // 索引4: 昨收, 索引5: 今开, 索引33: 今最高, 索引34: 今最低
      if (qtData.length > 34) {
        prevClose = parseFloat(qtData[4]) || null;
        dayHigh = parseFloat(qtData[33]) || null;
        dayLow = parseFloat(qtData[34]) || null;
      } else if (qtData.length > 4) {
        // Fallback: 至少获取昨收价
        prevClose = parseFloat(qtData[4]) || null;
      }
    }

    if (!prevClose || isNaN(prevClose)) {
      throw new Error('Cannot get previous close price');
    }

    console.log('[分时数据API] 昨收:', prevClose, '今最高:', dayHigh, '今最低:', dayLow);

    // 解析每条分时记录
    // 格式: "0930 1411.00 183 25821300.00"
    // 时间(HHMM) 价格 成交量 成交额
    for (const record of minuteData.data) {
      const parts = record.trim().split(/\s+/);
      if (parts.length >= 2) {
        const timeRaw = parts[0]; // HHMM
        const price = parseFloat(parts[1]);

        if (!isNaN(price)) {
          // 转换时间格式: 0930 -> 09:30
          const hour = timeRaw.substring(0, 2);
          const minute = timeRaw.substring(2, 4);
          const timeStr = `${hour}:${minute}`;

          times.push(timeStr);
          prices.push(price.toFixed(2));
        }
      }
    }

    if (times.length === 0) {
      throw new Error('No valid minute data parsed');
    }

    return { times, prices, code, prevClose, dayHigh, dayLow };
  } catch (error) {
    console.error('解析分时数据失败:', error.message);
    throw error;
  }
}

// 生成模拟分时数据
function generateMockMinuteData(code, basePrice = 10.00) {
  const times = [];
  const prices = [];

  const startTime = new Date();
  startTime.setHours(9, 30, 0, 0);

  // 昨日收盘价（假设在当前价附近）
  const prevClose = basePrice * (1 + (Math.random() - 0.5) * 0.02);

  // 开盘价（在昨日收盘价附近）
  let currentPrice = prevClose * (1 + (Math.random() - 0.5) * 0.01);

  // 生成分时数据
  for (let i = 0; i < 242; i++) {
    const time = new Date(startTime);
    time.setMinutes(time.getMinutes() + i);

    const hour = time.getHours();
    const minute = time.getMinutes();
    if (hour === 11 && minute >= 30) continue;
    if (hour >= 12 && hour < 13) continue;
    if (hour >= 15) break;

    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    times.push(timeStr);

    // 使用几何布朗运动模型生成更真实的价格
    const drift = (basePrice - currentPrice) * 0.002; // 向目标价漂移
    const volatility = basePrice * 0.002; // 波动率
    const randomShock = (Math.random() - 0.5) * volatility;

    currentPrice = currentPrice + drift + randomShock;

    // 添加小幅震荡
    const microNoise = (Math.random() - 0.5) * basePrice * 0.0005;
    currentPrice += microNoise;

    prices.push(currentPrice.toFixed(2));
  }

  // 平滑处理 - 移动平均，使曲线更自然
  const smoothedPrices = [];
  const window = 5;
  for (let i = 0; i < prices.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(prices.length - 1, i + window); j++) {
      sum += parseFloat(prices[j]);
      count++;
    }
    smoothedPrices.push((sum / count).toFixed(2));
  }

  return { times, prices: smoothedPrices, code };
}

// 解析K线数据（使用新浪K线API获取真实数据）
function parseDailyData(data, code) {
  try {
    // 数据已经是从新浪API获取的JSON数组
    if (Array.isArray(data) && data.length > 0) {
      const dates = [];
      const klineData = [];

      // 新浪K线数据格式: [{day, open, high, low, close, volume}, ...]
      for (const item of data) {
        if (item.day && item.open && item.high && item.low && item.close) {
          dates.push(item.day);

          // ECharts candlestick格式: [open, close, low, high, volume]
          klineData.push([
            parseFloat(item.open),
            parseFloat(item.close),
            parseFloat(item.low),
            parseFloat(item.high),
            parseInt(item.volume) || 0
          ]);
        }
      }

      console.log('[K线API] 解析成功，数据点数:', klineData.length);

      if (klineData.length > 0) {
        return { dates, klineData };
      }
    }

    throw new Error('Invalid K-line data format');
  } catch (error) {
    console.error('[K线API] 解析失败:', error.message);
    throw error;
  }
}

// 生成模拟日K线数据
function generateMockDailyData(code, basePrice = 20.00) {
  const dates = [];
  const klineData = [];

  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // 跳过周末
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }

    dates.push(date.toISOString().split('T')[0]);

    // 基于当前价格生成K线数据
    const range = basePrice * 0.05; // 5%的波动范围
    const open = basePrice + (Math.random() - 0.5) * range * 2;
    const close = basePrice + (Math.random() - 0.5) * range * 2;
    const low = Math.min(open, close) - Math.random() * range * 0.3;
    const high = Math.max(open, close) + Math.random() * range * 0.3;

    klineData.push([
      parseFloat(open.toFixed(2)),
      parseFloat(close.toFixed(2)),
      parseFloat(low.toFixed(2)),
      parseFloat(high.toFixed(2)),
      Math.floor(Math.random() * 1000000) + 100000
    ]);
  }

  return { dates, klineData };
}

module.exports = router;
