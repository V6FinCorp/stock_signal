# StockSignal Pro: Developer Context & Maintenance Guide

## 1. Data Fetching Architecture (The "Dual-Tap" Rule)
The system uses the Upstox API. There is a critical distinction between "Historical" and "Intraday" data.

*   **Historical Endpoints (`/days/1` and `/minutes/5` with dynamic dates):** 
    *   Updated by Upstox only **once a day** (after market hours).
    *   Used to fill gaps in the past.
    *   **CRITICAL:** Never use these to fetch the *current* session's moving price during market hours.
*   **Dedicated Intraday Endpoint (`/intraday/` without dates):**
    *   Provides live candles for the **current moving session**.
    *   Used to fill the "bridge" between the last historical close and right now.
*   **The 7-Day Lookback Rule:** Always fetch with at least a 7-day lookback to ensure Friday-to-Monday gaps and missed execution windows (like computer being off) are automatically healed via `ON DUPLICATE KEY UPDATE`.

## 2. Indicator & Calculation Engine (The "Synthesis" Rule)
Indicator calculations must never happen on "Stale" daily data alone.

*   **Live Synthesis:** If the Daily (1d) data is older than the 5m data, the engine MUST synthesize a "Live Candle" from today's 5m bars before running indicators.
*   **Progress & Timing Integrity:** Long-running operations (Data Fetching and Indicator Calculation) MUST use streaming responses (SSE).
    *   **Per-Timeframe Timing:** Every timeframe calculation must report exactly how many seconds it took.
    *   **Blocking UI:** The UI must remain in a "Busy" state (spinning/loading) until the final `[DONE]` signal is received to ensure user visibility of the full pipeline.
*   **Vectorized Math:** All technical indicators must be calculated using `pandas-ta` on the full dataframe to ensure warm-up periods (like 200 EMA) are mathematically accurate.
*   **MTF Agreement:** Multi-timeframe agreement is calculated by checking the `supertrend_dir` across mapped timeframes in the `app_sg_calculated_signals` table.

## 3. Database Integrity & Schema Rules
*   **Upsert Principle:** Always use `INSERT ... ON DUPLICATE KEY UPDATE`. This handles the "shifting" of data from Intraday status to Historical status without duplicating records.
*   **ISIN as Primary Key:** Indicators are mapped via `isin`. Symbols are lookups from the `vw_e_bs_companies_all` view in the datamart.
*   **Timezone:** All internal processing and storage must strictly adhere to **IST (UTC+5:30)** to match Indian Market hours.

## 4. UI/UX & Signal Aesthetics
*   **Premium Design:** Maintain the "Dark Mode / Cyberpunk" glassmorphism theme with vibrant colors (Success/Danger/Amber).
*   **Interactive Components:** Use SVG for mini-sparklines and dynamic charts.
*   **Loading States:** Use `showTableSkeleton` during loading to prevent layout shifts.

## 5. Pre-Flight Checklist for Development
Prior to any file modification, ensure:
1.  **Duplicate Safety:** Did I handle the `ON DUPLICATE KEY UPDATE` to prevent DB bloat?
2.  **Date Robustness:** Will this fetch break on a Saturday morning? (Refer to "Self-Healing" via 7-day lookback).
3.  **Context Preservation:** Am I respecting the `profile_id` (swing vs intraday) context?
4.  **API Mapping:** Am I using the correct Upstox URL format? (`/days/` for 1d, `/minutes/` for 5m, `/intraday/` for live).
5.  **Side Impacts:** Does this change the way `max(timestamp)` is calculated in `api/status`?
