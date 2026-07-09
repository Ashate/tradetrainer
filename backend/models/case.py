from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from database import Base

class TradeCase(Base):
    __tablename__ = "trade_cases"
    id               = Column(Integer, primary_key=True, autoincrement=True)
    user_id          = Column(Integer, ForeignKey("users.id"), nullable=False)
    trade_id         = Column(Integer, nullable=True)
    session_id       = Column(Integer, nullable=True)
    symbol           = Column(String(20), nullable=False)
    case_type        = Column(String(20), nullable=False)
    entry_screenshot = Column(String(500), nullable=True)
    exit_screenshot  = Column(String(500), nullable=True)
    note             = Column(Text, nullable=True)
    tags             = Column(String(200), nullable=True)
    pnl              = Column(Float, nullable=True)
    created_at       = Column(DateTime, server_default=func.now())
