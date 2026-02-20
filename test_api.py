import requests
print(len(requests.get("http://127.0.0.1:8000/api/signals?mode=swing&timeframe=1w").json().get("data", [])))
