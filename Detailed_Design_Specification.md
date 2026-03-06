# StockSignal Pro: Detailed Design Specification

> **Implementation Directive:** This is a zero-context clone manual. Any pair programmer or developer reading this document must be able to entirely recreate "StockSignal Pro" using ONLY the information provided here.

## 1. System Architecture & Tech Stack
The application is a decoupled, async-first web platform.
*   **Backend Array:** Python 3.10+, `FastAPI` (Core API), `uvicorn` (ASGI Server), `aiomysql` (Async DB pooling), `pandas` & `pandas-ta` (Vectorized Math), `httpx` (Async API fetching), `hashlib` (Security).
*   **Frontend Array:** Pure Vanilla HTML5, CSS3 (Custom Properties), and Vanilla ES6 JavaScript. ZERO external frameworks (No React, No Tailwind).
*   **Data Persistence:** MySQL 8.0+.
    *   `Datamart DB`: Source for symbols (`vw_e_bs_companies_all`) and favourites (`vw_e_bs_companies_favourite_indices`).
    *   `App DB`: Store for prices, signals, history, trades, and user auth.

---

## 2. Database Schema (App DB)
The application relies strictly on the following table definitions.

### A. Authentication & Profiles
```sql
CREATE TABLE app_sg_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app_sg_profiles (
    profile_id VARCHAR(20) PRIMARY KEY, -- 'swing', 'intraday', 'global'
    watchlist_method ENUM('TOP_VOLUME', 'MANUAL') DEFAULT 'MANUAL',
    top_n INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE app_sg_indicator_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    profile_id VARCHAR(20),
    indicator_key VARCHAR(50) NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    params_json JSON, 
    FOREIGN KEY (profile_id) REFERENCES app_sg_profiles(profile_id) ON DELETE CASCADE,
    UNIQUE KEY (profile_id, indicator_key)
);
```

### B. Core Data & Signals
```sql
CREATE TABLE app_sg_ohlcv_prices (
    isin VARCHAR(20),
    timeframe VARCHAR(10),
    timestamp DATETIME,
    open DECIMAL(10, 4), high DECIMAL(10, 4), low DECIMAL(10, 4), close DECIMAL(10, 4), volume BIGINT,
    UNIQUE KEY (isin, timeframe, timestamp)
);

CREATE TABLE app_sg_calculated_signals (
    isin VARCHAR(20) PRIMARY KEY,
    profile_id VARCHAR(20),
    timeframe VARCHAR(10),
    timestamp DATETIME,
    ltp DECIMAL(10, 4), rsi DECIMAL(10, 4), rsi_day_high DECIMAL(10, 4), rsi_day_low DECIMAL(10, 4),
    ema_signal ENUM('BUY', 'SELL'), ema_fast DECIMAL(10, 4), ema_slow DECIMAL(10, 4),
    volume_signal VARCHAR(20), volume_ratio DECIMAL(10, 4), 
    supertrend_dir ENUM('BUY', 'SELL'), supertrend_value DECIMAL(10, 4),
    dma_data JSON, confluence_rank INT,
    sl DECIMAL(10, 4), target DECIMAL(10, 4), trade_strategy VARCHAR(50),
    candlestick_pattern VARCHAR(100), pattern_score INT, last_5_candles JSON,
    sector VARCHAR(100), industry VARCHAR(100), pe DECIMAL(10, 2), roe DECIMAL(10, 2),
    i_group VARCHAR(100), i_subgroup VARCHAR(100)
);
```

### C. Active Trades & Strategy Lab
```sql
CREATE TABLE app_sg_active_trades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    isin VARCHAR(20), symbol VARCHAR(50), profile_id VARCHAR(20), timeframe VARCHAR(10),
    entry_price DECIMAL(10, 4), target_1 DECIMAL(10, 4), stop_loss DECIMAL(10, 4),
    qty INT, side ENUM('BUY', 'SELL'), status ENUM('OPEN', 'CLOSED'), notes TEXT
);

CREATE TABLE app_sg_confluence_strategies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100), query_text TEXT
);

CREATE TABLE app_sg_system_status (
    mode VARCHAR(20) PRIMARY KEY,
    last_fetch_run TIMESTAMP, last_calc_run TIMESTAMP
);
```

---

## 3. Data Ingestion Pipeline
*   **Upstox Integration:** Uses public candles API.
*   **Synthesis:** If 1d data is stale, the engine synthesizes a "Live Daily" candle using the latest 5m intraday data.
*   **Streaming (SSE):** `app.py` uses Server-Sent Events to stream terminal logs of the fetch process to the UI.

---

## 4. Indicator Engine Logic
*   **RSI Integration:** Tracks intraday boundaries (RSI Day High/Low).
*   **Pattern Scoring:** Candlestick patterns are weighted (3 = Multi-candle, 2 = Strong Body, 1 = Single).
*   **VPVR (Volume Profile):** Calculates volume distribution across 24 price bins.
*   **Confluence Score:** Composite integer (-5 to +5) based on EMA Cross, Supertrend, RSI Momentum (>50), SMA 20, and Volume Spikes.
*   **Anchored DMA:** All SMA periods (20, 50, 200) are strictly anchored to the Daily timeframe.

---

## 5. Scenario & Backtest Engine
*   **Tranche-based Scaling:** Supports entering in 3 tranches (e.g., 50%/25%/25%) based on price pullbacks.
*   **Target Logic:**
    *   **T1:** TP1 level OR 5m Supertrend reversal.
    *   **T2:** TP2 level OR Primary timeframe Supertrend reversal.
*   **Look-ahead Bias Guard:** Logic uses `shift(1)` on primary timeframe indicators to ensure the backtester only "sees" confirmed bars.

---

## 6. Frontend Features
*   **Pro Screener:** Advanced filtering of the signal pool based on real-time confluence ranking.
*   **Strategy Lab:** SQL-like query builder that allows users to filter signals on-the-fly via a dynamic evaluation engine.
*   **Interactive SVG Charting:** Custom-built SVG renderer for candles, indicators, and crosshairs (0 external dependencies).
*   **Sector Sentiment:** Real-time bullish/bearish heatmaps calculated from the current signal pool.
