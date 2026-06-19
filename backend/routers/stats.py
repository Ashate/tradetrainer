from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models.session import TrainingSession
from models.trade import Trade
from models.user import User
from routers.auth import get_current_user

router = APIRouter(prefix="/stats", tags=["stats"])

@router.get("/overview")
def get_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sessions = db.query(TrainingSession).filter(TrainingSession.user_id == current_user.id).all()
    trades   = db.query(Trade).filter(
        Trade.user_id == current_user.id,
        Trade.exit_price.isnot(None),
        Trade.pnl.isnot(None)
    ).all()

    pnls   = [t.pnl for t in trades]
    wins   = [p for p in pnls if p > 0]
    losses = [abs(p) for p in pnls if p < 0]

    total_duration = sum(s.duration_sec or 0 for s in sessions)

    max_win_streak = max_loss_streak = cur_win = cur_loss = 0
    for p in pnls:
        if p > 0:
            cur_win += 1; cur_loss = 0
            max_win_streak = max(max_win_streak, cur_win)
        else:
            cur_loss += 1; cur_win = 0
            max_loss_streak = max(max_loss_streak, cur_loss)

    # 按市场分类
    by_market = {}
    for s in sessions:
        mkt = s.market or "unknown"
        if mkt not in by_market:
            by_market[mkt] = {"sessions": 0, "wins": 0, "losses": 0, "total_pnl_pct": 0.0, "trade_count": 0}
        by_market[mkt]["sessions"]    += 1
        by_market[mkt]["trade_count"] += s.trade_count or 0
        by_market[mkt]["total_pnl_pct"] += s.pnl_pct or 0.0
        if (s.pnl_pct or 0) >= 0:
            by_market[mkt]["wins"]   += 1
        else:
            by_market[mkt]["losses"] += 1

    # 按品种分类
    by_symbol = {}
    for s in sessions:
        sym = s.symbol
        if sym not in by_symbol:
            by_symbol[sym] = {"wins": 0, "total": 0, "pnl": 0}
        by_symbol[sym]["pnl"]   += s.total_pnl or 0
        by_symbol[sym]["wins"]  += s.win_count or 0
        by_symbol[sym]["total"] += s.trade_count or 0

    recent_sessions = sorted(sessions, key=lambda x: x.created_at or 0)[-20:]

    pnl_pcts = [s.pnl_pct for s in sessions if s.pnl_pct is not None]
    total_pnl_pct = sum(pnl_pcts)
    avg_pnl_pct   = total_pnl_pct / len(pnl_pcts) if pnl_pcts else 0

    return {
        "total_sessions":     len(sessions),
        "total_duration_sec": total_duration,
        "total_trades":       len(trades),
        "total_pnl":          round(sum(pnls), 4),
        "total_pnl_pct":      round(total_pnl_pct, 4),
        "avg_pnl_pct":        round(avg_pnl_pct, 4),
        "win_rate":           len(wins) / len(pnls) if pnls else 0,
        "avg_win":            sum(wins)   / len(wins)   if wins   else 0,
        "avg_loss":           sum(losses) / len(losses) if losses else 0,
        "avg_rr":             (sum(wins)/len(wins)) / (sum(losses)/len(losses)) if wins and losses else 0,
        "profit_factor":      round(sum(wins) / sum(losses), 4) if losses else None,
        "max_win_streak":     max_win_streak,
        "max_loss_streak":    max_loss_streak,
        "by_market":          by_market,
        "by_symbol":          by_symbol,
        "recent_pnl":         [s.total_pnl or 0 for s in recent_sessions],
        "recent_pnl_pct":     [s.pnl_pct or 0 for s in recent_sessions],
    }
