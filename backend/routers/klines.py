import random
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models.kline import Kline
from models.user import User
from routers.auth import get_current_user
from services.indicators import attach_indicators
from data_fetcher import config_loader

router = APIRouter(prefix="/klines", tags=["klines"])

def _display_name_map() -> dict:
    """symbol -> display_name，来自 symbols_config.json；找不到就用symbol本身兜底
    （比如手动导入、没写进配置文件的标的）。"""
    return {s["symbol"]: s.get("display_name", s["symbol"]) for s in config_loader.list_all_symbols()}

# 训练配置（与前端保持一致）
WARMUP_N = 300   # 指标预热数
REF_N    = 50    # 参考段
TRAIN_N  = 70    # 训练段
TOTAL_NEED = WARMUP_N + REF_N + TRAIN_N  # 至少需要420根

@router.get("/symbols")
def list_symbols(market: str = None, db: Session = Depends(get_db)):
    # 同时返回 interval，让前端知道该用哪个周期
    q = db.query(Kline.symbol, Kline.market, Kline.interval).distinct()
    if market:
        q = q.filter(Kline.market == market)
    rows = q.all()
    name_map = _display_name_map()
    # 只返回数据量足够的品种
    result = []
    seen = set()
    for symbol, market_val, interval in rows:
        key = (symbol, interval)
        if key in seen:
            continue
        count = db.query(Kline).filter(
            Kline.symbol == symbol,
            Kline.interval == interval
        ).count()
        if count >= TOTAL_NEED:
            seen.add(key)
            # 取该symbol+interval下是否存在任意一条manual记录，用于前端标注"手动"
            has_manual = db.query(Kline).filter(
                Kline.symbol == symbol, Kline.interval == interval, Kline.source == "manual"
            ).first() is not None
            result.append({
                "symbol":       symbol,
                "display_name": name_map.get(symbol, symbol),
                "market":       market_val,
                "interval":     interval,
                "count":        count,
                "source":       "manual" if has_manual else "auto",
            })
    return result

@router.get("/intervals")
def list_intervals(symbol: str, db: Session = Depends(get_db)):
    rows = db.query(Kline.interval).filter(Kline.symbol == symbol).distinct().all()
    return [r[0] for r in rows]

@router.get("/symbols-by-market")
def symbols_by_market(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """按市场返回品种列表，只返回数据量足够的品种"""
    rows = db.query(Kline.symbol, Kline.market, Kline.interval).distinct().all()
    name_map = _display_name_map()
    result = {}
    for symbol, market, interval in rows:
        count = db.query(Kline).filter(
            Kline.symbol == symbol, Kline.interval == interval
        ).count()
        if count >= TOTAL_NEED:
            key = market
            if key not in result:
                result[key] = []
            existing = [x for x in result[key] if x["symbol"] == symbol]
            if not existing:
                result[key].append({
                    "symbol": symbol, "display_name": name_map.get(symbol, symbol),
                    "market": market, "interval": interval, "count": count,
                })
    return result

@router.get("/train-data")
def get_train_data(
    symbol: str,
    interval: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    一次性返回完整训练数据：
    - warmup(300) + ref(50) + train(70) = 420 根
    - 随机选取起始位置
    - 包含指标计算结果（MA、ATR）
    """
    total = db.query(Kline).filter(
        Kline.symbol == symbol, Kline.interval == interval
    ).count()

    if total < TOTAL_NEED:
        raise HTTPException(400, f"数据量不足：需要至少 {TOTAL_NEED} 根K线，当前只有 {total} 根")

    # 随机选取起始点（确保后面还有足够数据）
    max_start = total - TOTAL_NEED
    start_offset = random.randint(0, max_start)

    rows = (
        db.query(Kline)
        .filter(Kline.symbol == symbol, Kline.interval == interval)
        .order_by(Kline.time)
        .offset(start_offset)
        .limit(TOTAL_NEED)
        .all()
    )

    if len(rows) < TOTAL_NEED:
        raise HTTPException(500, "数据读取异常，请重试")

    klines = [
        {
            "time": r.time, "open": r.open, "high": r.high,
            "low": r.low,   "close": r.close, "volume": r.volume,
            "amount": r.amount, "open_interest": r.open_interest,
        }
        for r in rows
    ]

    # 计算指标（基于全量数据，保证准确）
    with_indicators = attach_indicators(klines)

    return {
        "warmup_n":  WARMUP_N,
        "ref_n":     REF_N,
        "train_n":   TRAIN_N,
        "total":     len(with_indicators),
        "klines":    with_indicators,
        # 告诉前端各段的起始index
        "ref_start":   WARMUP_N,
        "train_start": WARMUP_N + REF_N,
    }

@router.get("/market-data")
def get_market_data(
    symbol: str,
    interval: str,
    before: int = None,   # 时间戳(ms)：返回该时间之前的K线（用于向左滚动加载更多历史）
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    行情模块专用：分页加载K线。
    - before=None：返回最新的 limit 根（初始视图）
    - before=<ts>：返回该时间点之前的 limit 根（向左滚动加载历史）
    返回按时间升序排列，方便前端直接拼接到现有数据前面。
    """
    limit = min(max(limit, 10), 1000)  # 防止恶意超大请求

    q = db.query(Kline).filter(Kline.symbol == symbol, Kline.interval == interval)
    if before is not None:
        q = q.filter(Kline.time < before)

    rows = q.order_by(Kline.time.desc()).limit(limit).all()
    rows.reverse()  # 转回升序

    klines = [
        {
            "time": r.time, "open": r.open, "high": r.high,
            "low": r.low, "close": r.close, "volume": r.volume,
            "amount": r.amount, "open_interest": r.open_interest,
        }
        for r in rows
    ]

    has_more = False
    if klines:
        earlier_count = (
            db.query(Kline)
            .filter(Kline.symbol == symbol, Kline.interval == interval, Kline.time < klines[0]["time"])
            .count()
        )
        has_more = earlier_count > 0

    return {"klines": klines, "has_more": has_more}


# 保留旧接口兼容性
@router.get("/session-start")
def get_session_start(
    symbol: str,
    interval: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    total = db.query(Kline).filter(Kline.symbol == symbol, Kline.interval == interval).count()
    if total < TOTAL_NEED:
        raise HTTPException(400, f"数据量不足")
    start_idx = random.randint(0, total - TOTAL_NEED)
    row = (
        db.query(Kline.time)
        .filter(Kline.symbol == symbol, Kline.interval == interval)
        .order_by(Kline.time)
        .offset(start_idx + WARMUP_N + REF_N)
        .limit(1)
        .scalar()
    )
    return {"start_index": start_idx, "start_ts": row, "total": total}
