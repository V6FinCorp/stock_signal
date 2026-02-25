import asyncio
import aiomysql
from config import Config

async def check():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    
    for target_dim, profile in [(1, 'intraday'), (2, 'swing')]:
        async with datamart_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT bs_symbol FROM vw_e_bs_companies_favourite_indices WHERE dim_favourites = %s",
                    (target_dim,)
                )
                rows = await cur.fetchall()
                favourite_symbols = {row[0] for row in rows}
        print(f"Profile: {profile}, Target Dim: {target_dim}, Favourite Symbols len: {len(favourite_symbols)}")
        
        base_timeframe = '5m' if profile == 'intraday' else '1d'
        
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT DISTINCT isin FROM app_sg_ohlcv_prices WHERE timeframe = %s", (base_timeframe,))
                available_isins = {row['isin'] for row in await cur.fetchall()}
                print(f"Available ISINs for {base_timeframe}: {len(available_isins)}")
                
                isin_to_symbol = {}
                if available_isins:
                    async with datamart_pool.acquire() as dm_conn:
                        async with dm_conn.cursor(aiomysql.DictCursor) as dm_cur:
                            format_strings = ','.join(['%s'] * len(available_isins))
                            await dm_cur.execute(f"SELECT bs_ISIN, bs_SYMBOL FROM vw_e_bs_companies_all WHERE bs_ISIN IN ({format_strings})", tuple(available_isins))
                            for row in await dm_cur.fetchall():
                                isin_to_symbol[row['bs_ISIN']] = row['bs_SYMBOL']
                
                isins = [isin for isin in available_isins if isin_to_symbol.get(isin) in favourite_symbols]
                print(f"Intersected ISINs: {len(isins)}")
                
    pool.close()
    datamart_pool.close()
    await pool.wait_closed()
    await datamart_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check())
