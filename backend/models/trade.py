from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, BigInteger
from sqlalchemy.sql import func
from database import Base

class Trade(Base):
    __tablename__ = "trades"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    session_id    = Column(Integer, ForeignKey("training_sessions.id"), nullable=False)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)
    direction     = Column(String(10), nullable=False)
    quantity      = Column(Float, nullable=False, default=1.0)
    entry_price   = Column(Float, nullable=False)
    exit_price    = Column(Float, nullable=True)
    entry_time    = Column(BigInteger, nullable=False)
    exit_time     = Column(BigInteger, nullable=True)
    sl_price      = Column(Float, nullable=True)
    tp_price      = Column(Float, nullable=True)
    exit_reason   = Column(String(20), nullable=True)
    pnl           = Column(Float, nullable=True)
    pnl_pct       = Column(Float, nullable=True)
    atr_at_entry  = Column(Float, nullable=True)
    created_at    = Column(DateTime, server_default=func.now())
