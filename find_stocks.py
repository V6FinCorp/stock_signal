import asyncio
import aiomysql
from config import Config

async def find_stocks():
    app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    
    async with app_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # Check for DHPIND, NARMP, CUPID in holdings
            stocks = ('DHPIND', 'NARMP', 'CUPID')
            for s in stocks:
                print(f"\nSearching for {s}:")
                await cur.execute("SELECT * FROM tb_app_sf_holdings WHERE symbol LIKE %s OR code LIKE %s", (f"%{s}%", f"%{s}%"))
                rows = await cur.fetchall()
                if rows:
                    for r in rows:
                        print(f"  Found: {r['symbol']} ({r['isin']})")
                else:
                    print("  NOT FOUND")
    
    app_pool.close()
    await app_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(find_stocks())
