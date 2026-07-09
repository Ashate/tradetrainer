"""
清理数据库里已经存在的、被前复权(qfq)污染出现负价格的股票历史K线。

跟 stock_fetcher.py 里新加的过滤逻辑是同一个规则：只要某一天出现负数，就说明
它之前的复权基准不可靠——哪怕中间夹着几天正数，只要后面还会再出现负数，
那些"夹在负数之间"的正数也不保留，只留"最后一次负数"之后、从此没再出现负数的部分。

这个脚本只处理已经在库里的老数据（在stock_fetcher.py加上这个过滤逻辑之前抓的），
之后再抓的数据会在抓取时就自动过滤掉，不需要每次都跑这个脚本。

用法（在 backend 容器内执行）：
    # 清理配置文件里所有股票标的
    python scripts/clean_stock_negative_prices.py

    # 只清理某一只
    python scripts/clean_stock_negative_prices.py 600519

    # 先看看会删多少，不真的删（试运行）
    python scripts/clean_stock_negative_prices.py --dry-run
"""
import sys
import os
import argparse
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from database import SessionLocal
from models.kline import Kline
from data_fetcher import config_loader

INTERVAL = "1d"


def fmt_ts(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def clean_symbol(db, symbol: str, dry_run: bool) -> int:
    rows = (
        db.query(Kline)
        .filter(Kline.symbol == symbol, Kline.interval == INTERVAL, Kline.market == "stock")
        .order_by(Kline.time.asc())
        .all()
    )
    if not rows:
        print(f"  {symbol}: 无数据，跳过")
        return 0

    last_negative_idx = -1
    for i, k in enumerate(rows):
        if k.open < 0 or k.high < 0 or k.low < 0 or k.close < 0:
            last_negative_idx = i

    if last_negative_idx == -1:
        print(f"  {symbol}: ✓ 未发现负值，共{len(rows)}根，无需清理")
        return 0

    to_delete = rows[:last_negative_idx + 1]
    print(f"  {symbol}: ✗ 发现负值，最后一次出现在 {fmt_ts(rows[last_negative_idx].time)}，"
          f"需删除该日期及之前共 {len(to_delete)} 根（保留 {len(rows) - len(to_delete)} 根）")

    if dry_run:
        return len(to_delete)

    ids = [r.id for r in to_delete]
    db.query(Kline).filter(Kline.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return len(to_delete)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("symbol", nargs="?", default=None)
    parser.add_argument("--dry-run", action="store_true", help="只打印会删除多少，不真的执行删除")
    args = parser.parse_args()

    if args.symbol:
        symbols = [args.symbol]
    else:
        cfg = config_loader.load_config()
        symbols = [s["symbol"] for s in cfg.get("stock", [])]
        if not symbols:
            print("配置文件里没有找到股票标的，且未指定symbol参数")
            return

    db = SessionLocal()
    total_deleted = 0
    try:
        print(f"{'[试运行，不会真的删除数据] ' if args.dry_run else ''}开始检查 {len(symbols)} 个股票标的...")
        for symbol in symbols:
            total_deleted += clean_symbol(db, symbol, args.dry_run)
    finally:
        db.close()

    print(f"\n{'预计' if args.dry_run else '已'}删除 {total_deleted} 根被前复权负值污染的K线")


if __name__ == "__main__":
    main()
