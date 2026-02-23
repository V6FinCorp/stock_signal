
import asyncio
import aiomysql
from config import Config
from datetime import datetime

async def peek_results():
    symbol = "DRREDDY"
    isin = "INE089A01031"
    
    app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with app_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # 1. Check latest signals
            await cur.execute("SELECT * FROM app_sg_calculated_signals WHERE isin = %s AND timeframe = '1d'", (isin,))
            sig = await cur.fetchone()
            
            print("--- DATABASE CHECK FOR " + symbol + " ---")
            if sig:
                print("LTP: " + str(sig['ltp']))
                print("RSI: " + str(sig['rsi']))
                print("Strategy: " + str(sig['trade_strategy']))
            else:
                print("No signal found in app_sg_calculated_signals.")
            
            # 2. Check internal data for synthesis
            await cur.execute("SELECT MAX(timestamp) as ts FROM app_sg_ohlcv_prices WHERE isin = %s AND timeframe = '1d'", (isin,))
            r_1d = await cur.fetchone()
            print("Latest Official 1D Date: " + str(r_1d['ts']))
            
            await cur.execute("SELECT MAX(timestamp) as ts FROM app_sg_ohlcv_prices WHERE isin = %s AND timeframe = '5m'", (isin,))
            r_5m = await cur.fetchone()
            print("Latest Intraday 5M Date: " + str(r_5m['ts']))

    app_pool.close()
    await app_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(peek_results())
