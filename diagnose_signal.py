import asyncio
import httpx
import aiomysql
from datetime import datetime, timedelta
from config import Config
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

async def test_single_fetch_and_synthesis():
    symbol = "DRREDDY"
    isin = "INE089A01031"
    
    # 1. Fetch
    to_date = datetime.now().strftime("%Y-%m-%d")
    from_date_intraday = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")
    url = f"https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/minutes/5/{to_date}/{from_date_intraday}"
    logging.info(f"Testing Fetch for {symbol} URL: {url}")
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        data = response.json()
        if data.get("status") == "success":
            candles = data["data"]["candles"]
            logging.info(f"Fetched {len(candles)} candles.")
            
            pool = await aiomysql.create_pool(**Config.get_app_db_config())
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    rows = []
                    for c in candles:
                        ts = c[0].split('+')[0].replace('T', ' ')
                        rows.append((isin, '5m', ts, c[1], c[2], c[3], c[4], c[5]))
                    await cur.executemany("INSERT INTO app_sg_ohlcv_prices (isin, timeframe, timestamp, open, high, low, close, volume) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE close=VALUES(close)", rows)
                    await conn.commit()
            pool.close()
            await pool.wait_closed()
            logging.info("Saved 5m data.")

    # 2. Calc
    from indicator_engine import process_profile
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    dm_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    logging.info("Calculating ...")
    await process_profile(pool, dm_pool, "swing", "1d")
    pool.close()
    await pool.wait_closed()
    dm_pool.close()
    await dm_pool.wait_closed()
    
    # 3. Verify
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM app_sg_calculated_signals WHERE isin = %s AND timeframe = '1d'", (isin,))
            sig = await cur.fetchone()
            if sig:
                logging.info(f"--- RESULTS FOR {symbol} ---")
                logging.info(f"Price: {sig['ltp']}")
                logging.info(f"RSI: {sig['rsi']}")
                logging.info(f"MTF: {sig['mtf_data']}")
            else:
                logging.error("No signal found.")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(test_single_fetch_and_synthesis())
