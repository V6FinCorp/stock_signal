import aiomysql
from typing import Optional
from fastapi import FastAPI, HTTPException, Request, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from config import Config
from indicator_engine import process_profile, get_enriched_chart_data
from scenario_engine import run_scenario_backtest
from pydantic import BaseModel
import json
import hashlib
from datetime import datetime, timedelta
import httpx
import asyncio

app = FastAPI(title="StockSignal Pro API")
fetching_active = {"swing": True, "intraday": True}

@app.on_event("startup")
async def startup_db_setup():
    """Ensure all required tables exist on startup."""
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Table for App Users (Simple Auth)
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS app_sg_users (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        username VARCHAR(50) UNIQUE NOT NULL,
                        password_hash VARCHAR(255) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                # Check if any user exists
                await cur.execute("SELECT COUNT(*) FROM app_sg_users")
                count = (await cur.fetchone())[0]
                if count == 0:
                    # Default: admin / admin123
                    h = hashlib.sha256("admin123".encode()).hexdigest()
                    await cur.execute("INSERT INTO app_sg_users (username, password_hash) VALUES ('admin', %s)", (h,))

                # Original Tables logic...
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS app_sg_confluence_strategies (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(100) NOT NULL,
                        query_text TEXT NOT NULL,
                        mapped_mode VARCHAR(20),
                        mapped_timeframe VARCHAR(10),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )
                """)
                # Migration for existing tables
                try: await cur.execute("ALTER TABLE app_sg_confluence_strategies ADD COLUMN mapped_mode VARCHAR(20)")
                except: pass
                try: await cur.execute("ALTER TABLE app_sg_confluence_strategies ADD COLUMN mapped_timeframe VARCHAR(10)")
                except: pass
                
                # Ensure columns in active trades
                try: await cur.execute("ALTER TABLE app_sg_active_trades ADD COLUMN notes TEXT")
                except: pass
                try: await cur.execute("ALTER TABLE app_sg_active_trades ADD COLUMN side VARCHAR(10) DEFAULT 'BUY'")
                except: pass

                # Global Settings Profile
                await cur.execute("INSERT IGNORE INTO app_sg_profiles (profile_id) VALUES ('global')")
                await cur.execute("INSERT IGNORE INTO app_sg_indicator_settings (profile_id, indicator_key, params_json) VALUES ('global', 'session', '{\"hours\": 24}')")
                
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS app_sg_signal_history (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        isin VARCHAR(20),
                        symbol VARCHAR(50),
                        profile_id VARCHAR(20),
                        timeframe VARCHAR(10),
                        timestamp DATETIME,
                        ltp DECIMAL(10, 4),
                        rsi DECIMAL(10, 4),
                        confluence_rank INT,
                        trade_strategy VARCHAR(50),
                        sl DECIMAL(10, 4),
                        target DECIMAL(10, 4),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY unique_log (isin, profile_id, timeframe, timestamp)
                    )
                """)
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS app_sg_system_status (
                        mode VARCHAR(20) PRIMARY KEY,
                        last_fetch_run TIMESTAMP NULL,
                        last_calc_run TIMESTAMP NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )
                """)
                await cur.execute("INSERT IGNORE INTO app_sg_system_status (mode) VALUES ('swing'), ('intraday')")
                await conn.commit()
        app_pool.close()
        await app_pool.wait_closed()
    except Exception as e:
        print(f"Startup DB Setup Error: {e}")

# --- Auth Models & Logic ---
def get_session_token(request: Request):
    return request.cookies.get("session_token")

async def check_auth(token: str = Depends(get_session_token)):
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

class LoginRequest(BaseModel):
    username: str
    password: str

class ChangePasswordRequest(BaseModel):
    username: str
    old_password: str
    new_password: str

# --- Original Models ---
class TradeOpen(BaseModel):
    isin: str
    symbol: str
    mode: str
    timeframe: str
    entry_price: float
    target: float
    stop_loss: float
    side: str = "BUY"
    qty: int = 1
    query_context: Optional[str] = None

class StrategySave(BaseModel):
    id: Optional[int] = None
    name: str
    query: str
    mode: Optional[str] = None
    timeframe: Optional[str] = None

# --- Auth Endpoints ---
@app.post("/api/auth/login")
async def login(req: LoginRequest, response: Response):
    try:
        passwd_hash = hashlib.sha256(req.password.encode()).hexdigest()
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT * FROM app_sg_users WHERE username = %s AND password_hash = %s", (req.username, passwd_hash))
                user = await cur.fetchone()
                
                # Fetch dynamic session duration
                await cur.execute("SELECT params_json FROM app_sg_indicator_settings WHERE profile_id = 'global' AND indicator_key = 'session'")
                session_row = await cur.fetchone()
                duration_hours = 24
                if session_row:
                    try:
                        params = json.loads(session_row['params_json'])
                        duration_hours = int(params.get('hours', 24))
                    except: pass
        
        app_pool.close()
        if not user: raise HTTPException(status_code=401, detail="Invalid credentials")
        
        max_age = 3600 * duration_hours
        response.set_cookie(key="session_token", value=passwd_hash, httponly=True, max_age=max_age)
        return {"status": "success", "user": user['username'], "session_hours": duration_hours}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie("session_token")
    return {"status": "success"}

@app.get("/api/auth/verify")
async def verify(request: Request, token: str = Depends(get_session_token)):
    if not token: return {"status": "fail"}
    # In this simple auth, the token is the password hash.
    # To find the user, we look up who has this hash.
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT username FROM app_sg_users WHERE password_hash = %s", (token,))
                user = await cur.fetchone()
        app_pool.close()
        if user: return {"status": "success", "username": user['username']}
    except: pass
    return {"status": "fail"}

@app.post("/api/auth/change-password", dependencies=[Depends(check_auth)])
async def change_password(req: ChangePasswordRequest):
    try:
        old_hash = hashlib.sha256(req.old_password.encode()).hexdigest()
        new_hash = hashlib.sha256(req.new_password.encode()).hexdigest()
        
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Verify old password
                await cur.execute("SELECT id FROM app_sg_users WHERE username = %s AND password_hash = %s", (req.username, old_hash))
                user = await cur.fetchone()
                
                if not user:
                    raise HTTPException(status_code=401, detail="Current password incorrect")
                
                # Update to new password
                await cur.execute("UPDATE app_sg_users SET password_hash = %s WHERE id = %s", (new_hash, user[0]))
                await conn.commit()
                
        app_pool.close()
        return {"status": "success", "message": "Password updated successfully"}
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Serving Header Routes ---
@app.get("/")
async def serve_dashboard(request: Request):
    if not request.cookies.get("session_token"):
        return FileResponse("login.html")
    return FileResponse("index.html")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory="."), name="static")

# --- Original API Routes (Protected) ---
@app.post("/api/trades/open", dependencies=[Depends(check_auth)])
async def api_open_trade(trade: TradeOpen):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    INSERT INTO app_sg_active_trades (isin, symbol, profile_id, timeframe, entry_price, target_1, stop_loss, qty, side, status, notes)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'OPEN', %s)
                """, (trade.isin, trade.symbol, trade.mode, trade.timeframe, trade.entry_price, trade.target, trade.stop_loss, trade.qty, trade.side, trade.query_context))
                await conn.commit()
        app_pool.close()
        return {"status": "success"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/trades/active", dependencies=[Depends(check_auth)])
async def api_get_active_trades():
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT t.*, (SELECT close FROM app_sg_ohlcv_prices WHERE isin = t.isin AND timeframe = t.timeframe ORDER BY timestamp DESC LIMIT 1) as ltp FROM app_sg_active_trades t WHERE t.status = 'OPEN'")
                rows = await cur.fetchall()
        app_pool.close()
        return {"status": "success", "data": rows}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/trades/close/{trade_id}", dependencies=[Depends(check_auth)])
async def api_close_trade(trade_id: int):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM app_sg_active_trades WHERE id = %s", (trade_id,))
                await conn.commit()
        app_pool.close()
        return {"status": "success"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/settings/load", dependencies=[Depends(check_auth)])
async def load_settings(profile: str):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT indicator_key, params_json FROM app_sg_indicator_settings WHERE profile_id = %s", (profile,))
                rows = await cur.fetchall()
        app_pool.close()
        settings = {}
        for r in rows:
            key = r['indicator_key'].lower()
            if key == 'supertrend': key = 'st'
            settings[key] = json.loads(r['params_json'])
        return {"status": "success", "settings": settings}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/settings/save", dependencies=[Depends(check_auth)])
async def save_settings(data: dict):
    profile = data.get("profile")
    settings = data.get("settings")
    
    if profile == 'global':
        mapping = {'session': 'session'}
    else:
        mapping = {'rsi': 'RSI', 'ema': 'EMA', 'st': 'SUPERTREND', 'vol': 'VOLUME', 'dma': 'DMA', 'patterns': 'patterns', 'fundamentals': 'FUNDAMENTALS', 'localization': 'localization'}
    
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                for fe_key, be_key in mapping.items():
                    if fe_key in settings:
                        val = settings[fe_key]
                        params = {k: v for k, v in val.items() if k != 'enabled'}
                        is_enabled = val.get('enabled', True)
                        await cur.execute("INSERT INTO app_sg_indicator_settings (profile_id, indicator_key, is_enabled, params_json) VALUES (%s, %s, %s, %s) ON DUPLICATE KEY UPDATE is_enabled=VALUES(is_enabled), params_json=VALUES(params_json)", (profile, be_key, is_enabled, json.dumps(params)))
                await conn.commit()
        app_pool.close()
        return {"status": "success"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/strategies/list", dependencies=[Depends(check_auth)])
async def list_strategies():
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT id, name, query_text as query, mapped_mode as mode, mapped_timeframe as timeframe, updated_at FROM app_sg_confluence_strategies ORDER BY updated_at DESC")
                rows = await cur.fetchall()
        app_pool.close()
        return {"status": "success", "data": rows}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/strategies/save", dependencies=[Depends(check_auth)])
async def save_strategy(strat: StrategySave):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                if strat.id: 
                    await cur.execute("UPDATE app_sg_confluence_strategies SET name = %s, query_text = %s, mapped_mode = %s, mapped_timeframe = %s WHERE id = %s", (strat.name, strat.query, strat.mode, strat.timeframe, strat.id))
                else: 
                    await cur.execute("INSERT INTO app_sg_confluence_strategies (name, query_text, mapped_mode, mapped_timeframe) VALUES (%s, %s, %s, %s)", (strat.name, strat.query, strat.mode, strat.timeframe))
                await conn.commit()
        app_pool.close()
        return {"status": "success"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/strategies/{strat_id}", dependencies=[Depends(check_auth)])
async def delete_strategy_api(strat_id: int):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur: 
                await cur.execute("DELETE FROM app_sg_confluence_strategies WHERE id = %s", (strat_id,))
                await conn.commit()
        app_pool.close()
        return {"status": "success"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/signals") # Public or Private? Let's protect it
async def get_signals(mode: str = "swing", timeframe: str = None, token: str = Depends(get_session_token)):
    if not token: raise HTTPException(status_code=401)
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
        signals = []
        async with datamart_pool.acquire() as dm_conn:
            async with dm_conn.cursor() as dm_cur:
                await dm_cur.execute("SELECT bs_ISIN, bs_SYMBOL FROM vw_e_bs_companies_all WHERE BINARY bs_Status = 'Active'")
                symbols_map = {row[0]: row[1] for row in await dm_cur.fetchall()}
        async with app_pool.acquire() as app_conn:
            async with app_conn.cursor(aiomysql.DictCursor) as app_cur:
                await app_cur.execute("SELECT isin, timeframe, supertrend_dir FROM app_sg_calculated_signals WHERE profile_id = %s", (mode,))
                mtf_map = {}
                for m in await app_cur.fetchall():
                    if m['isin'] not in mtf_map: mtf_map[m['isin']] = {}
                    mtf_map[m['isin']][m['timeframe']] = m['supertrend_dir']
                q = f"SELECT * FROM app_sg_calculated_signals WHERE profile_id = %s"
                p = [mode]
                if timeframe and timeframe != "all": q += " AND timeframe = %s"; p.append(timeframe)
                await app_cur.execute(q + " ORDER BY confluence_rank DESC LIMIT 1000", tuple(p))
                for row in await app_cur.fetchall():
                    processed_row = {}
                    for k, v in row.items():
                        if k not in ['id', 'isin', 'symbol'] and v is not None and not isinstance(v, (str, bytes, datetime)):
                            try:
                                processed_row[k] = float(v)
                            except:
                                processed_row[k] = v
                        elif k in ['last_5_candles', 'dma_data'] and isinstance(v, str):
                            try:
                                processed_row[k] = json.loads(v)
                            except:
                                processed_row[k] = v
                        else:
                            processed_row[k] = v
                    
                    processed_row['symbol'] = symbols_map.get(row['isin'], row['isin'])
                    processed_row['mtf_data'] = mtf_map.get(row['isin'], {})
                    signals.append(processed_row)
        app_pool.close(); datamart_pool.close()
        return {"status": "success", "data": signals}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/strategy/execute", dependencies=[Depends(check_auth)])
async def execute_strategy(payload: dict):
    # This is the "backend implementation" for strategy scanning.
    # It takes the full strategy state and can perform complex server-side filtering.
    try:
        mode = payload.get("mode", "swing")
        entry_logic = payload.get("entry", "")
        # For now, we return success and the frontend continues to use its eval engine.
        # But this endpoint is ready for full server-side execution.
        return {"status": "success", "message": "Backend execution ready."}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/status", dependencies=[Depends(check_auth)])
async def api_status(mode: str = "swing", timeframe: str = None):
    app_pool = None
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # 1. Job Run Times from System Status Table
                await cur.execute("SELECT last_fetch_run, last_calc_run FROM app_sg_system_status WHERE mode = %s", (mode,))
                job_times = await cur.fetchone()
                
                # 2. Latest Market Data Timestamp (Actual OHLC age)
                # Map synthesized timeframes to their base timeframe for status check
                tf_check_map = {
                    '1w': '1d',
                    '1mo': '1d',
                    '15m': '5m',
                    '30m': '5m',
                    '60m': '5m'
                }
                tf_key = timeframe if timeframe else ('1d' if mode == 'swing' else '5m')
                query_tf = tf_check_map.get(tf_key, tf_key)
                
                # Check both the target timeframe and '5m' for today's synthesis if we are in daily-based modes
                # This ensures OHLC shows today's date if 5m data is available, even if 1d is lagging
                if query_tf in ['1d', '1w', '1mo']:
                    await cur.execute("SELECT MAX(timestamp) as latest_ohlc FROM app_sg_ohlcv_prices WHERE timeframe IN (%s, '5m')", (query_tf,))
                else:
                    await cur.execute("SELECT MAX(timestamp) as latest_ohlc FROM app_sg_ohlcv_prices WHERE timeframe = %s", (query_tf,))
                    
                ohlc_row = await cur.fetchone()
                latest_ohlc = ohlc_row['latest_ohlc'] if ohlc_row and ohlc_row['latest_ohlc'] else None
                
        return {
            "status": "success",
            "last_fetch": job_times['last_fetch_run'].strftime("%d-%b-%Y %I:%M:%S %p") if job_times and job_times['last_fetch_run'] else "Never",
            "last_calc": job_times['last_calc_run'].strftime("%d-%b-%Y %I:%M:%S %p") if job_times and job_times['last_calc_run'] else "Never",
            "ohlc_time": latest_ohlc.strftime("%d-%b-%Y %I:%M:%S %p") if latest_ohlc else "Never",
            "market_status": "Live" 
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        if app_pool:
            app_pool.close()
            await app_pool.wait_closed()

@app.get("/api/sector/sentiment", dependencies=[Depends(check_auth)])
async def api_sector_sentiment(mode: str = "swing", timeframe: str = None):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                # Aggregate by industry group and supertrend direction
                await cur.execute("""
                    SELECT i_group as `group`, 
                           SUM(CASE WHEN supertrend_dir = 'BUY' THEN 1 ELSE 0 END) as buy_count,
                           SUM(CASE WHEN supertrend_dir = 'SELL' THEN 1 ELSE 0 END) as sell_count,
                           COUNT(*) as total
                    FROM app_sg_calculated_signals 
                    WHERE profile_id = %s AND i_group IS NOT NULL AND i_group != ''
                    GROUP BY i_group
                """, (mode,))
                rows = await cur.fetchall()
        
        # Calculate sentiment score (0-100)
        formatted_data = []
        for r in rows:
            # Score logic: (Buy Count / Total) * 100
            score = round((r['buy_count'] / r['total']) * 100) if r['total'] > 0 else 50
            formatted_data.append({
                "group": r['group'],
                "buy_count": int(r['buy_count']),
                "sell_count": int(r['sell_count']),
                "total": int(r['total']),
                "score": score
            })
            
        # Sort by score descending
        formatted_data.sort(key=lambda x: x['score'], reverse=True)
            
        app_pool.close()
        return {"status": "success", "data": formatted_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history", dependencies=[Depends(check_auth)])
async def api_history(mode: str = "all", timeframe: str = "all", limit: int = 100):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT * FROM app_sg_signal_history ORDER BY timestamp DESC LIMIT %s", (limit,))
                rows = await cur.fetchall()
        app_pool.close()
        return {"status": "success", "data": rows}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/chart/details", dependencies=[Depends(check_auth)])
async def api_chart_details(isin: str, timeframe: str, profile: str = "swing", bars: int = 30):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        data = await get_enriched_chart_data(app_pool, isin, timeframe, profile, bars)
        app_pool.close()
        return {"status": "success", "data": data}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))
@app.post("/api/calculate", dependencies=[Depends(check_auth)])
async def api_calculate(mode: str, fundamentals: bool = False):
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
        
        # Determine timeframes based on mode
        tfs = ['1d', '1w', '1mo'] if mode == 'swing' else ['5m', '15m', '30m', '60m']
        
        shared_cache = {}
        for tf in tfs:
            await process_profile(app_pool, datamart_pool, mode, tf, shared_cache=shared_cache, use_fundamentals=fundamentals)
            
        # Update system status with IST time
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                ist_now = datetime.utcnow() + timedelta(hours=5, minutes=30)
                await cur.execute("UPDATE app_sg_system_status SET last_calc_run = %s WHERE mode = %s", (ist_now, mode))
                await conn.commit()
                
        app_pool.close()
        datamart_pool.close()
        return {"status": "success"}
    except Exception as e:
        if 'app_pool' in locals(): app_pool.close()
        if 'datamart_pool' in locals(): datamart_pool.close()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/stop-fetch", dependencies=[Depends(check_auth)])
async def stop_fetch(mode: str):
    fetching_active[mode] = False
    return {"status": "success"}

@app.get("/api/stream/fetch-data", dependencies=[Depends(check_auth)])
async def stream_fetch(mode: str = "swing"):
    async def event_generator():
        fetching_active[mode] = True
        yield "data: 🚀 Starting Market Data Fetch ({})\n\n".format(mode.upper())
        
        try:
            app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
            datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
            
            # Get Holdings ISINs for Integrity Check
            holdings_isins = set()
            try:
                async with app_pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute("SELECT DISTINCT isin FROM tb_app_sf_holdings")
                        h_rows = await cur.fetchall()
                        holdings_isins = {r[0] for r in h_rows if r[0]}
            except Exception as e:
                logging.warning(f"Stream Fetch: Failed to fetch holdings: {e}")

            async with datamart_pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    target_dim = 1 if mode == 'intraday' else 2
                    
                    # Merge Logic: Get Favourites + Get info for any ISIN in holdings
                    # We use a broad union query
                    await cur.execute("""
                        SELECT DISTINCT c.bs_ISIN as isin, c.bs_SYMBOL as symbol, c.bs_Available_ON as exchange
                        FROM vw_e_bs_companies_all c
                        LEFT JOIN vw_e_bs_companies_favourite_indices f ON c.bs_SYMBOL = f.bs_symbol
                        WHERE BINARY c.bs_Status = 'Active' 
                        AND (f.dim_favourites = %s OR (c.bs_ISIN IS NOT NULL AND %s = 2 AND c.bs_ISIN IN %s))
                    """, (target_dim, target_dim, tuple(holdings_isins) if holdings_isins else ('',)))
                    companies = await cur.fetchall()
            
            if not companies:
                yield "data: ⚠️ No favourite companies found for this mode.\n\n"
                yield "data: [DONE]\n\n"
                app_pool.close(); datamart_pool.close()
                return

            total = len(companies)
            yield "data: 📊 Found {} stocks to process.\n\n".format(total)

            headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
            async with httpx.AsyncClient(headers=headers) as client:
                for i, comp in enumerate(companies, 1):
                    if not fetching_active.get(mode, True):
                        yield "data: 🛑 Fetch interrupted by user.\n\n"
                        break
                    
                    isin = comp['isin']
                    symbol = comp['symbol']
                    
                    yield "data: Processing {}/{} - {}...\n\n".format(i, total, symbol)
                    
                    # Fetch Logic (Dual fetch for Swing to support live synthesis)
                    try:
                        fetch_configs = []
                        # Select correct prefix based on exchange availability
                        prefix = "BSE_EQ" if comp.get('exchange') == 'BSE' else "NSE_EQ"
                        
                        if mode == "swing":
                            fetch_configs.append({'url': f"https://api.upstox.com/v3/historical-candle/{prefix}|{isin}/days/1/{datetime.now().strftime('%Y-%m-%d')}/2023-01-01", 'tf': '1d'})
                            fetch_configs.append({'url': f"https://api.upstox.com/v3/historical-candle/intraday/{prefix}|{isin}/minutes/5", 'tf': '5m'})
                        else:
                            fetch_configs.append({'url': f"https://api.upstox.com/v3/historical-candle/intraday/{prefix}|{isin}/minutes/5", 'tf': '5m'})
                            
                        for cfg in fetch_configs:
                            url = cfg['url']
                            tf_key = cfg['tf']
                            res = await client.get(url, timeout=10.0)
                            if res.status_code == 200:
                                data = res.json()
                                if data.get("status") == "success":
                                    candles = data["data"]["candles"]
                                    async with app_pool.acquire() as conn:
                                        async with conn.cursor() as cur:
                                            rows = []
                                            for c in candles:
                                                ts = c[0].split('+')[0].replace('T', ' ')
                                                rows.append((isin, tf_key, ts, c[1], c[2], c[3], c[4], c[5]))
                                            if rows:
                                                await cur.executemany("""
                                                    INSERT INTO app_sg_ohlcv_prices (isin, timeframe, timestamp, open, high, low, close, volume)
                                                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                                                    ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume)
                                                """, rows)
                                    # yield "data: ✅ {} - {} candles updated ({tf}).\n\n".format(symbol, len(candles), tf=tf_key)
                                yield "data: ✅ {} - {} candles updated.\n\n".format(symbol, len(candles))
                    except Exception as e:
                        yield "data: ❌ Error fetching {}: {}\n\n".format(symbol, str(e))
                    
                    await asyncio.sleep(0.1) # Small delay for UI smoothness

            # Update system status on success with IST time
            async with app_pool.acquire() as conn:
                async with conn.cursor() as cur:
                    ist_now = datetime.utcnow() + timedelta(hours=5, minutes=30)
                    await cur.execute("UPDATE app_sg_system_status SET last_fetch_run = %s WHERE mode = %s", (ist_now, mode))
                    await conn.commit()

            yield "data: [DONE]\n\n"
            app_pool.close(); datamart_pool.close()
            
        except Exception as e:
            yield "data: 💥 Global Error: {}\n\n".format(str(e))
            if 'app_pool' in locals(): app_pool.close()
            if 'datamart_pool' in locals(): datamart_pool.close()
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/db/stats", dependencies=[Depends(check_auth)])
async def api_db_stats():
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT COUNT(*) as raw_rows FROM app_sg_ohlcv_prices")
                raw = (await cur.fetchone())['raw_rows']
                await cur.execute("SELECT COUNT(*) as calc_rows FROM app_sg_calculated_signals")
                calc = (await cur.fetchone())['calc_rows']
                
                # Fetch coverage matrix
                await cur.execute("""
                    SELECT 
                        timeframe, 
                        MIN(timestamp) as min_date, 
                        MAX(timestamp) as max_date, 
                        COUNT(DISTINCT DATE(timestamp)) as days, 
                        COUNT(*) as count 
                    FROM app_sg_ohlcv_prices 
                    GROUP BY timeframe
                """)
                coverage_rows = await cur.fetchall()
                coverage = {}
                for r in coverage_rows:
                    coverage[r['timeframe']] = {
                        "min_date": r['min_date'].strftime('%Y-%m-%d') if r['min_date'] else '-',
                        "max_date": r['max_date'].strftime('%Y-%m-%d') if r['max_date'] else '-',
                        "days": r['days'],
                        "count": r['count']
                    }
                    
        app_pool.close()
        return {"status": "success", "data": {"raw_rows": raw, "calc_rows": calc, "coverage": coverage}}
    except Exception as e:
        if 'app_pool' in locals(): app_pool.close()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
