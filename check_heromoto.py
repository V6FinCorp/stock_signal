
import mysql.connector
from config import Config
import pandas as pd
import pandas_ta as ta

def check_heromoto():
    # 1. Get ISIN
    dm_cfg = Config.get_datamart_db_config()
    conn_dm = mysql.connector.connect(**dm_cfg)
    cur_dm = conn_dm.cursor()
    cur_dm.execute("SELECT bs_ISIN FROM vw_e_bs_companies_all WHERE bs_SYMBOL = 'HEROMOTOCO'")
    row = cur_dm.fetchone()
    if not row:
        print("HEROMOTOCO not found in companies table.")
        return
    isin = row[0]
    print(f"ISIN for HEROMOTOCO: {isin}")
    conn_dm.close()

    # 2. Fetch Data
    app_cfg = Config.get_app_db_config()
    conn_app = mysql.connector.connect(**app_cfg)
    query = f"""
        SELECT timestamp, open, high, low, close 
        FROM app_sg_ohlcv_prices 
        WHERE isin = '{isin}' AND timeframe = '5m' 
        AND timestamp >= '2026-02-01 00:00:00' 
        ORDER BY timestamp ASC
    """
    df = pd.read_sql(query, conn_app)
    
    if df.empty:
        print("No 5m data found for HEROMOTOCO today.")
        return

    # 3. Calculate 15m RSI (as the scenario uses primary timeframe for RSI)
    df_15m = df.set_index('timestamp').resample('15min').agg({'close': 'last'}).dropna()
    df_15m['RSI'] = ta.rsi(df_15m['close'], length=14)
    df_15m['RSI_shifted'] = df_15m['RSI'].shift(1)
    
    # 4. Check for today
    today_mask = (df_15m.index >= '2026-02-23 09:15:00') & (df_15m.index <= '2026-02-23 15:30:00')
    df_today = df_15m[today_mask]
    
    print("\nHEROMOTOCO 15m RSI values for today:")
    print(df_today[['close', 'RSI_shifted']].to_string())
    
    # Check if any value hits 65-70 range
    hits = df_today[(df_today['RSI_shifted'] >= 65) & (df_today['RSI_shifted'] <= 70)]
    if hits.empty:
        print("\nConclusion: HEROMOTOCO RSI did NOT enter the 65-70 range today.")
        max_rsi = df_today['RSI_shifted'].max()
        print(f"Max RSI today: {max_rsi}")
    else:
        print("\nConclusion: RSI DID enter the range at these times:")
        print(hits)

    conn_app.close()

if __name__ == "__main__":
    check_heromoto()
