import asyncio
import aiomysql
from config import Config

async def check():
    datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    async with datamart_pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT c.bs_ISIN as isin, c.bs_SYMBOL as symbol, f.dim_favourites
                FROM vw_e_bs_companies_all c
                LEFT JOIN vw_e_bs_companies_favourite_indices f ON c.bs_SYMBOL = f.bs_symbol
                WHERE BINARY c.bs_Status = 'Active'
            """)
            active_companies = await cur.fetchall()
            
            c_all = len(active_companies)
            
            intraday_symbols = {c[1] for c in active_companies if c[2] == 1}
            swing_symbols = {c[1] for c in active_companies if c[2] == 2}
            print(f"Total active: {c_all}")
            print(f"Intraday (dim=1) count: {len(intraday_symbols)}")
            print(f"Swing (dim=2) count: {len(swing_symbols)}")
            
            print("First 5 active with dim_favourites:", active_companies[:5])
            
            # Look for Nifty 50 and Nifty 200 explicitly
            print("Intraday Symbols:", list(intraday_symbols)[:10])
            print("Swing Symbols:", list(swing_symbols)[:10])

    datamart_pool.close()
    await datamart_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check())
