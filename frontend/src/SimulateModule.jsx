import { useState, useEffect, useCallback, useRef } from "react"
import { P, MARKETS, MKT_LABEL } from "./theme"
import { fmt, fmtPct, fmtDate, useIsMobile } from "./utils"
import MarketChart from "./MarketChart"
import RotatedFullscreen from "./RotatedFullscreen"
import DrawToolMenu from "./DrawToolMenu"
import { klinesAPI, simulateAPI, marketAPI, drawingsAPI } from "./api"
import { useIndicatorSettings } from "./indicatorSettings"

// 模拟模块只涉及期货和加密货币（与行情模块一致，股票不支持开仓做多空杠杆这套模型）
const SIM_MARKETS = MARKETS.filter(m => m.id !== "stock")

// ─── 首页：资金管理 + 杠杆设置 + 标的选择 ──────────────────────────────────────────
function SimulateHome({account, onUpdateAccount, onStart, onShowHistory, onShowStats}){
  const isMobile = useIsMobile()
  const [editingBalance, setEditingBalance] = useState(false)
  const [balanceInput, setBalanceInput] = useState("")
  const [leverageInput, setLeverageInput] = useState(account?.leverage || 10)
  const [selectMode, setSelectMode] = useState("random")   // random | manual
  const [selectedMarket, setSelectedMarket] = useState("crypto")
  const [symbols, setSymbols] = useState([])
  const [selectedSymbol, setSelectedSymbol] = useState(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState("")

  useEffect(()=>{
    klinesAPI.symbols().then(r=>{
      const list = (r.data||[]).filter(s => s.market==="crypto"||s.market==="futures"||s.market==="期货"||s.market==="数字货币")
      setSymbols(list)
    }).catch(()=>setSymbols([]))
  },[])

  useEffect(()=>{ if(account) setLeverageInput(account.leverage) },[account])

  const marketSymbols = symbols.filter(s=>{
    if(selectedMarket==="crypto") return s.market==="crypto"||s.market==="数字货币"
    if(selectedMarket==="futures") return s.market==="futures"||s.market==="期货"
    return false
  })

  const saveBalance = ()=>{
    const v = parseFloat(balanceInput)
    if(isNaN(v) || v < 0){ setError("请输入有效的资金数额"); return }
    onUpdateAccount({ balance: v })
    setEditingBalance(false)
    setError("")
  }

  const saveLeverage = (v)=>{
    setLeverageInput(v)
    onUpdateAccount({ leverage: v })
  }

  const handleStart = async ()=>{
    setError("")
    if(selectMode==="manual" && !selectedSymbol){ setError("请选择一个标的，或切换为随机模式"); return }
    setStarting(true)
    try{
      await onStart({
        market: selectedMarket,
        symbol: selectMode==="manual" ? selectedSymbol.symbol : null,
        interval: selectMode==="manual" ? (selectedSymbol.interval||"1h") : "1h",
      })
    }catch(e){
      setError(e.response?.data?.detail || "开始失败，请重试")
    }finally{ setStarting(false) }
  }

  return (
    <div style={{height:"100%",overflowY:"auto",background:P.bg,color:P.text}}>
      <div style={{maxWidth:560,margin:"0 auto",padding:isMobile?"16px 14px 32px":"24px 24px 40px"}}>
        <div style={{fontSize:isMobile?20:24,fontWeight:900,marginBottom:4}}>模拟交易</div>
        <div style={{fontSize:13,color:P.textMuted,marginBottom:20}}>虚拟资金 · 真实杠杆机制 · 不限K线走图</div>

        {/* 资金管理 */}
        <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"16px 18px",marginBottom:14}}>
          <div style={{fontSize:11,color:P.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>虚拟资金</div>
          {!editingBalance ? (
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontSize:28,fontWeight:900,fontFamily:"monospace",color:P.green}}>{fmt(account?.balance,2)}</span>
              <button onClick={()=>{ setBalanceInput(String(account?.balance||"")); setEditingBalance(true) }}
                style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${P.border}`,background:"transparent",color:P.textMuted,fontSize:12,cursor:"pointer"}}>
                修改
              </button>
            </div>
          ) : (
            <div style={{display:"flex",gap:8}}>
              <input type="number" value={balanceInput} onChange={e=>setBalanceInput(e.target.value)} autoFocus
                style={{flex:1,background:P.panel,border:`1px solid ${P.borderLight}`,borderRadius:8,padding:"10px 12px",color:P.text,fontSize:16,fontFamily:"monospace"}}/>
              <button onClick={saveBalance} style={{padding:"10px 16px",borderRadius:8,border:"none",background:P.red,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>确定</button>
              <button onClick={()=>setEditingBalance(false)} style={{padding:"10px 14px",borderRadius:8,border:`1px solid ${P.border}`,background:"transparent",color:P.textMuted,fontSize:13,cursor:"pointer"}}>取消</button>
            </div>
          )}
        </div>

        {/* 杠杆设置 */}
        <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"16px 18px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
            <span style={{fontSize:11,color:P.textMuted,textTransform:"uppercase",letterSpacing:"0.08em"}}>杠杆倍数</span>
            <span style={{fontSize:20,fontWeight:800,fontFamily:"monospace",color:P.yellow}}>{leverageInput}x</span>
          </div>
          <input type="range" min={1} max={100} value={leverageInput}
            onChange={e=>saveLeverage(parseInt(e.target.value))}
            style={{width:"100%",accentColor:P.red}}/>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:P.textDim,marginTop:2}}>
            <span>1x</span><span>25x</span><span>50x</span><span>75x</span><span>100x</span>
          </div>
        </div>

        {/* 标的选择 */}
        <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"16px 18px",marginBottom:14}}>
          <div style={{fontSize:11,color:P.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>标的选择</div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            {[["random","随机标的"],["manual","手动选择"]].map(([k,label])=>(
              <button key={k} onClick={()=>setSelectMode(k)}
                style={{flex:1,padding:"9px 0",borderRadius:8,border:`1px solid ${selectMode===k?P.red:P.border}`,
                  background:selectMode===k?"rgba(232,64,64,0.12)":"transparent",
                  color:selectMode===k?P.red:P.textMuted,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                {label}
              </button>
            ))}
          </div>

          {selectMode==="random" ? (
            <div style={{display:"flex",gap:8}}>
              {[["crypto","加密货币"],["futures","期货"]].map(([k,label])=>(
                <button key={k} onClick={()=>setSelectedMarket(k)}
                  style={{flex:1,padding:"9px 0",borderRadius:8,border:`1px solid ${selectedMarket===k?P.blue:P.border}`,
                    background:selectedMarket===k?"rgba(75,158,255,0.12)":"transparent",
                    color:selectedMarket===k?P.blue:P.textMuted,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:220,overflowY:"auto"}}>
              {marketSymbols.length===0 && <div style={{fontSize:12,color:P.textDim,padding:"8px 0"}}>该市场暂无可用标的</div>}
              {marketSymbols.map((s,i)=>(
                <button key={`${s.symbol}-${i}`} onClick={()=>setSelectedSymbol(s)}
                  style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderRadius:8,
                    border:`1px solid ${selectedSymbol?.symbol===s.symbol?P.red:P.border}`,
                    background:selectedSymbol?.symbol===s.symbol?"rgba(232,64,64,0.1)":P.panel,
                    color:P.text,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                  <span>{s.symbol}</span>
                  <span style={{fontSize:11,color:P.textMuted}}>{s.interval}</span>
                </button>
              ))}
              {/* 手动模式下也需要选市场分类筛选 */}
              <div style={{display:"flex",gap:8,marginTop:4}}>
                {[["crypto","加密货币"],["futures","期货"]].map(([k,label])=>(
                  <button key={k} onClick={()=>{setSelectedMarket(k);setSelectedSymbol(null)}}
                    style={{flex:1,padding:"6px 0",borderRadius:6,border:`1px solid ${selectedMarket===k?P.blue:P.border}`,
                      background:selectedMarket===k?"rgba(75,158,255,0.1)":"transparent",
                      color:selectedMarket===k?P.blue:P.textMuted,fontSize:11,cursor:"pointer"}}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <div style={{fontSize:13,color:P.red,marginBottom:12,padding:"8px 12px",background:"rgba(232,64,64,0.1)",borderRadius:8}}>{error}</div>}

        <button onClick={handleStart} disabled={starting}
          style={{width:"100%",padding:"15px 0",borderRadius:12,border:"none",cursor:starting?"wait":"pointer",
            background:P.red,color:"#fff",fontWeight:800,fontSize:16,marginBottom:14}}>
          {starting?"准备中...":"▶ 开始模拟交易"}
        </button>

        <div style={{display:"flex",gap:10}}>
          <button onClick={onShowHistory} style={{flex:1,padding:"13px 0",borderRadius:10,border:`1px solid ${P.border}`,background:P.surface,cursor:"pointer",color:P.text,fontSize:13,fontWeight:600}}>📋 交易记录</button>
          <button onClick={onShowStats} style={{flex:1,padding:"13px 0",borderRadius:10,border:`1px solid ${P.border}`,background:P.surface,cursor:"pointer",color:P.text,fontSize:13,fontWeight:600}}>📊 统计数据</button>
        </div>
      </div>
    </div>
  )
}

// ─── 开仓面板 ─────────────────────────────────────────────────────────────────
function OpenOrderPanel({onClose, onSubmit, currentPrice, leverage, balance, priceMode}){
  const isMobile = useIsMobile()
  const [direction, setDirection] = useState("long")
  const [orderType, setOrderType] = useState("market")   // market | limit
  const [quantity, setQuantity] = useState("")
  const [limitPrice, setLimitPrice] = useState("")
  const [useSL, setUseSL] = useState(false)
  const [slPrice, setSlPrice] = useState("")
  const [useTP, setUseTP] = useState(false)
  const [tpPrice, setTpPrice] = useState("")
  const [error, setError] = useState("")

  const qty = parseFloat(quantity) || 0
  const refPrice = orderType==="market" ? currentPrice : (parseFloat(limitPrice)||currentPrice)
  const margin = refPrice && qty ? (refPrice * qty) / leverage : 0

  const submit = ()=>{
    setError("")
    if(qty <= 0){ setError("请输入有效数量"); return }
    if(orderType==="limit" && (!limitPrice || parseFloat(limitPrice)<=0)){ setError("请输入挂单价格"); return }
    if(margin > balance){ setError(`保证金不足：需要 ${margin.toFixed(2)}，可用 ${balance.toFixed(2)}`); return }

    // 校验止盈止损价格方向，避免填反导致开仓后立即被判定触发
    const entryRef = orderType==="market" ? currentPrice : parseFloat(limitPrice)
    if(useSL && slPrice){
      const sl = parseFloat(slPrice)
      if(direction==="long" && sl >= entryRef){ setError("多单止损价必须低于开仓价"); return }
      if(direction==="short" && sl <= entryRef){ setError("空单止损价必须高于开仓价"); return }
    }
    if(useTP && tpPrice){
      const tp = parseFloat(tpPrice)
      if(direction==="long" && tp <= entryRef){ setError("多单止盈价必须高于开仓价"); return }
      if(direction==="short" && tp >= entryRef){ setError("空单止盈价必须低于开仓价"); return }
    }

    onSubmit({
      type: orderType, direction, quantity: qty,
      limit_price: orderType==="limit" ? parseFloat(limitPrice) : null,
      sl_price: useSL ? parseFloat(slPrice)||null : null,
      tp_price: useTP ? parseFloat(tpPrice)||null : null,
    })
  }

  const inputStyle = {width:"100%",background:P.panel,border:`1px solid ${P.border}`,borderRadius:8,padding:"10px 12px",color:P.text,fontSize:14,fontFamily:"monospace",boxSizing:"border-box"}

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:16}}>
      <div style={{background:P.surface,border:`1px solid ${P.borderLight}`,borderRadius:16,padding:24,width:380,maxWidth:"100%",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontSize:16,fontWeight:800}}>开仓</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:P.textMuted,fontSize:22,cursor:"pointer"}}>×</button>
        </div>

        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {[["long","开多"],["short","开空"]].map(([d,label])=>(
            <button key={d} onClick={()=>setDirection(d)}
              style={{flex:1,padding:"12px 0",borderRadius:10,border:"none",cursor:"pointer",fontWeight:800,fontSize:14,
                background:direction===d?(d==="long"?P.up:P.down):P.panel, color:direction===d?"#fff":P.textMuted}}>
              {label}
            </button>
          ))}
        </div>

        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {[["market","市价"],["limit","挂单"]].map(([t,label])=>(
            <button key={t} onClick={()=>setOrderType(t)}
              style={{flex:1,padding:"8px 0",borderRadius:8,border:`1px solid ${orderType===t?P.blue:P.border}`,cursor:"pointer",fontWeight:600,fontSize:12,
                background:orderType===t?"rgba(75,158,255,0.12)":"transparent", color:orderType===t?P.blue:P.textMuted}}>
              {label}
            </button>
          ))}
        </div>

        <div style={{fontSize:12,color:P.textMuted,marginBottom:12,padding:"8px 12px",background:P.panel,borderRadius:8}}>
          当前价 <b style={{color:P.text,fontFamily:"monospace"}}>{fmt(currentPrice)}</b> · 成交模式 <b style={{color:P.yellow}}>{priceMode==="close"?"收盘价":"开盘价"}</b>
        </div>

        {orderType==="limit" && (
          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,color:P.textMuted,display:"block",marginBottom:5}}>挂单价格</label>
            <input type="number" value={limitPrice} onChange={e=>setLimitPrice(e.target.value)} placeholder={String(currentPrice)} style={inputStyle}/>
          </div>
        )}

        <div style={{marginBottom:14}}>
          <label style={{fontSize:11,color:P.textMuted,display:"block",marginBottom:5}}>仓位数量</label>
          <input type="number" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="输入数量" style={inputStyle}/>
          {margin>0 && <div style={{fontSize:11,color:P.textMuted,marginTop:5}}>所需保证金 <b style={{color:P.yellow,fontFamily:"monospace"}}>{margin.toFixed(2)}</b> (杠杆{leverage}x)</div>}
        </div>

        {/* 止盈止损 */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          <input type="checkbox" checked={useSL} onChange={e=>setUseSL(e.target.checked)} style={{accentColor:P.down}}/>
          <span style={{fontSize:12,color:P.textMuted,flex:1}}>设置止损</span>
          {useSL && <input type="number" value={slPrice} onChange={e=>setSlPrice(e.target.value)} placeholder="止损价" style={{...inputStyle,width:110,padding:"6px 10px"}}/>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
          <input type="checkbox" checked={useTP} onChange={e=>setUseTP(e.target.checked)} style={{accentColor:P.up}}/>
          <span style={{fontSize:12,color:P.textMuted,flex:1}}>设置止盈</span>
          {useTP && <input type="number" value={tpPrice} onChange={e=>setTpPrice(e.target.value)} placeholder="止盈价" style={{...inputStyle,width:110,padding:"6px 10px"}}/>}
        </div>

        {error && <div style={{fontSize:12,color:P.red,marginBottom:12,padding:"7px 10px",background:"rgba(232,64,64,0.1)",borderRadius:6}}>{error}</div>}

        <button onClick={submit}
          style={{width:"100%",padding:"13px 0",borderRadius:10,border:"none",cursor:"pointer",
            background:direction==="long"?P.up:P.down, color:"#fff",fontWeight:800,fontSize:14}}>
          确认{orderType==="limit"?"挂单":"开仓"}
        </button>
      </div>
    </div>
  )
}

// ─── 平仓面板（市价/挂单/部分仓位）──────────────────────────────────────────────
function CloseOrderPanel({position, onClose, onSubmitClose, currentPrice}){
  const [closeQty, setCloseQty] = useState(String(position.quantity))
  const [closeType, setCloseType] = useState("market")
  const [limitPrice, setLimitPrice] = useState("")
  const [error, setError] = useState("")

  const submit = ()=>{
    const q = parseFloat(closeQty)
    if(isNaN(q) || q<=0 || q>position.quantity){ setError(`数量需在 0~${position.quantity} 之间`); return }
    const price = closeType==="market" ? currentPrice : parseFloat(limitPrice)
    if(closeType==="limit" && (!limitPrice||price<=0)){ setError("请输入挂单平仓价格"); return }
    onSubmitClose({ exit_price: price })
  }

  const inputStyle = {width:"100%",background:P.panel,border:`1px solid ${P.border}`,borderRadius:8,padding:"10px 12px",color:P.text,fontSize:14,fontFamily:"monospace",boxSizing:"border-box"}

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:16}}>
      <div style={{background:P.surface,border:`1px solid ${P.borderLight}`,borderRadius:16,padding:24,width:340,maxWidth:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontSize:16,fontWeight:800}}>平仓</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:P.textMuted,fontSize:22,cursor:"pointer"}}>×</button>
        </div>

        <div style={{fontSize:12,color:P.textMuted,marginBottom:14,padding:"8px 12px",background:P.panel,borderRadius:8}}>
          {position.direction==="long"?"▲ 持多":"▼ 持空"} @ {fmt(position.entry_price)} × {position.quantity}
        </div>

        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {[["market","市价平仓"],["limit","挂单平仓"]].map(([t,label])=>(
            <button key={t} onClick={()=>setCloseType(t)}
              style={{flex:1,padding:"8px 0",borderRadius:8,border:`1px solid ${closeType===t?P.blue:P.border}`,cursor:"pointer",fontWeight:600,fontSize:12,
                background:closeType===t?"rgba(75,158,255,0.12)":"transparent", color:closeType===t?P.blue:P.textMuted}}>
              {label}
            </button>
          ))}
        </div>

        {closeType==="limit" && (
          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,color:P.textMuted,display:"block",marginBottom:5}}>平仓价格</label>
            <input type="number" value={limitPrice} onChange={e=>setLimitPrice(e.target.value)} placeholder={String(currentPrice)} style={inputStyle}/>
          </div>
        )}

        <div style={{marginBottom:16}}>
          <label style={{fontSize:11,color:P.textMuted,display:"block",marginBottom:5}}>平仓数量（最多{position.quantity}）</label>
          <input type="number" value={closeQty} onChange={e=>setCloseQty(e.target.value)} style={inputStyle}/>
        </div>

        {error && <div style={{fontSize:12,color:P.red,marginBottom:12,padding:"7px 10px",background:"rgba(232,64,64,0.1)",borderRadius:6}}>{error}</div>}

        <button onClick={submit}
          style={{width:"100%",padding:"13px 0",borderRadius:10,border:"none",cursor:"pointer",
            background:position.direction==="long"?P.down:P.up, color:"#fff",fontWeight:800,fontSize:14}}>
          确认平仓
        </button>
      </div>
    </div>
  )
}

// ─── 修改止盈止损面板（持仓中可调整）──────────────────────────────────────────────
function EditSLTPPanel({position, onClose, onSubmit}){
  const [useSL, setUseSL] = useState(position.sl_price != null)
  const [slPrice, setSlPrice] = useState(position.sl_price != null ? String(position.sl_price) : "")
  const [useTP, setUseTP] = useState(position.tp_price != null)
  const [tpPrice, setTpPrice] = useState(position.tp_price != null ? String(position.tp_price) : "")
  const [error, setError] = useState("")

  const inputStyle = {width:"100%",background:P.panel,border:`1px solid ${P.border}`,borderRadius:8,padding:"10px 12px",color:P.text,fontSize:14,fontFamily:"monospace",boxSizing:"border-box"}

  const submit = ()=>{
    setError("")
    const entry = position.entry_price
    if(useSL && slPrice){
      const sl = parseFloat(slPrice)
      if(position.direction==="long" && sl>=entry){ setError("多单止损价必须低于入场价"); return }
      if(position.direction==="short" && sl<=entry){ setError("空单止损价必须高于入场价"); return }
    }
    if(useTP && tpPrice){
      const tp = parseFloat(tpPrice)
      if(position.direction==="long" && tp<=entry){ setError("多单止盈价必须高于入场价"); return }
      if(position.direction==="short" && tp>=entry){ setError("空单止盈价必须低于入场价"); return }
    }
    onSubmit({
      sl_price: useSL && slPrice ? parseFloat(slPrice) : null,
      clear_sl: !useSL || !slPrice,
      tp_price: useTP && tpPrice ? parseFloat(tpPrice) : null,
      clear_tp: !useTP || !tpPrice,
    })
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:16}}>
      <div style={{background:P.surface,border:`1px solid ${P.borderLight}`,borderRadius:16,padding:24,width:340,maxWidth:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontSize:16,fontWeight:800}}>修改止盈止损</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:P.textMuted,fontSize:22,cursor:"pointer"}}>×</button>
        </div>

        <div style={{fontSize:12,color:P.textMuted,marginBottom:16,padding:"8px 12px",background:P.panel,borderRadius:8}}>
          {position.direction==="long"?"▲ 持多":"▼ 持空"} @ {fmt(position.entry_price)} × {position.quantity}
        </div>

        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <input type="checkbox" checked={useSL} onChange={e=>setUseSL(e.target.checked)} style={{accentColor:P.down}}/>
          <span style={{fontSize:12,color:P.textMuted,width:50}}>止损价</span>
          <input type="number" value={slPrice} onChange={e=>setSlPrice(e.target.value)} disabled={!useSL} placeholder="不设置" style={{...inputStyle,opacity:useSL?1:0.5}}/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18}}>
          <input type="checkbox" checked={useTP} onChange={e=>setUseTP(e.target.checked)} style={{accentColor:P.up}}/>
          <span style={{fontSize:12,color:P.textMuted,width:50}}>止盈价</span>
          <input type="number" value={tpPrice} onChange={e=>setTpPrice(e.target.value)} disabled={!useTP} placeholder="不设置" style={{...inputStyle,opacity:useTP?1:0.5}}/>
        </div>

        {error && <div style={{fontSize:12,color:P.red,marginBottom:12,padding:"7px 10px",background:"rgba(232,64,64,0.1)",borderRadius:6}}>{error}</div>}

        <button onClick={submit}
          style={{width:"100%",padding:"13px 0",borderRadius:10,border:"none",cursor:"pointer",background:P.red,color:"#fff",fontWeight:800,fontSize:14}}>
          保存修改
        </button>
      </div>
    </div>
  )
}

// ─── 结算结果弹窗 ─────────────────────────────────────────────────────────────
// ─── 本局结束汇总弹窗（走完所有K线时展示，汇总本局产生的全部交易记录）──────────────────
function SessionEndModal({trades, balance, onClose}){
  const totalPnl = trades.reduce((s,t)=>s+t.pnl,0)
  const totalPnlPct = trades.reduce((s,t)=>s+t.pnl_pct,0)
  const wins = trades.filter(t=>t.pnl>0).length
  const anyLiquidated = trades.some(t=>t.liquidated)
  const ip = totalPnl >= 0
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400}}>
      <div style={{background:P.surface,border:`1px solid ${P.borderLight}`,borderRadius:16,padding:"32px 36px",width:360,maxWidth:"92vw",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:8}}>{anyLiquidated?"💥":(ip?"🎉":"📉")}</div>
        <div style={{fontSize:13,color:P.textMuted,marginBottom:6}}>本局已走完全部K线</div>
        <div style={{fontSize:42,fontWeight:900,color:ip?P.up:P.down,fontFamily:"monospace",marginBottom:4}}>
          {totalPnl>=0?"+":""}{fmt(totalPnl,2)}
        </div>
        <div style={{fontSize:12,color:P.textMuted,marginBottom:18}}>
          共{trades.length}笔交易 · 胜{wins}笔 · 当前余额 {fmt(balance,2)}
        </div>

        {trades.length>0 && (
          <div style={{maxHeight:160,overflowY:"auto",marginBottom:16,textAlign:"left"}}>
            {trades.map(t=>(
              <div key={t.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:P.panel,borderRadius:6,marginBottom:4,fontSize:12}}>
                <span style={{color:t.direction==="long"?P.up:P.down}}>{t.direction==="long"?"▲":"▼"} {fmt(t.entry_price)}→{fmt(t.exit_price)}</span>
                <span style={{fontFamily:"monospace",fontWeight:700,color:t.pnl>=0?P.up:P.down}}>{t.pnl>=0?"+":""}{fmt(t.pnl)}</span>
              </div>
            ))}
          </div>
        )}

        <button onClick={onClose} style={{width:"100%",padding:"13px 0",borderRadius:10,border:"none",cursor:"pointer",background:P.red,color:"#fff",fontWeight:800,fontSize:15}}>
          返回
        </button>
      </div>
    </div>
  )
}

// ─── 持仓/挂单列表面板 ─────────────────────────────────────────────────────────
function PositionsPanel({orders, currentPrice, onCloseClick, onCancelClick, onEditSLTPClick}){
  const openOrders = orders.filter(o=>o.status==="open")
  const pendingOrders = orders.filter(o=>o.status==="pending")

  if(openOrders.length===0 && pendingOrders.length===0){
    return <div style={{fontSize:12,color:P.textDim,textAlign:"center",padding:"16px 0"}}>暂无持仓/挂单</div>
  }

  const calcFloatPnl = (o)=>{
    const mult = o.direction==="long" ? 1 : -1
    return (currentPrice - o.entry_price) * mult * o.quantity
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {openOrders.map(o=>{
        const floatPnl = calcFloatPnl(o)
        return (
          <div key={o.id} style={{background:P.panel,border:`1px solid ${P.border}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:12,fontWeight:700,color:o.direction==="long"?P.up:P.down}}>
                {o.direction==="long"?"▲ 持多":"▼ 持空"} {o.leverage}x
              </span>
              <span style={{fontSize:13,fontWeight:700,fontFamily:"monospace",color:floatPnl>=0?P.up:P.down}}>
                {floatPnl>=0?"+":""}{fmt(floatPnl)}
              </span>
            </div>
            <div style={{fontSize:11,color:P.textMuted,fontFamily:"monospace",marginBottom:6}}>
              {fmt(o.entry_price)} × {o.quantity} · 保证金{fmt(o.margin)} · 强平{fmt(o.liq_price)}
              {o.sl_price && <span> · 止损{fmt(o.sl_price)}</span>}
              {o.tp_price && <span> · 止盈{fmt(o.tp_price)}</span>}
            </div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>onEditSLTPClick(o)} style={{flex:1,padding:"6px 0",borderRadius:6,border:`1px solid ${P.border}`,background:"transparent",color:P.yellow,fontSize:12,cursor:"pointer"}}>
                止盈止损
              </button>
              <button onClick={()=>onCloseClick(o)} style={{flex:1,padding:"6px 0",borderRadius:6,border:`1px solid ${P.border}`,background:"transparent",color:P.text,fontSize:12,cursor:"pointer"}}>
                平仓
              </button>
            </div>
          </div>
        )
      })}
      {pendingOrders.map(o=>(
        <div key={o.id} style={{background:P.panel,border:`1px dashed ${P.borderLight}`,borderRadius:10,padding:"10px 12px"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:12,fontWeight:700,color:P.yellow}}>⏳ 挂单 {o.direction==="long"?"开多":"开空"}</span>
            <span style={{fontSize:11,color:P.textMuted}}>{o.leverage}x</span>
          </div>
          <div style={{fontSize:11,color:P.textMuted,fontFamily:"monospace",marginBottom:6}}>
            触发价{fmt(o.limit_price)} × {o.quantity}
          </div>
          <button onClick={()=>onCancelClick(o)} style={{width:"100%",padding:"6px 0",borderRadius:6,border:`1px solid ${P.border}`,background:"transparent",color:P.textMuted,fontSize:12,cursor:"pointer"}}>
            取消挂单
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── 交易主界面：走图 + 开仓/平仓 + 画线工具（复用MarketChart）──────────────────────
const VIEW_INTERVALS = ["5m","15m","30m","1h","1d"]

function TradeView({sessionInfo, account, onBack, onAccountUpdate}){
  const isMobile = useIsMobile()
  const [fullscreen, setFullscreen] = useState(false)
  const { settings: indicatorSettings } = useIndicatorSettings()

  const [klines, setKlines] = useState([])
  const [currentIdxTime, setCurrentIdxTime] = useState(sessionInfo.start_time)
  const [atEnd, setAtEnd] = useState(false)
  const [nextTime, setNextTime] = useState(null)
  const [loading, setLoading] = useState(true)

  // 显示周期：默认=本局走图的基础周期(sessionInfo.interval)，可切换到其他周期进行只读查看。
  // 切到非基础周期时进入"查看模式"——走图/开仓/平仓按钮禁用，因为这些操作必须基于真实走图
  // 进度(klines/currentIdxTime)，而非基础周期的K线序列在时间对齐上不可直接驱动交易状态机。
  const [displayInterval, setDisplayInterval] = useState(sessionInfo.interval)
  const isViewMode = displayInterval !== sessionInfo.interval
  const [viewKlines, setViewKlines] = useState([])
  const [viewLoading, setViewLoading] = useState(false)
  const viewLoadingMoreRef = useRef(false)
  const [viewHasMore, setViewHasMore] = useState(true)

  const [orders, setOrders] = useState([])
  const [showOpenPanel, setShowOpenPanel] = useState(false)
  const [closingOrder, setClosingOrder] = useState(null)
  const [editingSLTPOrder, setEditingSLTPOrder] = useState(null)
  const [showPositions, setShowPositions] = useState(false)
  const [priceMode, setPriceMode] = useState("close")
  const [drawTool, setDrawTool] = useState(null)
  const [drawings, setDrawings] = useState([])
  const [showDrawingList, setShowDrawingList] = useState(false)
  const [sessionEndTrades, setSessionEndTrades] = useState(null)  // 非null时表示本局已走完，展示汇总弹窗
  const [eventToast, setEventToast] = useState(null)

  const sessionId = sessionInfo.session_id
  const symbol = sessionInfo.symbol
  const market = sessionInfo.market
  const advancingRef = useRef(false)
  const commitTimerRef = useRef({})

  const loadData = useCallback((idxTime)=>{
    setLoading(true)
    Promise.all([
      simulateAPI.getSessionData(sessionId, idxTime),
      simulateAPI.listOrders(sessionId),
    ]).then(([dataRes, ordersRes])=>{
      setKlines(dataRes.data.klines||[])
      setAtEnd(dataRes.data.at_end)
      setNextTime(dataRes.data.next_time)
      setOrders(ordersRes.data||[])
    }).catch(()=>{}).finally(()=>setLoading(false))
  },[sessionId])

  useEffect(()=>{ loadData(currentIdxTime) },[])  // 仅首次加载

  // 画线按 symbol+基础interval 关联存储（与基础周期绑定，切换显示周期不影响画线数据本身）
  useEffect(()=>{
    drawingsAPI.list(symbol, sessionInfo.interval).then(r=>setDrawings(r.data||[])).catch(()=>setDrawings([]))
  },[symbol, sessionInfo.interval])

  // 切换显示周期：非基础周期时进入只读查看模式，独立拉取该周期数据，不影响走图状态机。
  // 关键修复：必须以当前模拟走图进度(currentIdxTime)为锚点拉取"该时间点之前"的K线，
  // 而不是传null去拿该周期数据库里真实的最新K线——否则不同周期之间时间会不同步
  // （比如基础周期走到2020年，切到其他周期却显示2026年真实最新数据）。
  useEffect(()=>{
    if(!isViewMode){ setViewKlines([]); return }
    setViewLoading(true)
    setViewHasMore(true)
    marketAPI.getData(symbol, displayInterval, currentIdxTime+1, 200)
      .then(r=>{ setViewKlines(r.data.klines||[]); setViewHasMore(r.data.has_more) })
      .catch(()=>setViewKlines([]))
      .finally(()=>setViewLoading(false))
  },[isViewMode, displayInterval, symbol, currentIdxTime])

  const loadMoreViewHistory = useCallback(()=>{
    if(viewLoadingMoreRef.current || !viewHasMore || viewKlines.length===0) return
    viewLoadingMoreRef.current = true
    const earliestTime = viewKlines[0].time
    marketAPI.getData(symbol, displayInterval, earliestTime, 200)
      .then(r=>{
        const newKlines = r.data.klines || []
        if(newKlines.length>0) setViewKlines(prev=>[...newKlines, ...prev])
        setViewHasMore(r.data.has_more)
      })
      .catch(()=>{})
      .finally(()=>{ viewLoadingMoreRef.current=false })
  },[symbol, displayInterval, viewHasMore, viewKlines])

  const handleAddDrawing = useCallback((data)=>{
    drawingsAPI.create({symbol, market, interval:sessionInfo.interval, color:"#f0b429", ...data})
      .then(r=>{ setDrawings(prev=>[...prev, {id:r.data.id, color:"#f0b429", ...data}]) })
      .catch(()=>{})
  },[symbol, market, sessionInfo.interval])

  const handleDeleteDrawing = useCallback((id)=>{
    drawingsAPI.remove(id).then(()=>{ setDrawings(prev=>prev.filter(d=>d.id!==id)) }).catch(()=>{})
    if(commitTimerRef.current[id]){ clearTimeout(commitTimerRef.current[id]); delete commitTimerRef.current[id] }
  },[])

  const handleUpdateDrawing = useCallback((id, patch)=>{
    setDrawings(prev=>prev.map(d=>d.id===id?{...d,...patch}:d))
    if(commitTimerRef.current[id]) clearTimeout(commitTimerRef.current[id])
    commitTimerRef.current[id] = setTimeout(()=>{
      drawingsAPI.updatePosition(id, patch).catch(()=>{})
      delete commitTimerRef.current[id]
    }, 200)
  },[])


  const last = klines[klines.length-1]
  const currentPrice = last?.close
  const openOrders = orders.filter(o=>o.status==="open")
  const hasPosition = openOrders.length > 0

  // 走图：前进一根，让后端检查挂单成交/止盈止损/强平。每次平仓(止盈/止损/强平)都会立即
  // 写入一条独立交易记录，但不会结束本局——可以继续开新仓。只有走到数据最新一根(is_last_bar)
  // 时，若仍有持仓会被强制平仓，随后session才真正结束，此时弹出本局汇总。
  const handleAdvance = useCallback(async ()=>{
    if(advancingRef.current || atEnd || !nextTime || !last) return
    advancingRef.current = true
    try{
      const dataRes = await simulateAPI.getSessionData(sessionId, nextTime)
      const newKlines = dataRes.data.klines||[]
      const newLast = newKlines[newKlines.length-1]
      if(!newLast){ advancingRef.current=false; return }

      const advRes = await simulateAPI.advanceSession({
        session_id: sessionId, bar_time: newLast.time,
        bar_open: newLast.open, bar_high: newLast.high, bar_low: newLast.low, bar_close: newLast.close,
        is_last_bar: dataRes.data.at_end,
      })

      setKlines(newKlines)
      setCurrentIdxTime(nextTime)
      setAtEnd(dataRes.data.at_end)
      setNextTime(dataRes.data.next_time)
      onAccountUpdate({ balance: advRes.data.balance })

      const ordersRes = await simulateAPI.listOrders(sessionId)
      setOrders(ordersRes.data||[])

      if(advRes.data.events?.length>0){
        const ev = advRes.data.events[0]
        const labelMap = {limit_filled:"挂单已成交", TP:"止盈触发，本笔交易已完成", SL:"止损触发，本笔交易已完成", liquidation:"⚠️ 触发强制平仓", Settle:"已自动平仓", cancelled:"挂单已取消"}
        setEventToast(labelMap[ev.type] || ev.type)
        setTimeout(()=>setEventToast(null), 2500)
      }

      // 只有真正走完所有K线(session_ended)才弹出本局汇总，平仓/空仓走图都不会触发
      if(advRes.data.session_ended){
        const tradesRes = await simulateAPI.listTrades(0, 200, sessionId)
        setSessionEndTrades(tradesRes.data||[])
      }
    }catch(e){
      console.error(e)
    }finally{
      advancingRef.current = false
    }
  },[sessionId, atEnd, nextTime, last, onAccountUpdate])

  const handleOpenSubmit = useCallback(async (data)=>{
    if(!last) return
    try{
      const entryPrice = priceMode==="close" ? last.close : last.open
      const res = await simulateAPI.openOrder({
        session_id: sessionId, type: data.type, direction: data.direction, quantity: data.quantity,
        limit_price: data.limit_price, current_price: entryPrice, current_time: last.time,
        sl_price: data.sl_price, tp_price: data.tp_price,
      })
      onAccountUpdate({ balance: res.data.balance })
      const ordersRes = await simulateAPI.listOrders(sessionId)
      setOrders(ordersRes.data||[])
      setShowOpenPanel(false)
    }catch(e){
      alert(e.response?.data?.detail || "开仓失败")
    }
  },[sessionId, last, priceMode, onAccountUpdate])


  const handleCloseSubmit = useCallback(async ({exit_price})=>{
    if(!closingOrder || !last) return
    try{
      const res = await simulateAPI.closeOrder({ order_id: closingOrder.id, exit_price, exit_time: last.time })
      onAccountUpdate({ balance: res.data.balance })
      const ordersRes = await simulateAPI.listOrders(sessionId)
      setOrders(ordersRes.data||[])
      setClosingOrder(null)
      // 平仓即完成一笔交易记录，但本局会话继续保持active，可以接着开新仓
      const pnl = res.data.pnl
      setEventToast(`本笔交易完成 ${pnl>=0?"+":""}${fmt(pnl)}`)
      setTimeout(()=>setEventToast(null), 2000)
    }catch(e){
      alert(e.response?.data?.detail || "平仓失败")
    }
  },[closingOrder, last, sessionId, onAccountUpdate])

  const handleCancelOrder = useCallback(async (order)=>{
    try{
      const res = await simulateAPI.cancelOrder({ order_id: order.id })
      onAccountUpdate({ balance: res.data.balance })
      const ordersRes = await simulateAPI.listOrders(sessionId)
      setOrders(ordersRes.data||[])
    }catch(e){
      alert(e.response?.data?.detail || "取消失败")
    }
  },[sessionId, onAccountUpdate])

  const handleUpdateSLTP = useCallback(async (patch)=>{
    if(!editingSLTPOrder) return
    try{
      await simulateAPI.updateSLTP({ order_id: editingSLTPOrder.id, ...patch })
      const ordersRes = await simulateAPI.listOrders(sessionId)
      setOrders(ordersRes.data||[])
      setEditingSLTPOrder(null)
    }catch(e){
      alert(e.response?.data?.detail || "修改失败")
    }
  },[editingSLTPOrder, sessionId])

  const totalFloatPnl = openOrders.reduce((sum,o)=>{
    if(!currentPrice) return sum
    const mult = o.direction==="long"?1:-1
    return sum + (currentPrice-o.entry_price)*mult*o.quantity
  },0)

  // 把当前持仓的止盈/止损转换为图表只读参考线；强平价不再画在图表里（价格过高/过低会把K线挤到一边），
  // 改为在图表上方以徽标形式展示，见下方 liqBadges。订单一旦平仓就不在openOrders里了，
  // 下次orders刷新后这些线自动从图表消失，符合"触发后线消失"的需求
  const priceLines = []
  openOrders.forEach(o=>{
    if(o.tp_price) priceLines.push({price:o.tp_price, color:P.up, label:"止盈"})
    if(o.sl_price) priceLines.push({price:o.sl_price, color:P.down, label:"止损"})
  })
  const liqBadges = openOrders.filter(o=>o.liq_price).map(o=>({
    id: o.id, price: o.liq_price, direction: o.direction,
  }))

  const content = (
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:P.bg,color:P.text,overflow:"hidden"}}>
      {/* 顶部信息条 */}
      <div style={{flexShrink:0,background:P.surface,borderBottom:`1px solid ${P.border}`,padding:fullscreen?"6px 10px":(isMobile?"8px 12px":"8px 16px")}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={onBack} style={{background:"none",border:"none",color:P.textMuted,fontSize:fullscreen?20:22,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>‹</button>
          <span style={{fontWeight:700,fontSize:fullscreen?13:(isMobile?14:15)}}>{sessionInfo.symbol}</span>
          <span style={{fontSize:11,color:P.textMuted}}>{MKT_LABEL[sessionInfo.market]||sessionInfo.market} · {sessionInfo.interval}</span>
          {currentPrice && <span style={{fontSize:fullscreen?13:15,fontWeight:700,fontFamily:"monospace",color:P.text}}>{fmt(currentPrice)}</span>}

          <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
            <div style={{display:"flex",background:P.panel,borderRadius:16,padding:2}}>
              {["close","open"].map(m=>(
                <button key={m} onClick={()=>setPriceMode(m)} disabled={hasPosition}
                  style={{padding:"3px 9px",borderRadius:14,border:"none",cursor:hasPosition?"not-allowed":"pointer",fontSize:10,fontWeight:700,
                    background:priceMode===m?P.red:"transparent", color:priceMode===m?"#fff":P.textMuted, opacity:hasPosition?0.5:1}}>
                  {m==="close"?"Close":"Open"}
                </button>
              ))}
            </div>
            <button onClick={()=>setFullscreen(v=>!v)} title="全屏" style={{background:"none",border:"none",color:P.textMuted,fontSize:fullscreen?16:18,cursor:"pointer",padding:"2px 6px"}}>
              {fullscreen?"⤓":"⛶"}
            </button>
          </div>
        </div>
        {/* 账户信息行 */}
        <div style={{display:"flex",gap:14,marginTop:6,fontSize:11,fontFamily:"monospace"}}>
          <span style={{color:P.textMuted}}>余额 <b style={{color:P.text}}>{fmt(account?.balance,2)}</b></span>
          {hasPosition && <span style={{color:P.textMuted}}>浮动盈亏 <b style={{color:totalFloatPnl>=0?P.up:P.down}}>{totalFloatPnl>=0?"+":""}{fmt(totalFloatPnl)}</b></span>}
        </div>
        {/* 周期切换：切到非基础周期(粗体标记的那个)进入只读查看模式，走图/交易锁定 */}
        <div style={{display:"flex",gap:6,marginTop:6,overflowX:"auto"}}>
          {VIEW_INTERVALS.map(iv=>(
            <button key={iv} onClick={()=>setDisplayInterval(iv)}
              style={{padding:fullscreen?"3px 9px":"4px 10px",borderRadius:6,border:iv===sessionInfo.interval?`1px solid ${P.blue}`:"none",cursor:"pointer",fontSize:fullscreen?10:11,fontWeight:600,flexShrink:0,
                background:displayInterval===iv?P.red:P.panel, color:displayInterval===iv?"#fff":P.textMuted}}>
              {iv}{iv===sessionInfo.interval?"•":""}
            </button>
          ))}
        </div>
      </div>

      {eventToast && (
        <div style={{position:"absolute",top:fullscreen?40:70,left:"50%",transform:"translateX(-50%)",background:P.panel,border:`1px solid ${P.yellow}`,borderRadius:8,padding:"6px 16px",fontSize:12,color:P.yellow,zIndex:25}}>
          {eventToast}
        </div>
      )}

      {/* 图表区 */}
      <div style={{flex:1,overflow:"hidden",position:"relative",minHeight:0}}>
        {liqBadges.length>0 && (
          <div style={{position:"absolute",top:isViewMode?(fullscreen?60:28):(fullscreen?6:6),left:8,zIndex:17,display:"flex",flexDirection:"column",gap:4}}>
            {liqBadges.map(b=>(
              <div key={b.id} style={{background:"rgba(232,64,64,0.15)",border:`1px solid ${P.red}`,borderRadius:6,padding:"2px 8px",fontSize:11,color:P.red,fontFamily:"monospace",fontWeight:700,whiteSpace:"nowrap"}}>
                强平价({b.direction==="long"?"多":"空"}) {fmt(b.price)}
              </div>
            ))}
          </div>
        )}
        {isViewMode && (
          <div style={{position:"absolute",top:fullscreen?38:6,left:"50%",transform:"translateX(-50%)",background:"rgba(240,180,41,0.15)",border:`1px solid ${P.yellow}`,borderRadius:8,padding:"4px 12px",fontSize:11,color:P.yellow,zIndex:16,whiteSpace:"nowrap"}}>
            查看模式({displayInterval})· 走图/交易已锁定，切回{sessionInfo.interval}继续操作
          </div>
        )}
        {(isViewMode ? viewLoading : (loading && klines.length===0)) ? (
          <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
            <div style={{fontSize:32,animation:"spin 1s linear infinite"}}>⟳</div>
            <div style={{fontSize:13,color:P.textMuted}}>加载中...</div>
          </div>
        ) : (
          <MarketChart
            klines={isViewMode ? viewKlines : klines}
            onNeedMoreHistory={isViewMode ? loadMoreViewHistory : ()=>{}}
            drawTool={drawTool}
            drawings={drawings}
            priceLines={priceLines}
            onAddDrawing={handleAddDrawing}
            onUpdateDrawing={handleUpdateDrawing}
            onDeleteDrawing={handleDeleteDrawing}
            isMobile={isMobile}
            indicatorSettings={indicatorSettings}
          />
        )}

        {/* 画线工具菜单（右上角）+ 持仓面板按钮 */}
        <div style={{position:"absolute",top:10,right:10,zIndex:18,display:"flex",flexDirection:"column",gap:8}}>
          <DrawToolMenu
            drawTool={drawTool} setDrawTool={setDrawTool}
            drawingCount={drawings.length}
            showDrawingList={showDrawingList} setShowDrawingList={setShowDrawingList}
          />
          <button onClick={()=>setShowPositions(v=>!v)}
            style={{width:36,height:36,borderRadius:18,border:`1px solid ${showPositions?P.red:P.borderLight}`,
              background:showPositions?"rgba(232,64,64,0.18)":P.panel,color:showPositions?P.red:P.textMuted,
              fontSize:15,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,0.4)"}}>
            ☰
          </button>
        </div>

        {showDrawingList && (
          <div style={{position:"absolute",top:10,right:56,background:P.panel,border:`1px solid ${P.borderLight}`,borderRadius:10,padding:12,minWidth:200,maxHeight:"60%",overflowY:"auto",zIndex:20,boxShadow:"0 8px 24px rgba(0,0,0,0.5)"}}>
            <div style={{fontSize:11,color:P.textMuted,marginBottom:8,fontWeight:700,textTransform:"uppercase"}}>已画线条</div>
            {drawings.length===0 && <div style={{fontSize:12,color:P.textDim}}>暂无画线</div>}
            {drawings.map(d=>(
              <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${P.border}`}}>
                <span style={{width:10,height:10,borderRadius:5,background:d.color,flexShrink:0}}/>
                <span style={{fontSize:12,flex:1}}>{d.type==="horizontal"?"水平线":"射线"} @ {fmt(d.price)}</span>
                <button onClick={()=>handleDeleteDrawing(d.id)} style={{background:"none",border:"none",color:P.red,cursor:"pointer",fontSize:14}}>✕</button>
              </div>
            ))}
          </div>
        )}

        {showPositions && (
          <div style={{position:"absolute",top:62,right:56,width:240,background:P.surface,border:`1px solid ${P.borderLight}`,borderRadius:12,padding:12,maxHeight:"70%",overflowY:"auto",zIndex:19,boxShadow:"0 8px 24px rgba(0,0,0,0.5)"}}>
            <div style={{fontSize:11,color:P.textMuted,marginBottom:10,fontWeight:700,textTransform:"uppercase"}}>持仓 / 挂单</div>
            <PositionsPanel orders={orders} currentPrice={currentPrice} onCloseClick={setClosingOrder} onCancelClick={handleCancelOrder} onEditSLTPClick={setEditingSLTPOrder}/>
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div style={{flexShrink:0,background:P.surface,borderTop:`1px solid ${P.border}`,padding:fullscreen?"8px 10px":"10px 12px",display:"flex",gap:8}}>
        <button onClick={()=>setShowOpenPanel(true)} disabled={isViewMode}
          style={{flex:1,padding:fullscreen?"10px 0":"13px 0",borderRadius:10,border:"none",cursor:isViewMode?"not-allowed":"pointer",
            background:isViewMode?"#5a2020":P.up,color:"#fff",fontWeight:800,fontSize:fullscreen?13:14,opacity:isViewMode?0.6:1}}>
          开仓
        </button>
        <button onClick={()=>{ if(openOrders[0]) setClosingOrder(openOrders[0]) }} disabled={!hasPosition||isViewMode}
          style={{flex:1,padding:fullscreen?"10px 0":"13px 0",borderRadius:10,border:"none",cursor:(hasPosition&&!isViewMode)?"pointer":"not-allowed",
            background:(hasPosition&&!isViewMode)?P.down:"#2a2d3a",color:(hasPosition&&!isViewMode)?"#fff":P.textMuted,fontWeight:800,fontSize:fullscreen?13:14}}>
          平仓
        </button>
        <button onClick={handleAdvance} disabled={atEnd||loading||isViewMode}
          style={{flex:1,padding:fullscreen?"10px 0":"13px 0",borderRadius:10,border:`1px solid ${P.border}`,cursor:(atEnd||isViewMode)?"not-allowed":"pointer",
            background:(atEnd||isViewMode)?"#262830":"#2a2d3a",color:(atEnd||isViewMode)?P.textMuted:P.text,fontWeight:700,fontSize:fullscreen?13:14}}>
          走图
        </button>
      </div>

      {showOpenPanel && currentPrice && (
        <OpenOrderPanel onClose={()=>setShowOpenPanel(false)} onSubmit={handleOpenSubmit}
          currentPrice={currentPrice} leverage={account?.leverage||10} balance={account?.balance||0} priceMode={priceMode}/>
      )}
      {closingOrder && currentPrice && (
        <CloseOrderPanel position={closingOrder} onClose={()=>setClosingOrder(null)} onSubmitClose={handleCloseSubmit} currentPrice={currentPrice}/>
      )}
      {editingSLTPOrder && (
        <EditSLTPPanel position={editingSLTPOrder} onClose={()=>setEditingSLTPOrder(null)} onSubmit={handleUpdateSLTP}/>
      )}
      {sessionEndTrades && (
        <SessionEndModal trades={sessionEndTrades} balance={account?.balance} onClose={()=>{ setSessionEndTrades(null); onBack() }}/>
      )}
    </div>
  )

  return (
    <>
      {!fullscreen && content}
      <RotatedFullscreen active={fullscreen}>{content}</RotatedFullscreen>
    </>
  )
}

// ─── 历史记录页 ───────────────────────────────────────────────────────────────
function HistoryPage({onBack}){
  const isMobile = useIsMobile()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    setLoading(true)
    simulateAPI.listTrades(0,100).then(r=>setList(r.data||[])).catch(()=>setList([])).finally(()=>setLoading(false))
  },[])

  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:P.bg,color:P.text}}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:P.surface,borderBottom:`1px solid ${P.border}`,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:P.textMuted,cursor:"pointer",fontSize:22,lineHeight:1}}>‹</button>
        <span style={{fontSize:16,fontWeight:700}}>模拟交易记录</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:isMobile?"12px":"16px 20px"}}>
        {loading && <div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>加载中...</div>}
        {!loading && list.length===0 && <div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>暂无记录<br/><span style={{fontSize:12}}>完成一次开仓到平仓后自动记录</span></div>}
        {list.map(t=>{
          const ip = (t.pnl||0) >= 0
          return (
            <div key={t.id} style={{display:"flex",alignItems:"center",padding:"12px 14px",background:P.surface,borderRadius:10,marginBottom:8,border:`1px solid ${P.border}`}}>
              <div style={{width:42,height:24,borderRadius:5,background:t.liquidated?"rgba(232,64,64,0.25)":(ip?"rgba(232,64,64,0.18)":"rgba(0,184,122,0.15)"),display:"flex",alignItems:"center",justifyContent:"center",marginRight:12,flexShrink:0}}>
                <span style={{fontSize:t.liquidated?9:11,fontWeight:700,color:t.liquidated?P.red:(ip?P.up:P.down)}}>{t.liquidated?"强平":(ip?"盈利":"亏损")}</span>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:14}}>{t.symbol}</div>
                <div style={{fontSize:11,color:P.textMuted}}>{MKT_LABEL[t.market]||t.market} · {t.direction==="long"?"开多":"开空"} · {t.leverage}x · {t.exit_reason}</div>
              </div>
              <div style={{textAlign:"right",minWidth:90}}>
                <div style={{fontSize:15,fontWeight:700,fontFamily:"monospace",color:ip?P.up:P.down}}>{fmtPct(t.pnl_pct)}</div>
                <div style={{fontSize:11,color:P.textMuted,fontFamily:"monospace"}}>{ip?"+":""}{fmt(t.pnl)}</div>
              </div>
              <div style={{fontSize:12,color:P.textMuted,minWidth:84,textAlign:"right"}}>{fmtDate(t.created_at)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 统计页 ───────────────────────────────────────────────────────────────────
function StatsPage({onBack}){
  const isMobile = useIsMobile()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    simulateAPI.getStats().then(r=>setData(r.data)).catch(()=>setData(null)).finally(()=>setLoading(false))
  },[])

  const Card = ({label,value,color,big})=>(
    <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:big?"20px 22px":"16px 18px"}}>
      <div style={{fontSize:10,color:P.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>{label}</div>
      <div style={{fontSize:big?(isMobile?26:30):(isMobile?18:20),fontWeight:900,fontFamily:"monospace",color:color||P.text}}>{value}</div>
    </div>
  )

  const byMkt = data?.by_market || {}
  const mktNames = {crypto:"加密货币", futures:"期货"}

  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:P.bg,color:P.text}}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:P.surface,borderBottom:`1px solid ${P.border}`,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:P.textMuted,cursor:"pointer",fontSize:22,lineHeight:1}}>‹</button>
        <span style={{fontSize:16,fontWeight:700}}>模拟交易统计</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:isMobile?"12px":"16px 20px"}}>
        {loading && <div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>加载中...</div>}
        {!loading && !data && <div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>暂无统计数据</div>}
        {data && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10,marginBottom:10}}>
              <Card label="交易笔数" value={data.total_trades} big/>
              <Card label="累计收益率" value={fmtPct(data.total_pnl_pct)} color={(data.total_pnl_pct||0)>=0?P.up:P.down} big/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <Card label="累计盈亏" value={(data.total_pnl>=0?"+":"")+fmt(data.total_pnl,2)} color={data.total_pnl>=0?P.up:P.down}/>
              <Card label="平均每笔收益率" value={fmtPct(data.avg_pnl_pct)} color={(data.avg_pnl_pct||0)>=0?P.up:P.down}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:isMobile?16:20}}>
              <Card label="交易胜率" value={data.win_rate!=null?(data.win_rate*100).toFixed(1)+"%":"—"} color={data.win_rate>=0.5?P.up:P.down}/>
              <Card label="强平次数" value={data.liquidated_count} color={data.liquidated_count>0?P.red:P.text}/>
            </div>
            {Object.entries(byMkt).map(([mktId,d])=>{
              const mktWinRate = d.trades>0 ? d.wins/d.trades : null
              return (
                <div key={mktId} style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:isMobile?"14px":"16px 20px",marginBottom:10}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:10}}>{mktNames[mktId]||mktId}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:isMobile?8:12}}>
                    {[["交易笔数",d.trades,P.text],["累计收益率",fmtPct(d.total_pnl_pct),(d.total_pnl_pct||0)>=0?P.up:P.down],["累计盈亏",(d.total_pnl>=0?"+":"")+fmt(d.total_pnl,2),d.total_pnl>=0?P.up:P.down],["胜率",mktWinRate!=null?(mktWinRate*100).toFixed(0)+"%":"—",mktWinRate>=0.5?P.up:P.textMuted]].map(([l,v,c])=>(
                      <div key={l}>
                        <div style={{fontSize:10,color:P.textMuted,marginBottom:4}}>{l}</div>
                        <div style={{fontSize:isMobile?14:16,fontWeight:700,fontFamily:"monospace",color:c}}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

// ─── 模拟模块根组件 ───────────────────────────────────────────────────────────
export default function SimulateModule(){
  const [page, setPage] = useState("home")   // home | trade | history | stats
  const [account, setAccount] = useState(null)
  const [sessionInfo, setSessionInfo] = useState(null)

  useEffect(()=>{
    simulateAPI.getAccount().then(r=>setAccount(r.data)).catch(()=>setAccount({balance:10000,leverage:10}))
  },[])

  const handleUpdateAccount = useCallback((patch)=>{
    simulateAPI.updateAccount(patch).then(r=>setAccount(r.data)).catch(()=>{})
  },[])

  const handleAccountPatchLocal = useCallback((patch)=>{
    // 走图/开仓/平仓接口已经在后端处理了余额变化，这里只是同步前端本地显示，不需要再调用updateAccount
    setAccount(prev=>({...prev, ...patch}))
  },[])

  const handleStart = useCallback(async ({market, symbol, interval})=>{
    const res = await simulateAPI.startSession({ market, symbol, interval })
    setSessionInfo(res.data)
    setPage("trade")
  },[])

  if(page==="trade" && sessionInfo) {
    return <TradeView sessionInfo={sessionInfo} account={account} onAccountUpdate={handleAccountPatchLocal} onBack={()=>{ setPage("home"); simulateAPI.getAccount().then(r=>setAccount(r.data)).catch(()=>{}) }}/>
  }
  if(page==="history") return <HistoryPage onBack={()=>setPage("home")}/>
  if(page==="stats")   return <StatsPage onBack={()=>setPage("home")}/>

  return (
    <SimulateHome
      account={account}
      onUpdateAccount={handleUpdateAccount}
      onStart={handleStart}
      onShowHistory={()=>setPage("history")}
      onShowStats={()=>setPage("stats")}
    />
  )
}
