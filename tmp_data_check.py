import asyncio
import aiomysql
import json
from config import Config

async def check_data():
    try:
        pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT COUNT(*) as count FROM app_sg_calculated_signals WHERE last_5_candles IS NOT NULL AND last_5_candles != ''")
                res = await cur.fetchone()
                print(f"Records with last_5_candles: {res['count']}")
                
                await cur.execute("SELECT COUNT(*) as count FROM app_sg_calculated_signals")
                res = await cur.fetchone()
                print(f"Total signals: {res['count']}")
                
                # Check one sample to see if it's a string
                await cur.execute("SELECT last_5_candles FROM app_sg_calculated_signals WHERE last_5_candles IS NOT NULL LIMIT 1")
                res = await cur.fetchone()
                if res:
                    val = res['last_5_candles']
                    print(f"Sample type: {type(val)}")
                    print(f"Sample value (first 50 chars): {str(val)[:50]}")
                    
        pool.close()
        await pool.wait_closed()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_data())
