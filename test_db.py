import asyncio
import aiomysql
from config import Config

async def q():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT timeframe, COUNT(*) FROM app_sg_calculated_signals GROUP BY timeframe")
            print(await cur.fetchall())
    pool.close()
    await pool.wait_closed()

asyncio.run(q())
