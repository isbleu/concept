import os, tushare as ts
import pandas as pd
from dotenv import load_dotenv
load_dotenv('d:/Vibe/concept/concept_wechat/server/.env')
ts.set_token(os.environ.get('TUSHARE_TOKEN'))
pro = ts.pro_api()
df = pro.fina_indicator(ts_code='600519.SH', limit=5)
with open('debug_cols.txt', 'w') as f:
    f.write(','.join(df.columns.tolist()))
    f.write('\n\n')
    f.write(df.head(1).to_string())
