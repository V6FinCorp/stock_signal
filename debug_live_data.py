
import asyncio
import aiomysql
from config import Config
from datetime import datetime

async def debug_data_presence():
    print("--- Debugging Data Presence for Feb 23 ---")
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # 1. Check for 1d data latest date
                await cur.execute("SELECT MAX(timestamp) as max_ts FROM app_sg_ohlcv_prices WHERE timeframe = '1d'")
                res_1d = await cur.fetchone()
                print(f"Latest 1d Candle: {res_1d['max_ts']}")

                # 2. Check for 5m data on Feb 23
                await cur.execute("SELECT COUNT(*) as count, MAX(timestamp) as max_ts FROM app_sg_ohlcv_prices WHERE timeframe = '5m' AND timestamp >= '2026-02-23 00:00:00' AND timestamp < '2026-02-24 00:00:00'")
                res_5m = await cur.fetchone()
                print(f"5m Candles for Feb 23: {res_5m['count']} (Latest: {res_5m['max_ts']})")

                # 3. Sample a specific favorite stock
                await cur.execute("SELECT isin FROM app_sg_ohlcv_prices WHERE timeframe = '5m' LIMIT 1")
                sample = await cur.fetchone()
                if sample:
                    await cur.execute("SELECT timestamp, close FROM app_sg_ohlcv_prices WHERE isin = %s AND timeframe = '5m' AND timestamp >= '2026-02-23 00:00:00' ORDER BY timestamp DESC LIMIT 5", (sample['isin'],))
                    ticks = await cur.fetchall()
                    print(f"\nRecent 5m ticks for {sample['isin']}:")
                    for t in ticks:
                        print(f"  {t['timestamp']} | {t['close']}")

        app_pool.close()
        await app_pool.wait_closed()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(debug_data_presence())
