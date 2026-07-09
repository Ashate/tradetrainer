from sqlalchemy import Column, BigInteger, Integer, String, Float, ForeignKey, DateTime
from sqlalchemy.sql import func
from database import Base

class SimTrade(Base):
    """
    一次完整交易记录：从该session内某次开仓开始，到对应仓位平仓为止算一次交易。
    一个session内可以产生多条SimTrade记录（用户可以反复开仓/平仓）。
    这是统计页/历史记录页真正展示的最小单位（而不是session本身）。
    """
    __tablename__ = "sim_trades"

    id            = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id    = Column(BigInteger, ForeignKey("sim_sessions.id"), nullable=False)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)

    symbol        = Column(String(20), nullable=False)
    market        = Column(String(20), nullable=False)

    direction     = Column(String(10), nullable=False)
    quantity      = Column(Float, nullable=False)
    leverage      = Column(Integer, nullable=False)

    entry_price   = Column(Float, nullable=False)
    entry_time    = Column(BigInteger, nullable=False)
    exit_price    = Column(Float, nullable=False)
    exit_time     = Column(BigInteger, nullable=False)
    exit_reason   = Column(String(20), nullable=False)

    pnl           = Column(Float, nullable=False)
    pnl_pct       = Column(Float, nullable=False)
    liquidated    = Column(Integer, nullable=False, default=0)

    created_at    = Column(DateTime, server_default=func.now())
