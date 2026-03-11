import asyncio
import aiomysql
from config import Config

symbols = ['ACGL', 'ALUFLUOR', 'BIOGEN', 'DHPIND', 'FRONTSP']

async def check_stocks():
    # 1. Check Datamart
    print("--- Checking Datamart ---")
    dm_conf = Config.get_datamart_db_config()
    conn = await aiomysql.connect(**dm_conf)
    async with conn.cursor(aiomysql.DictCursor) as cur:
        format_strings = ','.join(['%s'] * len(symbols))
        query = f"SELECT bs_SYMBOL, bs_ISIN, bs_Status FROM vw_e_bs_companies_all WHERE bs_SYMBOL IN ({format_strings})"
        await cur.execute(query, tuple(symbols))
        rows = await cur.fetchall()
        for s in symbols:
            found = [r for r in rows if r['bs_SYMBOL'] == s]
            if found:
                print(f"Symbol: {s}, ISIN: {found[0]['bs_ISIN']}, Status: {found[0]['bs_Status']}")
            else:
                print(f"Symbol: {s} NOT FOUND in Datamart")
    conn.close()

    # 2. Check Holdings in App DB
    print("\n--- Checking Holdings in App DB ---")
    app_conf = Config.get_app_db_config()
    conn = await aiomysql.connect(**app_conf)
    async with conn.cursor(aiomysql.DictCursor) as cur:
        # Check tb_app_sf_holdings
        try:
            format_strings = ','.join(['%s'] * len(symbols))
            query = f"SELECT symbol, code, isin FROM tb_app_sf_holdings WHERE symbol IN ({format_strings}) OR code IN ({format_strings})"
            await cur.execute(query, tuple(symbols) + tuple(symbols))
            rows = await cur.fetchall()
            for s in symbols:
                found = [r for r in rows if r['symbol'] == s or r['code'] == s]
                if found:
                    print(f"Symbol/Code {s} found in holdings. ISIN: {found[0]['isin']}, Code: {found[0]['code']}")
                else:
                    print(f"Symbol {s} NOT found in holdings")
        except Exception as e:
            print(f"Error checking holdings: {e}")

        # 3. Check Price Data
        print("\n--- Checking Price Data (OHLCV) ---")
        # Since signals depend on data existence, let's see if we have ANY data for these isins
        isins_to_check = [r['isin'] for r in rows if r['isin']]
        if not isins_to_check:
             # Try to get ISINs from the first step if possible
             # For now just print if we have counts for these symbols if we assume ISIN matches
             pass
        
        for s in symbols:
            await cur.execute("SELECT count(*) as cnt FROM app_sg_ohlcv_prices WHERE isin = (SELECT isin FROM tb_app_sf_holdings WHERE symbol = %s LIMIT 1)", (s,))
            res = await cur.fetchone()
            print(f"Price rows for {s}: {res['cnt']}")

    conn.close()

asyncio.run(check_stocks())
