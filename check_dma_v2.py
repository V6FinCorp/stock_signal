
import asyncio
import aiomysql
from config import Config

async def check_dma_detailed():
    app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with app_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT isin, profile_id, timeframe, dma_data FROM app_sg_calculated_signals WHERE profile_id='swing' AND timeframe='1d' LIMIT 20")
            rows = await cur.fetchall()
            print("--- SWING 1D DMA Data Check ---")
            for row in rows:
                print(f"ISIN: {row['isin']} | Profile: {row['profile_id']} | TF: {row['timeframe']} | DMA: {row['dma_data']}")
    app_pool.close()
    await app_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_dma_detailed())
