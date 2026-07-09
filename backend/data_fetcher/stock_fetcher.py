"""
A股数据拉取器（基于 akshare）。

股票市场按需求只需要 1d 周期，不做分钟级拉取和聚合。
"""
import logging
import datetime

logger = logging.getLogger("data_fetcher.stock")

try:
    import akshare as ak
except ImportError:
    ak = None

from .db_writer import upsert_klines, get_latest_time

MARKET = "stock"
INTERVAL = "1d"


def _get_ak():
    if ak is None:
        raise RuntimeError("akshare 未安装，请在 requirements.txt 中确认 akshare 已加入并重新构建镜像")
    return ak


def _drop_up_to_last_negative(klines: list, symbol: str) -> list:
    """
    前复权(qfq)拉取股票历史K线时，如果这只股票上市时间很长、经历过多次分红/送股，
    前复权计算会把很早期的价格越调越低，调到变成负数（akshare/前复权算法的已知现象，
    不是抓取出错）。

    需求：只要某一天出现负数，说明它之前所有的复权基准都不可靠——哪怕中间有几天
    数值又变回正的，只要后面还会再出现负数，那些"夹在负数之间"的正数数据也不可信，
    一律不保留。只保留"最后一次出现负数"那天之后、从此再未出现负数的连续区间。

    做法：从前到后扫一遍，记录最后一个出现负值的下标，只保留它之后的部分。
    """
    last_negative_idx = -1
    for i, k in enumerate(klines):
        if k["open"] < 0 or k["high"] < 0 or k["low"] < 0 or k["close"] < 0:
            last_negative_idx = i
    if last_negative_idx == -1:
        return klines
    dropped = last_negative_idx + 1
    kept = klines[dropped:]
    logger.warning(
        f"[akshare] {symbol} 前复权价格出现负数，丢弃最早的 {dropped} 根K线"
        f"（最后一次负值出现在 {klines[last_negative_idx]['time']}），保留 {len(kept)} 根"
    )
    return kept


def _df_to_klines(df) -> list:
    """akshare stock_zh_a_hist 返回的DataFrame转为标准kline dict列表"""
    klines = []
    for _, row in df.iterrows():
        try:
            date_str = str(row["日期"])
            dt = datetime.datetime.strptime(date_str, "%Y-%m-%d")
            ts_ms = int(dt.timestamp() * 1000)
            klines.append({
                "time": ts_ms,
                "open": float(row["开盘"]),
                "high": float(row["最高"]),
                "low": float(row["最低"]),
                "close": float(row["收盘"]),
                "volume": float(row["成交量"]),
                "amount": float(row["成交额"]) if "成交额" in row and row["成交额"] not in (None, "") else None,
            })
        except (KeyError, ValueError, TypeError) as e:
            logger.warning(f"跳过无效行: {e}")
            continue
    return klines


def fetch_history(symbol: str, market: str = MARKET) -> dict:
    """首次拉取：从上市以来的全部日线历史"""
    akshare = _get_ak()
    df = akshare.stock_zh_a_hist(
        symbol=symbol, period="daily",
        start_date="19900101", end_date="20991231", adjust="qfq",
    )
    if df is None or df.empty:
        return {"inserted": 0, "updated": 0}

    klines = _df_to_klines(df)
    klines = _drop_up_to_last_negative(klines, symbol)
    if not klines:
        return {"inserted": 0, "updated": 0}
    result = upsert_klines(symbol, market, INTERVAL, klines, source="auto")
    logger.info(f"[akshare] {symbol} 历史拉取完成: {result}")
    return result


def fetch_incremental(symbol: str, market: str = MARKET) -> dict:
    """增量更新：只拉最近一段时间，足够覆盖上次更新后的缺口"""
    akshare = _get_ak()
    latest_ts = get_latest_time(symbol, INTERVAL)

    if latest_ts:
        start_dt = datetime.datetime.fromtimestamp(latest_ts / 1000) - datetime.timedelta(days=5)
    else:
        start_dt = datetime.datetime.now() - datetime.timedelta(days=30)

    df = akshare.stock_zh_a_hist(
        symbol=symbol, period="daily",
        start_date=start_dt.strftime("%Y%m%d"), end_date="20991231", adjust="qfq",
    )

    if df is None or df.empty:
        return {"inserted": 0, "updated": 0}

    klines = _df_to_klines(df)
    klines = _drop_up_to_last_negative(klines, symbol)
    if not klines:
        return {"inserted": 0, "updated": 0}
    result = upsert_klines(symbol, market, INTERVAL, klines, source="auto")
    logger.info(f"[akshare] {symbol} 增量更新完成: {result}")
    return result
