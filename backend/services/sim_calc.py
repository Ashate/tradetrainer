"""
模拟交易核心计算：保证金、浮动盈亏、强平价格。
纯函数实现，不依赖数据库，方便独立测试验证数学正确性。

模型说明：
  notional = entryPrice * quantity                      名义价值
  margin   = notional / leverage                         所需保证金
  pnl(price) = (price - entryPrice) * dirMult * quantity  浮动盈亏（dirMult: 多=+1, 空=-1）
  equity(price) = margin + pnl(price)                     该价格下的账户净值

  维持保证金比例 MAINT_RATIO：当 equity(price) <= margin * MAINT_RATIO 时触发强平。
"""

MAINT_RATIO = 0.1   # 维持保证金率：净值跌到初始保证金的10%时强平


def calc_margin(entry_price: float, quantity: float, leverage: int) -> float:
    notional = entry_price * quantity
    return notional / leverage


def calc_pnl(entry_price: float, quantity: float, direction: str, current_price: float) -> float:
    dir_mult = 1 if direction == "long" else -1
    return (current_price - entry_price) * dir_mult * quantity


def calc_equity(entry_price: float, quantity: float, leverage: int, direction: str, current_price: float) -> float:
    margin = calc_margin(entry_price, quantity, leverage)
    pnl = calc_pnl(entry_price, quantity, direction, current_price)
    return margin + pnl


def calc_liquidation_price(entry_price: float, quantity: float, leverage: int, direction: str) -> float:
    margin = calc_margin(entry_price, quantity, leverage)
    dir_mult = 1 if direction == "long" else -1
    return entry_price + dir_mult * margin * (MAINT_RATIO - 1) / quantity


def is_liquidated(entry_price: float, quantity: float, leverage: int, direction: str, current_price: float) -> bool:
    margin = calc_margin(entry_price, quantity, leverage)
    equity = calc_equity(entry_price, quantity, leverage, direction, current_price)
    return equity <= margin * MAINT_RATIO


def check_bar_for_liquidation(entry_price: float, quantity: float, leverage: int, direction: str,
                                bar_high: float, bar_low: float) -> bool:
    """判断某一根K线的高低点范围内是否触及强平价（与SL/TP同样的逐K线检测方式）"""
    liq_price = calc_liquidation_price(entry_price, quantity, leverage, direction)
    if direction == "long":
        return bar_low <= liq_price
    else:
        return bar_high >= liq_price
