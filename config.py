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
