import asyncio
import aiomysql
from config import Config

async def check_stats():
    app_conf = Config.get_app_db_config()
    conn = await aiomysql.connect(**app_conf)
    async with conn.cursor(aiomysql.DictCursor) as cur:
        await cur.execute("SELECT isin, rsi, confluence_rank FROM app_sg_calculated_signals WHERE profile_id = 'intraday' AND timeframe = '15m' AND confluence_rank > 0")
        rows = await cur.fetchall()
        print("Bullish stocks on 15m:")
        for r in rows:
            print(f"ISIN: {r['isin']}, RSI: {r['rsi']}, Rank: {r['confluence_rank']}")
    conn.close()

asyncio.run(check_stats())
