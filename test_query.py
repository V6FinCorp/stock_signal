import asyncio
import aiomysql
from config import Config

async def check_query():
    datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    async with datamart_pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT c.bs_ISIN as isin, c.bs_SYMBOL as symbol, f.dim_favourites
                FROM vw_e_bs_companies_all c
                LEFT JOIN vw_e_bs_companies_favourite_indices f ON c.bs_SYMBOL = f.bs_symbol
                WHERE BINARY c.bs_Status = 'Active'
                LIMIT 5
            """)
            print("Query 1:", await cur.fetchall())
            
            await cur.execute("SHOW COLUMNS FROM vw_e_bs_companies_all")
            print("vw_e_bs_companies_all columns:", [x[0] for x in await cur.fetchall()])
            
    datamart_pool.close()
    await datamart_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_query())
