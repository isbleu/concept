import os
import sqlite3
import pandas as pd
from datetime import datetime, timedelta
import tushare as ts
import time
import sys
from dotenv import load_dotenv

# 加载环境变量
env_path = os.path.join(os.path.dirname(__file__), '../.env')
load_dotenv(env_path)
ts.set_token(os.environ.get('TUSHARE_TOKEN'))
pro = ts.pro_api()

DB_PATH = os.path.join(os.path.dirname(__file__), 'warehouse.db')

def init_warehouse_schema():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS historical_daily (
            ts_code TEXT,
            trade_date TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            vol REAL,
            amount REAL,
            adj_factor REAL,
            up_limit REAL,
            down_limit REAL,
            turnover_rate_f REAL,
            pe_ttm REAL,
            dv_ttm REAL,
            buy_elg_amount REAL,
            sell_elg_amount REAL,
            buy_lg_amount REAL,
            sell_lg_amount REAL,
            PRIMARY KEY (ts_code, trade_date)
        )
    ''')
    # 对于提速查询至关重要的索引
    conn.execute('CREATE INDEX IF NOT EXISTS idx_hist_code_date ON historical_daily (ts_code, trade_date DESC)')
    # 系统状态表，存储最后同步日期等
    conn.execute('CREATE TABLE IF NOT EXISTS sys_sync_status (key TEXT PRIMARY KEY, value TEXT)')
    conn.commit()
    return conn

def get_last_60_trade_dates():
    end_date = datetime.now().strftime('%Y%m%d')
    start_date = (datetime.now() - timedelta(days=150)).strftime('%Y%m%d') # 多取以防节假日
    cal = pro.trade_cal(exchange='SSE', is_open='1', start_date=start_date, end_date=end_date)
    dates = cal['cal_date'].tolist()
    return sorted(dates)[-60:] # 获取最后 60 个交易日

def fetch_and_store_for_date(trade_date, conn):
    """拉取指定日期的全市场五大基础表并合并落库"""
    print(f"Syncing market data for: {trade_date} ...", flush=True)
    try:
        # 1. 基础日线
        df_daily = pro.daily(trade_date=trade_date)
        if df_daily.empty:
            return False

        # 2. 复权因子
        df_adj = pro.adj_factor(trade_date=trade_date)
        
        # 3. 每日基本面
        df_basic = pro.daily_basic(trade_date=trade_date)
        
        # 4. 涨跌停
        df_limit = pro.stk_limit(trade_date=trade_date)
        
        # 5. 资金流向
        df_money = pro.moneyflow(trade_date=trade_date)

        # 把这五张表按 ts_code 拼起来
        df_merged = df_daily[['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount']]

        if not df_adj.empty:
            df_merged = pd.merge(df_merged, df_adj[['ts_code', 'adj_factor']], on='ts_code', how='left')
        else:
            df_merged['adj_factor'] = 1.0

        if not df_limit.empty:
            df_merged = pd.merge(df_merged, df_limit[['ts_code', 'up_limit', 'down_limit']], on='ts_code', how='left')
        else:
            df_merged['up_limit'] = None
            df_merged['down_limit'] = None

        if not df_basic.empty:
            df_merged = pd.merge(df_merged, df_basic[['ts_code', 'turnover_rate_f', 'pe_ttm', 'dv_ttm']], on='ts_code', how='left')
        else:
            for c in ['turnover_rate_f', 'pe_ttm', 'dv_ttm']: df_merged[c] = None
        
        if not df_money.empty:
            df_merged = pd.merge(df_merged, df_money[['ts_code', 'buy_elg_amount', 'sell_elg_amount', 'buy_lg_amount', 'sell_lg_amount']], on='ts_code', how='left')
        else:
            for c in ['buy_elg_amount', 'sell_elg_amount', 'buy_lg_amount', 'sell_lg_amount']: df_merged[c] = 0.0

        # 由于可能出现重复键，用 replace 模式写入，但 Pandas to_sql 支持不佳，故自行构建 SQL 或用 df.to_sql(if_exists='append') 加 IGNORE
        # sqlite3 直接 append 有时会主键冲突报错，这里用稍微原生的防冲突写入
        records = df_merged.to_dict('records')
        
        sql = '''
            INSERT OR REPLACE INTO historical_daily (
                ts_code, trade_date, open, high, low, close, vol, amount, adj_factor,
                up_limit, down_limit, turnover_rate_f, pe_ttm, dv_ttm,
                buy_elg_amount, sell_elg_amount, buy_lg_amount, sell_lg_amount
            ) VALUES (
                :ts_code, :trade_date, :open, :high, :low, :close, :vol, :amount, :adj_factor,
                :up_limit, :down_limit, :turnover_rate_f, :pe_ttm, :dv_ttm,
                :buy_elg_amount, :sell_elg_amount, :buy_lg_amount, :sell_lg_amount
            )
        '''
        
        cur = conn.cursor()
        cur.executemany(sql, records)
        conn.commit()
        return True
    except Exception as e:
        print(f"{trade_date} 拉取失败: {e}", file=sys.stderr)
        return False

def init_historical():
    conn = init_warehouse_schema()
    dates = get_last_60_trade_dates()
    print(f"Data Warehouse Init: Syncing {len(dates)} days...")
    
    last_success_date = None
    for d in dates:
        success = fetch_and_store_for_date(d, conn)
        if success:
            last_success_date = d
            time.sleep(1.01)

    if last_success_date:
        conn.execute("INSERT OR REPLACE INTO sys_sync_status (key, value) VALUES ('last_historical_date', ?)", (last_success_date,))
        conn.commit()

    print("60-day Historical Data Sync Complete!")
    conn.close()

if __name__ == '__main__':
    init_historical()
