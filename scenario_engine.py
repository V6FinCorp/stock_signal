import asyncio
import aiomysql
import pandas as pd
import numpy as np
np.NaN = np.nan
import pandas_ta as ta
import json
import logging
from datetime import timedelta
from indicator_engine import get_profile_settings

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

async def fetch_ohlcv_data(cur, isin, base_timeframe, start_date, end_date):
    """Fetches OHLCV data with some buffer for indicator warmup (e.g. 30 days buffer)"""
    # Assuming start_date is a string 'YYYY-MM-DD'
    # We fetch extra days before start_date for warmup
    query = """
        SELECT timestamp, open, high, low, close, volume 
        FROM app_sg_ohlcv_prices 
        WHERE isin = %s AND timeframe = %s 
        AND timestamp >= DATE_SUB(%s, INTERVAL 365 DAY) AND timestamp <= %s
        ORDER BY timestamp ASC
    """
    await cur.execute(query, (isin, base_timeframe, start_date, f"{end_date} 23:59:59"))
    rows = await cur.fetchall()
    return rows

def resample_data(df, tf_rule):
    df_resampled = df.resample(tf_rule, on='timestamp').agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum'
    }).dropna()
    df_resampled.reset_index(inplace=True)
    return df_resampled

def prepare_indicators(df_base, df_primary, settings):
    # Calculate Supertrend for base (e.g. 5m)
    st_p = settings['SUPERTREND']['period']
    st_m = settings['SUPERTREND']['mult']
    
    st_base = ta.supertrend(df_base['high'], df_base['low'], df_base['close'], length=st_p, multiplier=st_m)
    if st_base is not None and not st_base.empty:
        # Col 1 is direction (1 for buy, -1 for sell)
        df_base['ST_5m_dir'] = st_base.iloc[:, 1]
    
    # Calculate RSI and Supertrend for Primary (resampled) timeframe
    rsi_p = settings['RSI']['period']
    df_primary['RSI'] = ta.rsi(df_primary['close'], length=rsi_p)
    
    st_primary = ta.supertrend(df_primary['high'], df_primary['low'], df_primary['close'], length=st_p, multiplier=st_m)
    if st_primary is not None and not st_primary.empty:
        df_primary['ST_primary_dir'] = st_primary.iloc[:, 1] # Direction
        df_primary['ST_primary_val'] = st_primary.iloc[:, 0] # Supertrend Line

    # Map the primary timeframe indicators back onto the base timeframe
    df_primary_subset = df_primary[['timestamp', 'RSI', 'ST_primary_dir', 'ST_primary_val']].copy()
    
    # Shift to ensure low-timeframe bars only see the COMPLETED previous primary bar
    # (Avoids look-ahead bias during merging)
    df_primary_subset[['RSI', 'ST_primary_dir', 'ST_primary_val']] = df_primary_subset[['RSI', 'ST_primary_dir', 'ST_primary_val']].shift(1)

    df_combined = pd.merge_asof(
        df_base, 
        df_primary_subset, 
        on='timestamp', 
        direction='backward'
    )
    return df_combined

async def run_scenario_backtest(pool, datamart_pool, params):
    """
    params:
    - symbol: Optional string
    - start_date: 'YYYY-MM-DD'
    - end_date: 'YYYY-MM-DD'
    - primary_tf: '15m'
    - base_tf: '5m'
    - action: 'BUY' or 'SELL'
    - rsi_min: 26 (for BUY)
    - rsi_max: 32 (for BUY)
    - stop_loss_pct: 0.21
    """
    base_tf = '5m' if params['primary_tf'] in ['15m', '30m'] else '1d' # For swing use 1d
    resample_rule = '15min' if params['primary_tf'] == '15m' else '30min' if params['primary_tf'] == '30m' else None
    
    action = params['action']
    sl_pct = params['stop_loss_pct'] / 100.0

    target_symbol = params.get('symbol')
    target_symbols = params.get('symbols', [])

    # 1. Map Symbol to ISIN
    isins_to_test = {}
    async with datamart_pool.acquire() as dm_conn:
        async with dm_conn.cursor() as dm_cur:
            if target_symbol and target_symbol.upper() != "ALL":
                await dm_cur.execute("SELECT bs_ISIN, bs_SYMBOL FROM vw_e_bs_companies_all WHERE bs_SYMBOL = %s", (target_symbol,))
            elif target_symbols and len(target_symbols) > 0:
                # Limit to prevent massive queries if needed, though mostly IN is fine up to ~5k
                format_strings = ','.join(['%s'] * len(target_symbols))
                await dm_cur.execute(f"SELECT bs_ISIN, bs_SYMBOL FROM vw_e_bs_companies_all WHERE bs_SYMBOL IN ({format_strings})", tuple(target_symbols))
            else:
                await dm_cur.execute("SELECT bs_ISIN, bs_SYMBOL FROM vw_e_bs_companies_favourite_indices")
            rows = await dm_cur.fetchall()
            for row in rows:
                isins_to_test[row[0]] = row[1]
                
    if not isins_to_test:
        return {"status": "error", "message": "No matching symbols found."}

    results = []

    # Fetch Profile Settings
    profile_id = 'swing' if params['primary_tf'] in ['1d', '1w', '1mo'] else 'intraday'
    settings = await get_profile_settings(pool, profile_id)

    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            for isin, symbol in isins_to_test.items():
                logging.info(f"Running simulation for {symbol} ({isin})")
                rows = await fetch_ohlcv_data(cur, isin, base_tf, params['start_date'], params['end_date'])
                if not rows: continue
                
                df_base = pd.DataFrame(rows)
                df_base['open'] = df_base['open'].astype(float)
                df_base['high'] = df_base['high'].astype(float)
                df_base['low'] = df_base['low'].astype(float)
                df_base['close'] = df_base['close'].astype(float)
                df_base['timestamp'] = pd.to_datetime(df_base['timestamp'])
                
                if resample_rule:
                    df_primary = resample_data(df_base, resample_rule)
                else:
                    df_primary = df_base.copy()
                
                # Use dynamic settings here
                df_sim = prepare_indicators(df_base, df_primary, settings)
                
                # Filter strictly by start_date to ignore warmup
                df_sim = df_sim[df_sim['timestamp'] >= pd.to_datetime(params['start_date'])].copy()

                # Simulation Variables
                pos_open = False
                pos_qty = 0.0  # Percentage of current open position (Total weight)
                pos_tranches = 0
                entry_points = []
                avg_entry = 0.0
                t1_hit = False
                
                tr_weights = params.get('tranche_weights', [50.0, 25.0, 25.0])
                tr_prices = params.get('tranche_prices', [0.1, 0.1])
                t1_weight = params.get('t1_weight', 50.0)
                t2_weight = params.get('t2_weight', 50.0)
                t1_target_pnl = params.get('t1_price', 0.49) / 100.0
                t2_target_pnl = params.get('t2_price', 0.90) / 100.0

                for idx, row in df_sim.iterrows():
                    current_price = row['close']
                    ts = row['timestamp']
                    rsi = row['RSI']
                    st_5m_dir = row.get('ST_5m_dir')
                    st_primary_dir = row.get('ST_primary_dir')
                    
                    if not pos_open:
                        # Entry Trigger
                        if pd.notna(rsi):
                            trigger_met = False
                            if action == 'BUY' and params['rsi_min'] <= rsi <= params['rsi_max']:
                                trigger_met = True
                            elif action == 'SELL' and params['rsi_min'] <= rsi <= params['rsi_max']:
                                trigger_met = True
                                
                            if trigger_met:
                                pos_open = True
                                pos_qty = tr_weights[0]
                                pos_tranches = 1
                                entry_points = [current_price]
                                avg_entry = current_price
                                t1_hit = False
                    else:
                        modifier = 1 if action == 'BUY' else -1
                        
                        # --- Check Stop Loss (Priority) ---
                        sl_price = avg_entry * (1 - (sl_pct * modifier))
                        if (action == 'BUY' and current_price <= sl_price) or (action == 'SELL' and current_price >= sl_price):
                            pnl_pct = ((current_price - avg_entry) / avg_entry) * modifier * 100
                            results.append({
                                "timestamp": ts.isoformat(),
                                "symbol": symbol,
                                "action": f"{action} EXIT (SL)",
                                "avg_entry": round(avg_entry, 2),
                                "tranches": f"{pos_tranches} ({pos_qty}%)",
                                "exit_price": round(current_price, 2),
                                "exit_trigger": f"Stop Loss (-{params['stop_loss_pct']}%)",
                                "pnl_pct": round(pnl_pct * (pos_qty/100.0), 4) # Weighted P&L for remaining pos
                            })
                            pos_open = False
                            continue
                            
                        # --- Check Scaling In (Tranche 2 & 3) ---
                        if pos_tranches == 1 and tr_weights[1] > 0:
                            t2_trigger_price = avg_entry * (1 - (tr_prices[0]/100.0 * modifier))
                            if (action == 'BUY' and current_price <= t2_trigger_price) or (action == 'SELL' and current_price >= t2_trigger_price):
                                entry_points.append(current_price)
                                # Weighted Average: (W1*E1 + W2*E2) / (W1+W2)
                                avg_entry = ((entry_points[0] * tr_weights[0]) + (current_price * tr_weights[1])) / (tr_weights[0] + tr_weights[1])
                                pos_qty += tr_weights[1]
                                pos_tranches = 2
                        elif pos_tranches == 2 and tr_weights[2] > 0:
                            t3_trigger_price = entry_points[1] * (1 - (tr_prices[1]/100.0 * modifier))
                            if (action == 'BUY' and current_price <= t3_trigger_price) or (action == 'SELL' and current_price >= t3_trigger_price):
                                entry_points.append(current_price)
                                # Weighted Average: (W1*E1 + W2*E2 + W3*E3) / (W1+W2+W3)
                                avg_entry = ((entry_points[0] * tr_weights[0]) + (entry_points[1] * tr_weights[1]) + (current_price * tr_weights[2])) / (tr_weights[0] + tr_weights[1] + tr_weights[2])
                                pos_qty += tr_weights[2]
                                pos_tranches = 3

                        # --- Check Target 1 ---
                        if not t1_hit and t1_weight > 0:
                            t1_price = avg_entry * (1 + (t1_target_pnl * modifier))
                            t1_triggered = False
                            
                            if (action == 'BUY' and current_price >= t1_price) or (action == 'SELL' and current_price <= t1_price):
                                t1_triggered = True
                                t1_reason = f"Target 1 ({params['t1_price']}%)"
                            elif st_5m_dir is not None:
                                if action == 'BUY' and st_5m_dir == 1:
                                    t1_triggered = True
                                    t1_reason = "ST 5m Break (Bullish)"
                                elif action == 'SELL' and st_5m_dir == -1:
                                    t1_triggered = True
                                    t1_reason = "ST 5m Break (Bearish)"
                            
                            if t1_triggered:
                                t1_hit = True
                                pnl_pct = ((current_price - avg_entry) / avg_entry) * modifier * 100
                                results.append({
                                    "timestamp": ts.isoformat(),
                                    "symbol": symbol,
                                    "action": f"{action} T1",
                                    "avg_entry": round(avg_entry, 2),
                                    "tranches": f"{pos_tranches} ({t1_weight}%)",
                                    "exit_price": round(current_price, 2),
                                    "exit_trigger": t1_reason,
                                    "pnl_pct": round(pnl_pct * (t1_weight/100.0), 4)
                                })
                                pos_qty -= t1_weight
                                if pos_qty <= 0:
                                    pos_open = False
                                    continue
                        
                        # --- Check Target 2 ---
                        if t1_hit and t2_weight > 0:
                            t2_price = avg_entry * (1 + (t2_target_pnl * modifier))
                            t2_triggered = False
                            
                            if (action == 'BUY' and current_price >= t2_price) or (action == 'SELL' and current_price <= t2_price):
                                t2_triggered = True
                                t2_reason = f"Target 2 ({params['t2_price']}%)"
                            elif st_primary_dir is not None:
                                if action == 'BUY' and st_primary_dir == 1:
                                    t2_triggered = True
                                    t2_reason = f"ST {params['primary_tf']} Break (Bullish)"
                                elif action == 'SELL' and st_primary_dir == -1:
                                    t2_triggered = True
                                    t2_reason = f"ST {params['primary_tf']} Break (Bearish)"
                                    
                            if t2_triggered:
                                pnl_pct = ((current_price - avg_entry) / avg_entry) * modifier * 100
                                results.append({
                                    "timestamp": ts.isoformat(),
                                    "symbol": symbol,
                                    "action": f"{action} T2",
                                    "avg_entry": round(avg_entry, 2),
                                    "tranches": f"{pos_tranches} ({t2_weight}%)",
                                    "exit_price": round(current_price, 2),
                                    "exit_trigger": t2_reason,
                                    "pnl_pct": round(pnl_pct * (t2_weight/100.0), 4)
                                })
                                pos_open = False # Fully closed
                                continue

    return {"status": "success", "data": results}
