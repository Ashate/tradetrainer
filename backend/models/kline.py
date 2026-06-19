from sqlalchemy import Column, BigInteger, String, Float, Index
from database import Base

class Kline(Base):
    __tablename__ = "klines"
    id            = Column(BigInteger, primary_key=True, autoincrement=True)
    symbol        = Column(String(20), nullable=False)
    market        = Column(String(20), nullable=False)
    interval      = Column(String(10), nullable=False)
    time          = Column(BigInteger, nullable=False)
    open          = Column(Float, nullable=False)
    high          = Column(Float, nullable=False)
    low           = Column(Float, nullable=False)
    close         = Column(Float, nullable=False)
    volume        = Column(Float, nullable=False)
    amount        = Column(Float, nullable=True)
    open_interest = Column(Float, nullable=True)

    __table_args__ = (
        Index("idx_symbol_interval_time", "symbol", "interval", "time"),
    )
