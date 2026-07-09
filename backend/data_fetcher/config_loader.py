"""
读取并校验 symbols_config.json。
配置文件路径固定在本模块同目录下，方便用户直接编辑维护标的列表。
"""
import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "symbols_config.json")

VALID_MARKETS = {"crypto", "futures", "stock"}


def load_config() -> dict:
    """读取配置文件，返回 {crypto: [...], futures: [...], stock: [...]}"""
    if not os.path.exists(CONFIG_PATH):
        return {"crypto": [], "futures": [], "stock": []}
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    result = {}
    for mkt in VALID_MARKETS:
        result[mkt] = raw.get(mkt, [])
    return result


def list_all_symbols() -> list:
    """展开为 [{symbol, market, display_name, ...}, ...] 扁平列表"""
    cfg = load_config()
    out = []
    for mkt, items in cfg.items():
        for item in items:
            out.append({**item, "market": mkt})
    return out


def add_symbol(market: str, symbol: str, display_name: str = None, exchange_symbol: str = None) -> dict:
    """向配置文件追加一个新标的（去重），返回新增的条目"""
    if market not in VALID_MARKETS:
        raise ValueError(f"market 必须是 {VALID_MARKETS} 之一")

    cfg = load_config()
    existing = [s["symbol"] for s in cfg[market]]
    if symbol in existing:
        raise ValueError(f"标的 {symbol} 已存在于 {market} 列表中")

    entry = {"symbol": symbol, "display_name": display_name or symbol}
    if exchange_symbol:
        entry["exchange_symbol"] = exchange_symbol

    cfg[market].append(entry)

    # 写回文件，保留原有的 _说明 字段，ensure_ascii=False保证中文可读不转义
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    raw[market] = cfg[market]
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False, indent=2)
        f.write("\n")

    return entry
