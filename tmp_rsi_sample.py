import asyncio
import httpx

async def check_api_signals():
    async with httpx.AsyncClient() as client:
        # Note: assuming local or using absolute URL if needed, but here I'll check the DB directly
        pass

import aiomysql
from config import Config

async def check_db_signals():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            for tf in ['5m', '15m', '30m', '60m']:
                await cur.execute("SELECT rsi FROM app_sg_calculated_signals WHERE profile_id = 'intraday' AND timeframe = %s LIMIT 5", (tf,))
                rows = await cur.fetchall()
                print(f"Timeframe {tf} sample RSI: {[r['rsi'] for r in rows]}")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_db_signals())
