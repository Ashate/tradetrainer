from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import logging

from database import Base, engine
import models.user, models.kline, models.session, models.trade, models.case, models.drawing
import models.sim_account, models.sim_session, models.sim_order, models.sim_trade
import models.system_setting

from routers import auth, klines, sessions, trades, cases, stats, import_data, admin, drawings, simulate
from config import settings
from data_fetcher.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)

# Create tables
Base.metadata.create_all(bind=engine)

# Ensure upload dir exists
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

app = FastAPI(
    title="TradeTrainer API",
    version="1.0.0",
    description="专业交易训练平台 API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files for uploads
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# Routers
app.include_router(auth.router)
app.include_router(klines.router)
app.include_router(sessions.router)
app.include_router(trades.router)
app.include_router(cases.router)
app.include_router(stats.router)
app.include_router(import_data.router)
app.include_router(admin.router)
app.include_router(drawings.router)
app.include_router(simulate.router)

@app.on_event("startup")
def _on_startup():
    start_scheduler()

@app.on_event("shutdown")
def _on_shutdown():
    stop_scheduler()

@app.get("/health")
def health():
    return {"status": "ok", "service": "TradeTrainer", "version": "1.0.0"}
