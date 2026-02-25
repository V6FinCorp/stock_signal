import asyncio
import aiomysql
from config import Config

async def check_db_counts():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT profile_id, timeframe, COUNT(*) FROM app_sg_calculated_signals GROUP BY profile_id, timeframe")
            print("Calculated Signals:", await cur.fetchall())
            
            await cur.execute("SELECT timeframe, COUNT(DISTINCT isin) FROM app_sg_ohlcv_prices GROUP BY timeframe")
            print("OHLCV prices distinct ISIN:", await cur.fetchall())
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_db_counts())
