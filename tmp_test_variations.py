import asyncio
import httpx
from datetime import datetime, timedelta

async def test_variations():
    isin = "INE002A01018"
    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
    
    variations = [
        f"https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/minute/5/{to_date}/{from_date}",
        f"https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/minutes/5/{to_date}/{from_date}",
        f"https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/5minute/{to_date}/{from_date}",
        f"https://api.upstox.com/v3/historical-candle/NSE_EQ|{isin}/5minutes/{to_date}/{from_date}",
    ]
    
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
    
    async with httpx.AsyncClient(headers=headers) as client:
        for url in variations:
            print(f"---\nTesting: {url}")
            try:
                res = await client.get(url, timeout=10.0)
                print(f"Status: {res.status_code}")
                if res.status_code == 200:
                    data = res.json()
                    candles = data.get("data", {}).get("candles", [])
                    print(f"Success! {len(candles)} candles.")
                    if candles: break
                else:
                    print(f"Error: {res.text}")
            except Exception as e:
                print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(test_variations())
