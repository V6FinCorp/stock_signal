import asyncio
import aiomysql
import pandas as pd
import numpy as np
np.NaN = np.nan
import pandas_ta as ta
import json
import logging
from datetime import timedelta

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

async def fetch_ohlcv_data(cur, isin, base_timeframe, start_date, end_date):
    """Fetches OHLCV data with some buffer for indicator warmup (e.g. 30 days buffer)"""
    # Assuming start_date is a string 'YYYY-MM-DD'
    # We fetch extra days before start_date for warmup
    query = """
        SELECT timestamp, open, high, low, close, volume 
        FROM app_sg_ohlcv_prices 
        WHERE isin = %s AND timeframe = %s 
        AND timestamp >= DATE_SUB(%s, INTERVAL 30 DAY) AND timestamp <= %s
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

def prepare_indicators(df_5m, df_primary, primary_tf, action):
    # Calculate Supertrends
    st_5m = ta.supertrend(df_5m['high'], df_5m['low'], df_5m['close'], length=10, multiplier=3.0)
    if st_5m is not None:
        df_5m['ST_5m_dir'] = st_5m['SUPERTd_10_3.0']

    # For primary timeframe (e.g. 15m), calculate RSI and Supertrend
    df_primary['RSI'] = ta.rsi(df_primary['close'], length=14)
    st_primary = ta.supertrend(df_primary['high'], df_primary['low'], df_primary['close'], length=10, multiplier=3.0)
    if st_primary is not None:
        df_primary['ST_primary_dir'] = st_primary['SUPERTd_10_3.0']

    # Map the primary timeframe indicators back onto the 5m timeframe using forward fill
    # This simulates "what was the last closed 15m candle's RSI at this 5m candle"
    df_primary_subset = df_primary[['timestamp', 'RSI', 'ST_primary_dir']].copy()
    
    # We shift the primary indicators by 1 so we don't look ahead. 
    # e.g. The 10:15 candle finishes at 10:15, so between 10:15 and 10:30 we use the 10:15 RSI.
    df_primary_subset['RSI'] = df_primary_subset['RSI'].shift(1)
    df_primary_subset['ST_primary_dir'] = df_primary_subset['ST_primary_dir'].shift(1)

    df_combined = pd.merge_asof(
        df_5m, 
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

    # 1. Map Symbol to ISIN
    isins_to_test = {}
    async with datamart_pool.acquire() as dm_conn:
        async with dm_conn.cursor() as dm_cur:
            if target_symbol and target_symbol.upper() != "ALL":
                await dm_cur.execute("SELECT bs_ISIN, bs_SYMBOL FROM vw_e_bs_companies_all WHERE bs_SYMBOL = %s", (target_symbol,))
            else:
                await dm_cur.execute("SELECT bs_ISIN, bs_SYMBOL FROM vw_e_bs_companies_favourite_indices")
            rows = await dm_cur.fetchall()
            for row in rows:
                isins_to_test[row[0]] = row[1]
                
    if not isins_to_test:
        return {"status": "error", "message": "No matching symbols found."}

    results = []

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
                
                df_sim = prepare_indicators(df_base, df_primary, params['primary_tf'], action)
                
                # Filter strictly by start_date to ignore warmup
                df_sim = df_sim[df_sim['timestamp'] >= pd.to_datetime(params['start_date'])].copy()

                # Simulation Variables
                pos_open = False
                pos_tranches = 0
                entry_points = []
                avg_entry = 0.0
                
                for idx, row in df_sim.iterrows():
                    current_price = row['close']
                    ts = row['timestamp']
                    rsi = row['RSI']
                    
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
                                pos_tranches = 1
                                entry_points = [current_price]
                                avg_entry = current_price
                                
                                # Log Tranche 1
                                # logging.info(f"[{ts}] {symbol} Tranche 1 {action} at {current_price}")
                    else:
                        modifier = 1 if action == 'BUY' else -1
                        
                        # --- Check Stop Loss ---
                        sl_price = avg_entry * (1 - (sl_pct * modifier))
                        if (action == 'BUY' and current_price <= sl_price) or (action == 'SELL' and current_price >= sl_price):
                            # STOP LOSS HIT
                            pnl_pct = ((current_price - avg_entry) / avg_entry) * modifier * 100
                            results.append({
                                "timestamp": ts.isoformat(),
                                "symbol": symbol,
                                "action": f"{action} (Long)" if action=="BUY" else f"{action} (Short)",
                                "avg_entry": round(avg_entry, 2),
                                "tranches": pos_tranches,
                                "exit_price": round(current_price, 2),
                                "exit_trigger": "Stop Loss (-0.21%)",
                                "pnl_pct": round(pnl_pct, 4)
                            })
                            pos_open = False
                            continue
                            
                        # --- Check Scaling In (Tranche 2 & 3) ---
                        if pos_tranches == 1:
                            t2_price = avg_entry * (1 - (0.001 * modifier)) # 0.1% drop
                            if (action == 'BUY' and current_price <= t2_price) or (action == 'SELL' and current_price >= t2_price):
                                entry_points.append(current_price)
                                avg_entry = sum(entry_points) / len(entry_points) # Wait, it's 50% then 25%, weighting is complex
                                # Proper weighting: Base=50, T2=25 -> Weight=(50*E1 + 25*E2)/75
                                avg_entry = ((entry_points[0] * 0.50) + (current_price * 0.25)) / 0.75
                                pos_tranches = 2
                        elif pos_tranches == 2:
                            t3_price = entry_points[1] * (1 - (0.001 * modifier)) # Drop from T2
                            if (action == 'BUY' and current_price <= t3_price) or (action == 'SELL' and current_price >= t3_price):
                                entry_points.append(current_price)
                                avg_entry = ((entry_points[0] * 0.50) + (entry_points[1] * 0.25) + (current_price * 0.25))
                                pos_tranches = 3

                        # --- Check Target 1 (50% position) ---
                        # Simplification: For the ledger, if Target 1 hits, we log it and reset position for simplicity. 
                        # In a true partial exit, we'd log T1, scale down position, and wait for T2.
                        t1_hit = False
                        t1_price = avg_entry * (1 + (0.0049 * modifier))
                        st_5m_dir = row.get('ST_5m_dir')
                        if (action == 'BUY' and current_price >= t1_price) or (action == 'SELL' and current_price <= t1_price):
                            t1_hit = True
                        elif st_5m_dir is not None:
                            if action == 'BUY' and st_5m_dir == -1: t1_hit = True
                            if action == 'SELL' and st_5m_dir == 1: t1_hit = True
                            
                        if t1_hit:
                            pnl_pct = ((current_price - avg_entry) / avg_entry) * modifier * 100
                            results.append({
                                "timestamp": ts.isoformat(),
                                "symbol": symbol,
                                "action": f"{action} (Long)" if action=="BUY" else f"{action} (Short)",
                                "avg_entry": round(avg_entry, 2),
                                "tranches": pos_tranches,
                                "exit_price": round(current_price, 2),
                                "exit_trigger": "Target 1 (0.49%) OR ST 5m Break",
                                "pnl_pct": round(pnl_pct, 4)
                            })
                            pos_open = False # Closing whole position for ledger clarity in V1
                            continue

    return {"status": "success", "data": results}
