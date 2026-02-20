import asyncio
import aiomysql
from config import Config

async def check_columns():
    pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SHOW COLUMNS FROM vw_e_bs_companies_favourite_indices")
            print([row[0] for row in await cur.fetchall()])
    pool.close()
    await pool.wait_closed()

asyncio.run(check_columns())
