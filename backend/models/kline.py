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
    # "auto"(交易所/akshare自动拉取) | "manual"(用户手动上传CSV)。
    # 手动数据源不参与定时任务的自动增量更新，且前端列表会标注"手动"。
    source        = Column(String(10), nullable=False, default="auto")

    __table_args__ = (
        Index("idx_symbol_interval_time", "symbol", "interval", "time"),
    )
