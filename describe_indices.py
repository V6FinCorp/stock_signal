import asyncio
import aiomysql
from config import Config

async def describe():
    conf = Config.get_datamart_db_config()
    conn = await aiomysql.connect(
        host=conf['host'],
        user=conf['user'],
        password=conf['password'],
        db=conf['db'],
        port=conf['port']
    )
    async with conn.cursor() as cur:
        await cur.execute("DESCRIBE e_bs_indices_nse")
        rows = await cur.fetchall()
        for r in rows:
            print(r)
    conn.close()

if __name__ == "__main__":
    asyncio.run(describe())
