import asyncio
import aiomysql
import traceback
from config import Config

async def run_schema():
    print("Connecting to database...")
    try:
        pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                with open('schema_strategy_builder.sql', 'r') as f:
                    sql_script = f.read()
                
                # aiomysql execute() doesn't support multiple statements at once easily. 
                # Splitting by semicolon
                statements = [s.strip() for s in sql_script.split(';') if s.strip()]
                for statement in statements:
                    await cur.execute(statement)
                await conn.commit()
                print("Strategy Builder Schema successfully applied!")
        pool.close()
        await pool.wait_closed()
    except Exception as e:
        print("Error applying schema:")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(run_schema())
