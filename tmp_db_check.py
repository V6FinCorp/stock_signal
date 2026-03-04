import asyncio
import aiomysql
from config import Config

async def check_ohlcv():
    try:
        pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DESCRIBE app_sg_ohlcv_prices")
                schema = await cur.fetchall()
                for field in schema:
                    print(field)
        pool.close()
        await pool.wait_closed()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_ohlcv())
