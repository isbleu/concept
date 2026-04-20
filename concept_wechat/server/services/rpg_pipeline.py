import sys
import os
import time
import json
import traceback
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# 初始化 Tushare
from dotenv import load_dotenv
env_path = os.path.join(os.path.dirname(__file__), '../.env')
load_dotenv(env_path)

TOKEN = os.environ.get('TUSHARE_TOKEN', '')
import tushare as ts
ts.set_token(TOKEN)
pro = ts.pro_api()

def factor_ema_vol_momentum(df: pd.DataFrame, ema_period: int = 6) -> pd.DataFrame:
    """从 backtester 中提取的 Target_Pos 核心算法"""
    df = df.copy()
    if len(df) < 10:
        df['Target_Pos'] = 0
        return df

    # 全部转为小写避免报错
    df.columns = [c.lower() for c in df.columns]
    
    # 防止含有非数值
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    # 核心均线与变化率
    df['M6'] = df['close'].ewm(span=ema_period, adjust=False).mean()
    df['RM6'] = df['M6'].shift(1)
    df['ChangeRate'] = (df['M6'] - df['RM6']) / df['RM6'] * 100
    df['Return'] = df['close'].pct_change() * 100
    
    # 填补第一天的基准值
    df['Base'] = df['RM6']
    df.loc[df.index[0], 'Base'] = (df['close'].iloc[0] + df['open'].iloc[0]) / 2

    # 均线波动率计算 (MAD算法)
    df['RM6_2'] = df['M6'].shift(2)
    df['M6_Mean'] = (df['M6'] + df['RM6'] + df['RM6_2']) / 3
    df['MAD_abs'] = (abs(df['M6'] - df['M6_Mean']) + 
                     abs(df['RM6'] - df['M6_Mean']) + 
                     abs(df['RM6_2'] - df['M6_Mean'])) / 3
    df['Volatility'] = df['MAD_abs'] / df['M6'] * 100

    # 量价配合因子
    df['VMA5'] = df['volume'].rolling(window=5).mean().fillna(df['volume'])
    
    # 核心买卖条件
    buy_base = (df['ChangeRate'] > 0.5) & \
               ((df['Volatility'] > 0.215) | (df['low'] > df['Base'])) & \
               (df['close'] >= df['open']) & \
               (df['volume'] > df['VMA5'] * 1.5)

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
        if code.startswith('6'):
            return f"{code}.SH"
        elif code.startswith('0') or code.startswith('3'):
            return f"{code}.SZ"
        elif code.startswith('8') or code.startswith('4'):
            return f"{code}.BJ"
    return code

def fetch_and_calculate(codes: list):
    """拉取低频数据并计算五维量化分数"""
    end_date = datetime.now().strftime('%Y%m%d')
    start_date = (datetime.now() - timedelta(days=90)).strftime('%Y%m%d') # 多取点以保证 60 个交易日
    
    raw_results = []
    
    for c in codes:
        ts_code = normalize_code(c)
        try:
            # 1. 行情、资金与涨跌停
            df_kline = ts.pro_bar(ts_code=ts_code, start_date=start_date, end_date=end_date, adj='qfq')
            df_limit = pro.stk_limit(ts_code=ts_code, start_date=start_date, end_date=end_date)
            df_basic = pro.daily_basic(ts_code=ts_code, start_date=start_date, end_date=end_date)
            df_money = pro.moneyflow(ts_code=ts_code, start_date=start_date, end_date=end_date)
            
            # 由于可能停牌，或者新股，处理 df 的截断，取最近 60 行
            if df_kline is None or df_kline.empty:
                continue
            
            # 对齐日期索引，方便合并
            df_kline.set_index('trade_date', inplace=True)
            if not df_limit.empty: df_limit.set_index('trade_date', inplace=True)
            if not df_basic.empty: df_basic.set_index('trade_date', inplace=True)
            if not df_money.empty: df_money.set_index('trade_date', inplace=True)
            
            df_merged = df_kline.head(60).copy() # 取最近60天
            
            # --- 算法 1：Target_Pos 信号 (必须逆序排序以保证时间正序计算 EMA) ---
            df_algo = df_merged.sort_index(ascending=True) # 时间升序才能算 EMA
            df_algo = factor_ema_vol_momentum(df_algo, ema_period=6)
            latest_signal = int(df_algo['Target_Pos'].iloc[-1]) if not df_algo.empty else 0

            # --- 算法 2：主力净流与占比 (最新天) ---
            latest_date = df_merged.index[0]
            net_main = 0.0
            main_ratio = 0.0
            if not df_money.empty and latest_date in df_money.index:
                row_m = df_money.loc[latest_date]
                if isinstance(row_m, pd.Series):
                    # Tushare moneyflow 可能会缺失
                    belg = float(row_m.get('buy_elg_amount', 0))
                    selg = float(row_m.get('sell_elg_amount', 0))
                    blg = float(row_m.get('buy_lg_amount', 0))
                    slg = float(row_m.get('sell_lg_amount', 0))
                    net_main = (belg - selg) + (blg - slg) # 单位万元
                    # 计算占比 (需要转换为相同单位，pro_bar里的amount是千元)
                    # amount_yuan = row_m['amount']万元? moneyflow表里可能没amount或者另算
                    if 'amount' in df_merged.columns:
                        total_amt_10k = float(df_merged.loc[latest_date, 'amount']) / 10 # 千元转化为万元
                        if total_amt_10k > 0:
                            main_ratio = round((net_main / total_amt_10k) * 100, 2)
                            net_main = round(net_main, 2)

            # --- 算法 3：法力 (MP) 涨停天数 ---
            up_limit_count = 0
            if not df_limit.empty:
                # 只统计 df_merged 中的这几十天
                for dt in df_merged.index:
                    if dt in df_limit.index:
                        lim_row = df_limit.loc[dt]
                        if isinstance(lim_row, pd.Series):
                            up_limit_val = lim_row.get('up_limit')
                            close_val = df_merged.loc[dt, 'close']
                            # 考虑到浮点数精度 并且 pro_bar 复权可能会影响判断，Tushare建议直接用不复权的判断。
                            # 既然我们用了复权的 pro_bar，简单模糊对比 1% 容差或用未复权的。这里粗度对比。
                            # 稳妥起见我们简单用 pct_chg 近似 > 9.9% 或 用 limit的判断
                            pct = float(df_merged.loc[dt, 'pct_chg'])
                            if pct >= 9.85:
                                up_limit_count += 1

            # --- 算法 4：灵巧 (AGI) 自由流动换手均值 ---
            agi_raw = 0.0
            if not df_basic.empty:
                # 提取过去 60 天交集的换手
                valid_trn = []
                for dt in df_merged.index:
                    if dt in df_basic.index:
                        r = df_basic.loc[dt]
                        if isinstance(r, pd.Series) and not pd.isna(r.get('turnover_rate_f')):
                            valid_trn.append(float(r['turnover_rate_f']))
                if valid_trn:
                    agi_raw = float(np.mean(valid_trn))
            
            # --- 算法 5：体力与力量 (VIT, STR) 等基础值 ---
            pe_raw = -1.0 # 默认负值
            dv_raw = 0.0
            if not df_basic.empty and latest_date in df_basic.index:
                row_b = df_basic.loc[latest_date]
                if isinstance(row_b, pd.Series):
                    pev = row_b.get('pe_ttm')
                    if pev and not pd.isna(pev): pe_raw = float(pev)
                    dvv = row_b.get('dv_ttm')
                    if dvv and not pd.isna(dvv): dv_raw = float(dvv)
                    
                    # 体力逻辑转换
                    if pe_raw > 0:
                        vit_raw = 100.0 / pe_raw # 倒数，市盈率越低该值越大
                    else:
                        vit_raw = 0.0 # 亏损直接 0 分体力
                else:
                    vit_raw = 0.0
            else:
                vit_raw = 0.0
                
            str_raw = dv_raw

            # 2. 智慧 (INT)：拉取财务表
            # 由于 fina 频率极低，且 Tushare 未必每只股票实时更新，用 ts_code 拉取倒序第一条
            df_fina = pro.fina_indicator(ts_code=ts_code, limit=1)
            int_raw = 0.0
            if not df_fina.empty:
                yoy = float(df_fina['q_netprofit_yoy'].iloc[0]) if not pd.isna(df_fina['q_netprofit_yoy'].iloc[0]) else 0.0
                qoq = float(df_fina['q_netprofit_qoq'].iloc[0]) if not pd.isna(df_fina['q_netprofit_qoq'].iloc[0]) else 0.0
                int_raw = yoy * 0.6 + qoq * 0.4 # 加权

            # 收集原始数据池，准备归一化打分
            raw_results.append({
                "code": ts_code,
                "target_pos": latest_signal,
                "net_main": net_main,
                "main_ratio": main_ratio,
                "vit_raw": vit_raw,
                "str_raw": str_raw,
                "mp_raw": up_limit_count,
                "agi_raw": agi_raw,
                "int_raw": int_raw,
                # 同时存一下展示用的实际数字底单
                "pe_ttm": pe_raw,
                "dv_ttm": dv_raw,
                "up_limit_days": up_limit_count,
                "turnover_mean": round(agi_raw, 2),
                "profit_growth": round(int_raw, 2)
            })

            time.sleep(0.12) # Tushare 频率压控保护
            
        except Exception as e:
            print(f"Error processing {c}: {traceback.format_exc()}", file=sys.stderr)
            continue
            
    # ============================================
    # 归一化打分引擎 (Cross-sectional Percentile)
    # ============================================
    if not raw_results:
        print(json.dumps([]))
        return
        
    df_raw = pd.DataFrame(raw_results)
    
    # 用 rank(pct=True) 算出 0~1 的百分位，再 * 100
    # 对所有维度正向排序
    df_raw['VIT'] = df_raw['vit_raw'].rank(pct=True, method='min') * 100
    # 对于体力，如果 vit_raw 为 0，应该压实到底层，上面 rank 会自动将一堆 0 排在最底
    
    df_raw['STR'] = df_raw['str_raw'].rank(pct=True, method='min') * 100
    df_raw['MP'] = df_raw['mp_raw'].rank(pct=True, method='min') * 100
    df_raw['AGI'] = df_raw['agi_raw'].rank(pct=True, method='min') * 100
    df_raw['INT'] = df_raw['int_raw'].rank(pct=True, method='min') * 100

    # 圆滑分数为整型
    for col in ['VIT', 'STR', 'MP', 'AGI', 'INT']:
        df_raw[col] = df_raw[col].fillna(0).round(0).astype(int)

    # 导出最终 JSON
    # 剔除不需落入前端视野的临时 RAW
    final_cols = ['code', 'target_pos', 'net_main', 'main_ratio', 'pe_ttm', 'dv_ttm', 'up_limit_days', 'turnover_mean', 'profit_growth', 'VIT', 'STR', 'MP', 'AGI', 'INT']
    
    final_output = df_raw[final_cols].to_dict('records')
    print(json.dumps(final_output, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No codes provided"}))
    else:
        raw_codes = sys.argv[1].split(',')
        fetch_and_calculate(raw_codes)
