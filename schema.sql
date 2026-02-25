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
    ema_signal ENUM('BUY', 'SELL', 'NEUTRAL'),
    ema_fast DECIMAL(10, 4),
    ema_slow DECIMAL(10, 4),
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

-- 5. Strategy Builder Tables --
CREATE TABLE IF NOT EXISTS app_user_strategies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_strategy_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    strategy_id INT NOT NULL,
    rule_type ENUM('ENTRY', 'EXIT') NOT NULL,
    indicator VARCHAR(50) NOT NULL,
    operator ENUM('>', '<', '=', '>=', '<=', 'CROSSES_ABOVE', 'CROSSES_BELOW') NOT NULL,
    value VARCHAR(50) NOT NULL,
    FOREIGN KEY (strategy_id) REFERENCES app_user_strategies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_trade_parameters (
    strategy_id INT PRIMARY KEY,
    stop_loss_pct DECIMAL(5, 2) DEFAULT 2.00,
    take_profit_pct DECIMAL(5, 2) DEFAULT 5.00,
    FOREIGN KEY (strategy_id) REFERENCES app_user_strategies(id) ON DELETE CASCADE
);

-- Insert Default Strategies
INSERT IGNORE INTO app_user_strategies (id, name, description, is_default) VALUES 
(1, 'Momentum Burst', 'Buys when Supertrend is green and RSI is above 60 indicating strong momentum.', TRUE),
(2, 'Pullback to Support', 'Looks for oversold conditions (RSI < 40) while price is above the 50 DMA.', TRUE),
(3, 'Golden Cross', 'Classic trend-following strategy when Fast EMA crosses above Slow EMA.', TRUE);

INSERT IGNORE INTO app_strategy_rules (strategy_id, rule_type, indicator, operator, value) VALUES 
(1, 'ENTRY', 'SUPERTREND', '=', 'BUY'),
(1, 'ENTRY', 'RSI', '>', '60'),
(1, 'EXIT', 'SUPERTREND', '=', 'SELL'),
(2, 'ENTRY', 'RSI', '<', '40'),
(2, 'ENTRY', 'PRICE_DMA', '>', '50'),
(2, 'EXIT', 'RSI', '>', '70'),
(3, 'ENTRY', 'EMA_SIGNAL', '=', 'BUY'),
(3, 'EXIT', 'EMA_SIGNAL', '=', 'SELL');

INSERT IGNORE INTO app_trade_parameters (strategy_id, stop_loss_pct, take_profit_pct) VALUES 
(1, 3.00, 6.00),
(2, 2.00, 5.00),
(3, 4.00, 10.00);
