import asyncio
import aiomysql
from config import Config

async def check():
    p = await aiomysql.create_pool(**Config.get_datamart_db_config())
    async with p.acquire() as c:
        async with c.cursor() as cur:
            await cur.execute('SELECT bs_symbol, dim_favourites FROM vw_e_bs_companies_favourite_indices')
            rows = await cur.fetchall()
            d1 = set(r[0] for r in rows if r[1]==1)
            d2 = set(r[0] for r in rows if r[1]==2)
            print(f'd1 length (Nifty 50 expected): {len(d1)}')
            print(f'd2 length (Nifty 200 expected): {len(d2)}')
            print(f'intersection: {len(d1.intersection(d2))}')
    p.close()
    await p.wait_closed()

if __name__ == "__main__":
    asyncio.run(check())
