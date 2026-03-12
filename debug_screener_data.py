
import asyncio
import aiomysql
import json
from config import Config

async def debug_screener_stocks():
    isins = {
        'INFY': 'INE009A01021',
        'TRIDENT': 'INE064C01022',
        'AMBUJACEM': 'INE079A01024',
        'GOCOLORS': 'INE0BJS01011',
        'BLUEJET': 'INE0KBH01020',
        'PRAJIND': 'INE074A01025',
        'SWIGGY': 'INE00H001014'
    }
    
    app_db = Config.get_app_db_config()
    pool = await aiomysql.create_pool(**app_db)
    
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            print(f"{'Symbol':<12} | {'TF':<5} | {'RSI':<8} | {'Pattern':<30} | {'Score'}")
            print("-" * 75)
            
            for symbol, isin in isins.items():
                # Check 1mo and 1w
                await cur.execute(
                    "SELECT timeframe, rsi, candlestick_pattern, pattern_score FROM app_sg_calculated_signals WHERE isin = %s AND timeframe IN ('1mo', '1w')",
                    (isin,)
                )
                rows = await cur.fetchall()
                for row in rows:
                    tf = row['timeframe']
                    rsi = row['rsi'] if row['rsi'] is not None else 'NULL'
                    pattern = row['candlestick_pattern'] if row['candlestick_pattern'] else 'None'
                    score = row['pattern_score'] if row['pattern_score'] else 0
                    print(f"{symbol:<12} | {tf:<5} | {rsi:<8} | {pattern:<30} | {score}")
                print("-" * 75)

    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(debug_screener_stocks())
