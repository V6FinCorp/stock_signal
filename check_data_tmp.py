
import mysql.connector
from config import Config
import pandas as pd

def check_data():
    db_cfg = Config.get_app_db_config()
    conn = mysql.connector.connect(**db_cfg)
    query = """
        SELECT timestamp, open, high, low, close 
        FROM app_sg_ohlcv_prices 
        WHERE isin = 'INE917I01010' AND timeframe = '5m' 
        AND timestamp >= '2026-02-23 00:00:00' 
        ORDER BY timestamp ASC
    """
    df = pd.read_sql(query, conn)
    print(df.head(20))
    conn.close()

if __name__ == "__main__":
    check_data()
