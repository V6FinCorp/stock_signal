import pandas as pd
import pandas_ta as ta

df = pd.DataFrame({
    'timestamp': pd.date_range('2026-01-01', periods=5),
    'open': [100, 101, 102, 103, 104],
    'high': [105, 106, 107, 108, 109],
    'low': [99, 100, 101, 102, 103],
    'close': [102, 103, 104, 105, 106],
    'volume': [1000]*5
})

df['RSI_14'] = ta.rsi(df['close'], length=14)
df['EMA_20'] = ta.ema(df['close'], length=20)
print(df)
