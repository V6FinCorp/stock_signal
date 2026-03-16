import os
import json
import openai
import aiomysql
from dotenv import load_dotenv
from config import Config
from datetime import datetime, timezone, timedelta

load_dotenv()
openai.api_key = os.getenv("OPENAI_API_KEY")

async def get_top_signals(mode: str = 'swing', limit: int = 5):
    """Retrieve top technical signals from the database based on confluence rank."""
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
        
        async with datamart_pool.acquire() as dm_conn:
            async with dm_conn.cursor() as dm_cur:
                await dm_cur.execute("SELECT bs_ISIN, bs_SYMBOL FROM vw_e_bs_companies_all")
                symbols_map = {row[0]: row[1] for row in await dm_cur.fetchall()}
                
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT isin, timeframe, ltp, rsi, ema_signal, supertrend_dir, confluence_rank, trade_strategy, sl, target "
                    "FROM app_sg_calculated_signals "
                    "WHERE profile_id = %s AND confluence_rank > 0 "
                    "ORDER BY confluence_rank DESC LIMIT %s", 
                    (mode, limit)
                )
                rows = await cur.fetchall()
                for r in rows:
                    r['symbol'] = symbols_map.get(r['isin'], r['isin'])
                    ltp = float(r['ltp']) if r['ltp'] else 0
                    target = float(r['target']) if r['target'] else 0
                    sl = float(r['sl']) if r['sl'] else 0
                    
                    r['ltp'] = ltp
                    r['target'] = target
                    r['sl'] = sl
                    r['rsi'] = float(r['rsi']) if r['rsi'] else 0
                    
                    # Add calculations for AI
                    if ltp > 0:
                        r['potential_return_pct'] = round(((target - ltp) / ltp) * 100, 2)
                        risk = abs(ltp - sl)
                        reward = abs(target - ltp)
                        r['risk_reward'] = round(reward / risk, 2) if risk > 0 else 0
                    else:
                        r['potential_return_pct'] = 0
                        r['risk_reward'] = 0
                        
                    r['expected_duration'] = "1-15 days" if mode == 'swing' else "Intraday (Same Day)"
                    
        app_pool.close()
        datamart_pool.close()
        await app_pool.wait_closed()
        await datamart_pool.wait_closed()
        return json.dumps(rows)
    except Exception as e:
        return json.dumps({"error": str(e)})

async def get_stock_status(symbol: str, mode: str = 'swing'):
    """Fetch status for a specific stock by symbol."""
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        datamart_pool = await aiomysql.create_pool(**Config.get_datamart_db_config())
        
        async with datamart_pool.acquire() as dm_conn:
            async with dm_conn.cursor() as dm_cur:
                await dm_cur.execute("SELECT bs_ISIN FROM vw_e_bs_companies_all WHERE bs_SYMBOL = %s", (symbol,))
                res = await dm_cur.fetchone()
                if not res:
                    return json.dumps({"error": f"Symbol {symbol} not found."})
                isin = res[0]
                
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT isin, timeframe, ltp, rsi, ema_signal, supertrend_dir, confluence_rank, trade_strategy, sl, target "
                    "FROM app_sg_calculated_signals "
                    "WHERE isin = %s AND profile_id = %s "
                    "ORDER BY timeframe", 
                    (isin, mode)
                )
                rows = await cur.fetchall()
                for r in rows:
                    ltp = float(r['ltp']) if r['ltp'] else 0
                    target = float(r['target']) if r['target'] else 0
                    sl = float(r['sl']) if r['sl'] else 0
                    
                    r['ltp'] = ltp
                    r['target'] = target
                    r['sl'] = sl
                    r['rsi'] = float(r['rsi']) if r['rsi'] else 0
                    
                    # Add calculations for AI
                    if ltp > 0:
                        r['potential_return_pct'] = round(((target - ltp) / ltp) * 100, 2)
                        risk = abs(ltp - sl)
                        reward = abs(target - ltp)
                        r['risk_reward'] = round(reward / risk, 2) if risk > 0 else 0
                    else:
                        r['potential_return_pct'] = 0
                        r['risk_reward'] = 0
                        
                    r['expected_duration'] = "1-15 days" if mode == 'swing' else "Intraday (Same Day)"
                    
        app_pool.close()
        datamart_pool.close()
        await app_pool.wait_closed()
        await datamart_pool.wait_closed()
        if not rows:
            return json.dumps({"message": "No calculated signals found for this stock in this profile."})
        return json.dumps(rows)
    except Exception as e:
        return json.dumps({"error": str(e)})

async def get_market_sentiment(mode: str = 'swing'):
    """Fetch overall market sentiment based on signal confluence."""
    try:
        app_pool = await aiomysql.create_pool(**Config.get_app_db_config())
        async with app_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT supertrend_dir, count(*) as count "
                    "FROM app_sg_calculated_signals "
                    "WHERE profile_id = %s "
                    "GROUP BY supertrend_dir", 
                    (mode,)
                )
                rows = await cur.fetchall()
                
        app_pool.close()
        await app_pool.wait_closed()
        return json.dumps(rows)
    except Exception as e:
        return json.dumps({"error": str(e)})

import httpx

async def chat_with_assistant(messages, mode='swing'):
    client = openai.AsyncOpenAI(http_client=httpx.AsyncClient())
    
    # Calculate IST Time (UTC+5:30)
    now_utc = datetime.now(timezone.utc)
    ist_now = now_utc + timedelta(hours=5, minutes=30)
    ist_str = ist_now.strftime("%I:%M %p")
    
    # 1. Simple Market status logic (9:15 AM - 3:30 PM)
    m_status = "Open"
    minutes = ist_now.hour * 60 + ist_now.minute
    
    if minutes < (9*60 + 15):
        m_status = "Closed (Morning)"
    elif minutes > (15*60 + 30):
        m_status = "Closed (Evening)"
    elif minutes >= (15*60 + 15):
        m_status = "Closing (Intraday Cutoff Active)"
    elif minutes >= (14*60 + 45):
        m_status = "Open (Closing Soon)"
    
    # 2. Data Staleness Check (Acceptable < 10min)
    data_status_msg = "Data is Live"
    try:
        from app import app_pool
        async with app_pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Check latest signal timestamp for intraday/swing
                await cur.execute(
                    "SELECT MAX(timestamp) FROM app_sg_calculated_signals WHERE profile_id = %s", 
                    (mode,)
                )
                res = await cur.fetchone()
                if res and res[0]:
                    last_update = res[0]
                    # Ensure last_update is aware or compare naive to naive
                    if last_update.tzinfo is None:
                        # Database usually stores naive local (which we treat as IST here)
                        diff = (ist_now.replace(tzinfo=None) - last_update).total_seconds() / 60
                    else:
                        diff = (ist_now - last_update).total_seconds() / 60
                    
                    if diff > 10:
                        data_status_msg = f"Data is STALE (Last update: {last_update.strftime('%I:%M %p')}, {int(diff)}m ago)"
    except Exception as e:
        print(f"Chat Engine: Staleness check failed: {e}")

    system_instruction = Config.CHAT_SYSTEM_PROMPT.format(
        mode=mode.upper(),
        mode_lower=mode.lower(),
        mode_lower_cap=mode.capitalize(),
        ist_time=ist_str,
        market_status=m_status,
        data_status=data_status_msg
    )
    
    # Update or insert system message to include mode context
    if messages and messages[0].get("role") == "system":
        messages[0]["content"] = system_instruction
    else:
        messages.insert(0, {"role": "system", "content": system_instruction})

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_top_signals",
                "description": "Get the top technical signals based on confluence rank.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "mode": {"type": "string", "enum": ["swing", "intraday"]},
                        "limit": {"type": "integer", "description": "Number of signals to retrieve."}
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_stock_status",
                "description": "Get detailed signal status and indicators for a specific stock symbol.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "symbol": {"type": "string", "description": "Stock symbol (e.g., RELIANCE, TCS)"},
                        "mode": {"type": "string", "enum": ["swing", "intraday"]}
                    },
                    "required": ["symbol"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_market_sentiment",
                "description": "Get overall market sentiment based on active signals and indicators.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "mode": {"type": "string", "enum": ["swing", "intraday"]}
                    }
                }
            }
        }
    ]

    try:
        if not openai.api_key:
            return "Error: OpenAI API key is missing. Please configure it in the .env file."
            
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools
        )
        
        response_message = response.choices[0].message
        tool_calls = response_message.tool_calls
        
        if tool_calls:
            # We must serialize the tool call results properly
            resolved_messages = messages.copy()
            # Pydantic validation: messages needs to be a dict representation sometimes depending on openai package version.
            # But recent versions accept the message object. Let's append as dict.
            resolved_messages.append({"role": "assistant", "content": response_message.content, "tool_calls": [t.model_dump() for t in tool_calls]})
            
            for tool_call in tool_calls:
                function_name = tool_call.function.name
                function_args = json.loads(tool_call.function.arguments)
                
                if function_name == "get_top_signals":
                    # Force the mode from the app context
                    function_response = await get_top_signals(
                        mode=mode, 
                        limit=function_args.get("limit", 5)
                    )
                elif function_name == "get_stock_status":
                    # Force the mode from the app context
                    function_response = await get_stock_status(
                        symbol=function_args.get("symbol"),
                        mode=mode
                    )
                elif function_name == "get_market_sentiment":
                    # Force the mode from the app context
                    function_response = await get_market_sentiment(
                        mode=mode
                    )
                else:
                    function_response = json.dumps({"error": "Unknown function"})
                    
                resolved_messages.append({
                    "tool_call_id": tool_call.id,
                    "role": "tool",
                    "name": function_name,
                    "content": function_response
                })
                
            second_response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=resolved_messages
            )
            return second_response.choices[0].message.content
        
        return response_message.content
        
    except Exception as e:
        return f"Error interacting with AI: {str(e)}"
