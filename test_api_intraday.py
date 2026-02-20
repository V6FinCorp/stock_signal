import requests
url = "https://api.upstox.com/v3/historical-candle/NSE_EQ|INE296A01032/minute/5/2026-02-20/2026-02-15"
try:
    resp = requests.get(url, headers={"Accept": "application/json"}).json()
    print("Historical Minute Status:", resp.get("status"))
    print("Num Candles:", len(resp.get("data", {}).get("candles", [])))
except Exception as e:
    print("Error:", e)
