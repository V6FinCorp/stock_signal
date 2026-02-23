
import asyncio
import aiomysql
from config import Config

async def check_signals():
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # Get DrREDDY ISIN
                async with datamart_pool.acquire() as dm_conn:
                    async with dm_conn.cursor(aiomysql.DictCursor) as dm_cur:
                        await dm_cur.execute("SELECT bs_ISIN FROM vw_e_bs_companies_all WHERE bs_SYMBOL = 'DRREDDY'")
                        row = await dm_cur.fetchone()
                        isin = row['bs_ISIN'] if row else None
                
                if isin:
                    await cur.execute("SELECT * FROM app_sg_calculated_signals WHERE isin = %s", (isin,))
                    sig = await cur.fetchone()
                    print(f"--- Signal for DRREDDY ({isin}) ---")
                    if sig:
                        print(f"RSI: {sig['rsi']}")
                        print(f"Last Price: {sig['ltp']}")
                    else:
                        print("No signal found in DB.")
                else:
                    print("Could not find ISIN for DRREDDY")

        app_pool.close()
        datamart_pool.close()
        await app_pool.wait_closed()
        await datamart_pool.wait_closed()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_signals())
