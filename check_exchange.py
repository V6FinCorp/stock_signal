import asyncio
import aiomysql
from config import Config

symbols = ['ACGL', 'ALUFLUOR', 'BIOGEN', 'DHPIND', 'FRONTSP']

async def check_exchange():
    dm_conf = Config.get_datamart_db_config()
    conn = await aiomysql.connect(**dm_conf)
    async with conn.cursor(aiomysql.DictCursor) as cur:
        format_strings = ','.join(['%s'] * len(symbols))
        query = f"SELECT bs_SYMBOL, bs_Available_ON FROM vw_e_bs_companies_all WHERE bs_SYMBOL IN ({format_strings})"
        await cur.execute(query, tuple(symbols))
        rows = await cur.fetchall()
        for r in rows:
            print(f"{r['bs_SYMBOL']}: {r['bs_Available_ON']}")
    conn.close()

asyncio.run(check_exchange())
