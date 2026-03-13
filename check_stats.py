import asyncio
import aiomysql
from config import Config

async def check_stats():
    app_conf = Config.get_app_db_config()
    conn = await aiomysql.connect(**app_conf)
    async with conn.cursor(aiomysql.DictCursor) as cur:
        await cur.execute("SELECT timeframe, COUNT(*) as count, AVG(rsi) as avg_rsi, SUM(CASE WHEN confluence_rank > 0 THEN 1 ELSE 0 END) as bullish_count FROM app_sg_calculated_signals WHERE profile_id = 'intraday' GROUP BY timeframe")
        rows = await cur.fetchall()
        for r in rows:
            print(f"Timeframe: {r['timeframe']}, Count: {r['count']}, Avg RSI: {r['avg_rsi']}, Bullish Count: {r['bullish_count']}")
    conn.close()

asyncio.run(check_stats())
