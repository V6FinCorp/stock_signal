
import asyncio
import aiomysql
from config import Config

async def check_view():
    try:
        pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT bs_symbol as symbol FROM vw_e_bs_companies_favourite_indices LIMIT 20")
                rows = await cur.fetchall()
                print("--- Favourite Symbols Sample ---")
                for r in rows:
                    print(r['symbol'])
                
                await cur.execute("SELECT count(*) as count FROM vw_e_bs_companies_favourite_indices")
                count = await cur.fetchone()
                print(f"\nTotal Favorites: {count['count']}")

        pool.close()
        await pool.wait_closed()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_view())
