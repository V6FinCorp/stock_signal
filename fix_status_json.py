
import json
from datetime import datetime

def fix_status():
    try:
        with open("status.json", "r") as f:
            status = json.load(f)
            
        def convert(ts_str):
            try:
                dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
                return dt.strftime("%d-%b-%Y %I:%M:%S %p")
            except:
                return ts_str
                
        for mode in status:
            if "last_fetch" in status[mode]:
                status[mode]["last_fetch"] = convert(status[mode]["last_fetch"])
            if "last_calc" in status[mode]:
                status[mode]["last_calc"] = convert(status[mode]["last_calc"])
                
        with open("status.json", "w") as f:
            json.dump(status, f)
        print("Successfully updated status.json format.")
    except Exception as e:
        print(f"Error fixing status.json: {e}")

if __name__ == "__main__":
    fix_status()
