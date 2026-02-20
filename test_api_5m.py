import requests
from datetime import datetime, timedelta

for days in [31, 32, 33, 34, 35]:
    to_date = datetime.now().strftime("%Y-%m-%d")
    from_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    url = f"https://api.upstox.com/v3/historical-candle/NSE_EQ|INE296A01032/minutes/5/{to_date}/{from_date}"
    try:
        resp = requests.get(url, headers={"Accept": "application/json"})
        print(f"Days {days}: Status Code: {resp.status_code}")
    except Exception as e:
        print("Error:", e)
