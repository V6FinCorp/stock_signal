
import mysql.connector
from config import Config

def alter_table():
    db_cfg = Config.get_app_db_config()
    conn = mysql.connector.connect(**db_cfg)
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE app_sg_calculated_signals ADD COLUMN rsi_day_high DECIMAL(10, 4) DEFAULT NULL")
    except Exception as e:
        print(f"Error adding rsi_day_high: {e}")
        
    try:
        cur.execute("ALTER TABLE app_sg_calculated_signals ADD COLUMN rsi_day_low DECIMAL(10, 4) DEFAULT NULL")
    except Exception as e:
        print(f"Error adding rsi_day_low: {e}")
        
    conn.commit()
    conn.close()
    print("Done altering table.")

if __name__ == "__main__":
    alter_table()
