from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import numpy as np
from database import get_db
from models.session import TrainingSession
from models.trade import Trade
from models.user import User
from routers.auth import get_current_user

router = APIRouter(prefix="/sessions", tags=["sessions"])

class SessionCreate(BaseModel):
    symbol: str
    market: str
    interval: str
    data_start_ts: int
    start_index: int

class SessionEnd(BaseModel):
    session_id: int
    data_end_ts: Optional[int] = None
    pnl_pct: Optional[float] = None   # 前端传入的收益率

@router.post("/create")
def create_session(payload: SessionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = TrainingSession(
        user_id=current_user.id,
        symbol=payload.symbol,
        market=payload.market,
        interval=payload.interval,
        start_time=datetime.utcnow(),
        data_start_ts=payload.data_start_ts,
    )
    db.add(s); db.commit(); db.refresh(s)
    return {"session_id": s.id}

@router.post("/end")
def end_session(payload: SessionEnd, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = db.query(TrainingSession).filter_by(id=payload.session_id, user_id=current_user.id).first()
    if not s:
        raise HTTPException(404, "Session not found")

    trades = db.query(Trade).filter(Trade.session_id == s.id, Trade.exit_price.isnot(None)).all()
    s.end_time = datetime.utcnow()
    s.duration_sec = int((s.end_time - s.start_time).total_seconds())
    s.trade_count = len(trades)
    if payload.data_end_ts:
        s.data_end_ts = payload.data_end_ts
    if payload.pnl_pct is not None:
        s.pnl_pct = payload.pnl_pct

    if trades:
        pnls = [t.pnl for t in trades]
        s.total_pnl  = sum(pnls)
        wins   = [p for p in pnls if p > 0]
        losses = [abs(p) for p in pnls if p < 0]
        s.win_count  = len(wins)
        s.loss_count = len(losses)
        s.win_rate   = len(wins) / len(pnls)
        avg_win  = np.mean(wins)   if wins   else 0
        avg_loss = np.mean(losses) if losses else 0
        s.avg_rr = float(avg_win / avg_loss) if avg_loss > 0 else None
        cum = np.cumsum(pnls)
        running_max = np.maximum.accumulate(cum)
        s.max_drawdown = float(np.min(cum - running_max))
        s.profit_factor = float(sum(wins) / sum(losses)) if losses else None
    db.commit()
    return {"session_id": s.id, "stats": {
        "duration_sec": s.duration_sec, "trade_count": s.trade_count,
        "total_pnl": s.total_pnl, "win_rate": s.win_rate,
        "avg_rr": s.avg_rr, "max_drawdown": s.max_drawdown,
        "profit_factor": s.profit_factor,
    }}

@router.get("/list")
def list_sessions(skip: int = 0, limit: int = 20, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(TrainingSession)
        .filter(TrainingSession.user_id == current_user.id)
        .order_by(TrainingSession.created_at.desc())
        .offset(skip).limit(limit).all()
    )
    return [
        {
            "id": r.id, "symbol": r.symbol, "market": r.market,
            "interval": r.interval, "start_time": r.start_time,
            "end_time": r.end_time, "duration_sec": r.duration_sec,
            "trade_count": r.trade_count, "total_pnl": r.total_pnl,
            "pnl_pct": r.pnl_pct,
            "win_rate": r.win_rate, "avg_rr": r.avg_rr,
            "max_drawdown": r.max_drawdown, "profit_factor": r.profit_factor,
        }
        for r in rows
    ]
