"""
定时任务调度器。在 main.py 启动时初始化，与FastAPI应用生命周期绑定。

任务安排：
- 加密货币：每小时增量更新一次（crypto市场24/7交易，更新频率高一些合理）
- 国内期货：每天收盘后增量更新一次（akshare新浪接口本身只有近期数据，更新太频繁没有意义）
- 股票：每天收盘后（15:30之后）增量更新一次
"""
import logging

logger = logging.getLogger("data_fetcher.scheduler")

try:
    from apscheduler.schedulers.background import BackgroundScheduler
except ImportError:
    BackgroundScheduler = None

from . import config_loader
from . import binance_fetcher
from . import stock_fetcher
from . import futures_fetcher
from .db_writer import is_manual_source

_scheduler = None


def _run_crypto_update():
    symbols = config_loader.load_config().get("crypto", [])
    for s in symbols:
        if is_manual_source(s["symbol"], "1m"):
            logger.info(f"[定时任务] crypto {s['symbol']} 是手动数据源，跳过自动更新")
            continue
        try:
            binance_fetcher.fetch_incremental(s["symbol"], s.get("exchange_symbol", s["symbol"]))
        except Exception as e:
            logger.error(f"[定时任务] crypto {s['symbol']} 增量更新失败: {e}")


def _run_futures_update():
    symbols = config_loader.load_config().get("futures", [])
    for s in symbols:
        if is_manual_source(s["symbol"], "1m"):
            logger.info(f"[定时任务] futures {s['symbol']} 是手动数据源，跳过自动更新")
            continue
        try:
            futures_fetcher.fetch_incremental(s["symbol"])
        except Exception as e:
            logger.error(f"[定时任务] futures {s['symbol']} 增量更新失败: {e}")


def _run_stock_update():
    symbols = config_loader.load_config().get("stock", [])
    for s in symbols:
        if is_manual_source(s["symbol"], "1d"):
            logger.info(f"[定时任务] stock {s['symbol']} 是手动数据源，跳过自动更新")
            continue
        try:
            stock_fetcher.fetch_incremental(s["symbol"])
        except Exception as e:
            logger.error(f"[定时任务] stock {s['symbol']} 增量更新失败: {e}")


def start_scheduler():
    global _scheduler
    if BackgroundScheduler is None:
        logger.warning("APScheduler 未安装，定时数据更新功能不可用。请在 requirements.txt 中确认已加入。")
        return None

    if _scheduler is not None:
        return _scheduler

    _scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    _scheduler.add_job(_run_crypto_update,  "interval", hours=1, id="crypto_update")
    _scheduler.add_job(_run_futures_update, "cron", hour=15, minute=45, id="futures_update")
    _scheduler.add_job(_run_stock_update,   "cron", hour=16, minute=0,  id="stock_update")
    _scheduler.start()
    logger.info("定时数据更新任务已启动：crypto每小时 / futures每日15:45 / stock每日16:00")
    return _scheduler


def stop_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
