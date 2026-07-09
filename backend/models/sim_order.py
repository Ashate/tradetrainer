from sqlalchemy import Column, BigInteger, Integer, String, Float, ForeignKey, DateTime
from sqlalchemy.sql import func
from database import Base

class SimOrder(Base):
    """
    模拟交易订单。一条记录代表一次完整的开仓->平仓过程（或挂单中/强平结束）。

    type: "market" | "limit"
    status: "pending" | "open" | "closed" | "liquidated"
    direction: "long" | "short"
    """
    __tablename__ = "sim_orders"

    id            = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id    = Column(BigInteger, ForeignKey("sim_sessions.id"), nullable=False)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)

    type          = Column(String(10), nullable=False, default="market")
    direction     = Column(String(10), nullable=False)
    quantity      = Column(Float, nullable=False)
    leverage      = Column(Integer, nullable=False)

    limit_price   = Column(Float, nullable=True)
    trigger_direction = Column(String(10), nullable=True)  # "rise" | "drop" —— 挂单创建时根据(限价 vs 当时市价)确定，避免方向歧义
    entry_price   = Column(Float, nullable=True)
    entry_time    = Column(BigInteger, nullable=True)

    sl_price      = Column(Float, nullable=True)
    sl_qty        = Column(Float, nullable=True)
    tp_price      = Column(Float, nullable=True)
    tp_qty        = Column(Float, nullable=True)

    margin        = Column(Float, nullable=True)
    liq_price     = Column(Float, nullable=True)

    exit_price    = Column(Float, nullable=True)
    exit_time     = Column(BigInteger, nullable=True)
    exit_reason   = Column(String(20), nullable=True)
    pnl           = Column(Float, nullable=True)

    status        = Column(String(20), nullable=False, default="pending")
    created_at    = Column(DateTime, server_default=func.now())
