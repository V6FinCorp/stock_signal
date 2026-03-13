import asyncio
import aiomysql
from config import Config

async def check():
    app_conf = Config.get_app_db_config()
    conn = await aiomysql.connect(**app_conf)
    async with conn.cursor() as cur:
        await cur.execute("SELECT COUNT(*) FROM app_sg_calculated_signals WHERE profile_id='intraday' AND timeframe='15m' AND rsi < 50 AND confluence_rank <= 0")
        count = await cur.fetchone()
        print(f"Stocks with RSI < 50 and Rank <= 0: {count[0]}")
    conn.close()

asyncio.run(check())
