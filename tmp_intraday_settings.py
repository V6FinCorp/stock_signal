import asyncio
import aiomysql
from config import Config

async def check_all_intraday_settings():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM app_sg_indicator_settings WHERE profile_id = 'intraday'")
            rows = await cur.fetchall()
            for r in rows:
                print(f"{r['indicator_key']}: {r['params_json']} (Enabled: {r['is_enabled']})")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_all_intraday_settings())
