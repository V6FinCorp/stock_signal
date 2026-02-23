
import asyncio
import aiomysql
from config import Config
import json

async def check_dma():
    app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    async with app_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT isin, dma_data FROM app_sg_calculated_signals LIMIT 10")
            rows = await cur.fetchall()
            print("--- DMA Data Check ---")
            for row in rows:
                print(f"ISIN: {row['isin']} | DMA: {row['dma_data']}")
    app_pool.close()
    await app_pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(check_dma())
