from sqlalchemy import Column, BigInteger, Integer, String, Float, ForeignKey, Index
from database import Base

class Drawing(Base):
    """
    用户在行情图表上画的线（水平线/射线）。
    按 user_id + symbol + interval 关联，切换标的/周期时只加载对应的画线。

    水平线：只用 price 字段（横跨整个图表宽度）。
    射线：用两个点 (time, price) 和 (time2, price2) 确定方向，从起点向终点方向无限延伸
          （与币安画线工具一致：两点决定斜率，射线只朝一个方向延伸）。
    """
    __tablename__ = "drawings"

    id        = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id   = Column(Integer, ForeignKey("users.id"), nullable=False)
    symbol    = Column(String(20), nullable=False)
    market    = Column(String(20), nullable=False)
    interval  = Column(String(10), nullable=False)

    type      = Column(String(20), nullable=False)   # "horizontal" | "ray"
    price     = Column(Float, nullable=False)         # 水平线的价格；射线的起点价格
    time      = Column(BigInteger, nullable=True)      # 射线起点的时间戳(ms)
    price2    = Column(Float, nullable=True)            # 射线终点价格（决定方向，水平线不用）
    time2     = Column(BigInteger, nullable=True)       # 射线终点时间戳（决定方向，水平线不用）
    color     = Column(String(20), nullable=False, default="#f0b429")

    __table_args__ = (
        Index("idx_drawing_user_symbol", "user_id", "symbol", "interval"),
    )
