import asyncio
import aiomysql
from config import Config

async def check_history_rsi():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT timeframe, COUNT(*), COUNT(rsi) FROM app_sg_signal_history GROUP BY timeframe")
            rows = await cur.fetchall()
            print("Timeframe | Count | RSI Present")
            for r in rows:
                print(f"{r['timeframe']:9} | {r['COUNT(*)']:5} | {r['COUNT(rsi)']}")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_history_rsi())
