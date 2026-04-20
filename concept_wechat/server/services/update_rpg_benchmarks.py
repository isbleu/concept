import os
import sys
import sqlite3
import pandas as pd
import numpy as np
import tushare as ts
import json
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv

# 加载环境变量
env_path = os.path.join(os.path.dirname(__file__), '../.env')
load_dotenv(env_path)
ts.set_token(os.environ.get('TUSHARE_TOKEN'))
pro = ts.pro_api()

DB_W = os.path.join(os.path.dirname(__file__), 'warehouse.db')
BENCHMARK_FILE = os.path.join(os.path.dirname(__file__), 'rpg_benchmarks.json')

def get_percentile_table(series, bins=101):
    """计算 0-100 分位值对照表"""
    if series.empty:
        return [0] * bins
    series = series.dropna()
    # 强制截断 1% 和 99% 的异常值以防拉平曲线
    val_min = series.quantile(0.01)
    val_max = series.quantile(0.99)
    # 计算分位点
    return np.percentile(series, np.linspace(0, 100, bins)).tolist()

def update_benchmarks():
    print("START: Building Global RPG Benchmarks...")
    conn = sqlite3.connect(DB_W)

    # 1. 寻找数据最完整的最近一个交易日作为基准 (防止被半路同步的今天数据干扰)
    latest_date_row = conn.execute("""
        SELECT trade_date FROM historical_daily 
        WHERE pe_ttm IS NOT NULL 
        GROUP BY trade_date 
        HAVING COUNT(*) > 1000 
        ORDER BY trade_date DESC 
        LIMIT 1
    """).fetchone()
    latest_date = latest_date_row[0] if latest_date_row else None
    
    if not latest_date:
        print("Error: No complete trading day found in warehouse (>1000 rows). Please run catch-up sync first.")
        conn.close()
        return

    print(f"Using baseline date: {latest_date}")

    # 1. VIT, STR, AGI (从该完整日计算分位)
    df_basic = pd.read_sql_query(f"SELECT ts_code, pe_ttm, dv_ttm, turnover_rate_f FROM historical_daily WHERE trade_date = '{latest_date}'", conn)
    
    # VIT 改用 100/PE (盈利率)，空值在 get_percentile_table 中 dropna 自动处理
    df_basic['vit_raw'] = 100.0 / df_basic['pe_ttm']
    
    vit_bench = get_percentile_table(df_basic['vit_raw'])
    str_bench = get_percentile_table(df_basic['dv_ttm'])
    agi_bench = get_percentile_table(df_basic['turnover_rate_f'])

    # 2. MP (新版已改为个股绝对评分，标尺仅保留占位以防前端或后端依赖报错)
    mp_bench = list(range(101))

    # 3. INT (全量 5000+ 积分不够，采用采样策略：市值 Top 1000 + 随机 500)
    print("STEP: Sampling INT metrics (Estimated 10-15 mins)...")
    df_top = pro.daily_basic(trade_date=latest_date, fields='ts_code,circ_mv')
    df_top = df_top.sort_values('circ_mv', ascending=False)
    
    sample_codes = df_top['ts_code'].head(1000).tolist()
    random_samples = df_top['ts_code'].sample(n=min(500, len(df_top))).tolist()
    all_samples = list(set(sample_codes + random_samples))

    from tqdm import tqdm
    int_raw_list = []
    total = len(all_samples)
    print(f"STEP: Sampling INT metrics for {total} stocks (Estimated 10-15 mins)...")
    
    for code in tqdm(all_samples, desc="RPG INT Sampling", unit="stock"):
        try:
            # 只取最新一季，不传 period
            df_f = pro.fina_indicator(ts_code=code, limit=1, fields='q_netprofit_yoy,q_netprofit_qoq')
            if not df_f.empty:
                yoy = float(df_f['q_netprofit_yoy'].iloc[0]) if not pd.isna(df_f['q_netprofit_yoy'].iloc[0]) else 0.0
                qoq = float(df_f['q_netprofit_qoq'].iloc[0]) if not pd.isna(df_f['q_netprofit_qoq'].iloc[0]) else 0.0
                int_raw_list.append(yoy * 0.6 + qoq * 0.4)
        except:
            pass
        time.sleep(0.4) # 受限分时流量，总时长约 10 分钟

    print("\nINT Sampling Completed.")

    int_bench = get_percentile_table(pd.Series(int_raw_list))

    benchmarks = {
        "metadata": {
            "updated_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            "sample_date": latest_date,
            "int_sample_size": len(int_raw_list)
        },
        "VIT": vit_bench,
        "STR": str_bench,
        "AGI": agi_bench,
        "MP": mp_bench,
        "INT": int_bench
    }

    with open(BENCHMARK_FILE, 'w') as f:
        json.dump(benchmarks, f, indent=4)

    print(f"DONE: Benchmarks updated at {BENCHMARK_FILE}")
    conn.close()

if __name__ == "__main__":
    update_benchmarks()
