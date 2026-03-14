import asyncio
import aiomysql
from config import Config

async def check():
    pool = await aiomysql.create_pool(
        host=Config.DATAMART_DB_HOST, port=Config.DATAMART_DB_PORT,
        user=Config.DATAMART_DB_USER, password=Config.DATAMART_DB_PASSWORD, db=Config.DATAMART_DB_NAME
    )
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("DESCRIBE e_bs_indices_nse")
            print("SCHEMA:")
            for row in await cur.fetchall():
                print(row)
            print("\nROW:")
            await cur.execute("SELECT * FROM e_bs_indices_nse where bs_key in ('INDICES ELIGIBLE IN DERIVATIVES','SECTORAL INDICES') limit 5")
            for row in await cur.fetchall():
                print(row)
    pool.close()
    await pool.wait_closed()

asyncio.run(check())
