import asyncio
import aiomysql
from config import Config

async def check():
    app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with app_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT timeframe, MAX(timestamp) as latest FROM app_sg_ohlcv_prices GROUP BY timeframe")
            rows = await cur.fetchall()
            print("Latest OHLC per timeframe:")
            for r in rows:
                print(f"  {r['timeframe']}: {r['latest']}")
            
            await cur.execute("SELECT mode, last_fetch_run, last_calc_run FROM app_sg_system_status")
            rows = await cur.fetchall()
            print("\nSystem Status:")
            for r in rows:
                print(f"  {r['mode']}: Fetch={r['last_fetch_run']}, Calc={r['last_calc_run']}")

    app_pool.close()
    await app_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check())
