
import asyncio
import aiomysql
from config import Config
import pandas as pd
from datetime import datetime

async def verify_swing_data():
    print("--- Verifying Swing Data Accuracy ---")
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # Get ISINs and counts from app db
                await cur.execute("SELECT isin, timeframe, MAX(timestamp) as latest_timestamp, COUNT(*) as candle_count, MIN(timestamp) as oldest_timestamp FROM app_sg_ohlcv_prices WHERE timeframe = '1d' GROUP BY isin ORDER BY latest_timestamp DESC LIMIT 10")
                app_data = await cur.fetchall()
                
                if not app_data:
                    print("No swing data (1d) found in the app database.")
                else:
                    # Get symbols from datamart
                    isins = [row['isin'] for row in app_data]
                    format_strings = ','.join(['%s'] * len(isins))
                    async with datamart_pool.acquire() as dm_conn:
                        async with dm_conn.cursor(aiomysql.DictCursor) as dm_cur:
                            await dm_cur.execute(f"SELECT bs_ISIN as isin, bs_SYMBOL as symbol FROM vw_e_bs_companies_all WHERE bs_ISIN IN ({format_strings})", tuple(isins))
                            symbols = {row['isin']: row['symbol'] for row in await dm_cur.fetchall()}
                    
                    print("\nLatest 10 Stocks with 1d Data:")
                    for row in app_data:
                        sym = symbols.get(row['isin'], row['isin'])
                        print(f"Symbol: {sym:10} | Last: {row['latest_timestamp']} | Count: {row['candle_count']:4} | Oldest: {row['oldest_timestamp']}")

        app_pool.close()
        datamart_pool.close()
        await app_pool.wait_closed()
        await datamart_pool.wait_closed()
    except Exception as e:
        print(f"Error during verification: {e}")

if __name__ == "__main__":
    asyncio.run(verify_swing_data())
