import asyncio
import aiomysql
from config import Config

async def check_rsi_values():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT symbol, timeframe, rsi FROM app_sg_calculated_signals WHERE profile_id = 'intraday' LIMIT 20")
            rows = await cur.fetchall()
            for r in rows:
                print(f"{r['symbol']} ({r['timeframe']}): {r['rsi']}")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_rsi_values())
