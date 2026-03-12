
import asyncio
import aiomysql
import json
from config import Config

async def debug_signals():
    conf = Config.get_app_db_config()
    conn = await aiomysql.connect(
        host=conf['host'],
        user=conf['user'],
        password=conf['password'],
        db=conf['db'],
        port=conf['port']
    )
    async with conn.cursor(aiomysql.DictCursor) as cur:
        # Check Daily signals for volume and trend
        print("\n--- [Daily] Signal Sample (Top 5) ---")
        await cur.execute("SELECT symbol, supertrend_dir, volume_signal FROM app_sg_calculated_signals WHERE timeframe = '1d' LIMIT 5")
        rows = await cur.fetchall()
        for r in rows:
            print(f"Stock: {r['symbol']}, Trend: {r['supertrend_dir']}, Volume: {r['volume_signal']}")

        # Check for any Bullish Trend matches
        print("\n--- Search for Bullish matches in [Daily] Trend ---")
        # Check for BUY, BULLISH, 1, BULL
        await cur.execute("SELECT COUNT(*) as cnt FROM app_sg_calculated_signals WHERE timeframe = '1d' AND supertrend_dir IN ('BUY', 'BULLISH', '1', 'BULL')")
        result = await cur.fetchone()
        print(f"Matches for 'Bullish' Trend: {result['cnt']}")

        # Check for any Bullish Volume matches
        print("\n--- Search for Bullish matches in [Daily] Volume ---")
        # Check for BULL_S, BULL_SPIKE, BULL
        await cur.execute("SELECT COUNT(*) as cnt FROM app_sg_calculated_signals WHERE timeframe = '1d' AND volume_signal IN ('BULL_S', 'BULL_SPIKE', 'BULL')")
        result = await cur.fetchone()
        print(f"Matches for 'Bullish' Volume: {result['cnt']}")

    conn.close()

if __name__ == "__main__":
    asyncio.run(debug_signals())
