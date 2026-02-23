import aiomysql
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from config import Config
from indicator_engine import process_profile
from scenario_engine import run_scenario_backtest
from pydantic import BaseModel
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
                # Add MTF query to fetch all supertrend directions for the entire mode
                await app_cur.execute(
                    """
                    SELECT isin, timeframe, supertrend_dir 
                    FROM app_sg_calculated_signals 
                    WHERE profile_id = %s
                    """,
                    (mode,)
                )
                mtf_data_all = await app_cur.fetchall()
                mtf_map = {}
                for m in mtf_data_all:
                    if m['isin'] not in mtf_map:
                        mtf_map[m['isin']] = {}
                    mtf_map[m['isin']][m['timeframe']] = m['supertrend_dir']
                
                # Fetch main timeframe rows
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
                        "ema_signal": row['ema_signal'],
                        "ema_fast": float(row['ema_fast']) if row['ema_fast'] is not None else None,
                        "ema_slow": float(row['ema_slow']) if row['ema_slow'] is not None else None,
                        "volume_signal": row['volume_signal'],
                        "volume_ratio": float(row['volume_ratio']) if row['volume_ratio'] is not None else 1.0,
                        "supertrend_dir": row['supertrend_dir'],
                        "supertrend_value": float(row['supertrend_value']) if row['supertrend_value'] is not None else None,
                        "dma_data": json.loads(row['dma_data']) if row['dma_data'] else {},
                        "confluence_rank": int(row['confluence_rank']) if row['confluence_rank'] is not None else 0,
                        "sl": float(row['sl']) if row['sl'] is not None else None,
                        "target": float(row['target']) if row['target'] is not None else None,
                        "trade_strategy": row['trade_strategy'] or "NORMAL",
                        "mtf_data": mtf_map.get(isin, {})
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
    
    # Save timestamp
    try:
        import json
        from datetime import datetime
        status_file = "status.json"
        try:
            with open(status_file, "r") as f:
                status = json.load(f)
        except FileNotFoundError:
            status = {"swing": {}, "intraday": {}}
            
        status.setdefault(mode, {})
        status[mode]["last_calc"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(status_file, "w") as f:
            json.dump(status, f)
    except Exception as e:
        pass
        
    return {"status": "success", "message": f"Successfully recalculated {mode} signals for {selected_timeframe}."}

import asyncio
import sys
import subprocess

@app.get("/api/stream/fetch-data")
def stream_api_fetch_data(mode: str = "swing"):
    """Streams the History Harvester console output via Server-Sent Events."""
    if mode not in ["swing", "intraday"]:
        raise HTTPException(status_code=400, detail="Invalid mode specified.")
        
    def log_generator():
        proc = subprocess.Popen(
            [sys.executable, "-u", "fetch_history.py", "--mode", mode],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, # Merge stderr into stdout
            text=True,
            bufsize=1 # Line buffered
        )
        for line in iter(proc.stdout.readline, ''):
            if not line:
                break
            # Only stream actual module logs, not library warnings
            clean_line = line.strip()
            if "INFO" in clean_line or "Planned:" in clean_line or "WARNING" in clean_line:
                 # Clean up python log prefix for nicer UI reading
                 if " - INFO - " in clean_line:
                     clean_line = clean_line.split(" - INFO - ")[-1]
                 elif " - WARNING - " in clean_line:
                     clean_line = "WARNING: " + clean_line.split(" - WARNING - ")[-1]
                 yield f"data: {clean_line}\n\n"
            elif "ERROR" in clean_line:
                 if " - ERROR - " in clean_line:
                     clean_line = clean_line.split(" - ERROR - ")[-1]
                 yield f"data: ERROR: {clean_line}\n\n"
            
        proc.stdout.close()
        proc.wait()
        
        try:
            import json
            from datetime import datetime
            status_file = "status.json"
            try:
                with open(status_file, "r") as f:
                    status = json.load(f)
            except FileNotFoundError:
                status = {"swing": {}, "intraday": {}}
                
            status.setdefault(mode, {})
            status[mode]["last_fetch"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(status_file, "w") as f:
                json.dump(status, f)
        except Exception as e:
            yield f"data: WARNING: Failed to write status.json: {e}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(log_generator(), media_type="text/event-stream")

# Keep the original POST for backwards compatibility if needed, though UI will use stream
@app.post("/api/fetch-data")
async def api_fetch_data(mode: str = "swing"):
    """Triggers the History Harvester to fetch fresh Upstox data for the given mode."""
    if mode not in ["swing", "intraday"]:
        raise HTTPException(status_code=400, detail="Invalid mode specified.")
        
    try:
        loop = asyncio.get_event_loop()
        proc = await loop.run_in_executor(
            None, 
            lambda: subprocess.run(
                [sys.executable, "-u", "fetch_history.py", "--mode", mode],
                capture_output=True, text=True
            )
        )
        
        if proc.returncode != 0:
            err_msg = proc.stderr if proc.stderr else "Unknown error"
            raise HTTPException(status_code=500, detail=f"Fetch script failed: {err_msg}")
            
        return {"status": "success", "message": f"Successfully fetched fresh data for {mode} mode."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to execute fetch: {repr(e)}")

@app.get("/api/status")
async def api_status():
    """Returns the last fetch and calculate execution timestamps."""
    import json
    try:
        with open("status.json", "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"swing": {}, "intraday": {}}

from typing import Optional

class BacktestParams(BaseModel):
    symbol: Optional[str] = None
    start_date: str
    end_date: str
    primary_tf: str
    action: str
    rsi_min: float
    rsi_max: float
    stop_loss_pct: float

@app.post("/api/backtest/run")
async def api_run_backtest(params: BacktestParams):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database Connection Failed: {str(e)}")

    try:
        results = await run_scenario_backtest(app_pool, datamart_pool, params.dict())
    except Exception as e:
        app_pool.close()
        datamart_pool.close()
        raise HTTPException(status_code=500, detail=f"Backtest Engine Failed: {str(e)}")

    app_pool.close()
    datamart_pool.close()
    await app_pool.wait_closed()
    await datamart_pool.wait_closed()
    return results

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
