
import mysql.connector
from config import Config

def check_db():
    app_cfg = Config.get_app_db_config()
    conn = mysql.connector.connect(**app_cfg)
    cur = conn.cursor()
    
    # Check HEROMOTOCO
    cur.execute("SELECT COUNT(*), MAX(timestamp) FROM app_sg_ohlcv_prices WHERE isin = 'INE158A01026' AND timeframe = '5m'")
    res = cur.fetchone()
    print(f"HEROMOTOCO (5m) - Rows: {res[0]}, Latest: {res[1]}")
    
    # Check BAJAJ-AUTO
    cur.execute("SELECT COUNT(*), MAX(timestamp) FROM app_sg_ohlcv_prices WHERE isin = 'INE917I01010' AND timeframe = '5m'")
    res = cur.fetchone()
    print(f"BAJAJ-AUTO (5m) - Rows: {res[0]}, Latest: {res[1]}")

    conn.close()

if __name__ == "__main__":
    check_db()
