import asyncio
import aiomysql
from config import Config

async def check_null_rsi():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("""
                SELECT timeframe, COUNT(*) as total, SUM(CASE WHEN rsi IS NULL THEN 1 ELSE 0 END) as null_rsi
                FROM app_sg_calculated_signals 
                WHERE profile_id = 'intraday'
                GROUP BY timeframe
            """)
            rows = await cur.fetchall()
            print("Timeframe | Total | Null RSI")
            for r in rows:
                print(f"{r['timeframe']:9} | {r['total']:5} | {r['null_rsi']}")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_null_rsi())
