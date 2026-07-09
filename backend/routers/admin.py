"""
数据源管理接口：新增标的（写入配置并立即首次拉取历史）、手动触发同步、查看状态。
"""
import sys
import os
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from data_fetcher import config_loader, binance_fetcher, stock_fetcher, futures_fetcher
from data_fetcher.db_writer import get_data_count
from models.user import User
from routers.auth import get_current_user

logger = logging.getLogger("admin")
router = APIRouter(prefix="/admin", tags=["admin"])


class AddSymbolPayload(BaseModel):
    market: str
    symbol: str
    display_name: Optional[str] = None
    exchange_symbol: Optional[str] = None


def _fetch_history_for(market: str, symbol: str, exchange_symbol: str = None):
    """后台任务：拉取新增标的的历史数据"""
    try:
        if market == "crypto":
            binance_fetcher.fetch_history(symbol, exchange_symbol or symbol)
        elif market == "futures":
            futures_fetcher.fetch_history(symbol)
        elif market == "stock":
            stock_fetcher.fetch_history(symbol)
        logger.info(f"[admin] {market}/{symbol} 历史数据拉取完成")
    except Exception as e:
        logger.error(f"[admin] {market}/{symbol} 历史数据拉取失败: {e}")


@router.post("/symbols/add")
def add_symbol(
    payload: AddSymbolPayload,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """新增标的：写入配置文件，并在后台立即拉取历史数据"""
    if payload.market == "crypto" and not payload.exchange_symbol:
        raise HTTPException(400, "加密货币标的需要提供 exchange_symbol（如 BTC/USDT）")

    try:
        entry = config_loader.add_symbol(
            payload.market, payload.symbol, payload.display_name, payload.exchange_symbol
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    background_tasks.add_task(
        _fetch_history_for, payload.market, payload.symbol, payload.exchange_symbol
    )

    return {
        "message": f"已添加标的 {payload.symbol}，历史数据正在后台拉取中，可通过 GET /admin/symbols/status 查看进度",
        "entry": entry,
    }


@router.post("/symbols/sync")
def sync_symbol(
    market: str,
    symbol: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """手动触发指定标的的数据同步（增量更新）"""
    cfg = config_loader.load_config()
    matched = next((s for s in cfg.get(market, []) if s["symbol"] == symbol), None)
    if not matched:
        raise HTTPException(404, f"配置中未找到 {market}/{symbol}，请先通过 /admin/symbols/add 添加")

    def _run():
        try:
            if market == "crypto":
                binance_fetcher.fetch_incremental(symbol, matched.get("exchange_symbol", symbol))
            elif market == "futures":
                futures_fetcher.fetch_incremental(symbol)
            elif market == "stock":
                stock_fetcher.fetch_incremental(symbol)
        except Exception as e:
            logger.error(f"[admin] 手动同步 {market}/{symbol} 失败: {e}")

    background_tasks.add_task(_run)
    return {"message": f"{market}/{symbol} 同步任务已提交到后台"}


@router.get("/symbols/status")
def symbols_status(current_user: User = Depends(get_current_user)):
    """查看配置中所有标的的数据量状态"""
    cfg = config_loader.load_config()
    result = {}
    for market, items in cfg.items():
        result[market] = []
        for item in items:
            symbol = item["symbol"]
            intervals = ["1m", "5m", "15m", "30m", "1h", "1d"] if market != "stock" else ["1d"]
            counts = {iv: get_data_count(symbol, iv) for iv in intervals}
            result[market].append({
                "symbol": symbol,
                "display_name": item.get("display_name"),
                "counts": {k: v for k, v in counts.items() if v > 0},
            })
    return result
