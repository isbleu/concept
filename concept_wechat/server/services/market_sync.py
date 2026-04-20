import sys
import os
import tushare as ts
import akshare as ak
import json
import pandas as pd
from datetime import datetime

# 从环境变量获取 Token
def get_token():
    return os.environ.get('TUSHARE_TOKEN')

# 股票代码格式化 (补全 .SH/.SZ)
def normalize_code(code):
    if '.' in code:
        return code.upper()
    if code.startswith('6'):
        return f"{code}.SH"
    elif code.startswith('0') or code.startswith('3'):
        return f"{code}.SZ"
    elif code.startswith('8') or code.startswith('4') or code.startswith('9'):
        return f"{code}.BJ"
    return code

def sync_market_data(codes):
    token = get_token()
    if not token:
        print(json.dumps({"error": "No TUSHARE_TOKEN found in environment variables"}))
        return

    ts.set_token(token)
    pro = ts.pro_api()

    # 标准化所有代码并过滤空值
    valid_codes = [c for c in codes if c and str(c).strip()]
    normalized_codes = [normalize_code(c) for c in valid_codes]
    
    # 格式化代码字符串
    formatted_codes = ",".join(normalized_codes)
    all_quotes = []

    if not formatted_codes:
        print("[]")
        return
    
    try:
        # 使用 ts.realtime_quote 抓取高频行情
        df_realtime = ts.realtime_quote(ts_code=formatted_codes)
        
        if not df_realtime.empty:
            # 确保关键列转为数值类型
            cols_to_numeric = ['PRICE', 'PRE_CLOSE', 'OPEN', 'HIGH', 'LOW', 'VOLUME', 'AMOUNT']
            for col in cols_to_numeric:
                df_realtime[col] = pd.to_numeric(df_realtime[col], errors='coerce').fillna(0)
            
            # 使用 Pandas 向量化计算涨跌幅，杜绝 for 循环
            # 考虑 PRE_CLOSE 可能为 0 的情况，避免除以 0
            df_realtime['PCT_CHANGE'] = 0.0
            mask = df_realtime['PRE_CLOSE'] > 0
            df_realtime.loc[mask, 'PCT_CHANGE'] = ((df_realtime['PRICE'] - df_realtime['PRE_CLOSE']) / df_realtime['PRE_CLOSE'] * 100).round(2)
            
            # 由于去掉了 AKShare (低频数据)，直接转换结果
            # 取出前端所需字段
            final_data = []
            for _, row in df_realtime.iterrows():
                final_data.append({
                    "code": row['TS_CODE'],
                    "name": row['NAME'],
                    "price": row['PRICE'],
                    "open": row['OPEN'],
                    "pre_close": row['PRE_CLOSE'],
                    "high": row['HIGH'],
                    "low": row['LOW'],
                    "pct_change": row['PCT_CHANGE'],
                    "volume": row['VOLUME'],
                    "amount": row['AMOUNT'],
                    "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                })
            print(json.dumps(final_data, ensure_ascii=False))
        else:
            print("[]")
    except Exception as e:
        import traceback
        error_msg = traceback.format_exc()
        print(json.dumps({"error": f"Tushare Error on codes [{formatted_codes}]: {error_msg}"}))

if __name__ == "__main__":
    # 高频行情时间卡控：交易日 09:15 - 15:00 之间运行 (包含集合竞价)
    now = datetime.now()
    current_time = now.time()
    from datetime import time
    
    is_weekday = now.weekday() < 5
    is_market_hours = time(9, 15) <= current_time <= time(15, 5)
    
    # 为了允许开发期间（周末/晚上）也能测试和查看页面排版数据，暂时注释掉强制退出逻辑
    # if not (is_weekday and is_market_hours):
    #     pass

    if len(sys.argv) < 2:
        print(json.dumps({"error": "No codes provided"}))
    else:
        stock_codes = sys.argv[1].split(',')
        sync_market_data(stock_codes)
