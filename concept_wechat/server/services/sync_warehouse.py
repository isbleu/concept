import os
import sqlite3
import pandas as pd
from datetime import datetime, time
import tushare as ts
import sys
import subprocess
from dotenv import load_dotenv

# 加载环境变量
env_path = os.path.join(os.path.dirname(__file__), '../.env')
load_dotenv(env_path)
ts.set_token(os.environ.get('TUSHARE_TOKEN'))
pro = ts.pro_api()

DB_PATH = os.path.join(os.path.dirname(__file__), 'warehouse.db')

# 从 init_historical_db.py 导入核心函数（此处直接内嵌以保证脚本独立健壮）
from init_historical_db import fetch_and_store_for_date

def get_last_synced_date():
    try:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute("SELECT value FROM sys_sync_status WHERE key = 'last_historical_date'").fetchone()
        conn.close()
        return row[0] if row else None
    except:
        return None

def update_last_synced_date(trade_date):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR REPLACE INTO sys_sync_status (key, value) VALUES ('last_historical_date', ?)", (trade_date,))
    conn.commit()
    conn.close()

def catch_up_sync():
    """检测缺口并执行追赶同步 (增加了数据完整性校验)"""
    last_date = get_last_synced_date()
    today_str = datetime.now().strftime('%Y%m%d')
    
    # 检查最后同步日的数据完整性 (需要 PE、股息、换手率全部有数)
    is_last_date_complete = True
    if last_date:
        try:
            conn_ck = sqlite3.connect(DB_PATH)
            # 同时检查 PE 和 股息率 (dv_ttm)
            row = conn_ck.execute("""
                SELECT COUNT(pe_ttm), COUNT(dv_ttm), COUNT(turnover_rate_f) 
                FROM historical_daily WHERE trade_date = ?
            """, (last_date,)).fetchone()
            conn_ck.close()
            
            # 如果任何一个核心指标填充率过低，视为不完整
            if any(c < 1000 for c in row):
                is_last_date_complete = False
                print(f"Detected 'hollow' data for {last_date} (Counts: PE={row[0]}, DV={row[1]}, Turn={row[2]}). Re-syncing...")
        except:
            pass

    if not last_date:
        print("Error: No initial sync date found. Please run init_historical_db.py first.")
        return

    # 获取同步列表
    print(f"Checking for trade date gaps since {last_date}...")
    try:
        cal = pro.trade_cal(exchange='SSE', is_open='1', start_date=last_date, end_date=today_str)
        # 如果最后一天不完整，将其包含进同步列表
        if not is_last_date_complete:
            dates_to_sync = cal[cal['cal_date'] >= last_date]['cal_date'].tolist()
        else:
            dates_to_sync = cal[cal['cal_date'] > last_date]['cal_date'].tolist()
    except Exception as e:
        print(f"Failed to fetch trade calendar: {e}")
        return

    # 过滤掉今天（如果还没到 18:30 结算时间，基本面数据通常在 18:00 后才全）
    current_time = datetime.now().time()
    market_closed_time = time(18, 30) 
    
    final_sync_list = []
    for d in dates_to_sync:
        if d < today_str:
            final_sync_list.append(d)
        elif d == today_str and current_time >= market_closed_time:
            final_sync_list.append(d)

    if not final_sync_list:
        print("Upcoming trading days found but market not yet closed for sync.")
        return

    print(f"Found {len(final_sync_list)} days to catch up: {final_sync_list}")
    
    conn = sqlite3.connect(DB_PATH)
    success_count = 0
    last_success = last_date

    for d in final_sync_list:
        if fetch_and_store_for_date(d, conn):
            last_success = d
            success_count += 1
            update_last_synced_date(d)
        else:
            print(f"Failed to sync {d}, stopping catch-up to maintain sequence.")
            break
    
    conn.close()
    
    if success_count > 0:
        print(f"Successfully caught up {success_count} days. Triggering RPG factor calculation...")
        # 触发本地量化计算
        try:
            # 需要读取题材池的所有代码来计算
            # 这里简单实现：我们可以让 Node.js 稍后单独拉起 calc_rpg_factors.py 
            # 或者在这里直接调用 (如果知道哪些代码)。
            # 由于 codes 由 Node.js 控制，此处仅完成仓库同步即可。
            pass
        except:
            pass
    else:
        print("No new data synchronized.")

if __name__ == '__main__':
    catch_up_sync()
