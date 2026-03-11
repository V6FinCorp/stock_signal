import asyncio
import aiomysql
from config import Config

async def check_values():
    dm_conf = Config.get_datamart_db_config()
    conn = await aiomysql.connect(**dm_conf)
    async with conn.cursor() as cur:
        await cur.execute("SELECT DISTINCT bs_Available_ON FROM vw_e_bs_companies_all")
        rows = await cur.fetchall()
        print([r[0] for r in rows])
    conn.close()

asyncio.run(check_values())
