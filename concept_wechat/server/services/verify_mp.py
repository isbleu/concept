import sqlite3
import pandas as pd
import os
import json

# 配置路径
DB_PATH = os.path.join(os.path.dirname(__file__), 'warehouse.db')

def verify_stock_mp(ts_code):
    conn = sqlite3.connect(DB_PATH)
    
    # 获取近 60 个交易日数据
    df = pd.read_sql_query(f'''
        SELECT trade_date, close, high, up_limit 
        FROM historical_daily 
        WHERE ts_code = ? 
        ORDER BY trade_date ASC
    ''', conn, params=(ts_code,))
    
    if df.empty:
        print(f"Error: No data found for {ts_code}")
        return

    # 计算涨幅
    df['pre_close'] = df['close'].shift(1)
    df['pct_chg'] = (df['close'] / df['pre_close'] - 1) * 100
    
    # 1. 基础涨幅得分 (不互斥，取最高档)
    df['gain_score'] = 0
    df.loc[(df['pct_chg'] >= 3.0) & (df['pct_chg'] < 6.0), 'gain_score'] = 1
    df.loc[(df['pct_chg'] >= 6.0) & (df['pct_chg'] < 9.0), 'gain_score'] = 3
    df.loc[df['pct_chg'] >= 9.0, 'gain_score'] = 9

    # 2. 事件得分 (基于价格动作的逻辑)
    # is_limit: 封死涨停
    df['is_limit'] = (df['close'] >= df['up_limit']) & (df['up_limit'] > 0)
    # is_touch: 触板未封 (炸板/摸板)
    df['is_touch'] = (df['high'] >= df['up_limit']) & (df['close'] < df['up_limit']) & (df['up_limit'] > 0)
    # is_streak: 连板 (今天涨停且昨天也涨停)
    df['is_streak'] = df['is_limit'] & df['is_limit'].shift(1)

    # 3. 汇总得分 (加法)
    df['mp_daily'] = df['gain_score']
    df.loc[df['is_touch'], 'mp_daily'] += 5
    df.loc[df['is_limit'], 'mp_daily'] += 10
    df.loc[df['is_streak'], 'mp_daily'] += 10

    # 汇总统计
    total_gain_score = df['gain_score'].sum()
    touch_count = df['is_touch'].sum()
    limit_count = df['is_limit'].sum()
    streak_count = df['is_streak'].sum()
    
    mp_points = df['mp_daily'].sum()
    final_score = min(mp_points, 100)

    print(f"\n--- [Experimental] MP Verification for {ts_code} (Last 60 Days) ---")
    print(f"基础涨幅总分: {total_gain_score}")
    print(f"触板未封次数 (+5): {touch_count}")
    print(f"封死涨停次数 (+10): {limit_count}")
    print(f"连板奖励次数 (+10): {streak_count}")
    print(f"----------------------------------------")
    print(f"总计算分 (Total Points): {mp_points}")
    print(f"最终 MP 战力 (Capped at 100): {final_score}")

    # 列出加分详情
    bonus_days = df[df['mp_daily'] > 0].copy()
    if not bonus_days.empty:
        print("\n[加分详情]")
        for _, row in bonus_days.iterrows():
            reasons = []
            if row['gain_score'] > 0: reasons.append(f"涨幅得分(+{int(row['gain_score'])})")
            if row['is_limit']: reasons.append("封板加成(+10)")
            if row['is_streak']: reasons.append("连板加成(+10)")
            if row['is_touch']: reasons.append("炸板补偿(+5)")
            print(f"{row['trade_date']}: 涨幅 {row['pct_chg']:.2f}% | {', '.join(reasons)} | 当日小计: {int(row['mp_daily'])}")

if __name__ == "__main__":
    verify_stock_mp('300394.SZ')
