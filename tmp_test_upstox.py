import asyncio
import httpx
from datetime import datetime, timedelta

async def test_upstox_history():
    # Using a common ISIN like Reliance (INE002A01018)
    isin = "INE002A01018"
    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
    
    # Try the format used for swing but with 5minute
    url = f"https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/5minute/{to_date}/{from_date}"
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
    
    async with httpx.AsyncClient(headers=headers) as client:
        print(f"Testing URL: {url}")
        res = await client.get(url, timeout=10.0)
        print(f"Status: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            if data.get("status") == "success":
                candles = data["data"]["candles"]
                print(f"Success! Fetched {len(candles)} candles.")
                if candles:
                    print(f"First candle: {candles[0]}")
                    print(f"Last candle: {candles[-1]}")
            else:
                print(f"API Error: {data}")
        else:
            print(f"HTTP Error: {res.text}")

if __name__ == "__main__":
    asyncio.run(test_upstox_history())
