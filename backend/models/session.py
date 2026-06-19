from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, BigInteger
from sqlalchemy.sql import func
from database import Base

class TrainingSession(Base):
    __tablename__ = "training_sessions"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)
    symbol        = Column(String(20), nullable=False)
    market        = Column(String(20), nullable=False)
    interval      = Column(String(10), nullable=False)
    start_time    = Column(DateTime, nullable=False)
    end_time      = Column(DateTime, nullable=True)
    data_start_ts = Column(BigInteger, nullable=False)
    data_end_ts   = Column(BigInteger, nullable=True)
    duration_sec  = Column(Integer, nullable=True)
    trade_count   = Column(Integer, default=0)
    total_pnl     = Column(Float, default=0.0)
    pnl_pct       = Column(Float, nullable=True)   # 收益率（百分比，如 +5.23 表示+5.23%）
    win_count     = Column(Integer, default=0)
    loss_count    = Column(Integer, default=0)
    win_rate      = Column(Float, nullable=True)
    avg_rr        = Column(Float, nullable=True)
    max_drawdown  = Column(Float, nullable=True)
    profit_factor = Column(Float, nullable=True)
    created_at    = Column(DateTime, server_default=func.now())
