import aiomysql
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from config import Config
from indicator_engine import process_profile
import json

app = FastAPI(title="StockSignal Pro API")

# Allow CORS for local testing (so index.html can hit it from anywhere)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Route to serve the main dashboard HTML
@app.get("/")
async def serve_dashboard():
    return FileResponse("index.html")

# Mount the current directory to serve static assets (like styles.css, app.js)
app.mount("/static", StaticFiles(directory="."), name="static")

@app.get("/api/signals")
async def get_signals(mode: str = "swing", timeframe: str = None):
    # Default timeframe mapping based on mode
    default_timeframe = "5m" if mode == "intraday" else "1d"
    selected_timeframe = timeframe if timeframe else default_timeframe
    
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database Connection Failed: {str(e)}")

    signals = []
    
    try:
        async with datamart_pool.acquire() as dm_conn:
            async with dm_conn.cursor() as dm_cur:
                await dm_cur.execute("SELECT bs_ISIN, bs_SYMBOL FROM vw_e_bs_companies_all WHERE BINARY bs_Status = 'Active'")
                symbols_map = {row[0]: row[1] for row in await dm_cur.fetchall()}
                
        async with app_pool.acquire() as app_conn:
            async with app_conn.cursor(aiomysql.DictCursor) as app_cur:
                await app_cur.execute(
                    """
                    SELECT * FROM app_sg_calculated_signals 
                    WHERE profile_id = %s AND timeframe = %s 
                    ORDER BY confluence_rank DESC LIMIT 500
                    """, 
                    (mode, selected_timeframe)
                )
                rows = await app_cur.fetchall()
                
                for row in rows:
                    isin = row['isin']
                    
                    # Ensure JSON serializable formatting matches the structure expected by JS
                    signals.append({
                        "isin": isin,
                        "symbol": symbols_map.get(isin, isin),
                        "ltp": float(row['ltp']) if row['ltp'] is not None else None,
                        "rsi": float(row['rsi']) if row['rsi'] is not None else None,
                        "ema_value": float(row['ema_value']) if row['ema_value'] is not None else None,
                        "supertrend_dir": row['supertrend_dir'],
                        "supertrend_value": float(row['supertrend_value']) if row['supertrend_value'] is not None else None,
                        "dma_data": json.loads(row['dma_data']) if row['dma_data'] else {},
                        "confluence_rank": int(row['confluence_rank']) if row['confluence_rank'] is not None else 0
                    })
                    
    except Exception as e:
        app_pool.close()
        datamart_pool.close()
        raise HTTPException(status_code=500, detail=f"Database Query Failed: {str(e)}")

    app_pool.close()
    datamart_pool.close()
    await app_pool.wait_closed()
    await datamart_pool.wait_closed()
    
    return {"status": "success", "data": signals}

@app.post("/api/calculate")
async def calculate_signals(mode: str = "swing", timeframe: str = None):
    """Manually triggers the Pandas-TA Indicator Engine from the frontend."""
    default_timeframe = "5m" if mode == "intraday" else "1d"
    selected_timeframe = timeframe if timeframe else default_timeframe
    
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database Connection Failed: {str(e)}")
        
    try:
        await process_profile(app_pool, datamart_pool, mode, selected_timeframe)
    except Exception as e:
        app_pool.close()
        datamart_pool.close()
        raise HTTPException(status_code=500, detail=f"Engine Calculation Failed: {str(e)}")
        
    app_pool.close()
    datamart_pool.close()
    await app_pool.wait_closed()
    await datamart_pool.wait_closed()
    
    return {"status": "success", "message": f"Successfully recalculated {mode} signals for {selected_timeframe}."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
