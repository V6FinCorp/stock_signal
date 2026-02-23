
import asyncio
import aiomysql
from config import Config

async def check_schema():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SHOW CREATE TABLE app_sg_calculated_signals")
            res = await cur.fetchone()
            print(res[1])
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_schema())
