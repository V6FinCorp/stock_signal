import asyncio
import aiomysql
from config import Config

async def check_rsi_variety():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # Check RSI for one ISIN across all timeframes
            await cur.execute("SELECT isin FROM app_sg_calculated_signals WHERE profile_id = 'intraday' LIMIT 1")
            row = await cur.fetchone()
            if not row:
                print("No intraday signals found.")
                return
            isin = row['isin']
            await cur.execute("SELECT timeframe, rsi FROM app_sg_calculated_signals WHERE isin = %s AND profile_id = 'intraday'", (isin,))
            rows = await cur.fetchall()
            print(f"RSI for ISIN {isin}:")
            for r in rows:
                print(f"  {r['timeframe']}: {r['rsi']}")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_rsi_variety())
