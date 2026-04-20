"""
market_worker.py - 高性能持久化行情守卫 (Scheme A+ V3.1)

这是一个常驻后台的 Python 进程。它通过 ts.realtime_quote 抓取实时行情，
并通过 HTTP POST 将数据回传给 Node.js 服务器。

特性：
- 版本号比对：仅在股票池变动时同步代码列表
- 潮汐调度：交易日开盘期间 5s 高频，非交易时段 300s 低频
- 交易日历感知：Node.js 通过 Tushare HTTP API 每日查询一次
"""

import sys
import os
import time
import json
import requests
import tushare as ts
import pandas as pd
from datetime import datetime

# =========== 配置 ===========
NODE_BASE_URL = "http://127.0.0.1:5000"
CONFIG_URL = f"{NODE_BASE_URL}/api/internal/config"
UPDATE_URL = f"{NODE_BASE_URL}/api/internal/market-update"

POLL_INTERVAL_ACTIVE = 5      # 交易时段：5秒
POLL_INTERVAL_IDLE = 300      # 非交易时段：5分钟
# ============================

def get_token():
    return os.environ.get('TUSHARE_TOKEN')

def normalize_code(code):
    """股票代码格式化"""
    if '.' in code:
        return code.upper()
    if code.startswith('6'):
        return f"{code}.SH"
    elif code.startswith('0') or code.startswith('3'):
        return f"{code}.SZ"
    elif code.startswith('8') or code.startswith('4') or code.startswith('9'):
        return f"{code}.BJ"
    return code

def fetch_realtime(codes):
    """
    使用 ts.realtime_quote 爬虫接口获取实时行情
    返回格式化后的 JSON 数据列表
    """
    if not codes:
        return []
    
    # 标准化代码
    normalized = [normalize_code(c) for c in codes if c and str(c).strip()]
    formatted = ",".join(normalized)
    
    try:
        df = ts.realtime_quote(ts_code=formatted)
        if df is None or df.empty:
            return []
        
        # 数值类型转换
        cols = ['PRICE', 'PRE_CLOSE', 'OPEN', 'HIGH', 'LOW', 'VOLUME', 'AMOUNT']
        for col in cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
        
        # 计算涨跌幅
        df['PCT_CHANGE'] = 0.0
        mask = df['PRE_CLOSE'] > 0
        df.loc[mask, 'PCT_CHANGE'] = (
            (df['PRICE'] - df['PRE_CLOSE']) / df['PRE_CLOSE'] * 100
        ).round(2)
        
        # 向量化：列重命名 + 整体转 dict，避免 iterrows 循环
        col_map = {
            'TS_CODE': 'code', 'NAME': 'name', 'PRICE': 'price',
            'OPEN': 'open', 'PRE_CLOSE': 'pre_close', 'HIGH': 'high',
            'LOW': 'low', 'PCT_CHANGE': 'pct_change',
            'VOLUME': 'volume', 'AMOUNT': 'amount'
        }
        out = df.rename(columns=col_map)[list(col_map.values())].copy()
        out['last_updated'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # 将 NaN 替换为 0，确保 JSON 序列化安全
        out = out.fillna(0)
        return out.to_dict('records')
    except Exception as e:
        print(f"❌ [Worker] 行情抓取失败: {e}", flush=True)
        return []

def main():
    """主循环：获取配置 -> 抓取行情 -> 回传数据 -> 动态休眠"""
    token = get_token()
    if not token:
        print("❌ [Worker] 未找到 TUSHARE_TOKEN，无法启动", flush=True)
        sys.exit(1)
    
    ts.set_token(token)
    
    local_version = -1
    local_codes = []
    last_processed_minute = None
    
    print("🚀 [Worker] 行情守卫已启动，等待 Node.js 配置...", flush=True)
    
    while True:
        try:
            start_time = time.time()
            
            # ---- Step 1: 获取 Node.js 配置 ----
            resp = requests.get(CONFIG_URL, params={'v': local_version}, timeout=5)
            config = resp.json()
            
            if config.get('changed'):
                local_codes = config.get('codes', [])
                local_version = config.get('version', local_version)
                print(f"🔄 [Worker] 代码列表已更新至 v{local_version}，共 {len(local_codes)} 只", flush=True)
            
            is_trade_day = config.get('isTradeDay', False)
            is_market_open = config.get('isMarketOpen', False)
            
            # 动态调整频率
            interval = POLL_INTERVAL_ACTIVE if (is_trade_day and is_market_open) else POLL_INTERVAL_IDLE
            
            # ---- Step 2: 判定分钟边界 (isMinuteCandle) ----
            now = datetime.now()
            current_minute = now.strftime("%Y-%m-%d %H:%M")
            is_minute_candle = False
            
            # 只有在活跃交易时段，才进行分钟线打点
            if is_trade_day and is_market_open:
                if current_minute != last_processed_minute:
                    is_minute_candle = True
                    last_processed_minute = current_minute

            # ---- Step 3: 抓取行情 ----
            if local_codes:
                data = fetch_realtime(local_codes)
                if data:
                    # ---- Step 4: POST 回传给 Node.js ----
                    # 注入分钟线标识，通知 Node 侧落库 stock_intraday
                    payload = {
                        "data": data,
                        "isMinuteCandle": is_minute_candle,
                        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S")
                    }
                    
                    requests.post(
                        UPDATE_URL, 
                        json=payload, 
                        timeout=10,
                        headers={'Content-Type': 'application/json'}
                    )
                    
                    if is_minute_candle:
                        print(f"🔔 [Worker] 分钟边界触发 ({current_minute})，已发送持久化标记", flush=True)
                    
                    if interval == POLL_INTERVAL_ACTIVE or int(time.time()) % 600 < interval:
                        print(f"📡 [Worker] 已推送 {len(data)} 只股票 | 间隔: {interval}s", flush=True)
            
        except Exception as e:
            print(f"❌ [Worker] 循环异常: {e}", flush=True)
            interval = POLL_INTERVAL_ACTIVE # 发生错误时快速重试
        
        # ---- Step 5: 动态对齐休眠 (消除漂移) ----
        # 计算下一跳的绝对目标时间 (例如 00s, 05s, 10s...)
        now_ts = time.time()
        next_tick = now_ts + interval - (now_ts % interval)
        sleep_time = next_tick - now_ts
        
        # 如果处理耗时超过了 interval，则休眠一个极短时间，直接进入下一轮
        if sleep_time < 0:
            sleep_time = 0.1
            
        time.sleep(sleep_time)

if __name__ == "__main__":
    main()
