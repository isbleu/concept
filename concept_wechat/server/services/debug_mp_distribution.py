import sqlite3
import pandas as pd
import os
import numpy as np

DB_W = os.path.join(os.path.dirname(__file__), 'warehouse.db')

def analyze_mp():
    if not os.path.exists(DB_W):
        print("Warehouse not found")
        return

    conn = sqlite3.connect(DB_W)
    
    # 获取最近 60 个交易日
    dates = pd.read_sql_query("SELECT DISTINCT trade_date FROM historical_daily ORDER BY trade_date DESC LIMIT 60", conn)
    if dates.empty:
        print("No dates found")
        return
    
    start_date = dates['trade_date'].min()
    
    # 抽取 60 天全量数据进行内存计算（连板逻辑在 SQL 里写比较麻烦，Pandas 更直观）
    df = pd.read_sql_query(f"SELECT ts_code, trade_date, close, high, up_limit FROM historical_daily WHERE trade_date >= '{start_date}' ORDER BY ts_code, trade_date ASC", conn)
    conn.close()

    if df.empty:
        print("Data empty")
        return

    # 1. 判定基本状态
    df['is_limit'] = (df['close'] >= df['up_limit']) & (df['up_limit'] > 0)
    df['is_touch'] = (df['high'] >= df['up_limit']) & (df['close'] < df['up_limit']) & (df['up_limit'] > 0)

    # 2. 计算连板天数 (Consecutive Limit Days)
    # 连板天数定义：如果今天是涨停，且前后有相连，则计入。简单逻辑：统计每个涨停块的大小
    df['limit_group'] = (df['is_limit'] != df['is_limit'].shift()).cumsum()
    
    # 过滤出只有涨停的组，并计算每组大小
    limit_only = df[df['is_limit']]
    group_sizes = limit_only.groupby(['ts_code', 'limit_group']).size().reset_index(name='streak')
    
    # 连板天数：只有 streak >= 2 的天数才算“连板天数”吗？
    # 用户公式：(涨停天数 - 连板天数)*2 + 连板天数*3
    # 按语义，如果一个涨停是孤立的，不算连板；如果有 2 连板，这 2 天都算连板天数。
    streak_days = group_sizes[group_sizes['streak'] >= 2].groupby('ts_code')['streak'].sum().reset_index(name='consecutive_days')
    
    # 3. 汇总统计
    stats = df.groupby('ts_code').agg(
        total_limit=('is_limit', 'sum'),
        touch_limit=('is_touch', 'sum')
    ).reset_index()
    
    stats = pd.merge(stats, streak_days, on='ts_code', how='left').fillna(0)
    
    # 4. 计算用户公式
    # 炸板天数 + (总涨停 - 连板天数)*2 + 连板天数*3
    stats['mp_score'] = stats['touch_limit'] + (stats['total_limit'] - stats['consecutive_days']) * 2 + stats['consecutive_days'] * 3
    
    # 5. 分析分布
    dist = stats['mp_score'].value_counts().sort_index()
    total_stocks = len(stats)
    zero_score_count = stats[stats['mp_score'] == 0].shape[0]
    
    print("\n--- MP Formula Simulation (Last 60 Days) ---")
    print(f"Total Stocks Analyzed: {total_stocks}")
    print(f"Stocks with Score 0: {zero_score_count} ({zero_score_count/total_stocks:.1%})")
    print("\nTop 10 Score Distribution (Head):")
    print(dist.head(10))
    
    print("\nPercentile benchmarks for MP Score:")
    for p in [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99]:
        val = np.percentile(stats['mp_score'], p)
        print(f"P{p}: {val}")

if __name__ == "__main__":
    analyze_mp()
