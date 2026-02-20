# Project: StockSignal Pro - Indian Equity Intelligence System

## 1. Project Overview
A professional-grade equity signal engine for the Indian stock market (NSE), supporting multi-timeframe analysis for 5,000 stocks (Swing) and 200 stocks (Intraday).

## 2. Technical Stack
*   **Database:** MySQL 8.0+ (Mandatory)
*   **Logic/Math Engine:** Python 3.10+ (using `Pandas-TA`, `httpx` for async fetching)
*   **Web Framework:** PHP (for Settings and Dashboard UI)
*   **Data Source:** Upstox V3 API (Historical & Minute candles)
    *   *Endpoint discovered:* `https://api.upstox.com/v3/historical-candle/NSE_EQ|{ISIN}/days/1/{to_date}/{from_date}` (Authentication-free for EOD)

## 3. Core Features & Business Logic
### A. Execution Modes
1.  **Swing Mode:**
    *   **Scope:** 5,000 stocks (NSE Equity segment).
    *   **Timeframes:** Daily, Weekly, Monthly (Resampled locally from Daily data).
    *   **Frequency:** Refreshed once daily (post-market) or on-demand.
2.  **Intraday Mode:**
    *   **Scope:** 200 high-priority stocks.
    *   **Timeframes:** 5m, 15m, 30m, 60m (Resampled from 1m data).
    *   **Frequency:** Semi-automatic (Triggered by "Refresh" button in UI).

### B. Indicator Configuration
Every indicator is fully configurable per mode (Swing vs Intraday independent settings):
*   **RSI:** Period, Overbought, Oversold.
*   **Supertrend:** ATR Period, Multiplier (Returns both Direction AND Value).
*   **EMA:** Single period (e.g., 20).
*   **DMA:** Multiple periods (10, 20, 50, 200, 300) - toggleable by user.

### C. Signal Confluence & Ranking
*   **Ranking Logic:** Count how many indicators agree on a signal.
*   **Sorting:** Highlight stocks with the highest confluence score (Rank 3-4) at the top based on the user's selected primary timeframe.

## 4. Database Schema Specification (MySQL)
### Tables:
1.  **`companies`**: `symbol`, `name`, `isin` (Primary Key).
2.  **`profiles`**: `profile_id` (swing/intraday), `watchlist_method` (TOP_VOLUME/MANUAL), `top_n`.
3.  **`indicator_settings`**: `profile_id`, `indicator_key`, `is_enabled`, `params_json`.
4.  **`ohlcv_prices`**: Time-series store for raw OHLCV data.
5.  **`calculated_signals`**: Stores latest RSI, EMA, Supertrend (Value + Dir), and Confluence Rank.

## 5. UI/UX Blueprint (Finalized in MOCK)
*   **Sidebar:** Toggle between Modes.
*   **Dashboard:** High-end dark theme table with dynamic column generation.
*   **Settings Modal:** Independent configuration for indicators with numeric inputs for sub-values.
*   **Progress Feedback:** Visual bar indicating data ingestion status.

## 6. Implementation Roadmap (Next Steps)
1.  **Step 1: DB Initialization.** Create the MySQL tables based on the specifications above.
2.  **Step 2: "History Harvester" (Python).** Build the async script to loop through ISINs and populate `ohlcv_prices` from Jan 2022.
3.  **Step 3: "Indicator Engine" (Python).** Build the logic using `Pandas-TA` that reads `indicator_settings` from MySQL and writes results to `calculated_signals`.
4.  **Step 4: "Dashboard & Settings" (PHP).** Replace the Mock JS logic with PHP code that reads from the database.

---
**Handover Instruction:** Antigravity should read this plan and immediately proceed to **Step 1: MySQL Database Creation** without further redesign.
