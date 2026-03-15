import aiomysql
import asyncio
import json
from config import Config

async def run():
    try:
        pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DESCRIBE e_bs_indices_nse")
                rows = await cur.fetchall()
                for row in rows:
                    print(row)
        pool.close()
        await pool.wait_closed()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(run())
