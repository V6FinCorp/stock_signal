import asyncio
import httpx
from datetime import datetime, timedelta

async def test_depth_30():
    isin = "INE002A01018"
    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
    url = f"https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/minutes/5/{to_date}/{from_date}"
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
    
    async with httpx.AsyncClient(headers=headers) as client:
        res = await client.get(url, timeout=10.0)
        if res.status_code == 200:
            candles = res.json().get("data", {}).get("candles", [])
            print(f"Success! Fetched {len(candles)} candles for 30 days.")
        else: print(f"Failed: {res.text}")

if __name__ == "__main__":
    asyncio.run(test_depth_30())
