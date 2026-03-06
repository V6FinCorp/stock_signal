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
                WHERE isin = (SELECT isin FROM app_sg_calculated_signals WHERE profile_id = 'intraday' LIMIT 1)
                AND profile_id = 'intraday'
            """)
            rows = await cur.fetchall()
            with open("tmp_rsi_out.txt", "w") as f:
                f.write("Stock | Timeframe | RSI\n")
                f.write("------|-----------|-----\n")
                for r in rows:
                    f.write(f"{r['symbol']:5} | {r['timeframe']:9} | {r['rsi']}\n")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_rsi_values())
