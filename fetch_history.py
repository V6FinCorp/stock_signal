import asyncio
import httpx
import aiomysql
from datetime import datetime, timedelta
import argparse
from config import Config
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Endpoints as discovered & outlined in IMPLEMENTATION_PLAN.md
URL_DAILY = "https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/days/1/{to_date}/{from_date}"
URL_INTRADAY = "https://api.upstox.com/v3/historical-candle/intraday/NSE_EQ|{isin}/minutes/5"

async def fetch_data(client, url):
    """Fetch JSON data from Upstox endpoint natively."""
    try:
        # User explicitly noted these work without authentication
        response = await client.get(url, timeout=15.0)
        response.raise_for_status()
        data = response.json()
        if data.get("status") == "success" and "data" in data:
            return data["data"]["candles"]
    except Exception as e:
        pass # Silently fail for stocks that might be BSE only, as NSE_EQ request will fail
    return []

async def cleanup_old_data(app_pool):
    logging.info("Running Garbage Collection: Cleaning up old historical data to conserve database space...")
    try:
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Keep roughly 3 years of 1d data (~1095 days)
                cutoff_1d = (datetime.now() - timedelta(days=1095)).strftime("%Y-%m-%d")
                await cur.execute("DELETE FROM app_sg_ohlcv_prices WHERE timeframe = '1d' AND timestamp < %s", (cutoff_1d,))
                deleted_1d = cur.rowcount
                
                # Keep roughly 35 days of 5m data
                cutoff_5m = (datetime.now() - timedelta(days=35)).strftime("%Y-%m-%d")
                await cur.execute("DELETE FROM app_sg_ohlcv_prices WHERE timeframe = '5m' AND timestamp < %s", (cutoff_5m,))
                deleted_5m = cur.rowcount
                
                logging.info(f"Cleanup Complete: Automatically purged {deleted_1d} old daily rows, {deleted_5m} old intraday rows.")
    except Exception as e:
        logging.error(f"Cleanup failed: {e}")

async def process_company(app_pool, client, isin, symbol, fetch_swing=True, fetch_intraday=False, current_idx=1, total_stocks=1):
    logging.info(f"Currently processing {current_idx}/{total_stocks}: {symbol}")
    
    to_date = datetime.now().strftime("%Y-%m-%d")
    from_date = "2022-01-01"
    
    # 30-day strict cap max for Upstox intraday API
    from_date_intraday = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

    # Dynamic Delta Fetch Logic - only download what we are missing
    try:
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                # 1. Delta fetch for Swing (Daily)
                if fetch_swing:
                    await cur.execute("SELECT MAX(timestamp) FROM app_sg_ohlcv_prices WHERE isin = %s AND timeframe = '1d'", (isin,))
                    latest_1d = await cur.fetchone()
                    if latest_1d and latest_1d[0]:
                        from_date = latest_1d[0].strftime("%Y-%m-%d")
                        logging.info(f"Last available date (1d): {from_date}. Fetching missing data from {from_date} to {to_date}...")
                    else:
                        logging.info(f"No previous data found. Fetching full history from {from_date} to {to_date}...")
                
                # 2. Delta fetch for Intraday (5m)
                if fetch_intraday:
                    await cur.execute("SELECT MAX(timestamp) FROM app_sg_ohlcv_prices WHERE isin = %s AND timeframe = '5m'", (isin,))
                    latest_5m = await cur.fetchone()
                    if latest_5m and latest_5m[0]:
                        db_latest_5m = latest_5m[0].strftime("%Y-%m-%d")
                        # We must fetch the max (most recent) between the Database's latest date and the 30-day Upstox limit
                        from_date_intraday = max(from_date_intraday, db_latest_5m)
                        logging.info(f"Last available date (5m): {db_latest_5m}. Fetching missing data from {from_date_intraday} to {to_date}...")
                    else:
                        logging.info(f"No previous data found (5m). Fetching full history from {from_date_intraday} to {to_date}...")
    except Exception as e:
         logging.warning(f"Delta fetch check failed for {symbol}: {e}")

    daily_candles = []
    if fetch_swing:
        daily_url = URL_DAILY.format(isin=isin, to_date=to_date, from_date=from_date)
        # Upstox candle format: [timestamp, open, high, low, close, volume, open_interest]
        daily_candles = await fetch_data(client, daily_url)
    
    intraday_candles = []
    if fetch_intraday:
        intraday_url = URL_INTRADAY.format(isin=isin, to_date=to_date, from_date_intraday=from_date_intraday)
        intraday_candles = await fetch_data(client, intraday_url)
    
    # Write OHLCV data to APP DATABASE
    async with app_pool.acquire() as conn:
        async with conn.cursor() as cur:
            insert_query = """
                INSERT INTO app_sg_ohlcv_prices (isin, timeframe, timestamp, open, high, low, close, volume)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    open=VALUES(open), high=VALUES(high), low=VALUES(low), 
                    close=VALUES(close), volume=VALUES(volume)
            """
            
            # --- Insert Daily Data ---
            daily_rows = []
            for c in daily_candles:
                try:
                    # Clean the ISO timestamp and convert to MySQL DATETIME
                    ts_clean = c[0].split('+')[0].replace('T', ' ')
                    daily_rows.append((isin, '1d', ts_clean, c[1], c[2], c[3], c[4], c[5]))
                except Exception as e:
                    logging.warning(f"Failed parsing daily candle for {symbol}: {e}")
                    
            if daily_rows:
                await cur.executemany(insert_query, daily_rows)

            # --- Insert Intraday Data ---
            intraday_rows = []
            for c in intraday_candles:
                try:
                    ts_clean = c[0].split('+')[0].replace('T', ' ')
                    intraday_rows.append((isin, '5m', ts_clean, c[1], c[2], c[3], c[4], c[5]))
                except Exception as e:
                    logging.warning(f"Failed parsing 5m candle for {symbol}: {e}")
                    
            if intraday_rows:
                await cur.executemany(insert_query, intraday_rows)
                
    if daily_rows or intraday_rows:
         logging.info(f"✅ [{symbol}] Data saved (Daily: {len(daily_rows)}, Intraday: {len(intraday_rows)})")
         
    # Be polite to Upstox API to avoid 429 Too Many Requests
    await asyncio.sleep(0.2)

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", type=str, choices=["swing", "intraday", "all"], default="all")
    args = parser.parse_args()
    mode = args.mode

    logging.info(f"Starting History Harvester in {mode.upper()} mode...")
    
    # 1. Initialize Datamart and App Database pools
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    except Exception as e:
        logging.error(f"Failed to connect to databases. Please check your .env credentials: {e}")
        return

    # 2. Fetch companies from DATAMART DB
    async with datamart_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            
            # Fetch all Active companies
            try:
                await cur.execute("""
                    SELECT bs_ISIN as isin, bs_SYMBOL as symbol 
                    FROM vw_e_bs_companies_all 
                    WHERE BINARY bs_Status = 'Active'
                """)
                active_companies = await cur.fetchall()
            except Exception as e:
                logging.error(f"Failed to read 'vw_e_bs_companies_all' from Datamart DB: {e}")
                return
            
            # Fetch Favourite Intraday Companies (to flag which ones get 5m data)
            try:
                await cur.execute("""
                    SELECT bs_symbol as symbol 
                    FROM vw_e_bs_companies_favourite_indices
                """)
                favourite_rows = await cur.fetchall()
                intraday_symbols = {row['symbol'] for row in favourite_rows}
            except Exception as e:
                logging.warning(f"Failed to read 'vw_e_bs_companies_favourite_indices': {e}. Continuing without intraday flags.")
                intraday_symbols = set()
                
            # Filter the active companies based on mode
            if mode == "intraday":
                active_companies = [c for c in active_companies if c['symbol'] in intraday_symbols]
            elif mode == "swing":
                # Only process up to 5000 stocks, no intraday filter needed for swing
                pass
            else:
                # "all" mode: fetch everything (can be heavy, originally limited to intraday)
                active_companies = [c for c in active_companies if c['symbol'] in intraday_symbols]
            
    if not active_companies:
        logging.warning("No active companies found in Datamart DB.")
        return

    logging.info(f"Planned: Fetching {len(active_companies)} {mode.capitalize()} Stocks")
    
    # 3. Process concurrently
    sem = asyncio.Semaphore(5)
    
    async def sem_process(client, isin, symbol, fetch_swing, fetch_intraday, current_idx, total_stocks):
        async with sem:
            await process_company(app_pool, client, isin, symbol, fetch_swing, fetch_intraday, current_idx, total_stocks)
            
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    async with httpx.AsyncClient(headers=headers) as client:
        # Loop through all active companies.
        tasks = []
        total_len = len(active_companies)
        for idx, comp in enumerate(active_companies, 1):
            fetch_swing = (mode in ["swing", "all"])
            fetch_intraday = False
            if mode in ["intraday", "all"]:
                 fetch_intraday = comp["symbol"] in intraday_symbols

            tasks.append(
                sem_process(
                    client, 
                    comp["isin"], 
                    comp["symbol"], 
                    fetch_swing=fetch_swing,
                    fetch_intraday=fetch_intraday,
                    current_idx=idx,
                    total_stocks=total_len
                ) 
            )
        await asyncio.gather(*tasks)

    # Execute historical garbage collection
    await cleanup_old_data(app_pool)

    app_pool.close()
    datamart_pool.close()
    await app_pool.wait_closed()
    await datamart_pool.wait_closed()
    logging.info("History Harvester run complete.")

if __name__ == "__main__":
    asyncio.run(main())
