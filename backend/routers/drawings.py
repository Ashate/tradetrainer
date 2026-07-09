from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from models.drawing import Drawing
from models.user import User
from routers.auth import get_current_user

router = APIRouter(prefix="/drawings", tags=["drawings"])

VALID_TYPES = {"horizontal", "ray"}


class DrawingCreate(BaseModel):
    symbol: str
    market: str
    interval: str
    type: str
    price: float
    time: Optional[int] = None
    price2: Optional[float] = None   # 射线终点价格（两点确定方向）
    time2: Optional[int] = None       # 射线终点时间
    color: str = "#f0b429"


class DrawingUpdate(BaseModel):
    """拖动画线后整体更新位置。水平线只用price；射线四个字段都可能变化（整体平移或调整端点）。"""
    price: Optional[float] = None
    time: Optional[int] = None
    price2: Optional[float] = None
    time2: Optional[int] = None


@router.get("/list")
def list_drawings(
    symbol: str,
    interval: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Drawing)
        .filter(Drawing.user_id == current_user.id, Drawing.symbol == symbol, Drawing.interval == interval)
        .all()
    )
    return [
        {
            "id": r.id, "type": r.type,
            "price": r.price, "time": r.time,
            "price2": r.price2, "time2": r.time2,
            "color": r.color,
        }
        for r in rows
    ]


@router.post("/create")
def create_drawing(
    payload: DrawingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.type not in VALID_TYPES:
        raise HTTPException(400, f"type 必须是 {VALID_TYPES} 之一")
    if payload.type == "ray" and (payload.time is None or payload.time2 is None or payload.price2 is None):
        raise HTTPException(400, "射线需要提供起点(time,price)和终点(time2,price2)两个点")

    d = Drawing(
        user_id=current_user.id, symbol=payload.symbol, market=payload.market,
        interval=payload.interval, type=payload.type, price=payload.price,
        time=payload.time, price2=payload.price2, time2=payload.time2,
        color=payload.color,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return {"id": d.id}


@router.delete("/{drawing_id}")
def delete_drawing(
    drawing_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    d = db.query(Drawing).filter(Drawing.id == drawing_id, Drawing.user_id == current_user.id).first()
    if not d:
        raise HTTPException(404, "未找到该画线，或不属于当前用户")
    db.delete(d)
    db.commit()
    return {"message": "已删除"}


@router.put("/{drawing_id}/color")
def update_drawing_color(
    drawing_id: int,
    color: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    d = db.query(Drawing).filter(Drawing.id == drawing_id, Drawing.user_id == current_user.id).first()
    if not d:
        raise HTTPException(404, "未找到该画线，或不属于当前用户")
    d.color = color
    db.commit()
    return {"message": "已更新"}


@router.put("/{drawing_id}/position")
def update_drawing_position(
    drawing_id: int,
    payload: DrawingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    拖动画线后整体更新位置（上下移动改价格，左右移动改时间）。
    前端在拖动过程中只本地更新渲染，松手时才调用此接口持久化一次。
    """
    d = db.query(Drawing).filter(Drawing.id == drawing_id, Drawing.user_id == current_user.id).first()
    if not d:
        raise HTTPException(404, "未找到该画线，或不属于当前用户")
    if payload.price is not None: d.price = payload.price
    if payload.time is not None: d.time = payload.time
    if payload.price2 is not None: d.price2 = payload.price2
    if payload.time2 is not None: d.time2 = payload.time2
    db.commit()
    return {"message": "已更新"}
