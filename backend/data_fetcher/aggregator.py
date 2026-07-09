"""
K线周期聚合器。

将细粒度K线（1m / 5m）按时间桶聚合成粗粒度K线（5m / 15m / 30m / 1h / 1d）。
标准OHLCV聚合规则：
  open   = 桶内第一根的 open
  high   = 桶内所有 high 的最大值
  low    = 桶内所有 low 的最小值
  close  = 桶内最后一根的 close
  volume = 桶内所有 volume 求和
  amount = 桶内所有 amount 求和（若存在）

时间桶按 UTC 自然对齐（例如 1h 桶从每小时 00 分开始），与各交易所/数据源的对齐惯例一致。
"""

INTERVAL_MS = {
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "30m": 30 * 60_000,
    "1h": 60 * 60_000,
    "1d": 24 * 60 * 60_000,
}

# 支持聚合的目标周期（按从小到大顺序，便于链式聚合）
AGGREGATABLE_TARGETS = ["5m", "15m", "30m", "1h", "1d"]


def _bucket_start(ts_ms: int, bucket_ms: int) -> int:
    """计算时间戳所属的对齐桶起始时间"""
    return (ts_ms // bucket_ms) * bucket_ms


def aggregate(klines: list, target_interval: str) -> list:
    """
    将一组K线（dict列表，含time/open/high/low/close/volume/amount字段，按time升序排列）
    聚合为目标周期。klines的粒度必须严格小于target_interval，否则直接返回空列表。
    """
    if target_interval not in INTERVAL_MS:
        raise ValueError(f"不支持的目标周期: {target_interval}")
    if not klines:
        return []

    bucket_ms = INTERVAL_MS[target_interval]
    buckets = {}  # bucket_start_ts -> 聚合中的K线dict

    for k in klines:
        bstart = _bucket_start(k["time"], bucket_ms)
        if bstart not in buckets:
            buckets[bstart] = {
                "time": bstart,
                "open": k["open"],
                "high": k["high"],
                "low": k["low"],
                "close": k["close"],
                "volume": k["volume"] or 0,
                "amount": k.get("amount") or 0,
                "open_interest": k.get("open_interest"),  # 取桶内最后一个值
            }
        else:
            b = buckets[bstart]
            b["high"] = max(b["high"], k["high"])
            b["low"] = min(b["low"], k["low"])
            b["close"] = k["close"]  # 持续覆盖，最后一次即为桶内最后一根的close
            b["volume"] += (k["volume"] or 0)
            b["amount"] += (k.get("amount") or 0)
            if k.get("open_interest") is not None:
                b["open_interest"] = k["open_interest"]

    return [buckets[ts] for ts in sorted(buckets.keys())]


def aggregate_all_targets(base_klines: list, base_interval: str, market: str) -> dict:
    """
    从基础周期（1m或5m）一次性聚合出所有更粗的目标周期。
    股票市场不做聚合（只用1d，且akshare直接返回日线，不需要从分钟聚合）。
    返回 {interval: [klines...]}，不包含base_interval本身。
    """
    if market == "stock":
        return {}

    if base_interval not in ("1m", "5m"):
        # 非1m/5m的数据不做自动聚合（按用户需求：只有1m/5m手动上传才需要整理）
        return {}

    base_ms = INTERVAL_MS[base_interval]
    result = {}
    for target in AGGREGATABLE_TARGETS:
        target_ms = INTERVAL_MS[target]
        if target_ms <= base_ms:
            continue  # 跳过比基础周期还小或相等的目标
        result[target] = aggregate(base_klines, target)
    return result
