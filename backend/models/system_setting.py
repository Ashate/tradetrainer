from sqlalchemy import Column, String
from database import Base

class SystemSetting(Base):
    """全局系统配置（key-value），用于存储如"是否开放注册"等开关型设置。"""
    __tablename__ = "system_settings"
    key   = Column(String(50), primary_key=True)
    value = Column(String(200), nullable=False)
