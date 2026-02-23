
import asyncio
import aiomysql
from config import Config
import json

async def check_settings():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM app_sg_indicator_settings")
            rows = await cur.fetchall()
            print("--- Indicator Settings in DB ---")
            for row in rows:
                print(f"Profile: {row['profile_id']} | Key: {row['indicator_key']} | Params: {row['params_json']}")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_settings())
