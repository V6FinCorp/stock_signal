import asyncio
import httpx
from datetime import datetime, timedelta
from config import Config

async def test_fetch():
    # Test DHPIND (BSE)
    isin = "INE509F01029"
    symbol = "CUPID"
    prefix = "NSE_EQ"
    
    today_str = datetime.now().strftime('%Y-%m-%d')
    lookback_str = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
    
    url = f"https://api.upstox.com/v3/historical-candle/{prefix}|{isin}/minutes/5/{today_str}/{lookback_str}"
    print(f"Testing URL: {url}")
    
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
    async with httpx.AsyncClient(headers=headers) as client:
        res = await client.get(url, timeout=10.0)
        print(f"Status: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            if data.get("status") == "success":
                candles = data["data"]["candles"]
                print(f"Total candles: {len(candles)}")
                if candles:
                    print(f"Latest candle: {candles[0]}")
                    print(f"Oldest candle: {candles[-1]}")
            else:
                print(f"API Error: {data}")
        else:
            print(f"HTTP Error: {res.text}")

if __name__ == "__main__":
    asyncio.run(test_fetch())
