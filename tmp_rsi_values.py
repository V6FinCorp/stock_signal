import asyncio
import aiomysql
from config import Config

async def check_rsi_values():
    pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # Pick one stock and check RSI across timeframes
            await cur.execute("""
                SELECT symbol, timeframe, rsi 
                FROM app_sg_calculated_signals 
                WHERE isin = (SELECT isin FROM app_sg_calculated_signals LIMIT 1)
                AND profile_id = 'intraday'
            """)
            rows = await cur.fetchall()
            print("Stock | Timeframe | RSI")
            print("------|-----------|-----")
            for r in rows:
                print(f"{r['symbol']:5} | {r['timeframe']:9} | {r['rsi']}")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_rsi_values())
