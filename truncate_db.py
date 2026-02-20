import asyncio
import aiomysql
from config import Config

async def truncate_table():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("TRUNCATE TABLE app_sg_calculated_signals")
            print("Successfully truncated app_sg_calculated_signals.")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(truncate_table())
