import asyncio
import aiomysql
from config import Config

async def check_signals():
    app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    isins = ('INE509F01029', 'INE590D01016', 'INE572D01014', 'INE846D01012', 'INE060D01028')
    
    async with app_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            print("--- SIGNALS CHECK ---")
            await cur.execute("SELECT isin, profile_id FROM app_sg_calculated_signals WHERE isin IN %s", (isins,))
            rows = await cur.fetchall()
            for r in rows:
                print(r)
    
    app_pool.close()
    await app_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_signals())
