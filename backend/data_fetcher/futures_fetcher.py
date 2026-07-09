"""
国内期货数据拉取器（基于 akshare 新浪期货接口）。

akshare 的 futures_zh_minute_sina(symbol, period) 提供分钟级数据(period可为'1','5','15','30','60')，
本系统统一用 1分钟粒度拉取后再聚合，与crypto的处理逻辑保持一致，复用同一套聚合器。
注意：新浪期货接口只能取到近期数据（通常几个月），不像加密货币交易所能拉很长历史，
这是数据源本身的限制。
"""
import logging
import datetime

logger = logging.getLogger("data_fetcher.futures")

try:
    import akshare as ak
except ImportError:
    ak = None

from .aggregator import aggregate_all_targets
from .db_writer import upsert_klines

MARKET = "futures"
BASE_INTERVAL = "1m"


def _get_ak():
    if ak is None:
        raise RuntimeError("akshare 未安装，请在 requirements.txt 中确认 akshare 已加入并重新构建镜像")
    return ak


def _df_to_klines(df) -> list:
    """akshare futures_zh_minute_sina 返回的DataFrame转为标准kline dict列表"""
    klines = []
    for _, row in df.iterrows():
        try:
            dt = datetime.datetime.strptime(str(row["datetime"]), "%Y-%m-%d %H:%M:%S")
            ts_ms = int(dt.timestamp() * 1000)
            klines.append({
                "time": ts_ms,
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"]) if row.get("volume") not in (None, "") else 0,
            })
        except (KeyError, ValueError, TypeError) as e:
            logger.warning(f"跳过无效行: {e}")
            continue
    return klines


def fetch_history(symbol: str, market: str = MARKET) -> dict:
    """
    首次拉取：新浪接口本身只返回近期可用的全部1分钟数据（数据源限制，无法指定起止时间），
    一次性拉取后聚合所有目标周期写入。
    """
    akshare = _get_ak()
    df = akshare.futures_zh_minute_sina(symbol=symbol, period="1")
    if df is None or df.empty:
        return {"base": {"inserted": 0, "updated": 0}, "aggregated": {}}

    base_klines = _df_to_klines(df)
    base_result = upsert_klines(symbol, market, BASE_INTERVAL, base_klines, source="auto")

    agg_results = {}
    aggregated = aggregate_all_targets(base_klines, BASE_INTERVAL, market)
    for interval, klines in aggregated.items():
        agg_results[interval] = upsert_klines(symbol, market, interval, klines, source="auto")

    logger.info(f"[akshare-futures] {symbol} 拉取完成: base={base_result}, agg={agg_results}")
    return {"base": base_result, "aggregated": agg_results}


def fetch_incremental(symbol: str, market: str = MARKET) -> dict:
    """
    增量更新：新浪接口不支持按时间范围查询，每次都是拉取当前可用的全部数据，
    upsert_klines会自动跳过已存在的时间点只写入新增部分，所以增量和首次拉取逻辑相同。
    """
    return fetch_history(symbol, market)
