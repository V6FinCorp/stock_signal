
import asyncio
import aiomysql
import json
from config import DB_CONFIG

async def debug_signals():
    conn = await aiomysql.connect(**DB_CONFIG)
    async with conn.cursor(aiomysql.DictCursor) as cur:
        # Check Daily signals for volume and trend
        print("\n--- [Daily] Signal Sample (Top 5) ---")
        await cur.execute("SELECT symbol, supertrend_dir, volume_signal FROM app_sg_calculated_signals WHERE timeframe = '1d' LIMIT 5")
        rows = await cur.fetchall()
        for r in rows:
            print(f"Stock: {r['symbol']}, Trend: {r['supertrend_dir']}, Volume: {r['volume_signal']}")

        # Check for any Bullish matches manually
        print("\n--- Search for Bullish matches in [Daily] ---")
        await cur.execute("SELECT COUNT(*) as cnt FROM app_sg_calculated_signals WHERE timeframe = '1d' AND (supertrend_dir IN ('BUY', 'BULLISH', '1') OR volume_signal IN ('BULL_S', 'BULL_SPIKE', 'BULL'))")
        result = await cur.fetchone()
        print(f"Total Daily Bullish Matches in DB: {result['cnt']}")

    conn.close()

if __name__ == "__main__":
    asyncio.run(debug_signals())
