"""
统一的K线写入器。所有数据来源（Binance自动拉取、akshare自动拉取、手动CSV导入聚合后）
都通过这里写入数据库，保证去重/更新逻辑只有一处实现。
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from database import SessionLocal
from models.kline import Kline


def upsert_klines(symbol: str, market: str, interval: str, klines: list, source: str = "auto") -> dict:
    """
    写入一批K线到数据库。按 (symbol, interval, time) 做去重：
    - 已存在的时间点：更新 OHLCV（应对交易所回补/修正数据的情况，或手动数据源重新上传时的合并）
    - 不存在的时间点：插入新记录
    source: "auto"(自动拉取) | "manual"(手动上传)。新插入的记录会打上这个标记；
    更新已存在记录时不修改source（避免自动增量误把手动数据源标记改回auto，或反之）。
    返回 {"inserted": n, "updated": n}
    """
    if not klines:
        return {"inserted": 0, "updated": 0}

    db = SessionLocal()
    inserted = updated = 0
    try:
        existing_times = set(
            row[0] for row in
            db.query(Kline.time).filter(Kline.symbol == symbol, Kline.interval == interval).all()
        )

        new_rows = []
        for k in klines:
            t = int(k["time"])
            if t in existing_times:
                db.query(Kline).filter(
                    Kline.symbol == symbol, Kline.interval == interval, Kline.time == t
                ).update({
                    "open": k["open"], "high": k["high"], "low": k["low"],
                    "close": k["close"], "volume": k["volume"],
                    "amount": k.get("amount"), "open_interest": k.get("open_interest"),
                })
                updated += 1
            else:
                new_rows.append(Kline(
                    symbol=symbol, market=market, interval=interval, time=t,
                    open=k["open"], high=k["high"], low=k["low"], close=k["close"],
                    volume=k["volume"], amount=k.get("amount"), open_interest=k.get("open_interest"),
                    source=source,
                ))
                inserted += 1

        if new_rows:
            db.bulk_save_objects(new_rows)
        db.commit()
    finally:
        db.close()

    return {"inserted": inserted, "updated": updated}


def get_data_count(symbol: str, interval: str) -> int:
    db = SessionLocal()
    try:
        return db.query(Kline).filter(Kline.symbol == symbol, Kline.interval == interval).count()
    finally:
        db.close()


def is_manual_source(symbol: str, interval: str) -> bool:
    """该symbol+interval的数据是否是手动上传的（任一来源标记为manual即认为是手动维护，
    定时任务应跳过，避免覆盖用户自己维护的数据）。"""
    db = SessionLocal()
    try:
        row = (
            db.query(Kline.source)
            .filter(Kline.symbol == symbol, Kline.interval == interval, Kline.source == "manual")
            .first()
        )
        return row is not None
    finally:
        db.close()


def get_latest_time(symbol: str, interval: str):
    db = SessionLocal()
    try:
        row = (
            db.query(Kline.time)
            .filter(Kline.symbol == symbol, Kline.interval == interval)
            .order_by(Kline.time.desc())
            .first()
        )
        return row[0] if row else None
    finally:
        db.close()


def trim_old_data(symbol: str, interval: str, keep_latest: int = 5000):
    """只保留最新N根，避免单个品种数据量无限增长拖慢查询"""
    db = SessionLocal()
    try:
        total = db.query(Kline).filter(Kline.symbol == symbol, Kline.interval == interval).count()
        if total <= keep_latest:
            return 0
        cutoff_row = (
            db.query(Kline.time)
            .filter(Kline.symbol == symbol, Kline.interval == interval)
            .order_by(Kline.time.desc())
            .offset(keep_latest - 1)
            .limit(1)
            .first()
        )
        if not cutoff_row:
            return 0
        cutoff_time = cutoff_row[0]
        deleted = (
            db.query(Kline)
            .filter(Kline.symbol == symbol, Kline.interval == interval, Kline.time < cutoff_time)
            .delete()
        )
        db.commit()
        return deleted
    finally:
        db.close()
