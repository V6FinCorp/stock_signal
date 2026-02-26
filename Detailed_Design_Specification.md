# StockSignal Pro: Detailed Design Specification

> **Implementation Directive:** This is a zero-context clone manual. Any pair programmer or developer reading this document must be able to entirely recreate "StockSignal Pro" using ONLY the information provided here.

## 1. System Architecture & Tech Stack
The application is a decoupled, async-first web platform.
*   **Backend Array:** Python 3.10+, `FastAPI` (routing), `uvicorn` (server), `aiomysql` (async database pooling), `pandas` & `pandas-ta` (vectorized indicator math), `httpx` (async API fetching).
*   **Frontend Array:** Pure Vanilla HTML5, CSS3 built on CSS Variables, and Vanilla ES6 JavaScript. No JS frameworks (React/Vue/Angular) or CSS frameworks (Tailwind/Bootstrap) are used.
*   **Data Persistence:** MySQL 8.0+. The system assumes two logically separated schemas:
    *   `Datamart DB` (Read-only source of active stock symbols/ISINs).
    *   `App DB` (Read/Write store for OHLCV data, calculated signals, and settings).

---

## 2. Database Schema (App DB)
The application relies strictly on the following table definitions to function.

### A. Profiles & Settings
```sql
CREATE TABLE app_sg_profiles (
    profile_id VARCHAR(20) PRIMARY KEY, -- 'swing' or 'intraday'
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (profile_id) REFERENCES app_sg_profiles(profile_id) ON DELETE CASCADE,
    UNIQUE KEY unique_profile_indicator (profile_id, indicator_key)
);
```

### B. Core Data Tables
```sql
CREATE TABLE app_sg_ohlcv_prices (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    isin VARCHAR(20),
    timeframe VARCHAR(10) NOT NULL, -- e.g., '1d', '5m', '15m'
    timestamp DATETIME NOT NULL,
    open DECIMAL(10, 4),
    high DECIMAL(10, 4),
    low DECIMAL(10, 4),
    close DECIMAL(10, 4),
    volume BIGINT,
    UNIQUE KEY unique_candle (isin, timeframe, timestamp),
    INDEX idx_isin_timeframe (isin, timeframe)
);

CREATE TABLE app_sg_calculated_signals (
    isin VARCHAR(20),
    profile_id VARCHAR(20),
    timeframe VARCHAR(10) NOT NULL,
    timestamp DATETIME NOT NULL,
    ltp DECIMAL(10, 4),
    rsi DECIMAL(10, 4),
    rsi_day_high DECIMAL(10, 4),
    rsi_day_low DECIMAL(10, 4),
    ema_signal ENUM('BUY', 'SELL', 'NEUTRAL'),
    ema_fast DECIMAL(10, 4),
    ema_slow DECIMAL(10, 4),
    ema_value DECIMAL(10, 4),
    volume_signal VARCHAR(20),
    volume_ratio DECIMAL(10, 4),
    supertrend_dir ENUM('BUY', 'SELL'),
    supertrend_value DECIMAL(10, 4),
    dma_data JSON, 
    confluence_rank INT DEFAULT 0,
    sl DECIMAL(10, 4),
    target DECIMAL(10, 4),
    trade_strategy VARCHAR(50),
    candlestick_pattern VARCHAR(100),
    last_5_candles JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (isin, profile_id, timeframe),
    FOREIGN KEY (profile_id) REFERENCES app_sg_profiles(profile_id) ON DELETE CASCADE,
    INDEX idx_isin (isin)
);
```

---

## 3. Data Ingestion Pipeline ([fetch_history.py](file:///e:/Official/WebApp/vs_ws_py/stock_signal/fetch_history.py))
This standalone script runs the ETL process using Upstox APIs (which function without auth for historical data).
*   **Endpoints:**
    *   Daily: `https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/days/1/{to_date}/{from_date}`
    *   Intraday: `https://api.upstox.com/v3/historical-candle/intraday/NSE_EQ|{isin}/minutes/5/`
*   **Delta Fetching:** The script queries the App DB to find the `MAX(timestamp)` for each `isin`/`timeframe`. It only fetches data from the Upstox API ranging from that `MAX(timestamp)` to `now`, avoiding redundant API calls.
*   **Concurrency:** Utilizes `asyncio.Semaphore(5)` to limit simultaneous HTTP requests to 5, preventing `429 Too Many Requests` bans.
*   **Garbage Collection:** Automatically deletes Daily (`1d`) data older than 1095 days (3 years) and Intraday (`5m`) data older than 35 days to maintain database health.

---

## 4. Indicator Engine ([indicator_engine.py](file:///e:/Official/WebApp/vs_ws_py/stock_signal/indicator_engine.py))
This is the core mathematical brain. It uses `pandas` and `pandas-ta`.
*   **Timeframe Synthesis:** The engine relies purely on `1d` base data for Swing profiles, and `5m` base data for Intraday profiles. To calculate `15m`, `30m`, `60m`, or `1w`, `1mo` signals, it actively uses pandas [resample()](file:///e:/Official/WebApp/vs_ws_py/stock_signal/scenario_engine.py#29-39) on the base data rather than fetching new timeframes from the API.
*   **Indicator Configurations:**
    *   **RSI:** Period 14.
    *   **EMA:** Fast=9, Slow=20 (Swing) or 21 (Intraday). A "BUY" signal occurs if Fast > Slow.
    *   **SuperTrend:** Period 10, Multiplier 3.0 (Swing) or 2.5 (Intraday). 
    *   **Volume:** Compares current volume to a 20-period SMA of volume. Signal 'HIGH' if > 2x (Swing) or 1.5x (Intraday).
    *   **Candlestick Patterns:** Analyzes all `CDL_` columns from `pandas-ta`. 
        *   *Logic Guard:* Patterns are only registered if `abs(value) >= 10`.
        *   *Categorization:* `CDL_INSIDE`, `CDL_BELTHOLD`, `CDL_DOJI` variants are forcefully mapped to "Neutral".
*   **Confluence Ranking:** A composite integer score.
    *   `+10` points for Supertrend BUY, `-10` for SELL.
    *   `+5` points for EMA BUY, `-5` for SELL.
    *   `+5` points for extreme Volume breakout.
    *   Bonus points mapped based on RSI proximity to 50 bounds.

---

## 5. API Layer ([app.py](file:///e:/Official/WebApp/vs_ws_py/stock_signal/app.py))
A fast, non-blocking API serving the frontend.
*   `GET /api/signals`: Returns the contents of `app_sg_calculated_signals` for a designated `mode` and `timeframe`. It automatically joins MTF (Multi-Timeframe) Supertrend direction data for all base timeframes inside a JSON object per stock.
*   `GET /api/chart/details`: Fetches up to `N` base candles (`1d` or `5m`) and recalculates all indicators dynamically on the fly to return rich data points for drawing charts.
*   `GET /api/stream/fetch-data`: Spawns the [fetch_history.py](file:///e:/Official/WebApp/vs_ws_py/stock_signal/fetch_history.py) script as a subprocess and yields standard output via **Server-Sent Events (SSE)** to allow the UI to display a live terminal.
*   `POST /api/calculate`: Triggers the indicator engine to recalculate all signals and overwrite the calculated table.

---

## 6. Frontend Application ([index.html](file:///e:/Official/WebApp/vs_ws_py/stock_signal/index.html), [app.js](file:///e:/Official/WebApp/vs_ws_py/stock_signal/app.js), [styles.css](file:///e:/Official/WebApp/vs_ws_py/stock_signal/styles.css))
### A. CSS & Theme ([styles.css](file:///e:/Official/WebApp/vs_ws_py/stock_signal/styles.css))
*   **Color Palette:** Strict dark mode theme. Variables include: `--bg-body: #050b14`, `--bg-dark: #0f172a`, `--sidebar-bg: rgba(15, 23, 42, 0.95)`, `--primary: #3b82f6`, `--success: #10b981`, `--danger: #ef4444`.
*   **Aesthetics:** Heavy use of modern UI paradigms: `backdrop-filter: blur()`, subtle borders (`1px solid rgba(255,255,255,0.08)`), rounded borders (`border-radius: 12px`), and CSS grid layouts.

### B. JavaScript State & Processing ([app.js](file:///e:/Official/WebApp/vs_ws_py/stock_signal/app.js))
*   **State Machines:** Tracks `currentMode` ('swing' vs 'intraday'), `currentTimeframe`, `isAutoSyncEnabled`, and caches payload data locally in `signalCache` to ensure 0-millisecond tab switching.
*   **Dynamic DOM Table:** The system forcefully clears and rewrites `<tbody>` contents.
*   **Visual Elements:**
    *   *Mini-Sparklines:* Drawn directly in table cells dynamically via `<svg>` tags using the `last_5_candles` JSON data.
    *   *RSI Bar:* Custom HTML progress-bar-style visualization plotting the current RSI against the day's high/low RSI boundaries.
*   **Modal SVG Charting ([renderEnrichedChart](file:///e:/Official/WebApp/vs_ws_py/stock_signal/app.js#1544-1789)):** 
    *   **CRITICAL RESTRICTION:** Absolutely no heavy charting libraries (like Chart.js or Lightweight-Charts) are permitted.
    *   The Javascript engine dynamically creates raw SVG coordinates based on calculating max/min bounds of price data.
    *   It manually draws:
        1.  Candle wicks (`<line>`) and bodies (`<rect>`).
        2.  Supertrend (`<polyline>` with stroke-dasharray).
        3.  EMAs (`<polyline>` with distinct colors).
        4.  Session Day boundaries (brighter white `<line>` markers, restricted only to Intraday views).
        5.  Dynamic Mouse Crosshairs by binding an [onmousemove](file:///e:/Official/WebApp/vs_ws_py/stock_signal/app.js#1751-1785) listener to the SVG container.

---

## 7. Backtest Scenarios ([scenario_engine.py](file:///e:/Official/WebApp/vs_ws_py/stock_signal/scenario_engine.py))
Allows "what-if" simulations on historical data.
*   **Logic Flow:**
    1.  Receives params (Entry rule, Stop Loss %, Take Profit Tranche %, Weights).
    2.  Fetches base timeframe OHLCV array.
    3.  Iterates chronologically `iterrows()`.
    4.  Triggers "Entry" if RSI boundaries are met.
    5.  Subsequently checks every newly processed candle against the Stop-Loss boundary first (Highest priority), then Take Profit Tranches (T1, T2).
    6.  Generates a list of dictionaries detailing P&L% per trade ticket.
