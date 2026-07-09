"""
命令行入口：手动触发全部已配置标的的历史数据拉取。

用法（在backend容器内执行）：
    python -m data_fetcher.runner                # 拉取配置中所有标的的历史数据
    python -m data_fetcher.runner --incremental   # 对所有标的执行增量更新
"""
import logging
import argparse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("data_fetcher.runner")

from . import config_loader, binance_fetcher, stock_fetcher, futures_fetcher


def run_history():
    cfg = config_loader.load_config()

    for s in cfg.get("crypto", []):
        logger.info(f"拉取历史 crypto/{s['symbol']} ...")
        try:
            binance_fetcher.fetch_history(s["symbol"], s.get("exchange_symbol", s["symbol"]))
        except Exception as e:
            logger.error(f"crypto/{s['symbol']} 失败: {e}")

    for s in cfg.get("futures", []):
        logger.info(f"拉取历史 futures/{s['symbol']} ...")
        try:
            futures_fetcher.fetch_history(s["symbol"])
        except Exception as e:
            logger.error(f"futures/{s['symbol']} 失败: {e}")

    for s in cfg.get("stock", []):
        logger.info(f"拉取历史 stock/{s['symbol']} ...")
        try:
            stock_fetcher.fetch_history(s["symbol"])
        except Exception as e:
            logger.error(f"stock/{s['symbol']} 失败: {e}")

    logger.info("全部历史拉取任务完成")


def run_incremental():
    cfg = config_loader.load_config()

    for s in cfg.get("crypto", []):
        try:
            binance_fetcher.fetch_incremental(s["symbol"], s.get("exchange_symbol", s["symbol"]))
        except Exception as e:
            logger.error(f"crypto/{s['symbol']} 增量失败: {e}")

    for s in cfg.get("futures", []):
        try:
            futures_fetcher.fetch_incremental(s["symbol"])
        except Exception as e:
            logger.error(f"futures/{s['symbol']} 增量失败: {e}")

    for s in cfg.get("stock", []):
        try:
            stock_fetcher.fetch_incremental(s["symbol"])
        except Exception as e:
            logger.error(f"stock/{s['symbol']} 增量失败: {e}")

    logger.info("全部增量更新任务完成")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--incremental", action="store_true", help="执行增量更新而非全量历史拉取")
    args = parser.parse_args()

    if args.incremental:
        run_incremental()
    else:
        run_history()
