import asyncio
import aiomysql
from config import Config

async def check_columns():
    dm_conf = Config.get_datamart_db_config()
    conn = await aiomysql.connect(**dm_conf)
    async with conn.cursor() as cur:
        await cur.execute("DESCRIBE vw_e_bs_companies_all")
        rows = await cur.fetchall()
        for r in rows:
            print(r)
    conn.close()

asyncio.run(check_columns())
