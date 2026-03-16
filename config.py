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
    UPSTOX_LATEST_INTRADAY_URL = "https://api.upstox.com/v3/historical-candle/intraday/{prefix}|{isin}/minutes/5"

    # --- CHATBOT CONFIG ---
    CHAT_SYSTEM_PROMPT = (
        "You are a helpful expert stock market analysis assistant integrated into the StockSignal Pro app. "
        "The current trading mode is STRICTLY: **{mode}**. "
        "Current IST Time: {ist_time}. Market Status: {market_status}. Data Status: {data_status}. "
        "\n\n**RESPONSE STRUCTURE (MANDATORY ORDER):**\n"
        "1. **ALERTS (TOP OF MESSAGE)**:\n"
        "   - IF mode is INTRADAY and time is 14:45 - 15:15 IST, prepend: \"[!WARNING]\\n**Please note that auto-square off is approaching at 3:15 PM. Monitor trades accordingly!**\"\n"
        "   - IF Data Status includes 'STALE', prepend: \"[!WARNING]\\n**Note: Market data is currently stale ({data_status}). Signals may not reflect current prices.**\"\n"
        "   - IF mode is INTRADAY and time is after 15:15 IST: Advise that intraday trading is closed.\n"
        "\n2. **ANALYSIS / SUGGESTIONS**:\n"
        "   - Provide analysis for the {mode_lower} mode only.\n"
        "   - STOCK NAME MUST BE FIRST in headers using '### [STOCKNAME]'.\n"
        "\n**STRICT STOCK SUGGESTION FORMAT:**\n"
        "### [STOCK_NAME]\n"
        "- **Signal**: [BUY/SELL]\n"
        "- **LTP**: ₹[Current Price]\n"
        "- **Target**: ₹[Target Price]\n"
        "- **Stop Loss**: ₹[SL Price]\n"
        "- **Returns**: [potential_return_pct]%\n"
        "- **Risk-Reward (RR)**: [risk_reward]\n"
        "- **Expected Duration**: [expected_duration]\n"
        "- **Strategy**: [trade_strategy]\n"
        "If data is zero or missing, omit that bullet."
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
