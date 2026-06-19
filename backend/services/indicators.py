import numpy as np
from typing import List, Optional

def calc_ma(closes: List[float], period: int) -> List[Optional[float]]:
    result = [None] * len(closes)
    arr = np.array(closes, dtype=float)
    for i in range(period - 1, len(closes)):
        result[i] = float(np.mean(arr[i - period + 1: i + 1]))
    return result

def calc_atr(highs, lows, closes, period: int = 14) -> List[Optional[float]]:
    h = np.array(highs, dtype=float)
    l = np.array(lows,  dtype=float)
    c = np.array(closes, dtype=float)
    n = len(c)
    tr = np.zeros(n)
    tr[0] = h[0] - l[0]
    for i in range(1, n):
        tr[i] = max(h[i] - l[i], abs(h[i] - c[i-1]), abs(l[i] - c[i-1]))
    result = [None] * n
    for i in range(period - 1, n):
        result[i] = float(np.mean(tr[i - period + 1: i + 1]))
    return result

def attach_indicators(klines: list, ma_periods=(5, 10, 20, 60, 120), atr_period=14, vol_ma=20):
    closes  = [k["close"]  for k in klines]
    highs   = [k["high"]   for k in klines]
    lows    = [k["low"]    for k in klines]
    volumes = [k["volume"] for k in klines]

    ma_data  = {f"ma{p}": calc_ma(closes,  p) for p in ma_periods}
    atr_data  = calc_atr(highs, lows, closes, atr_period)
    vol_ma_data = calc_ma(volumes, vol_ma)

    result = []
    for i, k in enumerate(klines):
        row = dict(k)
        for p in ma_periods:
            row[f"ma{p}"] = ma_data[f"ma{p}"][i]
        row["atr"]    = atr_data[i]
        row["vol_ma"] = vol_ma_data[i]
        result.append(row)
    return result
