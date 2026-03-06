import asyncio
import aiomysql
from config import Config

async def check_candle_history():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # Pick one ISIN and check candle distribution
            await cur.execute("SELECT isin FROM app_sg_ohlcv_prices WHERE timeframe = '5m' LIMIT 1")
            row = await cur.fetchone()
            if not row:
                print("No 5m data found.")
                return
            isin = row['isin']
            await cur.execute("""
                SELECT DATE(timestamp) as date, COUNT(*) as count 
                FROM app_sg_ohlcv_prices 
                WHERE isin = %s AND timeframe = '5m' 
                GROUP BY DATE(timestamp) 
                ORDER BY date DESC
            """, (isin,))
            rows = await cur.fetchall()
            print(f"5m Candle History for {isin}:")
            for r in rows:
                print(f"  {r['date']}: {r['count']} candles")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_candle_history())
