import asyncio
import aiomysql
import json
from config import Config

async def check_settings():
    try:
        pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                print("Checking indicator settings for 'patterns'...")
                await cur.execute("SELECT * FROM app_sg_indicator_settings WHERE indicator_key = 'patterns'")
                rows = await cur.fetchall()
                if not rows:
                    print("No specialized settings for 'patterns'.")
                for r in rows:
                    print(r)
        pool.close()
        await pool.wait_closed()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_settings())
