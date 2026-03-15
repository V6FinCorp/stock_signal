import os
from dotenv import load_dotenv

# Load environment variables from the .env file
load_dotenv()

class Config:
    # --- APP LAYER DB ---
    APP_DB_HOST = os.getenv("APP_DB_HOST", "localhost")
    APP_DB_USER = os.getenv("APP_DB_USER", "root")
    APP_DB_PASSWORD = os.getenv("APP_DB_PASSWORD", "")
    APP_DB_NAME = os.getenv("APP_DB_NAME", "stock_signal_pro")
    APP_DB_PORT = int(os.getenv("APP_DB_PORT", 3306))

    # --- DATAMART DB ---
    DATAMART_DB_HOST = os.getenv("DATAMART_DB_HOST", "localhost")
    DATAMART_DB_USER = os.getenv("DATAMART_DB_USER", "root")
    DATAMART_DB_PASSWORD = os.getenv("DATAMART_DB_PASSWORD", "")
    DATAMART_DB_NAME = os.getenv("DATAMART_DB_NAME", "stock_datamart")
    DATAMART_DB_PORT = int(os.getenv("DATAMART_DB_PORT", 3306))

    # --- API ENDPOINTS ---
    UPSTOX_HISTORICAL_URL = "https://api.upstox.com/v3/historical-candle/{prefix}|{isin}/days/1/{to_date}/{from_date}"
    UPSTOX_INTRADAY_URL = "https://api.upstox.com/v3/historical-candle/{prefix}|{isin}/minutes/5/{to_date}/{from_date}"

    # --- CHATBOT CONFIG ---
    CHAT_SYSTEM_PROMPT = (
        "You are a helpful expert stock market analysis assistant integrated into the StockSignal Pro app. "
        "The current trading mode is **{mode}**. Your answers should focus on {mode_lower} trade assumptions and data. "
        "Provide concise, clear answers based on the actual technical signals retrieved via tools. "
        "If the user asks about a stock, use 'get_stock_status'. For general market, use 'get_market_sentiment'."
    )

    @classmethod
    def get_app_db_config(cls):
        """Returns standard connection dictionary for App DB using aiomysql/pymysql"""
        return {
            "host": cls.APP_DB_HOST,
            "user": cls.APP_DB_USER,
            "password": cls.APP_DB_PASSWORD,
            "db": cls.APP_DB_NAME,
            "port": cls.APP_DB_PORT,
            "autocommit": True
        }

    @classmethod
    def get_datamart_db_config(cls):
        """Returns standard connection dictionary for Datamart DB using aiomysql/pymysql"""
        return {
            "host": cls.DATAMART_DB_HOST,
            "user": cls.DATAMART_DB_USER,
            "password": cls.DATAMART_DB_PASSWORD,
            "db": cls.DATAMART_DB_NAME,
            "port": cls.DATAMART_DB_PORT,
            "autocommit": True
        }
