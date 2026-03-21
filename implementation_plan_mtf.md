# 🚀 Implementation Plan: MTF Exhaustion & Multi-Tranche Trading

This plan outlines the integration of the "Triple RSI Exhaustion" strategy with professional position management (Accumulation & Scaled Exits).

## 1. Indicator Engine Enhancements (`indicator_engine.py`)
- **MTF Synchronization:** Ensure the engine calculates and stores RSI and SuperTrend for 5m, 15m, and 30m simultaneously for every stock.
- **Extreme Buffer Logic:** Add a calculation for the "Day's High/Low" reference points for SL offsets.
- **Custom Strategy Flag:** Implement a boolean check `is_mtf_exhaustion` that triggers when RSI < 31 or > 69 across 5m, 15m, and 30m.

## 2. Multi-Tranche Trading API (`app.py`)
- **Schema Update:** Update the `app_sg_paper_trades` table to support `parent_trade_id` for tranches.
- **New Endpoints:**
    - `POST /api/trades/add_tranche`: Adds a new position link to an existing trade (Accumulation).
    - `POST /api/trades/close_partial`: Closes a percentage of the total quantity (Scaled Exit).

## 3. Frontend Dashboard Updates (`app.js`)
- **Accumulation UI:** When viewing an active trade, show a "Zone Status" bar indicating if the price is currently in the 0.3% - 0.6% "Safe Accumulation Area."
- **Visual Targets:** Overlay T1 (+0.5%), SuperTrend Flip, and RSI Peak markers on the stock details view.
- **Blueprint Integration:** Add a "One-Click Blueprint" button in the Strategy Lab that auto-populates the Triple RSI logic.

## 4. Automation Service (The "Monitor")
- A background process that checks active trades every 5 minutes against:
    - **Price Target (T1):** Trigger T1 closure at +0.5% (approx 1:1 risk-to-reward).
    - **SuperTrend Change (T2):** Notify/Close T2 when the 5m or 15m SuperTrend flips against the side of the trade (e.g., from Buy to Sell).
    - **RSI Peak/Bottom (T3):** Final signal notification when the "snap-back" move reaches its opposite RSI extreme (e.g., RSI > 70 for a long trade).

---

## Technical Logic: MTF Exhaustion (Scenario 1)

**Buy Logic:**
- **Trigger:** RSI < 31 in 5, 15, and 30 mins simultaneously.
- **Pattern:** Reversal pattern in any of the 5, 15, or 30 mins.
- **Preferred Candles:** Short dojis/spinning tops at Day's Low with confirmation.
- **SL Calculation:** 0.16% from Day's Low (for 5m/15m patterns) or 0.21% (for 30m patterns).
- **Accumulation:** Allowed in the "Buffer Zone" (approx 0.3% - 0.6% below entry) to improve average price.

**Sell Logic:**
- **Trigger:** RSI > 69 in 5, 15, and 30 mins simultaneously.
- **Pattern:** Reversal pattern in any of the 5, 15, or 30 mins.
- **Preferred Candles:** Short dojis/spinning tops at Day's High with confirmation.
- **SL Calculation:** 0.16% from Day's High (for 5m/15m patterns) or 0.21% (for 30m patterns).
- **Accumulation:** Allowed in the "Buffer Zone" (approx 0.3% - 0.6% above entry) to improve average price.
