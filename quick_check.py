
import asyncio
import aiomysql
from config import Config

async def check():
    p = await aiomysql.create_pool(**Config.get_app_db_config())
    async with p.acquire() as c:
        async with c.cursor() as cur:
            # 1. Global max for 1d
            await cur.execute("SELECT MAX(timestamp) FROM app_sg_ohlcv_prices WHERE timeframe='1d'")
            max_1d = await cur.fetchone()
            print("Global Max 1D: " + str(max_1d))
            
            # 2. Global max for 5m
            await cur.execute("SELECT MAX(timestamp) FROM app_sg_ohlcv_prices WHERE timeframe='5m'")
            max_5m = await cur.fetchone()
            print("Global Max 5M: " + str(max_5m))
            
            # 3. Check DRREDDY specifically (Favourite)
            await cur.execute("SELECT timestamp, close FROM app_sg_ohlcv_prices WHERE isin='INE089A01031' AND timeframe='1d' ORDER BY timestamp DESC LIMIT 1")
            res_1d = await cur.fetchone()
            print("DRREDDY Latest 1D: " + str(res_1d))
            
            await cur.execute("SELECT ltp FROM app_sg_calculated_signals WHERE isin='INE089A01031' AND timeframe='1d'")
            res_sig = await cur.fetchone()
            print("DRREDDY Signal LTP: " + str(res_sig))

    p.close()
    await p.wait_closed()

if __name__ == "__main__":
    asyncio.run(check())
