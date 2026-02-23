
import asyncio
import aiomysql
from config import Config

async def check_dma_counts():
    app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with app_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT isin, profile_id, timeframe, dma_data FROM app_sg_calculated_signals WHERE isin='INE009A01021'")
            rows = await cur.fetchall()
            print("--- Detailed Check for INE009A01021 ---")
            for row in rows:
                print(f"Profile: {row['profile_id']} | TF: {row['timeframe']} | DMA: {row['dma_data']}")
    app_pool.close()
    await app_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_dma_counts())
