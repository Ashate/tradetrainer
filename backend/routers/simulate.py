"""
模拟交易路由。

核心概念：
  - SimSession(会话): 从随机/手动选定的历史时间点开始走图，一直走到该标的已加载数据的
    最新一根才结束(status变为ended)。用户可以在同一个session里反复开仓/平仓。
  - SimTrade(交易记录): 每完成一次"开仓->对应仓位全部平仓"的周期，立即写入一条交易记录，
    session继续保持active，不会因为某次平仓后暂时没有持仓就结束。这是统计/历史页展示的最小单位。

核心流程：
  1. GET /simulate/account          获取/初始化虚拟账户(余额+杠杆设置)
  2. PUT /simulate/account          修改余额/杠杆
  3. POST /simulate/session/start   开始一局模拟(随机或手动选标的，随机起始时间点)
  4. GET  /simulate/session/data    获取本局的K线窗口数据
  5. POST /simulate/order/open      开仓(市价/挂单，含止盈止损)
  6. POST /simulate/order/close     手动平仓 -> 写入一条SimTrade记录
  7. PUT  /simulate/order/update-sltp 持仓中修改止盈止损
  8. POST /simulate/order/cancel    取消挂单
  9. POST /simulate/session/advance 走图前进一根(检查挂单成交/止盈止损/强平，触发的平仓都会写入
                                     SimTrade记录；若走到最新一根且仍有持仓会强制平仓并写入记录，
                                     随后session标记为ended)
  10. GET /simulate/trades          交易记录列表(历史记录页用这个，不是session列表)
  11. GET /simulate/stats           统计数据(基于SimTrade聚合)
  12. GET /simulate/orders          某局会话当前的全部订单(持仓面板用)
"""
import random
import sys
import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from database import get_db
from models.kline import Kline
from models.sim_account import SimAccount
from models.sim_session import SimSession
from models.sim_order import SimOrder
from models.sim_trade import SimTrade
from models.user import User
from routers.auth import get_current_user
from services.sim_calc import (
    calc_margin, calc_pnl, calc_equity, calc_liquidation_price,
    check_bar_for_liquidation,
)

router = APIRouter(prefix="/simulate", tags=["simulate"])

WARMUP_N = 300
MIN_FUTURE_N = 50


class AccountUpdate(BaseModel):
    balance: Optional[float] = None
    leverage: Optional[int] = None


def _get_or_create_account(db: Session, user_id: int) -> SimAccount:
    acc = db.query(SimAccount).filter(SimAccount.user_id == user_id).first()
    if not acc:
        acc = SimAccount(user_id=user_id, balance=10000.0, leverage=10)
        db.add(acc)
        db.commit()
        db.refresh(acc)
    return acc


def _record_trade(db: Session, order: SimOrder, symbol: str, market: str, exit_price: float, exit_time: int,
                   exit_reason: str, account_balance_before_close: float, liquidated: bool = False) -> SimTrade:
    """
    平仓时调用：根据订单信息+实际平仓价写入一条独立的交易记录。
    pnl_pct 用"平仓前账户余额"作为基准，反映这笔交易相对当时本金的收益率。
    """
    pnl = calc_pnl(order.entry_price, order.quantity, order.direction, exit_price)
    pnl_pct = (pnl / account_balance_before_close * 100) if account_balance_before_close > 0 else 0
    trade = SimTrade(
        session_id=order.session_id, user_id=order.user_id,
        symbol=symbol, market=market,
        direction=order.direction, quantity=order.quantity, leverage=order.leverage,
        entry_price=order.entry_price, entry_time=order.entry_time,
        exit_price=exit_price, exit_time=exit_time, exit_reason=exit_reason,
        pnl=pnl, pnl_pct=pnl_pct, liquidated=1 if liquidated else 0,
    )
    db.add(trade)
    return trade


@router.get("/account")
def get_account(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    acc = _get_or_create_account(db, current_user.id)
    return {"balance": acc.balance, "leverage": acc.leverage}


@router.put("/account")
def update_account(
    payload: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    acc = _get_or_create_account(db, current_user.id)
    if payload.balance is not None:
        if payload.balance < 0:
            raise HTTPException(400, "余额不能为负数")
        acc.balance = payload.balance
    if payload.leverage is not None:
        if not (1 <= payload.leverage <= 100):
            raise HTTPException(400, "杠杆倍数必须在1-100之间")
        acc.leverage = payload.leverage
    db.commit()
    return {"balance": acc.balance, "leverage": acc.leverage}


class SessionStart(BaseModel):
    symbol: Optional[str] = None
    market: str
    interval: str


@router.post("/session/start")
def start_session(
    payload: SessionStart,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    symbol = payload.symbol
    if not symbol:
        candidates = (
            db.query(Kline.symbol)
            .filter(Kline.market == payload.market, Kline.interval == payload.interval)
            .distinct()
            .all()
        )
        if not candidates:
            raise HTTPException(400, f"{payload.market} 市场下没有可用标的，请先在设置中导入数据")
        symbol = random.choice(candidates)[0]

    total = (
        db.query(Kline)
        .filter(Kline.symbol == symbol, Kline.interval == payload.interval)
        .count()
    )
    min_needed = WARMUP_N + MIN_FUTURE_N
    if total < min_needed:
        raise HTTPException(400, f"{symbol} 数据量不足：需要至少 {min_needed} 根，当前只有 {total} 根")

    max_start_offset = total - min_needed
    start_offset = random.randint(0, max_start_offset)
    start_idx = WARMUP_N + start_offset

    start_row = (
        db.query(Kline)
        .filter(Kline.symbol == symbol, Kline.interval == payload.interval)
        .order_by(Kline.time)
        .offset(start_idx)
        .limit(1)
        .first()
    )
    if not start_row:
        raise HTTPException(500, "数据读取异常，请重试")

    acc = _get_or_create_account(db, current_user.id)

    sess = SimSession(
        user_id=current_user.id, symbol=symbol, market=payload.market, interval=payload.interval,
        start_time=start_row.time, initial_balance=acc.balance, leverage=acc.leverage,
        status="active",
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)

    return {
        "session_id": sess.id, "symbol": symbol, "market": payload.market, "interval": payload.interval,
        "start_time": start_row.time, "balance": acc.balance, "leverage": acc.leverage,
    }


@router.get("/session/data")
def get_session_data(
    session_id: int,
    current_idx_time: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sess = db.query(SimSession).filter(SimSession.id == session_id, SimSession.user_id == current_user.id).first()
    if not sess:
        raise HTTPException(404, "未找到该会话")

    cutoff_time = current_idx_time if current_idx_time else sess.start_time

    rows = (
        db.query(Kline)
        .filter(Kline.symbol == sess.symbol, Kline.interval == sess.interval, Kline.time <= cutoff_time)
        .order_by(Kline.time.desc())
        .limit(WARMUP_N + 2000)
        .all()
    )
    rows.reverse()

    klines = [
        {"time": r.time, "open": r.open, "high": r.high, "low": r.low, "close": r.close, "volume": r.volume}
        for r in rows
    ]

    latest_row = (
        db.query(Kline.time)
        .filter(Kline.symbol == sess.symbol, Kline.interval == sess.interval)
        .order_by(Kline.time.desc())
        .first()
    )
    at_end = latest_row and cutoff_time >= latest_row[0]

    next_row = (
        db.query(Kline.time)
        .filter(Kline.symbol == sess.symbol, Kline.interval == sess.interval, Kline.time > cutoff_time)
        .order_by(Kline.time)
        .limit(1)
        .first()
    )
    next_time = next_row[0] if next_row else None

    return {"klines": klines, "at_end": bool(at_end), "next_time": next_time}


# ─── 订单操作 ─────────────────────────────────────────────────────────────────

class OrderOpen(BaseModel):
    session_id: int
    type: str = "market"
    direction: str
    quantity: float
    limit_price: Optional[float] = None
    current_price: float
    current_time: int
    sl_price: Optional[float] = None
    sl_qty: Optional[float] = None
    tp_price: Optional[float] = None
    tp_qty: Optional[float] = None


@router.post("/order/open")
def open_order(
    payload: OrderOpen,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sess = db.query(SimSession).filter(SimSession.id == payload.session_id, SimSession.user_id == current_user.id, SimSession.status == "active").first()
    if not sess:
        raise HTTPException(404, "未找到该会话或会话已结算")
    if payload.direction not in ("long", "short"):
        raise HTTPException(400, "direction 必须是 long 或 short")
    if payload.quantity <= 0:
        raise HTTPException(400, "数量必须大于0")

    # 校验止盈止损方向合理性，防止填反导致创建后立即被判定触发(后端兜底校验，前端已有同样校验)
    entry_ref = payload.current_price if payload.type == "market" else payload.limit_price
    if payload.sl_price is not None and entry_ref is not None:
        if payload.direction == "long" and payload.sl_price >= entry_ref:
            raise HTTPException(400, "多单止损价必须低于开仓价")
        if payload.direction == "short" and payload.sl_price <= entry_ref:
            raise HTTPException(400, "空单止损价必须高于开仓价")
    if payload.tp_price is not None and entry_ref is not None:
        if payload.direction == "long" and payload.tp_price <= entry_ref:
            raise HTTPException(400, "多单止盈价必须高于开仓价")
        if payload.direction == "short" and payload.tp_price >= entry_ref:
            raise HTTPException(400, "空单止盈价必须低于开仓价")

    acc = _get_or_create_account(db, current_user.id)

    if payload.type == "market":
        entry_price = payload.current_price
        margin = calc_margin(entry_price, payload.quantity, sess.leverage)
        if margin > acc.balance:
            raise HTTPException(400, f"保证金不足：需要 {margin:.2f}，账户余额 {acc.balance:.2f}")

        liq_price = calc_liquidation_price(entry_price, payload.quantity, sess.leverage, payload.direction)
        order = SimOrder(
            session_id=sess.id, user_id=current_user.id, type="market", direction=payload.direction,
            quantity=payload.quantity, leverage=sess.leverage,
            entry_price=entry_price, entry_time=payload.current_time,
            sl_price=payload.sl_price, sl_qty=payload.sl_qty,
            tp_price=payload.tp_price, tp_qty=payload.tp_qty,
            margin=margin, liq_price=liq_price, status="open",
        )
        acc.balance -= margin
        db.add(order)
        db.commit()
        db.refresh(order)
        return {"order_id": order.id, "status": "open", "entry_price": entry_price, "margin": margin, "liq_price": liq_price, "balance": acc.balance}

    elif payload.type == "limit":
        if payload.limit_price is None:
            raise HTTPException(400, "挂单需要提供 limit_price")
        margin = calc_margin(payload.limit_price, payload.quantity, sess.leverage)
        if margin > acc.balance:
            raise HTTPException(400, f"保证金不足：需要 {margin:.2f}，账户余额 {acc.balance:.2f}")

        # 根据"挂单价 vs 创建时的市场参考价"决定触发方向，与多空方向无关：
        # 挂单价 <= 当前价 → 等待价格跌到此价位才成交(回踩/限价买入语义)
        # 挂单价 >  当前价 → 等待价格涨到此价位才成交(突破买入语义)
        # 这样彻底避免"挂单价高于当前价时条件恒成立导致立即成交"的bug
        trigger_direction = "drop" if payload.limit_price <= payload.current_price else "rise"

        order = SimOrder(
            session_id=sess.id, user_id=current_user.id, type="limit", direction=payload.direction,
            quantity=payload.quantity, leverage=sess.leverage, limit_price=payload.limit_price,
            trigger_direction=trigger_direction,
            sl_price=payload.sl_price, sl_qty=payload.sl_qty,
            tp_price=payload.tp_price, tp_qty=payload.tp_qty,
            margin=margin, status="pending",
        )
        acc.balance -= margin
        db.add(order)
        db.commit()
        db.refresh(order)
        return {"order_id": order.id, "status": "pending", "limit_price": payload.limit_price, "margin": margin, "balance": acc.balance}

    else:
        raise HTTPException(400, "type 必须是 market 或 limit")


class OrderClose(BaseModel):
    order_id: int
    exit_price: float
    exit_time: int


@router.post("/order/close")
def close_order(
    payload: OrderClose,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = db.query(SimOrder).filter(SimOrder.id == payload.order_id, SimOrder.user_id == current_user.id, SimOrder.status == "open").first()
    if not order:
        raise HTTPException(404, "未找到该持仓订单或已平仓")

    sess = db.query(SimSession).filter(SimSession.id == order.session_id).first()
    acc = _get_or_create_account(db, current_user.id)

    pnl = calc_pnl(order.entry_price, order.quantity, order.direction, payload.exit_price)
    _record_trade(db, order, sess.symbol, sess.market, payload.exit_price, payload.exit_time, "Manual", acc.balance)

    order.exit_price = payload.exit_price
    order.exit_time = payload.exit_time
    order.exit_reason = "Manual"
    order.pnl = pnl
    order.status = "closed"

    acc.balance += order.margin + pnl

    db.commit()
    return {"pnl": pnl, "balance": acc.balance}


class OrderUpdateSLTP(BaseModel):
    order_id: int
    sl_price: Optional[float] = None   # 传 null 表示清除止损
    tp_price: Optional[float] = None   # 传 null 表示清除止盈
    clear_sl: bool = False              # 显式清除标记(因为sl_price=None在pydantic里无法区分"不传"和"传null清除")
    clear_tp: bool = False


@router.put("/order/update-sltp")
def update_order_sltp(
    payload: OrderUpdateSLTP,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """持仓中修改止盈止损价格（或清除）。修改时同样校验方向合理性，避免改完立即被判定触发。"""
    order = db.query(SimOrder).filter(SimOrder.id == payload.order_id, SimOrder.user_id == current_user.id, SimOrder.status == "open").first()
    if not order:
        raise HTTPException(404, "未找到该持仓订单或已平仓")

    if payload.clear_sl:
        order.sl_price = None
    elif payload.sl_price is not None:
        if order.direction == "long" and payload.sl_price >= order.entry_price:
            raise HTTPException(400, "多单止损价必须低于入场价")
        if order.direction == "short" and payload.sl_price <= order.entry_price:
            raise HTTPException(400, "空单止损价必须高于入场价")
        order.sl_price = payload.sl_price

    if payload.clear_tp:
        order.tp_price = None
    elif payload.tp_price is not None:
        if order.direction == "long" and payload.tp_price <= order.entry_price:
            raise HTTPException(400, "多单止盈价必须高于入场价")
        if order.direction == "short" and payload.tp_price >= order.entry_price:
            raise HTTPException(400, "空单止盈价必须低于入场价")
        order.tp_price = payload.tp_price

    db.commit()
    return {"sl_price": order.sl_price, "tp_price": order.tp_price}


class CancelOrder(BaseModel):
    order_id: int


@router.post("/order/cancel")
def cancel_order(
    payload: CancelOrder,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = db.query(SimOrder).filter(SimOrder.id == payload.order_id, SimOrder.user_id == current_user.id, SimOrder.status == "pending").first()
    if not order:
        raise HTTPException(404, "未找到该挂单或已成交/已取消")

    acc = _get_or_create_account(db, current_user.id)
    acc.balance += order.margin
    order.status = "closed"
    order.exit_reason = "Cancelled"
    db.commit()
    return {"message": "已取消", "balance": acc.balance}


class SessionAdvance(BaseModel):
    session_id: int
    bar_time: int
    bar_open: float
    bar_high: float
    bar_low: float
    bar_close: float
    is_last_bar: bool = False   # 是否已走到该标的当前已加载的最新一根（前端根据at_end传入）


@router.post("/session/advance")
def advance_session(
    payload: SessionAdvance,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    走图前进一根后检查：挂单是否成交、持仓止盈止损是否触发、持仓是否触及强平价。
    强平优先级最高，一旦触及直接强平，不再检查止盈止损。
    任意一次平仓(止盈/止损/强平)都会立即写入一条SimTrade交易记录——
    不会因为某次平仓后暂时没有持仓就结束本局，用户可以继续在同一局里开新仓。
    只有走到最新一根(is_last_bar=True)时，若仍有持仓才强制平仓，随后session才标记为ended。
    """
    sess = db.query(SimSession).filter(SimSession.id == payload.session_id, SimSession.user_id == current_user.id, SimSession.status == "active").first()
    if not sess:
        raise HTTPException(404, "未找到该会话或会话已结束")

    acc = _get_or_create_account(db, current_user.id)
    events = []

    pending_orders = db.query(SimOrder).filter(SimOrder.session_id == sess.id, SimOrder.status == "pending").all()
    for o in pending_orders:
        if o.trigger_direction == "drop":
            triggered = payload.bar_low <= o.limit_price
        else:
            triggered = payload.bar_high >= o.limit_price
        if triggered:
            o.entry_price = o.limit_price
            o.entry_time = payload.bar_time
            o.liq_price = calc_liquidation_price(o.entry_price, o.quantity, o.leverage, o.direction)
            o.status = "open"
            events.append({"type": "limit_filled", "order_id": o.id, "price": o.entry_price})
        elif payload.is_last_bar:
            # 数据已到最新一根，未成交的挂单不再有意义，取消并退回保证金
            acc.balance += o.margin
            o.status = "closed"
            o.exit_reason = "Cancelled"
            events.append({"type": "cancelled", "order_id": o.id})

    open_orders = db.query(SimOrder).filter(SimOrder.session_id == sess.id, SimOrder.status == "open").all()
    for o in open_orders:
        if check_bar_for_liquidation(o.entry_price, o.quantity, o.leverage, o.direction, payload.bar_high, payload.bar_low):
            liq_price = o.liq_price
            pnl = calc_pnl(o.entry_price, o.quantity, o.direction, liq_price)
            _record_trade(db, o, sess.symbol, sess.market, liq_price, payload.bar_time, "Liquidation", acc.balance, liquidated=True)
            o.exit_price = liq_price
            o.exit_time = payload.bar_time
            o.exit_reason = "Liquidation"
            o.pnl = pnl
            o.status = "liquidated"
            acc.balance += max(0, o.margin + pnl)
            events.append({"type": "liquidation", "order_id": o.id, "price": liq_price, "pnl": pnl})
            continue

        hit_sl = o.sl_price and (
            (o.direction == "long" and payload.bar_low <= o.sl_price) or
            (o.direction == "short" and payload.bar_high >= o.sl_price)
        )
        hit_tp = o.tp_price and (
            (o.direction == "long" and payload.bar_high >= o.tp_price) or
            (o.direction == "short" and payload.bar_low <= o.tp_price)
        )
        if hit_sl or hit_tp:
            exit_price = o.tp_price if hit_tp else o.sl_price
            exit_reason = "TP" if hit_tp else "SL"
            pnl = calc_pnl(o.entry_price, o.quantity, o.direction, exit_price)
            _record_trade(db, o, sess.symbol, sess.market, exit_price, payload.bar_time, exit_reason, acc.balance)
            o.exit_price = exit_price
            o.exit_time = payload.bar_time
            o.exit_reason = exit_reason
            o.pnl = pnl
            o.status = "closed"
            acc.balance += o.margin + pnl
            events.append({"type": exit_reason, "order_id": o.id, "price": exit_price, "pnl": pnl})
        elif payload.is_last_bar:
            # 数据已到最新一根，仍持仓中 → 强制以收盘价平仓
            pnl = calc_pnl(o.entry_price, o.quantity, o.direction, payload.bar_close)
            _record_trade(db, o, sess.symbol, sess.market, payload.bar_close, payload.bar_time, "Settle", acc.balance)
            o.exit_price = payload.bar_close
            o.exit_time = payload.bar_time
            o.exit_reason = "Settle"
            o.pnl = pnl
            o.status = "closed"
            acc.balance += o.margin + pnl
            events.append({"type": "Settle", "order_id": o.id, "price": payload.bar_close, "pnl": pnl})

    # 只有走到最新一根K线时，整局才真正结束（不是"没有持仓"就结束）
    session_ended = False
    if payload.is_last_bar:
        sess.end_time = payload.bar_time
        sess.status = "ended"
        session_ended = True

    db.commit()
    return {"events": events, "balance": acc.balance, "session_ended": session_ended}


@router.get("/trades")
def list_trades(
    skip: int = 0, limit: int = 50, session_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """交易记录列表：每条记录是一次完整的开仓->平仓交易，不是session。
    传session_id可只查某一局产生的交易(用于该局结束时展示汇总)。"""
    q = db.query(SimTrade).filter(SimTrade.user_id == current_user.id)
    if session_id is not None:
        q = q.filter(SimTrade.session_id == session_id)
    rows = q.order_by(SimTrade.created_at.desc()).offset(skip).limit(limit).all()
    return [
        {
            "id": r.id, "symbol": r.symbol, "market": r.market,
            "direction": r.direction, "quantity": r.quantity, "leverage": r.leverage,
            "entry_price": r.entry_price, "exit_price": r.exit_price, "exit_reason": r.exit_reason,
            "pnl": r.pnl, "pnl_pct": r.pnl_pct, "liquidated": bool(r.liquidated),
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/stats")
def get_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    trades = db.query(SimTrade).filter(SimTrade.user_id == current_user.id).all()

    total_trades = len(trades)
    total_pnl = sum(t.pnl for t in trades)
    total_pnl_pct = sum(t.pnl_pct for t in trades)
    avg_pnl_pct = (total_pnl_pct / total_trades) if total_trades else 0
    win_trades = sum(1 for t in trades if t.pnl > 0)
    liquidated_count = sum(1 for t in trades if t.liquidated)

    by_market = {}
    for t in trades:
        mkt = t.market
        if mkt not in by_market:
            by_market[mkt] = {"trades": 0, "wins": 0, "total_pnl": 0, "total_pnl_pct": 0}
        by_market[mkt]["trades"] += 1
        by_market[mkt]["total_pnl"] += t.pnl
        by_market[mkt]["total_pnl_pct"] += t.pnl_pct
        if t.pnl > 0:
            by_market[mkt]["wins"] += 1

    return {
        "total_trades": total_trades,
        "total_pnl": total_pnl,
        "total_pnl_pct": total_pnl_pct,
        "avg_pnl_pct": avg_pnl_pct,
        "win_rate": (win_trades / total_trades) if total_trades else 0,
        "liquidated_count": liquidated_count,
        "by_market": by_market,
    }


@router.get("/orders")
def list_session_orders(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sess = db.query(SimSession).filter(SimSession.id == session_id, SimSession.user_id == current_user.id).first()
    if not sess:
        raise HTTPException(404, "未找到该会话")

    orders = db.query(SimOrder).filter(SimOrder.session_id == session_id).order_by(SimOrder.created_at).all()
    return [
        {
            "id": o.id, "type": o.type, "direction": o.direction, "quantity": o.quantity, "leverage": o.leverage,
            "limit_price": o.limit_price, "entry_price": o.entry_price, "entry_time": o.entry_time,
            "sl_price": o.sl_price, "tp_price": o.tp_price, "margin": o.margin, "liq_price": o.liq_price,
            "exit_price": o.exit_price, "exit_time": o.exit_time, "exit_reason": o.exit_reason,
            "pnl": o.pnl, "status": o.status,
        }
        for o in orders
    ]
