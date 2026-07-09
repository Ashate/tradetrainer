"""
K线综合缺口检测脚本——一次跑完两种"缺口"检测：

1. 时间戳缺口：数据库里两根K线之间少了记录（真实数据抓取问题，加密货币7*24连续
   交易理论上不应该有，出现了大概率是抓取/聚合逻辑的bug）。
2. 价格跳空缺口：相邻两根K线时间戳是连续的（没有缺记录），但价格区间不重叠
   （后一根的低点比前一根高点还高，或者反过来）。这在剧烈波动行情下是正常现象，
   不代表数据有问题——但如果"后一根开盘价"离"前一根收盘价"很远，那就值得怀疑
   数据本身有异常。

用法（在 backend 容器内执行）：
    # 检查配置文件里所有加密货币标的的全部周期(1m/5m/15m/30m/1h/1d)
    python scripts/check_kline_gaps_full.py

    # 只检查某个标的的全部周期
    python scripts/check_kline_gaps_full.py ETHUSDT

    # 只检查某个标的的某个周期
    python scripts/check_kline_gaps_full.py ETHUSDT 1d

    # 调整价格跳空的最小报告阈值（默认0.1%，即跳空幅度低于此忽略不报）
    python scripts/check_kline_gaps_full.py ETHUSDT 1d --min-pct 0.5
"""
import sys
import os
import argparse
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from database import SessionLocal
from models.kline import Kline
from data_fetcher import config_loader
from data_fetcher.aggregator import INTERVAL_MS

ALL_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "1d"]


def fmt_ts(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def fmt_duration(ms: int) -> str:
    minutes = ms / 60_000
    if minutes < 60:
        return f"{minutes:.0f}分钟"
    hours = minutes / 60
    if hours < 48:
        return f"{hours:.1f}小时"
    return f"{hours/24:.1f}天"


def check_time_gaps(rows, step_ms):
    """检测时间戳缺口，rows为按time升序排列的Kline对象列表"""
    gaps = []
    for i in range(1, len(rows)):
        diff = rows[i].time - rows[i-1].time
        if diff > step_ms:
            missing_bars = diff // step_ms - 1
            gaps.append((rows[i-1].time, rows[i].time, missing_bars))
    return gaps


def check_price_gaps(rows, min_pct):
    """检测价格跳空缺口"""
    found = []
    for i in range(1, len(rows)):
        prev, cur = rows[i-1], rows[i]
        if cur.low > prev.high:
            gap_pct = (cur.low - prev.high) / prev.high * 100
            direction = "向上跳空"
        elif cur.high < prev.low:
            gap_pct = (prev.low - cur.high) / prev.low * 100
            direction = "向下跳空"
        else:
            continue
        if gap_pct < min_pct:
            continue
        open_vs_close_pct = abs(cur.open - prev.close) / prev.close * 100
        found.append((prev, cur, direction, gap_pct, open_vs_close_pct))
    return found


def check_symbol_interval(db, symbol: str, interval: str, min_pct: float):
    step = INTERVAL_MS[interval]
    rows = (
        db.query(Kline)
        .filter(Kline.symbol == symbol, Kline.interval == interval)
        .order_by(Kline.time.asc())
        .all()
    )
    n = len(rows)
    if n < 2:
        print(f"  [{interval:>4}] 只有 {n} 条数据，跳过检测")
        return

    span_days = (rows[-1].time - rows[0].time) / 86_400_000
    expected_count = (rows[-1].time - rows[0].time) // step + 1
    completeness = n / expected_count * 100 if expected_count else 100

    # ── 时间戳缺口 ──
    time_gaps = check_time_gaps(rows, step)
    if not time_gaps:
        print(f"  [{interval:>4}] 时间戳: ✓ 无缺口，共{n}根，覆盖{span_days:.1f}天，完整度{completeness:.2f}%")
    else:
        total_missing = sum(g[2] for g in time_gaps)
        print(f"  [{interval:>4}] 时间戳: ✗ {len(time_gaps)}处缺口，共缺{total_missing}根，完整度{completeness:.2f}%")
        for start, end, missing in sorted(time_gaps, key=lambda g: -g[2])[:5]:
            print(f"           缺口: {fmt_ts(start)} → {fmt_ts(end)}，缺{missing}根（约{fmt_duration(end-start)}）")
        if len(time_gaps) > 5:
            print(f"           ...还有{len(time_gaps)-5}处较小缺口未列出")

    # ── 价格跳空 ──
    price_gaps = check_price_gaps(rows, min_pct)
    if not price_gaps:
        print(f"  [{interval:>4}] 价格跳空: ✓ 未发现超过{min_pct}%的跳空")
    else:
        print(f"  [{interval:>4}] 价格跳空: 发现{len(price_gaps)}处（阈值{min_pct}%）")
        for prev, cur, direction, gap_pct, ocp in sorted(price_gaps, key=lambda g: -g[3])[:5]:
            flag = "  ⚠ 开盘价与前收盘价相差较大，建议核查数据" if ocp > 0.05 else ""
            print(f"           {fmt_ts(prev.time)} → {fmt_ts(cur.time)}  {direction} {gap_pct:.2f}%"
                  f"（开盘价偏离前收盘{ocp:.2f}%）{flag}")
        if len(price_gaps) > 5:
            print(f"           ...还有{len(price_gaps)-5}处较小跳空未列出（用 --min-pct 调大阈值可以只看大的）")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("symbol", nargs="?", default=None)
    parser.add_argument("interval", nargs="?", default=None)
    parser.add_argument("--min-pct", type=float, default=0.1, help="价格跳空最小报告阈值（百分比），默认0.1")
    args = parser.parse_args()

    if args.symbol:
        symbols = [args.symbol]
    else:
        cfg = config_loader.load_config()
        symbols = [s["symbol"] for s in cfg.get("crypto", [])]
        if not symbols:
            print("配置文件里没有找到加密货币标的，且未指定symbol参数")
            return

    intervals = [args.interval] if args.interval else ALL_INTERVALS

    db = SessionLocal()
    try:
        for symbol in symbols:
            print(f"\n=== {symbol} ===")
            for interval in intervals:
                check_symbol_interval(db, symbol, interval, args.min_pct)
    finally:
        db.close()


if __name__ == "__main__":
    main()
