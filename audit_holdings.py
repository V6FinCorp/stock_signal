import asyncio
import aiomysql
from config import Config

async def audit_holdings():
    app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    
    async with app_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM tb_app_sf_holdings")
            rows = await cur.fetchall()
            print("--- ALL HOLDINGS ---")
            for r in rows:
                print(r)
    
    app_pool.close()
    await app_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(audit_holdings())
