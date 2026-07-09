from sqlalchemy import Column, Integer, Float, ForeignKey, DateTime
from sqlalchemy.sql import func
from database import Base

class SimAccount(Base):
    """
    用户的模拟交易账户设置。一个用户一条记录（全局虚拟资金配置，
    余额会随每一局模拟交易的结算累计增减，类似真实交易所账户）。
    """
    __tablename__ = "sim_accounts"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    user_id   = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)

    balance   = Column(Float, nullable=False, default=10000.0)
    leverage  = Column(Integer, nullable=False, default=10)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
