import os, shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models.case import TradeCase
from models.user import User
from routers.auth import get_current_user
from config import settings

router = APIRouter(prefix="/cases", tags=["cases"])

class CaseCreate(BaseModel):
    symbol: str
    case_type: str  # success | fail
    trade_id: Optional[int] = None
    session_id: Optional[int] = None
    note: Optional[str] = None
    tags: Optional[str] = None
    pnl: Optional[float] = None

@router.post("/create")
def create_case(payload: CaseCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    case = TradeCase(user_id=current_user.id, **payload.dict())
    db.add(case); db.commit(); db.refresh(case)
    return {"case_id": case.id}

@router.post("/{case_id}/upload/{img_type}")
async def upload_screenshot(
    case_id: int,
    img_type: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = db.query(TradeCase).filter_by(id=case_id, user_id=current_user.id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ("png", "jpg", "jpeg", "webp"):
        raise HTTPException(400, "仅支持图片格式")
    save_dir = os.path.join(settings.UPLOAD_DIR, str(current_user.id))
    os.makedirs(save_dir, exist_ok=True)
    fname = f"case_{case_id}_{img_type}.{ext}"
    fpath = os.path.join(save_dir, fname)
    with open(fpath, "wb") as f:
        shutil.copyfileobj(file.file, f)
    url = f"/uploads/{current_user.id}/{fname}"
    if img_type == "entry":
        case.entry_screenshot = url
    else:
        case.exit_screenshot = url
    db.commit()
    return {"url": url}

@router.get("/list")
def list_cases(
    case_type: Optional[str] = None,
    skip: int = 0, limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(TradeCase).filter(TradeCase.user_id == current_user.id)
    if case_type:
        q = q.filter(TradeCase.case_type == case_type)
    rows = q.order_by(TradeCase.created_at.desc()).offset(skip).limit(limit).all()
    return [
        {
            "id": r.id, "symbol": r.symbol, "case_type": r.case_type,
            "note": r.note, "tags": r.tags, "pnl": r.pnl,
            "entry_screenshot": r.entry_screenshot,
            "exit_screenshot": r.exit_screenshot,
            "created_at": r.created_at,
        }
        for r in rows
    ]
