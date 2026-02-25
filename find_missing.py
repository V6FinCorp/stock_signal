import asyncio
import aiomysql
from config import Config

async def find_missing():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    datamart = await aiomysql.create_pool(**Config.get_datamart_db_config())
    
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT isin FROM app_sg_calculated_signals WHERE profile_id='swing' and timeframe='1d'")
            isin_1d = {row[0] for row in await cur.fetchall()}
            
            await cur.execute("SELECT isin FROM app_sg_calculated_signals WHERE profile_id='swing' and timeframe='1mo'")
            isin_1mo = {row[0] for row in await cur.fetchall()}
            
    missing_isins = isin_1d - isin_1mo
    
    # Get symbols
    symbols = []
    if missing_isins:
        async with datamart.acquire() as conn:
            async with conn.cursor() as cur:
                placeholders = ','.join(['%s']*len(missing_isins))
                query = f"SELECT bs_SYMBOL FROM vw_e_bs_companies_all WHERE bs_ISIN IN ({placeholders})"
                await cur.execute(query, tuple(missing_isins))
                symbols = [row[0] for row in await cur.fetchall()]
                
    print(f"Missing ISINs count: {len(missing_isins)}")
    print(f"Missing Symbols: {symbols}")
    
    pool.close()
    datamart.close()
    await pool.wait_closed()
    await datamart.wait_closed()

if __name__ == "__main__":
    asyncio.run(find_missing())
