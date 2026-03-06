import asyncio
import aiomysql
from config import Config

async def check_rsi():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT timeframe, COUNT(*), COUNT(rsi) 
                FROM app_sg_calculated_signals 
                WHERE profile_id = 'intraday' 
                GROUP BY timeframe
            """)
            rows = await cur.fetchall()
            print("Timeframe | Total Signals | RSI Present")
            print("----------|---------------|------------")
            for r in rows:
                print(f"{r[0]:10} | {r[1]:13} | {r[2]:11}")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_rsi())
