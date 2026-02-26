import aiomysql
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from config import Config
from indicator_engine import process_profile, get_enriched_chart_data
from scenario_engine import run_scenario_backtest
from pydantic import BaseModel
import json

app = FastAPI(title="StockSignal Pro API")

# --- Paper Trading Models ---
class TradeOpen(BaseModel):
    isin: str
    symbol: str
    mode: str
    timeframe: str
    entry_price: float
    target_1: float
    target_2: float
    stop_loss: float
    qty: int = 1

@app.post("/api/trades/open")
async def api_open_trade(trade: TradeOpen):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    INSERT INTO app_sg_active_trades 
                    (isin, symbol, profile_id, timeframe, entry_price, target_1, target_2, stop_loss, qty)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (trade.isin, trade.symbol, trade.mode, trade.timeframe, trade.entry_price, 
                      trade.target_1, trade.target_2, trade.stop_loss, trade.qty))
                await conn.commit()
        app_pool.close()
        await app_pool.wait_closed()
        return {"status": "success", "message": "Trade opened successfully."}
    except Exception as e:
        if 'app_pool' in locals(): app_pool.close()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/trades/active")
async def api_get_active_trades():
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # Fetch active trades and join with current LTP from OHLCV table
                await cur.execute("""
                    SELECT t.*, p.close as ltp 
                    FROM app_sg_active_trades t
                    LEFT JOIN app_sg_ohlcv_prices p ON t.isin = p.isin AND t.timeframe = p.timeframe
                    WHERE t.status = 'OPEN'
                    AND p.timestamp = (SELECT MAX(timestamp) FROM app_sg_ohlcv_prices WHERE isin = t.isin AND timeframe = t.timeframe)
                """)
                rows = await cur.fetchall()
        app_pool.close()
        await app_pool.wait_closed()
        return {"status": "success", "data": rows}
    except Exception as e:
        if 'app_pool' in locals(): app_pool.close()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/trades/close/{trade_id}")
async def api_close_trade(trade_id: int):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM app_sg_active_trades WHERE id = %s", (trade_id,))
                await conn.commit()
        app_pool.close()
        await app_pool.wait_closed()
        return {"status": "success", "message": "Trade closed/removed."}
    except Exception as e:
        if 'app_pool' in locals(): app_pool.close()
        raise HTTPException(status_code=500, detail=str(e))

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

@app.post("/api/settings/save")
async def save_settings(data: dict):
    """Saves indicator settings for a specific profile (swing/intraday) to the database."""
    profile = data.get("profile")
    settings = data.get("settings")
    if not profile or not settings:
        raise HTTPException(status_code=400, detail="Profile and settings are required.")
    
    # Map frontend JS keys to backend Python engine keys
    mapping = {
        'rsi': 'RSI',
        'ema': 'EMA',
        'st': 'SUPERTREND',
        'vol': 'VOLUME',
        'dma': 'DMA',
        'patterns': 'patterns',
        'fundamentals': 'FUNDAMENTALS'
    }
    
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                for fe_key, be_key in mapping.items():
                    if fe_key in settings:
                        val = settings[fe_key]
                        is_enabled = val.get('enabled', True)
                        # Extract parameters excluding the 'enabled' flag
                        params = {k: v for k, v in val.items() if k != 'enabled'}
                        params_json = json.dumps(params)
                        
                        await cur.execute("""
                            INSERT INTO app_sg_indicator_settings (profile_id, indicator_key, is_enabled, params_json)
                            VALUES (%s, %s, %s, %s)
                            ON DUPLICATE KEY UPDATE is_enabled=VALUES(is_enabled), params_json=VALUES(params_json)
                        """, (profile, be_key, is_enabled, params_json))
                await conn.commit()
        app_pool.close()
        await app_pool.wait_closed()
        return {"status": "success", "message": f"Settings for {profile} saved to database."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {str(e)}")

@app.get("/api/sector/sentiment")
async def get_sector_sentiment(mode: str = "swing", timeframe: str = None):
    """Aggregates signal directions by Industry Group to provide sector-level sentiment."""
    default_tf = "5m" if mode == "intraday" else "1d"
    tf = timeframe if timeframe else default_tf
    
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("""
                    SELECT i_group, supertrend_dir, COUNT(*) as count 
                    FROM app_sg_calculated_signals 
                    WHERE profile_id = %s AND timeframe = %s AND i_group IS NOT NULL
                    GROUP BY i_group, supertrend_dir
                """, (mode, tf))
                rows = await cur.fetchall()
        app_pool.close()
        await app_pool.wait_closed()
        
        # Aggregate logic
        sentiment = {}
        for r in rows:
            g = r['i_group']
            if g not in sentiment:
                sentiment[g] = {'buy': 0, 'sell': 0, 'total': 0}
            
            if r['supertrend_dir'] == 'BUY':
                sentiment[g]['buy'] += r['count']
            elif r['supertrend_dir'] == 'SELL':
                sentiment[g]['sell'] += r['count']
            sentiment[g]['total'] += r['count']
            
        # Transform for frontend
        results = []
        for g, vals in sentiment.items():
            score = (vals['buy'] / vals['total'] * 100) if vals['total'] > 0 else 50
            results.append({
                "group": g,
                "buy_count": vals['buy'],
                "sell_count": vals['sell'],
                "total": vals['total'],
                "score": round(score, 1)
            })
            
        # Sort by score (Bullish first)
        results.sort(key=lambda x: x['score'], reverse=True)
        return {"status": "success", "data": results}
    except Exception as e:
        if 'app_pool' in locals(): app_pool.close()
        raise HTTPException(status_code=500, detail=str(e))

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
                        "rsi_day_high": float(row['rsi_day_high']) if row['rsi_day_high'] is not None else None,
                        "rsi_day_low": float(row['rsi_day_low']) if row['rsi_day_low'] is not None else None,
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
                        "candlestick_pattern": row.get('candlestick_pattern'),
                        "last_5_candles": json.loads(row['last_5_candles']) if row.get('last_5_candles') and row['last_5_candles'].startswith('[') else None,
                        "mtf_data": mtf_map.get(isin, {}),
                        "sector": row.get('sector'),
                        "i_group": row.get('i_group'),
                        "i_subgroup": row.get('i_subgroup'),
                        "industry": row.get('industry'),
                        "pe": float(row['pe']) if row.get('pe') is not None else None,
                        "pb": float(row['pb']) if row.get('pb') is not None else None,
                        "roe": float(row['roe']) if row.get('roe') is not None else None,
                        "eps": float(row['eps']) if row.get('eps') is not None else None,
                        "opm": float(row['opm']) if row.get('opm') is not None else None,
                        "npm": float(row['npm']) if row.get('npm') is not None else None
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

@app.get("/api/chart/details")
async def api_chart_details(isin: str, timeframe: str, profile: str = "swing", bars: int = 30):
    """Fetches high-detail chart data including indicators for a specific ISIN/Timeframe."""
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database Connection Failed: {str(e)}")

    try:
        data = await get_enriched_chart_data(app_pool, isin, timeframe, profile, bars)
        app_pool.close()
        await app_pool.wait_closed()
        return {"status": "success", "data": data}
    except Exception as e:
        app_pool.close()
        await app_pool.wait_closed()
        raise HTTPException(status_code=500, detail=f"Chart Enrichment Failed: {str(e)}")

@app.post("/api/calculate")
async def calculate_signals(mode: str = "swing", fundamentals: bool = True):
    """Manually triggers the Pandas-TA Indicator Engine from the frontend for all timeframes."""
    timeframes = ['1d', '1w', '1mo'] if mode == "swing" else ['5m', '15m', '30m', '60m']
    
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database Connection Failed: {str(e)}")
        
    try:
        shared_cache = {}
        for tf in timeframes:
            await process_profile(app_pool, datamart_pool, mode, tf, shared_cache, use_fundamentals=fundamentals)
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
        status[mode]["last_calc"] = datetime.now().strftime("%d-%b-%Y %I:%M:%S %p")
        with open(status_file, "w") as f:
            json.dump(status, f)
    except Exception as e:
        pass
        
    return {"status": "success", "message": f"Successfully recalculated {mode} signals for all timeframes."}

import asyncio
import sys
import subprocess
import os
import signal

active_fetch_processes = {}

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
            bufsize=1, # Line buffered
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        )
        active_fetch_processes[mode] = proc
        
        try:
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
        except Exception as e:
            yield f"data: ERROR: Streaming interrupted: {repr(e)}\n\n"

        proc.stdout.close()
        proc.wait()
        
        if mode in active_fetch_processes:
            del active_fetch_processes[mode]
            
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
            status[mode]["last_fetch"] = datetime.now().strftime("%d-%b-%Y %I:%M:%S %p")
            with open(status_file, "w") as f:
                json.dump(status, f)
        except Exception as e:
            yield f"data: WARNING: Failed to write status.json: {e}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(log_generator(), media_type="text/event-stream")

@app.post("/api/stop-fetch")
async def stop_fetch(mode: str = "swing"):
    """Terminates an active fetching process."""
    if mode in active_fetch_processes:
        proc = active_fetch_processes[mode]
        try:
            if os.name == 'nt':
                # Sending CTRL_BREAK_EVENT to the process group
                os.kill(proc.pid, signal.CTRL_BREAK_EVENT)
            else:
                proc.terminate()
            
            # Briefly wait for it to exit
            for _ in range(10):
                if proc.poll() is not None:
                    break
                await asyncio.sleep(0.1)
                
            if proc.poll() is None:
                proc.kill() # Force kill if still running
                
            if mode in active_fetch_processes:
                del active_fetch_processes[mode]
                
            return {"status": "success", "message": f"Fetch process for {mode} stopped."}
        except Exception as e:
            return {"status": "error", "message": f"Failed to stop process: {str(e)}"}
    return {"status": "error", "message": "No active fetch process found for this mode."}

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
async def api_status(mode: Optional[str] = None):
    """Returns the last fetch, calculate, and latest OHLC execution timestamps for all modes."""
    import json
    from datetime import datetime
    
    # 1. Get last fetch/calc from file
    status = {"swing": {}, "intraday": {}}
    try:
        with open("status.json", "r") as f:
            status = json.load(f)
    except FileNotFoundError:
        pass
        
    def format_ts(ts_str):
        if not ts_str or ts_str == "Never":
            return "Never"
        # If it's already in the target format (DD-MMM-YYYY), return it
        # (e.g. 23-Feb-2026 07:46:23 PM)
        try:
            # Check if it matches new format (loosely)
            if "-" in ts_str and any(m in ts_str for m in ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]):
                return ts_str
            # Try parsing old format
            dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
            return dt.strftime("%d-%b-%Y %I:%M:%S %p")
        except:
            return ts_str

    # Normalize existing status timestamps
    for m in ["swing", "intraday"]:
        status.setdefault(m, {})
        for key in ["last_fetch", "last_calc"]:
            if key in status[m]:
                status[m][key] = format_ts(status[m][key])

    # 2. Get latest OHLC times from DB for BOTH modes
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Get Swing effective date (check 1d vs 5m)
                await cur.execute("SELECT MAX(timestamp) FROM app_sg_ohlcv_prices WHERE timeframe = '1d'")
                res_s_1d = await cur.fetchone()
                
                await cur.execute("SELECT MAX(timestamp) FROM app_sg_ohlcv_prices WHERE timeframe = '5m'")
                res_s_5m = await cur.fetchone()
                
                s_1d = res_s_1d[0] if res_s_1d and res_s_1d[0] else None
                s_5m = res_s_5m[0] if res_s_5m and res_s_5m[0] else None
                
                # If 5m is NEWER than 1d (even on same day), show the 5m time as "Live"
                if s_5m and (not s_1d or s_5m > s_1d):
                    status["swing"]["latest_ohlc"] = s_5m.strftime("%d-%b-%Y %I:%M:%S %p") + " (Live)"
                else:
                    status["swing"]["latest_ohlc"] = s_1d.strftime("%d-%b-%Y %I:%M:%S %p") if s_1d else "Never"
                
                # Get Intraday (5m) - purely based on 5m data
                status["intraday"]["latest_ohlc"] = s_5m.strftime("%d-%b-%Y %I:%M:%S %p") if s_5m else "Never"
        app_pool.close()
        await app_pool.wait_closed()
    except Exception as e:
        print(f"Error fetching latest OHLC: {e}")
        status["swing"]["latest_ohlc"] = status["swing"].get("latest_ohlc", "Never")
        status["intraday"]["latest_ohlc"] = status["intraday"].get("latest_ohlc", "Never")
        
    return status

from typing import Optional

class BacktestParams(BaseModel):
    symbol: Optional[str] = None
    symbols: Optional[list] = []
    start_date: str
    end_date: str
    primary_tf: str
    action: str
    rsi_min: float
    rsi_max: float
    stop_loss_pct: float
    t1_weight: Optional[float] = 50.0
    t2_weight: Optional[float] = 50.0
    t1_price: Optional[float] = 0.49
    t2_price: Optional[float] = 0.90
    tranche_weights: Optional[list] = [50.0, 25.0, 25.0]
    tranche_prices: Optional[list] = [0.1, 0.1]

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

class DbClearParams(BaseModel):
    target: str

@app.get("/api/db/stats")
async def api_db_stats():
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database Connection Failed: {str(e)}")

    try:
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # Get total rows
                await cur.execute("SELECT COUNT(*) as raw_rows FROM app_sg_ohlcv_prices")
                raw_rows = (await cur.fetchone())['raw_rows']
                
                await cur.execute("SELECT COUNT(*) as calc_rows FROM app_sg_calculated_signals")
                calc_rows = (await cur.fetchone())['calc_rows']

                # Get dataset coverage by timeframe
                await cur.execute("""
                    SELECT timeframe, MIN(timestamp) as min_date, MAX(timestamp) as max_date, 
                           COUNT(*) as c, COUNT(DISTINCT DATE(timestamp)) as days
                    FROM app_sg_ohlcv_prices
                    GROUP BY timeframe
                """)
                coverage_rows = await cur.fetchall()
                coverage = {}
                for row in coverage_rows:
                    tf = row['timeframe']
                    coverage[tf] = {
                        "min_date": row['min_date'].strftime("%Y-%m-%d %H:%M:%S") if row['min_date'] else None,
                        "max_date": row['max_date'].strftime("%Y-%m-%d %H:%M:%S") if row['max_date'] else None,
                        "count": row['c'],
                        "days": row['days'],
                        "gaps": []
                    }

                    # --- GAP CHECK LOGIC ---
                    if row['min_date'] and row['max_date'] and tf == '1d':
                        # 1. Fetch official holidays from Datamart
                        holidays = []
                        try:
                            datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
                            async with datamart_pool.acquire() as dm_conn:
                                async with dm_conn.cursor() as dm_cur:
                                    await dm_cur.execute("SELECT holiday_date FROM e_bs_holidays_nse")
                                    holidays = [r[0] for r in await dm_cur.fetchall()]
                            datamart_pool.close()
                            await datamart_pool.wait_closed()
                        except: pass

                        # 2. Get dates present in DB
                        await cur.execute("SELECT DISTINCT DATE(timestamp) as d FROM app_sg_ohlcv_prices WHERE timeframe = %s", (tf,))
                        db_dates = {r['d'] for r in await cur.fetchall()}

                        # 3. Iterate and find missing non-weekend, non-holiday dates
                        start = row['min_date'].date()
                        end = row['max_date'].date()
                        import datetime
                        curr = start
                        while curr <= end:
                            # 0=Mon, 4=Fri, 5=Sat, 6=Sun
                            if curr.weekday() < 5 and curr not in holidays and curr not in db_dates:
                                coverage[tf]['gaps'].append(curr.strftime("%Y-%m-%d"))
                            curr += datetime.timedelta(days=1)
                        
                        # Only show last 5 gaps to keep UI clean
                        if len(coverage[tf]['gaps']) > 5:
                            total_gaps = len(coverage[tf]['gaps'])
                            coverage[tf]['gaps'] = coverage[tf]['gaps'][-5:]
                            coverage[tf]['total_gap_count'] = total_gaps

    except Exception as e:
        if app_pool: app_pool.close()
        raise HTTPException(status_code=500, detail=f"Stats Query Failed: {str(e)}")

    app_pool.close()
    await app_pool.wait_closed()
    return {"status": "success", "data": {"raw_rows": raw_rows, "calc_rows": calc_rows, "coverage": coverage}}

@app.post("/api/db/clear")
async def api_db_clear(params: DbClearParams):
    target = params.target
    if target not in ['raw', 'calculated', 'all']:
        raise HTTPException(status_code=400, detail="Invalid target")

    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database Connection Failed: {str(e)}")

    try:
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                if target in ['calculated', 'all']:
                    await cur.execute("TRUNCATE TABLE app_sg_calculated_signals")
                if target in ['raw', 'all']:
                    await cur.execute("TRUNCATE TABLE app_sg_ohlcv_prices")
    except Exception as e:
        app_pool.close()
        raise HTTPException(status_code=500, detail=f"Clear Query Failed: {str(e)}")

    app_pool.close()
    await app_pool.wait_closed()
    return {"status": "success", "message": f"Successfully cleared {target} data."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
