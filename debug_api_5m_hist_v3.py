
import requests
import json
from datetime import datetime

def debug_upstox_api():
    isin = "INE089A01031" # DRREDDY
    to_date = "2026-02-24"
    from_date = "2026-02-20"
    
    # Trying the 'minutes/5' format with dates
    url = f"https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/minutes/5/{to_date}/{from_date}"
    print(f"Calling URL: {url}")
    
    try:
        response = requests.get(url, timeout=10)
        print(f"Status Code: {response.status_code}")
        data = response.json()
        if data.get("status") == "success":
            candles = data["data"]["candles"]
            print(f"Returned {len(candles)} candles.")
            if candles:
                print(f"  First: {candles[-1][0]}")
                print(f"  Last:  {candles[0][0]}")
        else:
            print(f"API Error: {data}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    debug_upstox_api()
