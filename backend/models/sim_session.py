from sqlalchemy import Column, BigInteger, Integer, String, Float, ForeignKey, DateTime
from sqlalchemy.sql import func
from database import Base

class SimSession(Base):
    """
    一局模拟交易：从某个随机/手动选定的历史时间点开始走图，一直走到该标的
    已加载数据的最新一根才结束（session本身不是"一次交易"，是整个走图过程的容器）。

    用户可以在同一个session里反复开仓/平仓——每完成一次"开仓到全部仓位清空"的周期，
    会在 sim_trades 表里写入一条独立的交易记录，session继续保持active直到走完所有K线。
    走到最后一根K线时，若仍有持仓会被强制平仓（同样记一条交易），随后session才标记为ended。
    """
    __tablename__ = "sim_sessions"

    id            = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)

    symbol        = Column(String(20), nullable=False)
    market        = Column(String(20), nullable=False)
    interval      = Column(String(10), nullable=False)

    start_time    = Column(BigInteger, nullable=False)
    end_time      = Column(BigInteger, nullable=True)

    initial_balance = Column(Float, nullable=False)
    leverage        = Column(Integer, nullable=False)

    status        = Column(String(20), nullable=False, default="active")  # active | ended
    created_at    = Column(DateTime, server_default=func.now())
    ended_at      = Column(DateTime, nullable=True)
