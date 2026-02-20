-- Database Creation for App Layer
-- Using existing database u246664456_eqt_stage

-- 1. Profiles Table (swing vs intraday)
CREATE TABLE IF NOT EXISTS app_sg_profiles (
    profile_id VARCHAR(20) PRIMARY KEY,
    watchlist_method ENUM('TOP_VOLUME', 'MANUAL') DEFAULT 'MANUAL',
    top_n INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert default profiles
INSERT IGNORE INTO app_sg_profiles (profile_id, watchlist_method, top_n) VALUES 
('swing', 'MANUAL', 5000),
('intraday', 'MANUAL', 200);

-- 2. Indicator Settings Table
CREATE TABLE IF NOT EXISTS app_sg_indicator_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    profile_id VARCHAR(20),
    indicator_key VARCHAR(50) NOT NULL, -- e.g., 'RSI', 'SUPERTREND', 'EMA', 'DMA'
    is_enabled BOOLEAN DEFAULT TRUE,
    params_json JSON, -- Stores dynamic parameters like {"period": 14, "ob": 70, "os": 30}
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (profile_id) REFERENCES app_sg_profiles(profile_id) ON DELETE CASCADE,
    UNIQUE KEY unique_profile_indicator (profile_id, indicator_key)
);

-- 3. OHLCV Prices Table (Option A: No Foreign Key to external companies table)
CREATE TABLE IF NOT EXISTS app_sg_ohlcv_prices (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    isin VARCHAR(20),
    timeframe VARCHAR(10) NOT NULL, -- '1d', '5m', '15m', etc.
    timestamp DATETIME NOT NULL,
    open DECIMAL(10, 4),
    high DECIMAL(10, 4),
    low DECIMAL(10, 4),
    close DECIMAL(10, 4),
    volume BIGINT,
    UNIQUE KEY unique_candle (isin, timeframe, timestamp),
    INDEX idx_isin_timeframe (isin, timeframe) -- Added index for faster querying without FK
);

-- 4. Calculated Signals Table (Option A: No Foreign Key to external companies table)
CREATE TABLE IF NOT EXISTS app_sg_calculated_signals (
    isin VARCHAR(20),
    profile_id VARCHAR(20),
    timeframe VARCHAR(10) NOT NULL,
    timestamp DATETIME NOT NULL,
    ltp DECIMAL(10, 4),
    rsi DECIMAL(10, 4),
    ema_value DECIMAL(10, 4),
    supertrend_dir ENUM('BUY', 'SELL'),
    supertrend_value DECIMAL(10, 4),
    dma_data JSON, -- Stores multiple DMA values
    confluence_rank INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (isin, profile_id, timeframe),
    FOREIGN KEY (profile_id) REFERENCES app_sg_profiles(profile_id) ON DELETE CASCADE,
    INDEX idx_isin (isin) -- Added index for faster querying
);
