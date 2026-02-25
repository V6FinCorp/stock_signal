import asyncio
import aiomysql
from config import Config

async def wipe_and_calc():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("TRUNCATE TABLE app_sg_calculated_signals")
        await conn.commit()
    pool.close()
    await pool.wait_closed()
    print("Database signals truncated. Call indicator engine to recalculate.")

if __name__ == "__main__":
    asyncio.run(wipe_and_calc())
