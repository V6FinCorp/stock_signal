import asyncio
import httpx
from datetime import datetime, timedelta
from config import Config

async def debug_fetch():
    target_isin = "INE481G01011" # ULTRACEMCO
    symbol = "ULTRACEMCO"
    prefix = "NSE_EQ"
    
    today_str = datetime.now().strftime('%Y-%m-%d')
    lookback_str = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
    
    url = Config.UPSTOX_INTRADAY_URL.format(prefix=prefix, isin=target_isin, to_date=today_str, from_date=lookback_str)
    
    print(f"Fetching URL: {url}")
    
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
    async with httpx.AsyncClient(headers=headers) as client:
        try:
            res = await client.get(url, timeout=10.0)
            print(f"Status Code: {res.status_code}")
            if res.status_code == 200:
                data = res.json()
                print(f"API Status: {data.get('status')}")
                if data.get("status") == "success":
                    candles = data["data"]["candles"]
                    print(f"Fetched {len(candles)} candles.")
                    if candles:
                        print(f"Latest Candle: {candles[0][0]}")
                        print(f"Oldest Candle: {candles[-1][0]}")
                else:
                    print(f"Error Message: {data.get('errors')}")
            else:
                print(f"Response Text: {res.text[:200]}")
        except Exception as e:
            print(f"Exception: {e}")

    # Also try the dedicated intraday endpoint
    intraday_url = f"https://api.upstox.com/v3/historical-candle/intraday/{prefix}|{target_isin}/minutes/5"
    print(f"\nTrying dedicated Intraday URL: {intraday_url}")
    async with httpx.AsyncClient(headers=headers) as client:
        try:
            res = await client.get(intraday_url, timeout=10.0)
            print(f"Status Code: {res.status_code}")
            if res.status_code == 200:
                data = res.json()
                print(f"API Status: {data.get('status')}")
                if data.get("status") == "success":
                    candles = data["data"]["candles"]
                    print(f"Fetched {len(candles)} intraday candles.")
                    if candles:
                        print(f"Latest Candle: {candles[0][0]}")
            else:
                print(f"Response Text: {res.text[:200]}")
        except Exception as e:
            print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(debug_fetch())
