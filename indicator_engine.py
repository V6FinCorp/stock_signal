import asyncio
import aiomysql
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
        'EMA': {'period': 20, 'enabled': True},
        'SUPERTREND': {'period': 10, 'mult': 3.0, 'enabled': True},
        'DMA': {'periods': [10, 20, 50, 200], 'enabled': True}
    },
    'intraday': {
        'RSI': {'period': 14, 'ob': 80, 'os': 20, 'enabled': True},
        'EMA': {'period': 9, 'enabled': True},
        'SUPERTREND': {'period': 10, 'mult': 2.5, 'enabled': True},
        'DMA': {'periods': [10, 20], 'enabled': False}
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
        
    # EMA
    if settings['EMA']['enabled']:
        ema_len = settings['EMA']['period']
        df[f'EMA_{ema_len}'] = ta.ema(df['close'], length=ema_len)
        
    # DMA (Simple Moving Averages)
    if settings['DMA']['enabled']:
        for p in settings['DMA']['periods']:
            df[f'SMA_{p}'] = ta.sma(df['close'], length=p)
            
    # SUPERTREND
    if settings['SUPERTREND']['enabled']:
        st_len = settings['SUPERTREND']['period']
        st_mult = settings['SUPERTREND']['mult']
        # Pandas-TA Supertrend returns a DataFrame: SUPERT_length_mult, SUPERTd_length_mult, SUPERTl_length_mult, SUPERTs_length_mult
        st_df = ta.supertrend(df['high'], df['low'], df['close'], length=st_len, multiplier=st_mult)
        if st_df is not None and not st_df.empty:
            df['ST_value'] = st_df[f'SUPERT_{st_len}_{st_mult}']
            df['ST_dir'] = st_df[f'SUPERTd_{st_len}_{st_mult}'] # 1 for BUY, -1 for SELL
        
    return df.iloc[-1] # Return the latest row

async def process_profile(pool, datamart_pool, profile_id, timeframe):
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
                if len(rows) < 14: # Minimum rows for basic RSI
                    continue
                    
                df = pd.DataFrame(rows)
                df[['open', 'high', 'low', 'close']] = df[['open', 'high', 'low', 'close']].astype(float)
                
                # Resampling Logic
                if timeframe != base_timeframe:
                    df['timestamp'] = pd.to_datetime(df['timestamp'])
                    df = df.sort_values('timestamp')
                    df.set_index('timestamp', inplace=True)
                    
                    resample_rule = {
                        '1w': 'W-FRI',
                        '1mo': 'ME',
                        '15m': '15min',
                        '30m': '30min',
                        '60m': '60min'
                    }.get(timeframe)
                    
                    df = df.resample(resample_rule).agg({
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
                if settings['RSI']['enabled']:
                    rsi_col = f"RSI_{settings['RSI']['period']}"
                    rsi_val = float(latest_data[rsi_col]) if rsi_col in latest_data and pd.notna(latest_data[rsi_col]) else None
                
                ema_val = None
                if settings['EMA']['enabled']:
                    ema_col = f"EMA_{settings['EMA']['period']}"
                    ema_val = float(latest_data[ema_col]) if ema_col in latest_data and pd.notna(latest_data[ema_col]) else None
                    
                st_value = None
                st_dir = None
                if settings['SUPERTREND']['enabled'] and 'ST_value' in latest_data:
                    st_value = float(latest_data['ST_value']) if pd.notna(latest_data['ST_value']) else None
                    st_dir_num = latest_data.get('ST_dir')
                    if pd.notna(st_dir_num):
                        st_dir = 'BUY' if st_dir_num == 1 else 'SELL'
                        
                dma_data = {}
                if settings['DMA']['enabled']:
                    for p in settings['DMA']['periods']:
                        sma_col = f"SMA_{p}"
                        if sma_col in latest_data and pd.notna(latest_data[sma_col]):
                            dma_data[f"SMA_{p}"] = float(latest_data[sma_col])
                
                # --- Confluence Ranking Logic ---
                # Example basic logic: 
                # +1 if Price > EMA
                # +1 if Supertrend is BUY
                # +1 if RSI > 50 (bullish momemtum)
                # +1 if Price > DMA(20)
                rank = 0
                if ema_val and ltp > ema_val: rank += 1
                if st_dir == 'BUY': rank += 1
                if rsi_val and rsi_val > 50: rank += 1
                if dma_data and dma_data.get('SMA_20') and ltp > dma_data.get('SMA_20'): rank += 1

                signals_to_insert.append((
                    isin, profile_id, timeframe, timestamp, ltp, rsi_val, ema_val, 
                    st_dir, st_value, json.dumps(dma_data), rank
                ))
            
            # Upsert into database
            if signals_to_insert:
                upsert_query = """
                    INSERT INTO app_sg_calculated_signals 
                    (isin, profile_id, timeframe, timestamp, ltp, rsi, ema_value, supertrend_dir, supertrend_value, dma_data, confluence_rank)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        timestamp=VALUES(timestamp), ltp=VALUES(ltp), rsi=VALUES(rsi), ema_value=VALUES(ema_value),
                        supertrend_dir=VALUES(supertrend_dir), supertrend_value=VALUES(supertrend_value),
                        dma_data=VALUES(dma_data), confluence_rank=VALUES(confluence_rank)
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

    # Process Swing Mode (Daily data)
    await process_profile(pool, datamart_pool, 'swing', '1d')
    await process_profile(pool, datamart_pool, 'swing', '1w')
    await process_profile(pool, datamart_pool, 'swing', '1mo')
    
    # Process Intraday Mode (5m data)
    await process_profile(pool, datamart_pool, 'intraday', '5m')
    await process_profile(pool, datamart_pool, 'intraday', '15m')
    await process_profile(pool, datamart_pool, 'intraday', '30m')
    await process_profile(pool, datamart_pool, 'intraday', '60m')

    pool.close()
    datamart_pool.close()
    await pool.wait_closed()
    await datamart_pool.wait_closed()
    logging.info("Indicator Engine run complete.")

if __name__ == "__main__":
    asyncio.run(main())
