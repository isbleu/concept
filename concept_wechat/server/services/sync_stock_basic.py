"""
sync_stock_basic.py - 全量 A 股名录同步工具

每日调用 Tushare pro.stock_basic(list_status='L') 获取全部上市公司信息，
UPSERT 到 SQLite stocks_meta 表中，确保股票名称、行业等元数据始终最新。

同时计算 weight_factor = log(MA60_Amount) 用于板块指数合成加权。

用法:
    python sync_stock_basic.py
"""

import os
import sys
import json
import sqlite3
import math
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
import tushare as ts
from pypinyin import pinyin, Style

# 加载环境变量
env_path = os.path.join(os.path.dirname(__file__), '../.env')
load_dotenv(env_path)
ts.set_token(os.environ.get('TUSHARE_TOKEN'))
pro = ts.pro_api()

QUOTES_DB = os.path.join(os.path.dirname(__file__), '../data/quotes.db')
WAREHOUSE_DB = os.path.join(os.path.dirname(__file__), 'warehouse.db')

def get_pinyin_abbr(text):
    """提取汉字字符串的拼音首字母，返回纯小写字符拼音串"""
    if not isinstance(text, str):
        return ""
    # 提取首字母
    py_list = pinyin(text, style=Style.FIRST_LETTER, strict=False)
    # 展平并拼接
    return "".join([item[0] for item in py_list if item[0]]).lower()

def sync_stock_basic():
    """拉取全量 A 股上市公司名录并写入 stocks_meta"""
    print("📋 正在从 Tushare 拉取全量上市公司名录...", flush=True)
    
    try:
        df = pro.stock_basic(
            list_status='L',
            fields='ts_code,name,industry,market,list_date'
        )
    except Exception as e:
        print(json.dumps({"error": f"stock_basic API 调用失败: {e}"}))
        sys.exit(1)
    
    if df.empty:
        print(json.dumps({"error": "stock_basic 返回空数据"}))
        sys.exit(1)
    
    print(f"📋 获取到 {len(df)} 家上市公司，正在写入 stocks_meta...", flush=True)
    
    # 计算 weight_factor: log(MA60_Amount)
    # 如果 warehouse.db 存在，从中读取每只股票最近 60 天的平均成交额
    weight_map = {}
    if os.path.exists(WAREHOUSE_DB):
        try:
            conn_w = sqlite3.connect(WAREHOUSE_DB)
            df_amount = pd.read_sql_query("""
                SELECT ts_code, AVG(amount) as avg_amount
                FROM (
                    SELECT ts_code, amount 
                    FROM historical_daily 
                    WHERE amount IS NOT NULL AND amount > 0
                    ORDER BY trade_date DESC
                )
                GROUP BY ts_code
            """, conn_w)
            conn_w.close()
            
            for _, row in df_amount.iterrows():
                avg = row['avg_amount']
                if avg and avg > 0:
                    weight_map[row['ts_code']] = round(math.log(avg), 4)
        except Exception as e:
            print(f"⚠️ 读取 warehouse.db 计算权重失败: {e}", flush=True)
    
    # 写入 quotes.db 的 stocks_meta 表
    conn = sqlite3.connect(QUOTES_DB)
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    cursor = conn.cursor()
    count = 0
    for _, row in df.iterrows():
        code = row['ts_code']
        name = row['name']
        weight = weight_map.get(code, 0)
        py_abbr = get_pinyin_abbr(name)
        
        cursor.execute("""
            INSERT OR REPLACE INTO stocks_meta 
            (code, name, industry, market, list_date, weight_factor, py, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (code, name, row['industry'], row['market'], row['list_date'], weight, py_abbr, now))
        count += 1

    
    conn.commit()
    conn.close()
    
    result = {
        "success": True,
        "total": count,
        "weighted": len(weight_map),
        "timestamp": now
    }
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    sync_stock_basic()
