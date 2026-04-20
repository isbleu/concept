import sys
import os
import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime

# 注入 target_pos 逻辑所需 (因用户说只用 factor_ema_momentum)
def factor_ema_momentum(df: pd.DataFrame, ema_period: int = 6) -> pd.DataFrame:
    df = df.copy()
    if len(df) < 10:
        df['Target_Pos'] = 0
        return df
    
    df.columns = [c.lower() for c in df.columns]
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    df['M6'] = df['close'].ewm(span=ema_period, adjust=False).mean()
    df['RM6'] = df['M6'].shift(1)
    df['ChangeRate'] = (df['M6'] - df['RM6']) / df['RM6'] * 100
    df['Return'] = df['close'].pct_change() * 100
    
    df['Base'] = df['RM6']
    df.loc[df.index[0], 'Base'] = (df['close'].iloc[0] + df['open'].iloc[0]) / 2

    df['RM6_2'] = df['M6'].shift(2)
    df['M6_Mean'] = (df['M6'] + df['RM6'] + df['RM6_2']) / 3
    df['MAD_abs'] = (abs(df['M6'] - df['M6_Mean']) + 
                     abs(df['RM6'] - df['M6_Mean']) + 
                     abs(df['RM6_2'] - df['M6_Mean'])) / 3
    df['Volatility'] = df['MAD_abs'] / df['M6'] * 100

    buy_base = (df['ChangeRate'] > 0.5) & \
               ((df['Volatility'] > 0.215) | (df['low'] > df['Base'])) & \
               (df['close'] >= df['open'])

    sell_base = (df['ChangeRate'] < -0.3) & \
                ((df['Volatility'] > 0.2) | (df['high'] < df['Base'])) & \
                ((df['open'] >= df['close']) | (df['Return'] < -1.0))

    df['Target_Pos'] = np.nan
    df.loc[sell_base, 'Target_Pos'] = 0
    df.loc[buy_base, 'Target_Pos'] = 1  
    df['Target_Pos'] = df['Target_Pos'].ffill().fillna(0)
    
    return df

def normalize_code(code: str) -> str:
    code = code.upper()
    if not (code.endswith('.SH') or code.endswith('.SZ') or code.endswith('.BJ')):
        if code.startswith('6'): return f"{code}.SH"
        elif code.startswith('0') or code.startswith('3'): return f"{code}.SZ"
        elif code.startswith('8') or code.startswith('4'): return f"{code}.BJ"
    return code

from dotenv import load_dotenv
import tushare as ts

# 加载环境变量并初始化 Tushare
env_path = os.path.join(os.path.dirname(__file__), '../.env')
load_dotenv(env_path)
ts.set_token(os.environ.get('TUSHARE_TOKEN'))
pro = ts.pro_api()

DB_W = os.path.join(os.path.dirname(__file__), 'warehouse.db')
BENCHMARK_FILE = os.path.join(os.path.dirname(__file__), 'rpg_benchmarks.json')

def local_qfq(df):
    """本地进行前复权处理 (QFQ)"""
    if df.empty: return df
    
    # 保存一份不复权的收盘价和最高价，用于判定涨跌停 (up_limit 也是不复权的)
    df['orig_close'] = df['close'].copy()
    df['orig_high'] = df['high'].copy()
    
    # 获取最新的一个复权因子作为基准点
    latest_adj = df['adj_factor'].iloc[-1]
    if not latest_adj or latest_adj <= 0:
        latest_adj = 1.0
        
    df['qfq_factor'] = df['adj_factor'] / latest_adj
    df['open'] = df['open'] * df['qfq_factor']
    df['high'] = df['high'] * df['qfq_factor']
    df['low'] = df['low'] * df['qfq_factor']
    df['close'] = df['close'] * df['qfq_factor']
    return df

def calc_mp_score(df_stock):
    """计算法力值 (MP): 阶梯涨幅分 + 事件加成 (封板/连板/炸板)"""
    if df_stock.empty: return 0
    
    # 基础准备
    df = df_stock.copy()
    df['pre_close'] = df['orig_close'].shift(1)
    df['pct_chg'] = (df['orig_close'] / df['pre_close'] - 1) * 100
    
    # 1. 基础涨幅得分 (阶梯制)
    df['gain_score'] = 0
    df.loc[(df['pct_chg'] >= 3.0) & (df['pct_chg'] < 6.0), 'gain_score'] = 1
    df.loc[(df['pct_chg'] >= 6.0) & (df['pct_chg'] < 9.0), 'gain_score'] = 3
    df.loc[df['pct_chg'] >= 9.0, 'gain_score'] = 9

    # 2. 事件驱动得分
    # is_limit: 封死涨停
    df['is_limit'] = (df['orig_close'] >= df['up_limit']) & (df['up_limit'] > 0)
    # is_touch: 触板未封 (炸板/摸板)
    df['is_touch'] = (df['orig_high'] >= df['up_limit']) & (df['orig_close'] < df['up_limit']) & (df['up_limit'] > 0)
    # is_streak: 连板 (今天涨停且昨天也涨停则奖励)
    df['is_streak'] = df['is_limit'] & df['is_limit'].shift(1)

    # 3. 汇总加法
    df['mp_daily'] = df['gain_score']
    df.loc[df['is_touch'], 'mp_daily'] += 5
    df.loc[df['is_limit'], 'mp_daily'] += 10
    df.loc[df['is_streak'], 'mp_daily'] += 10

    # 4. 统计归点 (上限 100)
    total_points = df['mp_daily'].sum()
    return int(min(total_points, 100))

def main(codes):
    if not os.path.exists(DB_W):
        print(json.dumps([]))
        return

    conn = sqlite3.connect(DB_W)
    
    # 动态构建 SQL
    norm_codes = [normalize_code(c) for c in codes]
    placeholders = ','.join(['?']*len(norm_codes))
    
    # 从本地拿过去一段时间的所有数据
    df_all = pd.read_sql_query(f'''
        SELECT * FROM historical_daily 
        WHERE ts_code IN ({placeholders})
        ORDER BY trade_date ASC
    ''', conn, params=norm_codes)
    
    conn.close()

    if df_all.empty:
        print(json.dumps([]))
        return

    # 加载全局标尺
    benchmarks = {}
    if os.path.exists(BENCHMARK_FILE):
        with open(BENCHMARK_FILE, 'r') as f:
            benchmarks = json.load(f)

    # 结果容器
    final_output = []

    # 按股票代码 Group 处理因子计算
    for ts_code, df_stock in df_all.groupby('ts_code'):
        # 1. 本地复权 (内部会保留 orig_close)
        df_stock = df_stock.copy()
        df_stock = local_qfq(df_stock)
        df_stock['volume'] = df_stock['vol']

        # 2. 动量算法 (使用已复权的 close)
        df_algo = factor_ema_momentum(df_stock, ema_period=6)
        latest_signal = int(df_algo['Target_Pos'].iloc[-1]) if not df_algo.empty else 0

        # 取最近一日用于切片属性
        latest_row = df_stock.iloc[-1]
        
        # 3. 资金与占比 (核心指标，保持原始值不归一化)
        belg = float(latest_row['buy_elg_amount'] or 0)
        selg = float(latest_row['sell_elg_amount'] or 0)
        blg = float(latest_row['buy_lg_amount'] or 0)
        slg = float(latest_row['sell_lg_amount'] or 0)
        net_main = (belg - selg) + (blg - slg) # 单位万元
        
        amount_10k = float(latest_row['amount'] or 0) / 10
        main_ratio = round((net_main / amount_10k) * 100, 2) if amount_10k > 0 else 0.0

        # 4. 战力 Raw 值计算
        up_limit_count = (df_stock['orig_close'] >= df_stock['up_limit']).sum()
        agi_raw = df_stock['turnover_rate_f'].mean()
        # 直接取值，NA 逻辑由 get_score 统一处理
        pe_raw = float(latest_row['pe_ttm'])
        dv_raw = float(latest_row['dv_ttm'])
        
        # VIT 改用 100/PE (盈利率)，空值在 get_score 中自动处理为 0
        vit_val_raw = 100.0 / pe_raw if not pd.isna(pe_raw) and pe_raw != 0 else np.nan
        
        # 4.2 INT 获取：单股循环最新一季
        int_raw = 0.0
        profit_growth = 0.0
        try:
            df_fina = pro.fina_indicator(ts_code=ts_code, limit=1, fields='ts_code,end_date,q_netprofit_yoy,q_netprofit_qoq')
            if not df_fina.empty:
                yoy = float(df_fina['q_netprofit_yoy'].iloc[0]) if not pd.isna(df_fina['q_netprofit_yoy'].iloc[0]) else 0.0
                qoq = float(df_fina['q_netprofit_qoq'].iloc[0]) if not pd.isna(df_fina['q_netprofit_qoq'].iloc[0]) else 0.0
                int_raw = yoy * 0.6 + qoq * 0.4
                profit_growth = round(int_raw, 2)
        except Exception as e:
            pass

        # 4.3 === MP 法力值评分 (绝对值制) ===
        mp_score = calc_mp_score(df_stock)

        # 5. 代理分位打分 (在线插值 - 仅用于 VIT, STR, AGI, INT)
        def get_score(val, key):
            if pd.isna(val) or val is None:
                return 0 # 缺失或无效值直接回落到 0 分
            if key in benchmarks:
                xp = benchmarks[key] # 分位标尺点
                fp = np.linspace(0, 100, 101)
                return int(round(np.interp(val, xp, fp)))
            return 0

        # 5. 结果装填 (使用 safe_val 实时脱敏，避免二次循环)
        def safe_val(v, rounded=None):
            if pd.isna(v) or v is None: return None
            return round(float(v), rounded) if rounded is not None else float(v)

        final_output.append({
            "code": ts_code,
            "target_pos": latest_signal,
            "net_main": safe_val(net_main, 2),
            "main_ratio": safe_val(main_ratio, 2),
            "pe_ttm": safe_val(pe_raw, 4),
            "dv_ttm": safe_val(dv_raw, 4),
            "up_limit_days": int(up_limit_count),
            "turnover_mean": safe_val(agi_raw, 2),
            "profit_growth": safe_val(profit_growth, 2),
            "VIT": get_score(vit_val_raw, "VIT"),
            "STR": get_score(dv_raw, "STR"),
            "MP": mp_score, # 绝对分
            "AGI": get_score(agi_raw, "AGI"),
            "INT": get_score(int_raw, "INT")
        })

    print(json.dumps(final_output, ensure_ascii=False))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No codes provided"}))
    else:
        raw_codes = sys.argv[1].split(',')
        main(raw_codes)
