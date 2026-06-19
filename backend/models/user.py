from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.sql import func
from database import Base

class User(Base):
    __tablename__ = "users"
    id               = Column(Integer, primary_key=True, autoincrement=True)
    username         = Column(String(50), unique=True, nullable=False)
    email            = Column(String(100), unique=True, nullable=False)
    hashed_password  = Column(String(200), nullable=False)
    is_active        = Column(Boolean, default=True)
    created_at       = Column(DateTime, server_default=func.now())
