# Railway.app Deployment Guide 🚀

Your Python/FastAPI backend and background Engine scripts are now 100% ready for deployment to [Railway.app](https://railway.app/).

Here is exactly how to go live in under 5 minutes:

### Step 1: Push to GitHub
If you haven't already, push this entire `stock_signal` repository folder to a private GitHub repository.

### Step 2: Deploy the Web Service (FastAPI)
1. Log into your Railway dashboard.
2. Click **"New Project"** -> **"Deploy from GitHub repo"**.
3. Select your repository. 
4. Railway will automatically detect the **`requirements.txt`** and **`Procfile`** I created for you and build the Python 3.x environment natively.

### Step 3: Configure Environment Variables (.env)
Just like on your local PC, the cloud engine needs to know how to connect to the databases.
1. Click on the newly deployed Web Service box in Railway.
2. Go to the **"Variables"** tab.
3. Simply click **"Raw Editor"** and copy/paste your entire local `.env` file into the box! 
*(It will securely load all your APP_DB and DATAMART_DB credentials)*.

### Step 4: Add the Background Cron Jobs (Crucial)
Your Web API will serve the dashboard beautifully and handle manual Refreshes, but you need your `fetch_history.py` to automatically download the stock prices while you sleep!
1. Hit `CMD/CTRL + K` in Railway to open the command palette and type **"Create new Service"**.
2. Select **"Cron Job"**.
3. Point it to the exact same GitHub repository.
4. **Command:** `python fetch_history.py`
5. **Schedule:** `0 18 * * 1-5` *(Runs at 6:00 PM every Monday through Friday)*

Repeat this to create a **second Cron Job** for your logic engine:
1. **Command:** `python indicator_engine.py`
2. **Schedule:** `30 18 * * 1-5` *(Runs at 6:30 PM every Monday through Friday)*

**Important:** Both Cron Jobs need access to the same Database variables! Go to their "Variables" tab and "Link" them to the main Web Service variables so they share the exact same `.env` values securely!

---
**Done!** Navigate to your Railway external URL and your StockSignal Pro dashboard will be live and auto-updating in the cloud!
