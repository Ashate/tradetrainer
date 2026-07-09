"""
Binance 加密货币数据拉取器（基于 ccxt）。

策略：
- 首次拉取（标的新增）：
    1) 从1m粒度开始，向前拉取尽可能长的历史（受限于交易所返回上限，循环翻页直到拉不到
       更多数据），聚合出5m/15m/30m/1h/1d写入——这部分覆盖最近约35天的精细数据。
    2) 额外单独直接请求1d周期的长历史（可以拉到几年），与上一步聚合出的1d数据按时间戳
       自动合并（upsert按time去重，不会冲突）。这是必要的补充：仅靠1m聚合，1d最多只能
       覆盖35天，对于行情模块"自由查看历史"和模拟模块"随机选取历史时间点"都远远不够。
- 增量更新（定时任务）：同样分两步，1m增量聚合 + 1d直接增量，确保两条路径都持续更新。
"""
import time
import logging

logger = logging.getLogger("data_fetcher.binance")

try:
    import ccxt
except ImportError:
    ccxt = None

from .aggregator import aggregate_all_targets, INTERVAL_MS
from .db_writer import upsert_klines, get_latest_time, trim_old_data

BASE_INTERVAL = "1m"
MAX_HISTORY_BARS = 50_000  # 1m首次拉取上限（约35天），用于精细聚合5m/15m/30m/1h/1d
DAILY_MAX_BARS = 3000       # 1d周期单独拉取的上限（约8年），覆盖长历史浏览/随机起点需求


def _get_exchange():
    if ccxt is None:
        raise RuntimeError("ccxt 未安装，请在 requirements.txt 中确认 ccxt 已加入并重新构建镜像")
    ex = ccxt.binance({"enableRateLimit": True})
    return ex


def _ohlcv_to_dicts(ohlcv: list) -> list:
    return [
        {"time": row[0], "open": row[1], "high": row[2], "low": row[3], "close": row[4], "volume": row[5]}
        for row in ohlcv
    ]


def _fetch_daily_history(ex, exchange_symbol: str) -> list:
    """直接按1d周期翻页拉取长历史，不依赖1m聚合，能拉到交易所支持的最早数据"""
    all_bars = []
    cursor_since = int(time.time() * 1000) - DAILY_MAX_BARS * INTERVAL_MS["1d"]
    fetched = 0
    while fetched < DAILY_MAX_BARS:
        batch = ex.fetch_ohlcv(exchange_symbol, timeframe="1d", since=cursor_since, limit=1000)
        if not batch:
            break
        all_bars.extend(batch)
        fetched += len(batch)
        cursor_since = batch[-1][0] + 1
        if len(batch) < 1000:
            break
        time.sleep(ex.rateLimit / 1000)
    return all_bars


def _fetch_daily_incremental(ex, exchange_symbol: str, symbol: str) -> list:
    """1d周期增量：从数据库已有1d最新时间往后拉"""
    latest_ts = get_latest_time(symbol, "1d")
    since = (latest_ts + 1) if latest_ts else (int(time.time() * 1000) - 30 * INTERVAL_MS["1d"])
    all_bars = []
    cursor_since = since
    while True:
        batch = ex.fetch_ohlcv(exchange_symbol, timeframe="1d", since=cursor_since, limit=1000)
        if not batch:
            break
        all_bars.extend(batch)
        cursor_since = batch[-1][0] + 1
        if len(batch) < 1000:
            break
        time.sleep(ex.rateLimit / 1000)
    return all_bars


def fetch_history(symbol: str, exchange_symbol: str, market: str = "crypto") -> dict:
    """
    首次拉取：1m精细历史(聚合出5m/15m/30m/1h/1d) + 1d独立长历史(补全更早的日线)。
    返回各周期写入统计。
    """
    ex = _get_exchange()
    all_bars = []
    fetched_total = 0
    cursor_since = int(time.time() * 1000) - MAX_HISTORY_BARS * INTERVAL_MS[BASE_INTERVAL]

    while fetched_total < MAX_HISTORY_BARS:
        batch = ex.fetch_ohlcv(exchange_symbol, timeframe=BASE_INTERVAL, since=cursor_since, limit=1000)
        if not batch:
            break
        all_bars.extend(batch)
        fetched_total += len(batch)
        cursor_since = batch[-1][0] + 1
        if len(batch) < 1000:
            break
        time.sleep(ex.rateLimit / 1000)

    agg_results = {}
    base_result = {"inserted": 0, "updated": 0}
    if all_bars:
        base_klines = _ohlcv_to_dicts(all_bars)
        base_result = upsert_klines(symbol, market, BASE_INTERVAL, base_klines, source="auto")

        aggregated = aggregate_all_targets(base_klines, BASE_INTERVAL, market)
        for interval, klines in aggregated.items():
            agg_results[interval] = upsert_klines(symbol, market, interval, klines, source="auto")

        # 1m粒度数据本身不用于训练，写入后立即裁剪，只保留最近一部分用于聚合增量
        trim_old_data(symbol, BASE_INTERVAL, keep_latest=10_000)

    # 额外补充：直接拉取1d长历史，与上面聚合出的1d数据按时间戳自动合并去重
    daily_bars = _fetch_daily_history(ex, exchange_symbol)
    if daily_bars:
        daily_klines = _ohlcv_to_dicts(daily_bars)
        daily_result = upsert_klines(symbol, market, "1d", daily_klines, source="auto")
        agg_results["1d"] = {
            "inserted": agg_results.get("1d", {}).get("inserted", 0) + daily_result["inserted"],
            "updated":  agg_results.get("1d", {}).get("updated", 0) + daily_result["updated"],
        }

    logger.info(f"[Binance] {symbol} 历史拉取完成: base={base_result}, agg={agg_results}")
    return {"base": base_result, "aggregated": agg_results}


def fetch_incremental(symbol: str, exchange_symbol: str, market: str = "crypto") -> dict:
    """
    增量更新：1m增量聚合 + 1d独立增量，两条路径都更新到最新。
    """
    ex = _get_exchange()
    latest_ts = get_latest_time(symbol, BASE_INTERVAL)

    since = (latest_ts + 1) if latest_ts else (int(time.time() * 1000) - 2000 * INTERVAL_MS[BASE_INTERVAL])

    all_bars = []
    cursor_since = since
    while True:
        batch = ex.fetch_ohlcv(exchange_symbol, timeframe=BASE_INTERVAL, since=cursor_since, limit=1000)
        if not batch:
            break
        all_bars.extend(batch)
        cursor_since = batch[-1][0] + 1
        if len(batch) < 1000:
            break
        time.sleep(ex.rateLimit / 1000)

    agg_results = {}
    base_result = {"inserted": 0, "updated": 0}
    if all_bars:
        base_klines = _ohlcv_to_dicts(all_bars)
        base_result = upsert_klines(symbol, market, BASE_INTERVAL, base_klines, source="auto")

        # 增量聚合：为保证聚合桶完整（例如1h桶需要60根1m数据才能正确聚合），
        # 重新取最近一段1m数据（覆盖足够多的桶）做聚合，upsert会自动处理去重更新
        recent_klines = _get_recent_base_klines(symbol, BASE_INTERVAL, lookback_ms=26 * 60 * 60_000)
        aggregated = aggregate_all_targets(recent_klines, BASE_INTERVAL, market)
        for interval, klines in aggregated.items():
            agg_results[interval] = upsert_klines(symbol, market, interval, klines, source="auto")

        trim_old_data(symbol, BASE_INTERVAL, keep_latest=10_000)

    # 额外补充：1d周期独立增量
    daily_bars = _fetch_daily_incremental(ex, exchange_symbol, symbol)
    if daily_bars:
        daily_klines = _ohlcv_to_dicts(daily_bars)
        daily_result = upsert_klines(symbol, market, "1d", daily_klines, source="auto")
        agg_results["1d"] = {
            "inserted": agg_results.get("1d", {}).get("inserted", 0) + daily_result["inserted"],
            "updated":  agg_results.get("1d", {}).get("updated", 0) + daily_result["updated"],
        }

    logger.info(f"[Binance] {symbol} 增量更新完成: base={base_result}, agg={agg_results}")
    return {"base": base_result, "aggregated": agg_results}


def _get_recent_base_klines(symbol: str, interval: str, lookback_ms: int) -> list:
    """从数据库读出最近一段基础周期K线，用于重新聚合（保证跨增量边界的桶完整）"""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from database import SessionLocal
    from models.kline import Kline
    import time as _time

    db = SessionLocal()
    try:
        cutoff = int(_time.time() * 1000) - lookback_ms
        rows = (
            db.query(Kline)
            .filter(Kline.symbol == symbol, Kline.interval == interval, Kline.time >= cutoff)
            .order_by(Kline.time)
            .all()
        )
        return [
            {"time": r.time, "open": r.open, "high": r.high, "low": r.low,
             "close": r.close, "volume": r.volume, "amount": r.amount, "open_interest": r.open_interest}
            for r in rows
        ]
    finally:
        db.close()
