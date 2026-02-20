import asyncio
import httpx
import aiomysql
from datetime import datetime, timedelta
from config import Config
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Endpoints as discovered & outlined in IMPLEMENTATION_PLAN.md
URL_DAILY = "https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/days/1/{to_date}/{from_date}"
URL_INTRADAY = "https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/minutes/5/{to_date}/{from_date_intraday}"

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

async def process_company(app_pool, client, isin, symbol, fetch_intraday=False):
    logging.info(f"Processing {symbol} ({isin}) - Intraday: {fetch_intraday}")
    
    # We need historical data from Jan 2022
    to_date = datetime.now().strftime("%Y-%m-%d")
    from_date = "2022-01-01"
    
    # For Intraday, fetch the last 30 days (safely under Upstox limit of ~32 days max)
    from_date_intraday = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    
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
    logging.info("Starting History Harvester (Multi-DB Architecture)...")
    
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
                
            # Filter the active companies to ONLY be the 50 favourites for this testing phase
            active_companies = [c for c in active_companies if c['symbol'] in intraday_symbols]
            
    if not active_companies:
        logging.warning("No active companies found in Datamart DB.")
        return

    logging.info(f"Loaded {len(active_companies)} active companies. {len(intraday_symbols)} marked for Intraday limits.")
    
    # 3. Process concurrently
    sem = asyncio.Semaphore(5)
    
    async def sem_process(client, isin, symbol, fetch_intraday):
        async with sem:
            await process_company(app_pool, client, isin, symbol, fetch_intraday)
            
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    async with httpx.AsyncClient(headers=headers) as client:
        # Loop through all active companies. If symbol is in the intraday_symbols set, pass True to fetch_intraday
        tasks = [
            sem_process(
                client, 
                comp["isin"], 
                comp["symbol"], 
                fetch_intraday=(comp["symbol"] in intraday_symbols)
            ) 
            for comp in active_companies
        ]
        await asyncio.gather(*tasks)

    app_pool.close()
    datamart_pool.close()
    await app_pool.wait_closed()
    await datamart_pool.wait_closed()
    logging.info("History Harvester run complete.")

if __name__ == "__main__":
    asyncio.run(main())
