from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models.trade import Trade
from models.user import User
from routers.auth import get_current_user

router = APIRouter(prefix="/trades", tags=["trades"])

class TradeOpen(BaseModel):
    session_id: int
    direction: str
    quantity: float = 1.0
    entry_price: float
    entry_time: int
    sl_price: Optional[float] = None
    tp_price: Optional[float] = None
    atr_at_entry: Optional[float] = None

class TradeClose(BaseModel):
    trade_id: int
    exit_price: float
    exit_time: int
    exit_reason: str = "Manual"

@router.post("/open")
def open_trade(payload: TradeOpen, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    trade = Trade(
        session_id=payload.session_id,
        user_id=current_user.id,
        direction=payload.direction,
        quantity=payload.quantity,
        entry_price=payload.entry_price,
        entry_time=payload.entry_time,
        sl_price=payload.sl_price,
        tp_price=payload.tp_price,
        atr_at_entry=payload.atr_at_entry,
    )
    db.add(trade); db.commit(); db.refresh(trade)
    return {"trade_id": trade.id}

@router.post("/close")
def close_trade(payload: TradeClose, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    trade = db.query(Trade).filter_by(id=payload.trade_id, user_id=current_user.id).first()
    if not trade:
        raise HTTPException(404, "Trade not found")
    trade.exit_price  = payload.exit_price
    trade.exit_time   = payload.exit_time
    trade.exit_reason = payload.exit_reason
    mult = 1 if trade.direction == "long" else -1
    trade.pnl     = (payload.exit_price - trade.entry_price) * mult * trade.quantity
    trade.pnl_pct = trade.pnl / trade.entry_price
    db.commit()
    return {"trade_id": trade.id, "pnl": trade.pnl}

@router.get("/session/{session_id}")
def get_session_trades(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    trades = db.query(Trade).filter_by(session_id=session_id, user_id=current_user.id).all()
    return [
        {
            "id": t.id, "direction": t.direction, "quantity": t.quantity,
            "entry_price": t.entry_price, "exit_price": t.exit_price,
            "entry_time": t.entry_time, "exit_time": t.exit_time,
            "sl_price": t.sl_price, "tp_price": t.tp_price,
            "exit_reason": t.exit_reason, "pnl": t.pnl, "pnl_pct": t.pnl_pct,
            "atr_at_entry": t.atr_at_entry,
        }
        for t in trades
    ]
