import asyncio
import aiomysql
from datetime import datetime
import pandas as pd
import numpy as np
# Fix for pandas_ta compatibility with NumPy 2.0+
np.NaN = np.nan
import pandas_ta as ta
import json
import logging
from config import Config

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Default configurations in case the database settings are empty
DEFAULT_CONFIGS = {
    'swing': {
        'RSI': {'period': 14, 'ob': 70, 'os': 30, 'enabled': True},
        'EMA': {'fast_period': 9, 'slow_period': 20, 'enabled': True},
        'SUPERTREND': {'period': 10, 'mult': 3.0, 'enabled': True},
        'ATR': {'period': 14, 'enabled': True},
        'DMA': {'periods': [10, 20, 50, 200], 'enabled': True},
        'VOLUME': {'period': 20, 'threshold': 2.0, 'enabled': True},
        'patterns': {'enabled': True, 'bullish': True, 'bearish': True, 'neutral': False}
    },
    'intraday': {
        'RSI': {'period': 14, 'ob': 80, 'os': 20, 'enabled': True},
        'EMA': {'fast_period': 9, 'slow_period': 21, 'enabled': True},
        'SUPERTREND': {'period': 10, 'mult': 2.5, 'enabled': True},
        'ATR': {'period': 14, 'enabled': True},
        'DMA': {'periods': [10, 20], 'enabled': False},
        'VOLUME': {'period': 20, 'threshold': 1.5, 'enabled': True},
        'patterns': {'enabled': True, 'bullish': True, 'bearish': True, 'neutral': False}
    }
}

async def get_profile_settings(pool, profile_id):
    """Retrieve indicator settings for a profile, or use defaults."""
    settings = DEFAULT_CONFIGS[profile_id].copy()
    
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT indicator_key, is_enabled, params_json FROM app_sg_indicator_settings WHERE profile_id = %s",
                (profile_id,)
            )
            rows = await cur.fetchall()
            
            for row in rows:
                key = row['indicator_key']
                if key in settings:
                    settings[key]['enabled'] = bool(row['is_enabled'])
                    if row['params_json']:
                        try:
                            params = json.loads(row['params_json'])
                            settings[key].update(params)
                        except json.JSONDecodeError:
                            pass
    return settings

def calculate_indicators(df, settings):
    """Calculate technical indicators using pandas-ta."""
    # Ensure dataframe is sorted by timestamp
    df = df.sort_values(by='timestamp').copy()
    
    # RSI
    if settings['RSI']['enabled']:
        rsi_len = settings['RSI']['period']
        df[f'RSI_{rsi_len}'] = ta.rsi(df['close'], length=rsi_len)
        
        # Calculate RSI Day High/Low
        # Filter for the latest day available in the df
        if not df.empty and 'timestamp' in df.columns:
            # Ensure 'timestamp' is datetime type for .dt accessor
            if not pd.api.types.is_datetime64_any_dtype(df['timestamp']):
                df['timestamp'] = pd.to_datetime(df['timestamp'])
            latest_date = df['timestamp'].max().date()
            day_mask = df['timestamp'].dt.date == latest_date
            rsi_today = df.loc[day_mask, f'RSI_{rsi_len}']
            df['RSI_day_high'] = rsi_today.max()
            df['RSI_day_low'] = rsi_today.min()
        
    # EMA (Fast/Slow Crossover)
    if settings['EMA']['enabled']:
        fast_len = settings['EMA']['fast_period']
        slow_len = settings['EMA']['slow_period']
        
        df[f'EMA_{fast_len}'] = ta.ema(df['close'], length=fast_len)
        df[f'EMA_{slow_len}'] = ta.ema(df['close'], length=slow_len)
        
        # Determine signal based on current values
        # We can also detect crossover by comparing with previous values if we wanted to
        # For simplicity, BUY if Fast > Slow, else SELL
        df['ema_signal'] = np.where(df[f'EMA_{fast_len}'] > df[f'EMA_{slow_len}'], 'BUY', 'SELL')
        
    # DMA (Simple Moving Averages)
    # (DMA is explicitly handled in process_profile to remain anchored to the 1d timeframe)
            
    # SUPERTREND
    if settings.get('SUPERTREND', {}).get('enabled'):
        st_len = settings['SUPERTREND']['period']
        st_mult = settings['SUPERTREND']['mult']
        # Pandas-TA Supertrend returns a DataFrame with dynamic column names
        st_df = ta.supertrend(df['high'], df['low'], df['close'], length=st_len, multiplier=st_mult)
        if st_df is not None and not st_df.empty:
            # Use iloc to get the columns by position to avoid dynamic name issues
            # Col 0: Supertrend, Col 1: Direction
            df['ST_value'] = st_df.iloc[:, 0]
            df['ST_dir'] = st_df.iloc[:, 1] # 1 for BUY, -1 for SELL

    # ATR (Average True Range)
    if settings.get('ATR', {}).get('enabled'):
        atr_len = settings['ATR']['period']
        df['ATR_value'] = ta.atr(df['high'], df['low'], df['close'], length=atr_len)

    # VOLUME SPIKE
    if settings.get('VOLUME', {}).get('enabled'):
        vol_len = settings['VOLUME']['period']
        vol_threshold = settings['VOLUME']['threshold']
        df['vol_sma'] = df['volume'].rolling(window=vol_len).mean()
        df['vol_ratio'] = df['volume'] / df['vol_sma']
        
        # Bull spike: Ratio > threshold AND current close > current open
        # Bear spike: Ratio > threshold AND current close < current open
        df['vol_signal'] = 'NORMAL'
        df.loc[(df['vol_ratio'] > vol_threshold) & (df['close'] > df['open']), 'vol_signal'] = 'BULL_SPIKE'
        df.loc[(df['vol_ratio'] > vol_threshold) & (df['close'] < df['open']), 'vol_signal'] = 'BEAR_SPIKE'
        
    # CANDLESTICK PATTERNS
    if settings.get('patterns', {}).get('enabled'):
        try:
            cdl_df = df.ta.cdl_pattern(name="all")
            if cdl_df is not None and not cdl_df.empty:
                for col in cdl_df.columns:
                    df[col] = cdl_df[col]
        except Exception:
            pass
            
    return df.iloc[-1] # Return the latest row

async def process_profile(pool, datamart_pool, profile_id, timeframe, shared_cache=None):
    if shared_cache is None:
        shared_cache = {}
    logging.info(f"--- Processing Profile: {profile_id.upper()} (Timeframe: {timeframe}) ---")
    settings = await get_profile_settings(pool, profile_id)
    
    # 1. Fetch exactly the 50 Favourite Companies from Datamart DB
    favourite_symbols = set()
    try:
        async with datamart_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT bs_symbol FROM vw_e_bs_companies_favourite_indices")
                rows = await cur.fetchall()
                favourite_symbols = {row[0] for row in rows}
    except Exception as e:
        logging.error(f"Failed to fetch favourite indices from Datamart: {e}")
        return
        
    if not favourite_symbols:
        logging.warning("No favourite indices found in Datamart. Aborting calculation.")
        return

    # Determine base timeframe to fetch raw data 
    if timeframe in ['1w', '1mo']:
        base_timeframe = '1d'
    elif timeframe in ['15m', '30m', '60m']:
        base_timeframe = '5m'
    else:
        base_timeframe = timeframe

    # 2. Connect to App DB and process JUST those companies
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # We need to map available ISINs to their symbols to do the intersection
            await cur.execute("SELECT DISTINCT isin FROM app_sg_ohlcv_prices WHERE timeframe = %s", (base_timeframe,))
            available_isins = {row['isin'] for row in await cur.fetchall()}
            
            # Map those ISINs back to Symbols using the Datamart DB
            isin_to_symbol = {}
            if available_isins:
                try:
                    async with datamart_pool.acquire() as dm_conn:
                        async with dm_conn.cursor(aiomysql.DictCursor) as dm_cur:
                            # Using executemany isn't applicable for SELECT IN, constructing batch query
                            format_strings = ','.join(['%s'] * len(available_isins))
                            await dm_cur.execute(f"SELECT bs_ISIN, bs_SYMBOL FROM vw_e_bs_companies_all WHERE bs_ISIN IN ({format_strings})", tuple(available_isins))
                            for row in await dm_cur.fetchall():
                                isin_to_symbol[row['bs_ISIN']] = row['bs_SYMBOL']
                except Exception as e:
                    pass
            
            # Intersection: Only keep ISINs where the mapped Symbol is in the Favourite Symbols list
            isins = [isin for isin in available_isins if isin_to_symbol.get(isin) in favourite_symbols]
            
            if not isins:
                logging.warning(f"No OHLCV data found for timeframe {timeframe}.")
                return
                
            logging.info(f"Found {len(isins)} stocks for {profile_id}. Calculating signals...")
            
            signals_to_insert = []
            
            for isin in isins:
                # Fetch recent historical data (increase limit if we are resampling to higher timeframes)
                limit = 1500 if timeframe in ['1w', '1mo'] else 400
                await cur.execute(
                    """
                    SELECT timestamp, open, high, low, close, volume 
                    FROM app_sg_ohlcv_prices 
                    WHERE isin = %s AND timeframe = %s 
                    ORDER BY timestamp DESC LIMIT %s
                    """,
                    (isin, base_timeframe, limit)
                )
                rows = await cur.fetchall()
                
                # --- Synthesis Logic for "Live Daily" Candle ---
                if timeframe == '1d' and rows:
                    latest_1d_ts = rows[0]['timestamp']
                    
                    # 1. Find the absolute latest date present in 5m data for this stock
                    await cur.execute(
                        "SELECT MAX(timestamp) as max_5m FROM app_sg_ohlcv_prices WHERE isin = %s AND timeframe = '5m'",
                        (isin,)
                    )
                    res_5m = await cur.fetchone()
                    if res_5m and res_5m['max_5m']:
                        latest_5m_ts = res_5m['max_5m']
                        latest_1d_ts = rows[0]['timestamp']

                        # 2. If 5m data is NEWER than our 1d data (even on same day), synthesize that day
                        if latest_5m_ts > latest_1d_ts:
                            # If they are on the same day, remove the 1d candle first to avoid duplicates
                            if latest_5m_ts.date() == latest_1d_ts.date():
                                rows.pop(0)
                            
                            latest_5m_date = latest_5m_ts.strftime("%Y-%m-%d")
                            await cur.execute(
                                """
                                SELECT timestamp, open, high, low, close, volume 
                                FROM app_sg_ohlcv_prices 
                                WHERE isin = %s AND timeframe = '5m' AND DATE(timestamp) = %s
                                ORDER BY timestamp ASC
                                """,
                                (isin, latest_5m_date)
                            )
                            intra_rows = await cur.fetchall()
                            if intra_rows:
                                live_candle = {
                                    'timestamp': datetime.strptime(latest_5m_date + " 00:00:00", "%Y-%m-%d %H:%M:%S"),
                                    'open': float(intra_rows[0]['open']),
                                    'high': max(float(r['high']) for r in intra_rows),
                                    'low': min(float(r['low']) for r in intra_rows),
                                    'close': float(intra_rows[-1]['close']),
                                    'volume': sum(int(r['volume']) for r in intra_rows)
                                }
                                rows.insert(0, live_candle)
                                logging.info(f"Synthesized live 1d candle for {isin} for date {latest_5m_date}")

                if len(rows) < 14: # Minimum rows for basic RSI
                    continue
                    
                df = pd.DataFrame(rows)
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                df = df.sort_values('timestamp').reset_index(drop=True)
                df[['open', 'high', 'low', 'close']] = df[['open', 'high', 'low', 'close']].astype(float)
                
                # Resampling Logic
                if timeframe != base_timeframe:
                    df.set_index('timestamp', inplace=True)
                    
                    resample_rule = {
                        '1w': 'W-FRI',
                        '1mo': 'ME',
                        '15m': '15min',
                        '30m': '30min',
                        '60m': '60min'
                    }.get(timeframe)
                    
                    resample_kwargs = {}
                    if timeframe in ['15m', '30m', '60m'] and pd.to_timedelta('15min') is not None:
                        resample_kwargs['offset'] = '15min'
                    
                    df = df.resample(resample_rule, **resample_kwargs).agg({
                        'open': 'first',
                        'high': 'max',
                        'low': 'min',
                        'close': 'last',
                        'volume': 'sum'
                    }).dropna()
                    df.reset_index(inplace=True)
                
                try:
                    latest_data = calculate_indicators(df, settings)
                except Exception as e:
                    logging.error(f"Error calculating indicators for {isin}: {e}")
                    continue
                
                # Extract values safely
                ltp = float(latest_data['close'])
                timestamp = latest_data['timestamp']
                
                rsi_val = None
                rsi_day_high = None
                rsi_day_low = None
                if settings['RSI']['enabled']:
                    rsi_col = f"RSI_{settings['RSI']['period']}"
                    rsi_val = float(latest_data[rsi_col]) if rsi_col in latest_data and pd.notna(latest_data[rsi_col]) else None
                    rsi_day_high = float(latest_data['RSI_day_high']) if 'RSI_day_high' in latest_data and pd.notna(latest_data['RSI_day_high']) else None
                    rsi_day_low = float(latest_data['RSI_day_low']) if 'RSI_day_low' in latest_data and pd.notna(latest_data['RSI_day_low']) else None
                
                ema_fast = None
                ema_slow = None
                ema_signal = None
                if settings['EMA']['enabled']:
                    f_len = settings['EMA']['fast_period']
                    s_len = settings['EMA']['slow_period']
                    ema_fast = float(latest_data[f'EMA_{f_len}']) if f'EMA_{f_len}' in latest_data and pd.notna(latest_data[f'EMA_{f_len}']) else None
                    ema_slow = float(latest_data[f'EMA_{s_len}']) if f'EMA_{s_len}' in latest_data and pd.notna(latest_data[f'EMA_{s_len}']) else None
                    ema_signal = latest_data.get('ema_signal')

                vol_signal = 'NORMAL'
                vol_ratio = 1.0
                if settings.get('VOLUME', {}).get('enabled'):
                    vol_signal = latest_data.get('vol_signal', 'NORMAL')
                    vol_ratio = float(latest_data.get('vol_ratio', 1.0))
                    
                st_value = None
                st_dir = None
                if settings['SUPERTREND']['enabled'] and 'ST_value' in latest_data:
                    st_value = float(latest_data['ST_value']) if pd.notna(latest_data['ST_value']) else None
                    st_dir_num = latest_data.get('ST_dir')
                    if pd.notna(st_dir_num):
                        st_dir = 'BUY' if st_dir_num == 1 else 'SELL'
                        
                # --- Anchored DMA Calculation (Always strictly Daily timeframe) ---
                dma_data = {}
                if settings['DMA']['enabled']:
                    # Check memory cache first to avoid repeating Pandas math for the exact same company
                    if isin in shared_cache and 'dma_data' in shared_cache[isin]:
                        dma_data = shared_cache[isin]['dma_data']
                    else:
                        await cur.execute(
                            "SELECT close FROM app_sg_ohlcv_prices WHERE isin = %s AND timeframe = '1d' ORDER BY timestamp DESC LIMIT 250",
                            (isin,)
                        )
                        rows_1d = await cur.fetchall()
                        if rows_1d:
                            df_1d = pd.DataFrame(rows_1d)
                            df_1d['close'] = df_1d['close'].astype(float)
                            # Reverse so oldest data is first (required for accurate moving average calculations)
                            df_1d = df_1d.iloc[::-1].reset_index(drop=True)
                            for p in settings['DMA']['periods']:
                                if len(df_1d) >= p:
                                    sma_series = ta.sma(df_1d['close'], length=p)
                                    if sma_series is not None and not pd.isna(sma_series.iloc[-1]):
                                        dma_data[f"SMA_{p}"] = float(sma_series.iloc[-1])
                        
                        # Save back to cache
                        if isin not in shared_cache:
                            shared_cache[isin] = {}
                        shared_cache[isin]['dma_data'] = dma_data

                # --- Candlestick Patterns ---
                pattern_str = None
                patterns_opts = settings.get('patterns', {})
                if patterns_opts.get('enabled'):
                    bullish_patterns = []
                    bearish_patterns = []
                    neutral_patterns = []
                    
                    bullish_cols = ['CDL_ENGULFING', 'CDL_HAMMER', 'CDL_MORNINGSTAR', 'CDL_PIERCING', 'CDL_MORNINGDOJISTAR', 'CDL_3WHITESOLDIERS', 'CDL_DRAGONFLYDOJI']
                    bearish_cols = ['CDL_ENGULFING', 'CDL_SHOOTINGSTAR', 'CDL_EVENINGSTAR', 'CDL_DARKCLOUDCOVER', 'CDL_EVENINGDOJISTAR', 'CDL_HANGINGMAN', 'CDL_3BLACKCROWS', 'CDL_GRAVESTONEDOJI']
                    neutral_cols = ['CDL_DOJI_10_0.1', 'CDL_SPINNINGTOP', 'CDL_HIGHWAVE', 'CDL_RICKSHAWMAN', 'CDL_LONGLEGGEDDOJI']
                    
                    for key, val in latest_data.items():
                        if not isinstance(key, str) or not key.startswith("CDL_") or pd.isna(val) or val == 0:
                            continue
                        
                        pattern_name = key.replace("CDL_", "").split("_")[0].title()
                        
                        if val > 0:
                            if key in neutral_cols:
                                neutral_patterns.append(pattern_name)
                            elif key in bearish_cols and key not in bullish_cols:
                                bearish_patterns.append(pattern_name)
                            else:
                                bullish_patterns.append(pattern_name)
                        elif val < 0:
                            if key in bullish_cols and key not in bearish_cols:
                                bullish_patterns.append(pattern_name)
                            else:
                                bearish_patterns.append(pattern_name)
                                
                    active_found = []
                    if patterns_opts.get('bullish') and bullish_patterns:
                        active_found.append("Bullish " + "/".join(bullish_patterns))
                    if patterns_opts.get('bearish') and bearish_patterns:
                        active_found.append("Bearish " + "/".join(bearish_patterns))
                    if patterns_opts.get('neutral') and neutral_patterns:
                        active_found.append("Neutral " + "/".join(neutral_patterns))
                        
                    if active_found:
                        pattern_str = " | ".join(active_found)
                
                # --- Confluence Ranking Logic ---
                # Example basic logic: 
                # +1 if Price > EMA
                # +1 if Supertrend is BUY
                # +1 if RSI > 50 (bullish momemtum)
                # +1 if Price > DMA(20)
                rank = 0
                if ema_fast and ema_slow and ema_fast > ema_slow: rank += 1
                if st_dir == 'BUY': rank += 1
                if rsi_val and rsi_val > 50: rank += 1
                if dma_data and dma_data.get('SMA_20') and ltp > dma_data.get('SMA_20'): rank += 1
                if vol_signal == 'BULL_SPIKE': rank += 1

                # --- Trade Plan Logic (Pick Stocks for Trade) ---
                sl = None
                target = None
                trade_strategy = "NORMAL"
                
                if st_dir == 'BUY':
                    # SL is the lower of Supertrend and EMA Slow (safer floor)
                    if st_value and ema_slow:
                        sl = min(st_value, ema_slow)
                    elif st_value:
                        sl = st_value
                    elif ema_slow:
                        sl = ema_slow
                        
                    if sl and sl < ltp:
                        risk = ltp - sl
                        target = ltp + (risk * 2.0) # 1:2 Reward
                elif st_dir == 'SELL':
                    # Shorting Trade Plan
                    if st_value and ema_slow:
                        sl = max(st_value, ema_slow)
                    elif st_value:
                        sl = st_value
                    elif ema_slow:
                        sl = ema_slow
                        
                    if sl and sl > ltp:
                        risk = sl - ltp
                        target = ltp - (risk * 2.0)
                
                # Pick Strategy Labels
                if rank >= 4 and vol_signal == 'BULL_SPIKE' and ema_signal == 'BUY' and st_dir == 'BUY':
                    trade_strategy = "PERFECT_BUY"
                elif st_dir == 'BUY' and dma_data:
                    # Pullback logic: Check if price is near major DMA (20, 50, or 200)
                    for dma_val in dma_data.values():
                        if 0.985 <= (ltp / dma_val) <= 1.015:
                            trade_strategy = "DMA_BOUNCE"
                            break
                
                # Overextended check
                if ema_slow and ltp > (ema_slow * 1.12):
                    trade_strategy = "OVEREXTENDED"

                # Last 5 candles visualizer
                last_5_candles = None
                if len(df) >= 5:
                    recent_5 = df.iloc[-5:]
                    candles_list = []
                    for _, r in recent_5.iterrows():
                        candles_list.append({
                            "t": str(r['timestamp']),
                            "o": float(r['open']),
                            "h": float(r['high']),
                            "l": float(r['low']),
                            "c": float(r['close'])
                        })
                    last_5_candles = json.dumps(candles_list)

                signals_to_insert.append((
                    isin, profile_id, timeframe, timestamp, ltp, rsi_val, 
                    rsi_day_high, rsi_day_low,
                    ema_signal, ema_fast, ema_slow, 
                    vol_signal, vol_ratio,
                    ema_fast, # Using ema_fast as legacy ema_value
                    st_dir, st_value, json.dumps(dma_data), rank,
                    sl, target, trade_strategy, pattern_str, last_5_candles
                ))
            
            # Upsert into database
            if signals_to_insert:
                upsert_query = """
                    INSERT INTO app_sg_calculated_signals 
                    (isin, profile_id, timeframe, timestamp, ltp, rsi, rsi_day_high, rsi_day_low, ema_signal, ema_fast, ema_slow, volume_signal, volume_ratio, ema_value, supertrend_dir, supertrend_value, dma_data, confluence_rank, sl, target, trade_strategy, candlestick_pattern, last_5_candles)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        timestamp=VALUES(timestamp), ltp=VALUES(ltp), rsi=VALUES(rsi), 
                        rsi_day_high=VALUES(rsi_day_high), rsi_day_low=VALUES(rsi_day_low),
                        ema_signal=VALUES(ema_signal), ema_fast=VALUES(ema_fast), ema_slow=VALUES(ema_slow),
                        volume_signal=VALUES(volume_signal), volume_ratio=VALUES(volume_ratio),
                        ema_value=VALUES(ema_value),
                        supertrend_dir=VALUES(supertrend_dir), supertrend_value=VALUES(supertrend_value),
                        dma_data=VALUES(dma_data), confluence_rank=VALUES(confluence_rank),
                        sl=VALUES(sl), target=VALUES(target), trade_strategy=VALUES(trade_strategy),
                        candlestick_pattern=VALUES(candlestick_pattern),
                        last_5_candles=VALUES(last_5_candles)
                """
                await cur.executemany(upsert_query, signals_to_insert)
                logging.info(f"✅ Successfully updated {len(signals_to_insert)} signals for {profile_id} ({timeframe}).")

async def main():
    logging.info("Starting Indicator Engine (Testing Phase - Favourites Only)...")
    try:
        pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
    except Exception as e:
        logging.error(f"Failed to connect to Databases: {e}")
        return

    # Initialize memory caching object
    shared_cache = {}

    # Process Swing Mode (Daily data)
    await process_profile(pool, datamart_pool, 'swing', '1d', shared_cache)
    await process_profile(pool, datamart_pool, 'swing', '1w', shared_cache)
    await process_profile(pool, datamart_pool, 'swing', '1mo', shared_cache)
    
    # Process Intraday Mode (5m data)
    await process_profile(pool, datamart_pool, 'intraday', '5m', shared_cache)
    await process_profile(pool, datamart_pool, 'intraday', '15m', shared_cache)
    await process_profile(pool, datamart_pool, 'intraday', '30m', shared_cache)
    await process_profile(pool, datamart_pool, 'intraday', '60m', shared_cache)

    pool.close()
    datamart_pool.close()
    await pool.wait_closed()
    await datamart_pool.wait_closed()
    logging.info("Indicator Engine run complete.")

if __name__ == "__main__":
    asyncio.run(main())
