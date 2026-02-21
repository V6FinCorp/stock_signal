-- Strategy Builder Schema --

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
    indicator VARCHAR(50) NOT NULL, -- e.g., 'RSI', 'EMA_FAST_SLOW', 'SUPERTREND', 'PRICE_DMA'
    operator ENUM('>', '<', '=', '>=', '<=', 'CROSSES_ABOVE', 'CROSSES_BELOW') NOT NULL,
    value VARCHAR(50) NOT NULL, -- The value to compare against, e.g., '70', 'BUY', or 'EMA_SLOW'
    FOREIGN KEY (strategy_id) REFERENCES app_user_strategies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_trade_parameters (
    strategy_id INT PRIMARY KEY,
    stop_loss_pct DECIMAL(5, 2) DEFAULT 2.00,
    take_profit_pct DECIMAL(5, 2) DEFAULT 5.00,
    FOREIGN KEY (strategy_id) REFERENCES app_user_strategies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_mock_trades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    strategy_id INT NOT NULL,
    isin VARCHAR(20) NOT NULL,
    symbol VARCHAR(50),
    entry_price DECIMAL(10, 4) NOT NULL,
    entry_time DATETIME NOT NULL,
    status ENUM('OPEN', 'CLOSED_WIN', 'CLOSED_LOSS') DEFAULT 'OPEN',
    exit_price DECIMAL(10, 4),
    exit_time DATETIME,
    pnl_pct DECIMAL(5, 2),
    FOREIGN KEY (strategy_id) REFERENCES app_user_strategies(id) ON DELETE CASCADE
);

-- Insert Default Strategies
INSERT IGNORE INTO app_user_strategies (id, name, description, is_default) VALUES 
(1, 'Momentum Burst', 'Buys when Supertrend is green and RSI is above 60 indicating strong momentum.', TRUE),
(2, 'Pullback to Support', 'Looks for oversold conditions (RSI < 40) while price is above the 50 DMA.', TRUE),
(3, 'Golden Cross', 'Classic trend-following strategy when Fast EMA crosses above Slow EMA.', TRUE);

-- Momentum Burst Rules
INSERT IGNORE INTO app_strategy_rules (strategy_id, rule_type, indicator, operator, value) VALUES 
(1, 'ENTRY', 'SUPERTREND', '=', 'BUY'),
(1, 'ENTRY', 'RSI', '>', '60'),
(1, 'EXIT', 'SUPERTREND', '=', 'SELL');

-- Pullback to Support Rules
INSERT IGNORE INTO app_strategy_rules (strategy_id, rule_type, indicator, operator, value) VALUES 
(2, 'ENTRY', 'RSI', '<', '40'),
(2, 'ENTRY', 'PRICE_DMA', '>', '50'), -- Custom logic to mean Price > 50 DMA
(2, 'EXIT', 'RSI', '>', '70');

-- Golden Cross Rules
INSERT IGNORE INTO app_strategy_rules (strategy_id, rule_type, indicator, operator, value) VALUES 
(3, 'ENTRY', 'EMA_SIGNAL', '=', 'BUY'),
(3, 'EXIT', 'EMA_SIGNAL', '=', 'SELL');

-- Default Trade Params
INSERT IGNORE INTO app_trade_parameters (strategy_id, stop_loss_pct, take_profit_pct) VALUES 
(1, 3.00, 6.00),
(2, 2.00, 5.00),
(3, 4.00, 10.00);
