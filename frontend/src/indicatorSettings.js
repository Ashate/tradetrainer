import { useState, useCallback } from "react"

// ─── 全局指标设置（localStorage持久化）──────────────────────────────────────────
// 训练模块当前仍用自己的本地state（不读取此处，避免一次性改动过大引入回归）。
// 行情模块和模拟模块（后续阶段实现）将使用这里的全局配置。
// 设置模块在此处编辑，立即写入localStorage，下次打开任意模块自动生效。

const STORAGE_KEY = "tt_indicator_settings"

export const DEFAULT_INDICATOR_SETTINGS = {
  ma: {
    enabled: true,
    periods: { ma5:true, ma10:true, ma20:true, ma60:false, ma120:false },
    colors:  { ma5:"#ffdd00", ma10:"#ff9900", ma20:"#dd44ff", ma60:"#4499ff", ma120:"#ff4466" },
  },
  volMa: {
    enabled: true,
    periods: { volma5:false, volma10:false, volma20:true },
    colors:  { volma5:"#ffdd00", volma10:"#ff9900", volma20:"#4499ff" },
  },
  atr: {
    enabled: false,
    period: 14,
    color: "#a78bfa",
  },
  macd: {
    enabled: false,
    fast: 12, slow: 26, signal: 9,
    colors: { macd:"#4b9eff", signal:"#ff9900", histUp:"#e84040", histDown:"#00b87a" },
  },
  rsi: {
    enabled: false,
    period: 14,
    color: "#dd44ff",
  },
  boll: {
    enabled: false,
    period: 20, mult: 2,
    colors: { mid:"#f0b429", upper:"#4b9eff", lower:"#4b9eff" },
  },
  candle: {
    upColor:   "#e84040",  // 阳线颜色
    downColor: "#00b87a",  // 阴线颜色
  },
}

function loadSettings(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY)
    if(!raw) return DEFAULT_INDICATOR_SETTINGS
    const parsed = JSON.parse(raw)
    // 浅合并，防止旧版本缺字段
    return { ...DEFAULT_INDICATOR_SETTINGS, ...parsed }
  }catch{
    return DEFAULT_INDICATOR_SETTINGS
  }
}

export function useIndicatorSettings(){
  const [settings,setSettings] = useState(loadSettings)

  const update = useCallback((path, value)=>{
    setSettings(prev=>{
      const next = JSON.parse(JSON.stringify(prev))
      // path例: "ma.periods.ma5" 或 "atr.period"
      const keys = path.split(".")
      let obj = next
      for(let i=0;i<keys.length-1;i++) obj = obj[keys[i]]
      obj[keys[keys.length-1]] = value
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  },[])

  const resetAll = useCallback(()=>{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_INDICATOR_SETTINGS))
    setSettings(DEFAULT_INDICATOR_SETTINGS)
  },[])

  return { settings, update, resetAll }
}
