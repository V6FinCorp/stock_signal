import asyncio
import aiomysql
from config import Config

async def check_signal_timestamps():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("""
                SELECT timeframe, MAX(timestamp) as latest_sig 
                FROM app_sg_calculated_signals 
                WHERE profile_id = 'intraday' 
                GROUP BY timeframe
            """)
            rows = await cur.fetchall()
            print("Timeframe | Latest Signal Timestamp")
            for r in rows:
                print(f"{r['timeframe']:9} | {r['latest_sig']}")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_signal_timestamps())
