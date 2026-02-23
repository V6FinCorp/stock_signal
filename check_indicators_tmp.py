
import mysql.connector
from config import Config
import pandas as pd
import pandas_ta as ta

def check_data():
    db_cfg = Config.get_app_db_config()
    conn = mysql.connector.connect(**db_cfg)
    query = """
        SELECT timestamp, open, high, low, close 
        FROM app_sg_ohlcv_prices 
        WHERE isin = 'INE917I01010' AND timeframe = '5m' 
        AND timestamp >= '2026-02-01 00:00:00' 
        ORDER BY timestamp ASC
    """
    df = pd.read_sql(query, conn)
    
    st = ta.supertrend(df['high'], df['low'], df['close'], length=10, multiplier=3.0)
    df['ST_dir'] = st['SUPERTd_10_3.0']
    
    # Resample to 15m
    df_15m = df.set_index('timestamp').resample('15min').agg({'close': 'last'}).dropna()
    df_15m['RSI'] = ta.rsi(df_15m['close'], length=14)
    df_15m['RSI_shifted'] = df_15m['RSI'].shift(1)
    
    df = pd.merge_asof(
        df, 
        df_15m[['RSI_shifted']], 
        left_on='timestamp', 
        right_index=True,
        direction='backward'
    )

    mask = (df['timestamp'] >= '2026-02-23 09:15:00') & (df['timestamp'] <= '2026-02-23 11:00:00')
    target_data = df[mask][['timestamp', 'close', 'ST_dir', 'RSI_shifted']]
    print(target_data.to_string())
    conn.close()

if __name__ == "__main__":
    check_data()
