import { useState, useEffect, useCallback } from "react"
import { P, MA_COLORS, VOL_MA_COLORS, MARKETS, MKT_LABEL } from "./theme"
import { fmt, fmtPct, fmtDate, useIsMobile, calcMA, calcATR, generateLocalKlines } from "./utils"
import KlineChart from "./KlineChart"
import { sessionsAPI, tradesAPI, statsAPI, trainAPI } from "./api"

// ─── 结算弹窗 ─────────────────────────────────────────────────────────────────
function ResultModal({result,onClose}){
  const ip=result.pnlPct>=0
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400}}>
      <div style={{background:P.surface,border:`1px solid ${P.borderLight}`,borderRadius:16,padding:"36px 40px",width:340,maxWidth:"92vw",textAlign:"center"}}>
        <div style={{fontSize:44,marginBottom:10}}>{ip?"🎉":"📉"}</div>
        <div style={{fontSize:13,color:P.textMuted,marginBottom:6}}>本局收益率</div>
        <div style={{fontSize:48,fontWeight:900,color:ip?P.up:P.down,fontFamily:"monospace",marginBottom:4}}>{fmtPct(result.pnlPct)}</div>
        <div style={{fontSize:12,color:P.textMuted,marginBottom:20}}>{result.symbol} · {MKT_LABEL[result.market]||result.market} · {result.tradeCount}次交易</div>
        <div style={{display:"flex",gap:8,marginBottom:16,padding:"12px 14px",background:P.panel,borderRadius:10}}>
          {[["交易次数",result.tradeCount],["盈亏",fmt(result.pnl)],["胜率",result.winRate!=null?(result.winRate*100).toFixed(0)+"%":"—"]].map(([l,v])=>(
            <div key={l} style={{flex:1,textAlign:"center"}}>
              <div style={{fontSize:10,color:P.textMuted,marginBottom:4}}>{l}</div>
              <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace"}}>{v}</div>
            </div>
          ))}
        </div>
        <button onClick={onClose} style={{width:"100%",padding:"13px 0",borderRadius:10,border:"none",cursor:"pointer",background:P.red,color:"#fff",fontWeight:800,fontSize:15}}>继续训练</button>
      </div>
    </div>
  )
}

// ─── 主训练界面 ───────────────────────────────────────────────────────────────
const TRAIN_N = 70   // 训练K线总数
const REF_N   = 50   // 参考K线数
const DISPLAY = 50   // 图表显示数（固定50根铺满）
const WARMUP  = 300  // 预热数据

function TrainView({marketType,onBack,symbols}){
  const isMobile=useIsMobile()
  const isStock=marketType==="stock"

  // ── 核心数据 ──
  const [allData,      setAllData]      = useState([])
  const [currentIdx,   setCurrentIdx]   = useState(0)
  const [trainEndIdx,  setTrainEndIdx]  = useState(0)
  const [trainStartIdx,setTrainStartIdx]= useState(WARMUP+REF_N)
  const [currentSymbol,setCurrentSymbol]= useState("")
  const [currentInterval,setCurrentInterval]=useState("1d")
  const [sessionId,    setSessionId]    = useState(null)
  const [counter,      setCounter]      = useState(0)
  const [loading,      setLoading]      = useState(false)
  const [loadError,    setLoadError]    = useState("")

  // ── 交易 ──
  const [position,    setPosition]    = useState(null)
  const [tradeId,     setTradeId]     = useState(null)
  const [trades,      setTrades]      = useState([])
  const [sessionEnded,setSessionEnded]= useState(false)
  const [result,      setResult]      = useState(null)
  const [priceMode,   setPriceMode]   = useState("close")  // "close" | "open"
  const [pendingOrder,setPendingOrder]= useState(null)      // open模式下等待下一根开盘价成交的指令

  // ── 指标设置 ──
  const [maSettings,   setMaSettings]   = useState({ma5:true,ma10:true,ma20:true,ma60:false,ma120:false})
  const [volMASettings,setVolMASettings]= useState({volma5:false,volma10:false,volma20:true})
  const [showATR,      setShowATR]      = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // ── 当前K线 ──
  const currentCandle = allData[currentIdx]||null
  const prevCandle    = currentIdx>0 ? allData[currentIdx-1] : null
  const priceChg      = currentCandle&&prevCandle ? currentCandle.close-prevCandle.close : 0
  const priceChgPct   = prevCandle&&prevCandle.close ? (priceChg/prevCandle.close)*100 : 0
  const atrFull       = allData.length ? calcATR(allData,14) : []
  const currentATR    = atrFull[currentIdx]||0

  // ── 显示数据：固定50根铺满，滚动窗口 ──
  const displayStart = Math.max(0, currentIdx-DISPLAY+1)
  const displayData  = allData.slice(displayStart, currentIdx+1)
  const chartAllData = allData.slice(0, currentIdx+1)

  // ── 训练进度 ──
  const trainProgress = Math.max(0, currentIdx-trainStartIdx+1)
  const atEnd         = currentIdx >= trainEndIdx

  // ── 本局统计 ──
  const pnl      = trades.reduce((s,t)=>s+(t.pnl||0),0)
  const wins     = trades.filter(t=>t.pnl>0).length
  const winRate  = trades.length ? wins/trades.length : null
  const initPrice= allData[trainStartIdx]?.close||0
  const pnlPct   = initPrice>0 ? (pnl/initPrice)*100 : 0
  const floatPnl = position&&currentCandle ? (position.direction==="long"?currentCandle.close-position.entryPrice:position.entryPrice-currentCandle.close)*position.qty : 0

  // ── 开始新一局 ──
  const startNew=useCallback(async()=>{
    setTrades([]);setPosition(null);setTradeId(null);setSessionEnded(false);setResult(null);setLoadError("")

    // 找当前市场可用品种
    const marketKeyMap={stock:"股票",futures:"期货",crypto:"数字货币"}
    const mktSymbols=symbols.filter(s=>
      s.market===marketType||s.market===marketKeyMap[marketType]
    )

    if(mktSymbols.length>0){
      // ── 有真实数据：从后端拉取 ──
      const sym=mktSymbols[Math.floor(Math.random()*mktSymbols.length)]
      const symId=sym.symbol||sym.id   // 兼容两种字段名
      const symInterval=sym.interval||"1d"
      setCurrentSymbol(symId)
      setCurrentInterval(symInterval)
      setLoading(true)
      try{
        const res=await trainAPI.getData(symId, symInterval)
        const d=res.data
        const raw=d.klines
        setAllData(raw)
        const tsi=d.train_start
        const tei=tsi+TRAIN_N-1
        setTrainStartIdx(tsi)
        setCurrentIdx(tsi)
        setTrainEndIdx(tei)
        setSessionId(null)
      }catch(e){
        const errMsg=e.response?.data?.detail||"加载失败"
        setLoadError(`后端数据不足，已切换本地数据 (${errMsg})`)
        _useLocalData(symId)
      }finally{setLoading(false)}
    } else {
      // ── 无真实数据：使用本地生成 ──
      const defaultId={stock:"600519",futures:"IF",crypto:"BTC"}[marketType]||"BTC"
      setCurrentSymbol(defaultId)
      _useLocalData(defaultId)
    }
  },[symbols,marketType])

  // 本地数据fallback
  const _useLocalData=(symId)=>{
    const raw=generateLocalKlines(symId, WARMUP+REF_N+TRAIN_N+20)
    setAllData(raw)
    const tsi=WARMUP+REF_N
    setTrainStartIdx(tsi)
    setCurrentIdx(tsi)
    setTrainEndIdx(tsi+TRAIN_N-1)
    setSessionId(null)
  }

  useEffect(()=>{startNew()},[marketType])

  // ── 走图：每次+1 ──
  const nextBar=useCallback(()=>{
    if(sessionEnded||atEnd) return
    setCurrentIdx(prev=>Math.min(prev+1,trainEndIdx))
  },[sessionEnded,atEnd,trainEndIdx])

  // ── open模式：走到新K线后，用新K线开盘价执行待成交指令 ──
  useEffect(()=>{
    if(!pendingOrder||!currentCandle) return
    const order=pendingOrder
    setPendingOrder(null)
    const ep=currentCandle.open
    if(order.type==="open"){
      setPosition({direction:order.direction,qty:order.qty,entryPrice:ep,entryIdx:currentIdx,sl:null,tp:null})
      if(!sessionId){
        sessionsAPI.create({symbol:currentSymbol,market:marketType,interval:currentInterval,data_start_ts:currentCandle.time,start_index:currentIdx})
          .then(r=>{
            setSessionId(r.data.session_id)
            return tradesAPI.open({session_id:r.data.session_id,direction:order.direction,quantity:order.qty,entry_price:ep,entry_time:currentCandle.time,atr_at_entry:currentATR})
          }).then(tr=>setTradeId(tr.data.trade_id)).catch(()=>{})
      } else {
        tradesAPI.open({session_id:sessionId,direction:order.direction,quantity:order.qty,entry_price:ep,entry_time:currentCandle.time,atr_at_entry:currentATR})
          .then(tr=>setTradeId(tr.data.trade_id)).catch(()=>{})
      }
    } else if(order.type==="close"){
      const mult=order.position.direction==="long"?1:-1
      const pnlVal=(ep-order.position.entryPrice)*mult*order.position.qty
      const newTrade={id:trades.length+1,...order.position,exitPrice:ep,pnl:pnlVal,reason:"Manual"}
      setTrades(prev=>[...prev,newTrade])
      setPosition(null)
      if(order.tradeId){
        tradesAPI.close({trade_id:order.tradeId,exit_price:ep,exit_time:currentCandle.time,exit_reason:"Manual"}).catch(()=>{})
        setTradeId(null)
      }
    }
  },[currentIdx])

  // ── 70根走完后自动结算 ──
  useEffect(()=>{
    if(atEnd&&!sessionEnded&&allData.length>0&&!pendingOrder){
      settle()
    }
  },[atEnd,pendingOrder])

  // 空格/右箭头走图
  useEffect(()=>{
    const h=(e)=>{if(e.key===" "||e.key==="ArrowRight"){e.preventDefault();nextBar()}}
    window.addEventListener("keydown",h)
    return()=>window.removeEventListener("keydown",h)
  },[nextBar])

  // ── SL/TP检查（仅持仓状态下生效，pending订单不受影响）──
  useEffect(()=>{
    if(!position||!currentCandle||(!position.sl&&!position.tp)) return
    const {direction,sl,tp}=position
    const hitSL=sl?(direction==="long"?currentCandle.low<=sl:currentCandle.high>=sl):false
    const hitTP=tp?(direction==="long"?currentCandle.high>=tp:currentCandle.low<=tp):false
    if(!hitSL&&!hitTP) return
    closeTrade(hitTP?tp:sl, hitTP?"TP":"SL")
  },[currentIdx])

  // ── 平仓（close模式：立即用当前收盘价；open模式：挂单等下一根开盘价）──
  const closeTrade=useCallback(async(exitPrice,reason="Manual")=>{
    if(!position||!currentCandle) return

    // open模式 + 手动平仓（非SL/TP触发）→ 挂单等待下一根开盘价（最后一根则立即用收盘价平仓，因为没有下一根可成交）
    if(priceMode==="open"&&reason==="Manual"&&!atEnd){
      setPendingOrder({type:"close",position,tradeId})
      return
    }

    const ep=exitPrice??currentCandle.close
    const mult=position.direction==="long"?1:-1
    const pnlVal=(ep-position.entryPrice)*mult*position.qty
    const newTrade={id:trades.length+1,...position,exitPrice:ep,pnl:pnlVal,reason}
    setTrades(prev=>[...prev,newTrade])
    setPosition(null)
    if(tradeId){try{await tradesAPI.close({trade_id:tradeId,exit_price:ep,exit_time:currentCandle.time,exit_reason:reason})}catch{};setTradeId(null)}
    return newTrade
  },[position,currentCandle,tradeId,trades.length,priceMode,atEnd])

  // ── 开仓（close模式：立即用当前收盘价；open模式：挂单等下一根开盘价）──
  const openTrade=async(direction,qty=1)=>{
    if(!currentCandle||position||pendingOrder) return

    // open模式 → 挂单等待下一根开盘价（最后一根K线无法挂单，没有下一根可成交）
    if(priceMode==="open"){
      if(atEnd) return
      setPendingOrder({type:"open",direction,qty})
      return
    }

    const ep=currentCandle.close
    setPosition({direction,qty,entryPrice:ep,entryIdx:currentIdx,sl:null,tp:null})
    // Session 在首次开仓时才创建（确保只有触发结算才计入记录）
    if(!sessionId){
      try{
        const r=await sessionsAPI.create({symbol:currentSymbol,market:marketType,interval:currentInterval,data_start_ts:currentCandle.time,start_index:currentIdx})
        setSessionId(r.data.session_id)
        const tr=await tradesAPI.open({session_id:r.data.session_id,direction,quantity:qty,entry_price:ep,entry_time:currentCandle.time,atr_at_entry:currentATR})
        setTradeId(tr.data.trade_id)
      }catch{}
    } else {
      try{const r=await tradesAPI.open({session_id:sessionId,direction,quantity:qty,entry_price:ep,entry_time:currentCandle.time,atr_at_entry:currentATR});setTradeId(r.data.trade_id)}catch{}
    }
  }

  // ── 结算（只有结算才写入记录）──
  const settle=useCallback(async()=>{
    if(sessionEnded) return
    setSessionEnded(true)
    setPendingOrder(null)

    let finalTrades=[...trades]
    let finalPos=position
    if(finalPos&&currentCandle){
      const ep=currentCandle.close,mult=finalPos.direction==="long"?1:-1
      const pnlVal=(ep-finalPos.entryPrice)*mult*finalPos.qty
      const t={...finalPos,exitPrice:ep,pnl:pnlVal,reason:"Auto"}
      finalTrades=[...finalTrades,t]
      setTrades(finalTrades);setPosition(null)
      if(tradeId){try{await tradesAPI.close({trade_id:tradeId,exit_price:ep,exit_time:currentCandle.time,exit_reason:"Auto"})}catch{};setTradeId(null)}
    }

    setCounter(c=>c+1)
    const totalPnl=finalTrades.reduce((s,t)=>s+(t.pnl||0),0)
    const w=finalTrades.filter(t=>t.pnl>0).length
    const resObj={symbol:currentSymbol,market:marketType,pnl:totalPnl,pnlPct:initPrice>0?(totalPnl/initPrice)*100:0,tradeCount:finalTrades.length,winRate:finalTrades.length?w/finalTrades.length:null,entryPrice:initPrice}
    setResult(resObj)

    if(sessionId){
      try{await sessionsAPI.end({session_id:sessionId,data_end_ts:currentCandle?.time,pnl_pct:resObj.pnlPct})}catch{}
    } else if(finalTrades.length>0){
      try{
        const r=await sessionsAPI.create({symbol:currentSymbol,market:marketType,interval:currentInterval,data_start_ts:allData[trainStartIdx]?.time,start_index:trainStartIdx})
        await sessionsAPI.end({session_id:r.data.session_id,data_end_ts:currentCandle?.time,pnl_pct:resObj.pnlPct})
      }catch{}
    }
  },[sessionEnded,trades,position,currentCandle,tradeId,sessionId,currentSymbol,marketType,currentInterval,initPrice,trainStartIdx,allData])

  const btnBase={border:"none",cursor:"pointer",fontWeight:800,borderRadius:10,fontSize:isMobile?16:17,flex:1}

  const maDisplayVals=Object.entries(maSettings).filter(([,on])=>on).map(([k])=>{
    const p=parseInt(k.replace("ma",""))
    const full=calcMA(chartAllData,p)
    return {k,val:full[full.length-1]}
  }).filter(x=>x.val!=null)

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:P.bg,color:P.text,overflow:"hidden",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <div style={{background:P.surface,borderBottom:`1px solid ${P.border}`,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",padding:isMobile?"8px 12px":"8px 16px",gap:10,borderBottom:`1px solid ${P.border}`}}>
          <button onClick={onBack} style={{background:"none",border:"none",color:P.textMuted,fontSize:isMobile?20:22,cursor:"pointer",padding:"0 4px",fontWeight:400,lineHeight:1}}>‹</button>
          <span style={{fontWeight:700,fontSize:isMobile?14:15}}>K线训练</span>
          <span style={{fontSize:12,color:P.textMuted}}>· {currentSymbol} · {MKT_LABEL[marketType]||marketType}</span>
          <div style={{marginLeft:"auto",display:"flex",gap:isMobile?6:8,alignItems:"center"}}>
            <div style={{display:"flex",background:P.panel,borderRadius:20,padding:2,opacity:(position||pendingOrder)?0.5:1,pointerEvents:(position||pendingOrder)?"none":"auto"}}>
              {["close","open"].map(m=>(
                <button key={m} onClick={()=>setPriceMode(m)}
                  title={m==="close"?"以本根K线收盘价成交":"以下一根K线开盘价成交"}
                  style={{padding:isMobile?"4px 10px":"4px 12px",borderRadius:18,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,
                    background:priceMode===m?P.red:"transparent",
                    color:priceMode===m?"#fff":P.textMuted}}>
                  {m==="close"?"Close":"Open"}
                </button>
              ))}
            </div>
            <button onClick={()=>setShowSettings(v=>!v)} style={{background:"none",border:"none",color:showSettings?P.text:P.textMuted,fontSize:isMobile?16:18,cursor:"pointer",padding:"2px 4px"}}>⚙</button>
            <button onClick={startNew} style={{background:"none",border:"none",color:P.textMuted,fontSize:isMobile?16:18,cursor:"pointer",padding:"2px 4px"}}>⟳</button>
            <div style={{background:P.panel,borderRadius:20,padding:isMobile?"3px 10px":"4px 12px",fontSize:12,color:P.textMuted}}>
              结算 <b style={{color:P.text}}>{counter}</b>
            </div>
          </div>
        </div>

        {pendingOrder&&(
          <div style={{padding:"6px 16px",background:"rgba(240,180,41,0.12)",borderBottom:`1px solid rgba(240,180,41,0.3)`,fontSize:12,color:P.yellow,display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:14}}>⏳</span>
            {pendingOrder.type==="open"
              ? `挂单中：将以下一根K线开盘价 ${pendingOrder.direction==="long"?"开多":"开空"}`
              : "挂单中：将以下一根K线开盘价平仓"}
          </div>
        )}

        {currentCandle&&(
          <div style={{padding:isMobile?"6px 12px":"8px 16px",display:"flex",alignItems:"center",gap:isMobile?12:20,flexWrap:"wrap"}}>
            <div style={{minWidth:isMobile?80:100}}>
              <div style={{fontSize:isMobile?20:24,fontWeight:900,fontFamily:"monospace",color:pnlPct>=0?P.up:P.down,lineHeight:1}}>{fmtPct(pnlPct)}</div>
              <div style={{fontSize:10,color:P.textMuted,marginTop:2}}>本局收益率</div>
            </div>
            <div style={{display:"flex",gap:isMobile?10:16,fontSize:isMobile?12:13,fontFamily:"monospace",flexWrap:"wrap"}}>
              {[["开",fmt(currentCandle.open),P.text],["高",fmt(currentCandle.high),P.up],["收",fmt(currentCandle.close),priceChg>=0?P.up:P.down],["低",fmt(currentCandle.low),P.down],["涨跌额",fmt(priceChg),priceChg>=0?P.up:P.down],["涨跌幅",fmtPct(priceChgPct),priceChg>=0?P.up:P.down]].map(([l,v,c])=>(
                <span key={l} style={{color:P.textMuted}}>{l} <b style={{color:c}}>{v}</b></span>
              ))}
            </div>
          </div>
        )}

        {maDisplayVals.length>0&&(
          <div style={{padding:isMobile?"2px 12px 6px":"2px 16px 6px",display:"flex",gap:isMobile?10:14,fontSize:isMobile?11:12,fontFamily:"monospace",flexWrap:"wrap"}}>
            {maDisplayVals.map(({k,val})=>(
              <span key={k} style={{color:MA_COLORS[k]}}>{k.toUpperCase()}: {fmt(val)}</span>
            ))}
            {showATR&&currentATR>0&&<span style={{color:P.purple}}>ATR: {fmt(currentATR)}</span>}
          </div>
        )}
      </div>

      <div style={{flex:1,overflow:"hidden",position:"relative",minHeight:0}}>
        {loading&&(
          <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,background:P.bg}}>
            <div style={{fontSize:36,animation:"spin 1s linear infinite"}}>⟳</div>
            <div style={{fontSize:13,color:P.textMuted}}>正在加载真实K线数据...</div>
          </div>
        )}
        {!loading&&loadError&&(
          <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",background:"rgba(240,180,41,0.15)",border:"1px solid rgba(240,180,41,0.4)",borderRadius:8,padding:"6px 14px",fontSize:12,color:P.yellow,zIndex:10,whiteSpace:"nowrap",maxWidth:"90%",textAlign:"center"}}>
            {loadError}
          </div>
        )}
        {!loading&&allData.length>0&&displayData.length>0&&(
          <KlineChart
            displayData={displayData}
            allData={chartAllData}
            maSettings={maSettings}
            volMASettings={volMASettings}
            showATR={showATR}
            isMobile={isMobile}
          />
        )}

        {showSettings&&(
          <div style={{position:"absolute",top:8,right:8,background:P.panel,border:`1px solid ${P.borderLight}`,borderRadius:12,padding:14,zIndex:50,minWidth:180,boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
            <div style={{fontSize:10,color:P.textMuted,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.08em"}}>均线</div>
            {Object.keys(maSettings).map(k=>(
              <label key={k} style={{display:"flex",alignItems:"center",gap:8,padding:"3px 0",cursor:"pointer"}}>
                <input type="checkbox" checked={maSettings[k]} onChange={()=>setMaSettings(p=>({...p,[k]:!p[k]}))} style={{accentColor:MA_COLORS[k]}}/>
                <span style={{width:16,height:2,background:MA_COLORS[k],borderRadius:1}}/>
                <span style={{fontSize:12}}>{k.toUpperCase()}</span>
              </label>
            ))}
            <div style={{fontSize:10,color:P.textMuted,margin:"8px 0 6px",textTransform:"uppercase",letterSpacing:"0.08em"}}>成交量均线</div>
            {Object.entries(VOL_MA_COLORS).map(([k,color])=>(
              <label key={k} style={{display:"flex",alignItems:"center",gap:8,padding:"3px 0",cursor:"pointer"}}>
                <input type="checkbox" checked={volMASettings[k]} onChange={()=>setVolMASettings(p=>({...p,[k]:!p[k]}))} style={{accentColor:color}}/>
                <span style={{width:16,height:2,background:color,borderRadius:1}}/>
                <span style={{fontSize:12}}>{k.toUpperCase()}</span>
              </label>
            ))}
            <label style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0 3px",cursor:"pointer"}}>
              <input type="checkbox" checked={showATR} onChange={()=>setShowATR(v=>!v)} style={{accentColor:P.purple}}/>
              <span style={{width:16,height:2,background:P.purple,borderRadius:1}}/>
              <span style={{fontSize:12}}>ATR(14)</span>
            </label>
          </div>
        )}
      </div>

      <div style={{background:P.surface,borderTop:`1px solid ${P.border}`,flexShrink:0,padding:isMobile?"10px 10px 16px":"10px 14px 12px"}}>
        {position&&(
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,padding:"7px 12px",background:position.direction==="long"?"rgba(232,64,64,0.1)":"rgba(0,184,122,0.1)",borderRadius:8,border:`1px solid ${position.direction==="long"?"rgba(232,64,64,0.25)":"rgba(0,184,122,0.25)"}`}}>
            <span style={{fontSize:12,color:P.textMuted}}>
              {position.direction==="long"?"▲ 持多":"▼ 持空"} @ {fmt(position.entryPrice)} × {position.qty}
            </span>
            <span style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:floatPnl>=0?P.up:P.down}}>
              {floatPnl>=0?"+":""}{fmt(floatPnl)}
            </span>
          </div>
        )}

        <div style={{display:"flex",gap:isMobile?8:10,height:isMobile?54:58}}>
          {!position&&(
            <button onClick={()=>openTrade("long",1)} disabled={!!pendingOrder}
              style={{...btnBase,background:pendingOrder?"#5a2020":P.up,color:"#fff",cursor:pendingOrder?"not-allowed":"pointer"}}>
              {isStock?"买入":"开多"}
            </button>
          )}
          {!position&&!isStock&&(
            <button onClick={()=>openTrade("short",1)} disabled={!!pendingOrder}
              style={{...btnBase,background:pendingOrder?"#1a4a3a":P.down,color:"#fff",cursor:pendingOrder?"not-allowed":"pointer"}}>
              开空
            </button>
          )}
          {position&&(
            <button onClick={()=>closeTrade()} disabled={!!pendingOrder}
              style={{...btnBase,flex:2,background:position.direction==="long"?P.down:P.up,color:"#fff",opacity:pendingOrder?0.5:1,cursor:pendingOrder?"not-allowed":"pointer"}}>
              {isStock?"卖出":"平仓"}
            </button>
          )}
          <button onClick={nextBar} disabled={atEnd||sessionEnded}
            style={{...btnBase,background:atEnd||sessionEnded?"#262830":"#2a2d3a",color:atEnd||sessionEnded?P.textMuted:P.text,border:`1px solid ${P.border}`}}>
            走图
          </button>
          <button onClick={settle} disabled={sessionEnded}
            style={{...btnBase,background:"transparent",color:sessionEnded?P.textMuted:P.text,border:`2px solid ${sessionEnded?P.border:P.borderLight}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1}}>
            <span style={{fontSize:isMobile?14:15,fontWeight:700}}>结算</span>
            <span style={{fontSize:10,color:P.textMuted}}>{trainProgress}/{TRAIN_N}</span>
          </button>
        </div>
      </div>

      {result&&<ResultModal result={result} onClose={()=>{setResult(null);startNew()}}/>}
    </div>
  )
}

// ─── 训练模式选择（训练模块的内部首页）─────────────────────────────────────────
function TrainHome({onSelect,onShowStats,onShowHistory}){
  const isMobile=useIsMobile()
  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",overflow:"hidden",background:P.bg}}>
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",maxWidth:600,margin:"0 auto",width:"100%",padding:isMobile?"24px 16px":"40px 20px"}}>
        <div style={{textAlign:"center",marginBottom:isMobile?28:40}}>
          <div style={{fontSize:isMobile?22:28,fontWeight:900,marginBottom:8}}>选择训练模式</div>
          <div style={{fontSize:13,color:P.textMuted}}>每局随机品种，随机时间段，训练真实盘感</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:isMobile?20:28}}>
          {MARKETS.map(m=>(
            <button key={m.id} onClick={()=>onSelect(m.id)} style={{display:"flex",alignItems:"center",gap:16,padding:isMobile?"18px 16px":"22px 24px",borderRadius:14,border:`1px solid ${P.border}`,background:P.surface,cursor:"pointer",textAlign:"left"}}>
              <div style={{width:48,height:48,borderRadius:11,background:`${m.color}20`,border:`1px solid ${m.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>{m.icon}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:17,fontWeight:700,color:P.text,marginBottom:3}}>{m.label}</div>
                <div style={{fontSize:12,color:P.textMuted}}>{m.desc} · 随机品种 · {TRAIN_N}根K线训练</div>
              </div>
              <span style={{fontSize:20,color:P.textMuted}}>›</span>
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onShowHistory} style={{flex:1,padding:"15px 0",borderRadius:12,border:`1px solid ${P.border}`,background:P.surface,cursor:"pointer",color:P.text,fontSize:14,fontWeight:600}}>📋 训练记录</button>
          <button onClick={onShowStats} style={{flex:1,padding:"15px 0",borderRadius:12,border:`1px solid ${P.border}`,background:P.surface,cursor:"pointer",color:P.text,fontSize:14,fontWeight:600}}>📊 数据统计</button>
        </div>
      </div>
    </div>
  )
}

// ─── 训练记录页 ───────────────────────────────────────────────────────────────
function HistoryPage({onBack}){
  const isMobile=useIsMobile()
  const [list,setList]=useState([]);const [loading,setLoading]=useState(true)
  useEffect(()=>{setLoading(true);sessionsAPI.list(0,100).then(r=>setList(r.data||[])).catch(()=>setList([])).finally(()=>setLoading(false))},[])
  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:P.bg,color:P.text}}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:P.surface,borderBottom:`1px solid ${P.border}`,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:P.textMuted,cursor:"pointer",fontSize:22,lineHeight:1}}>‹</button>
        <span style={{fontSize:16,fontWeight:700}}>训练记录</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:isMobile?"12px":"16px 20px"}}>
        {loading&&<div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>加载中...</div>}
        {!loading&&list.length===0&&<div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>暂无记录<br/><span style={{fontSize:12}}>完成训练结算后自动保存</span></div>}
        {list.map((s,i)=>{
          const pct=s.pnl_pct??null
          const ip=pct!=null?pct>=0:(s.total_pnl||0)>=0
          const displayVal=pct!=null?fmtPct(pct):(s.total_pnl!=null?((ip?"+":"")+fmt(s.total_pnl)):"—")
          return(
            <div key={s.id||i} style={{display:"flex",alignItems:"center",padding:"12px 14px",background:P.surface,borderRadius:10,marginBottom:8,border:`1px solid ${P.border}`}}>
              <div style={{width:42,height:24,borderRadius:5,background:ip?"rgba(232,64,64,0.18)":"rgba(0,184,122,0.15)",display:"flex",alignItems:"center",justifyContent:"center",marginRight:12,flexShrink:0}}>
                <span style={{fontSize:11,fontWeight:700,color:ip?P.up:P.down}}>{ip?"盈利":"亏损"}</span>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:14,color:P.text}}>{s.symbol}</div>
                <div style={{fontSize:11,color:P.textMuted}}>{MKT_LABEL[s.market]||s.market||"—"}</div>
              </div>
              <div style={{fontSize:15,fontWeight:700,fontFamily:"monospace",color:ip?P.up:P.down,minWidth:80,textAlign:"center"}}>
                {displayVal}
              </div>
              <div style={{fontSize:12,color:P.textMuted,minWidth:84,textAlign:"right"}}>{fmtDate(s.start_time)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 统计页 ───────────────────────────────────────────────────────────────────
function StatsPage({onBack}){
  const isMobile=useIsMobile()
  const [data,setData]=useState(null);const [loading,setLoading]=useState(true)
  useEffect(()=>{statsAPI.overview().then(r=>setData(r.data)).catch(()=>setData(null)).finally(()=>setLoading(false))},[])

  const Card=({label,value,color,big,span2})=>(
    <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:big?"20px 22px":"16px 18px",gridColumn:span2?"span 2":undefined}}>
      <div style={{fontSize:10,color:P.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>{label}</div>
      <div style={{fontSize:big?isMobile?26:30:isMobile?18:20,fontWeight:900,fontFamily:"monospace",color:color||P.text}}>{value}</div>
    </div>
  )

  const byMkt=data?.by_market||{}
  const mktOrder=["stock","futures","crypto"]
  const mktNames={stock:"股票",futures:"期货",crypto:"加密货币"}

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:P.bg,color:P.text}}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:P.surface,borderBottom:`1px solid ${P.border}`,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:P.textMuted,cursor:"pointer",fontSize:22,lineHeight:1}}>‹</button>
        <span style={{fontSize:16,fontWeight:700}}>数据统计</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:isMobile?"12px":"16px 20px"}}>
        {loading&&<div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>加载中...</div>}
        {!loading&&!data&&<div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>暂无统计数据</div>}
        {data&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10,marginBottom:10}}>
              <Card label="训练次数" value={data.total_sessions} big/>
              <Card label="K线训练累计收益率" value={data.total_pnl_pct!=null?fmtPct(data.total_pnl_pct):"—"} color={(data.total_pnl_pct||0)>=0?P.up:P.down} big/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:isMobile?16:20}}>
              <Card label="综合胜率"    value={data.win_rate?(data.win_rate*100).toFixed(1)+"%":"—"} color={(data.win_rate||0)>=0.5?P.up:P.down}/>
              <Card label="平均盈亏比"  value={data.avg_rr?fmt(data.avg_rr):"—"}/>
              <Card label="总交易次数"  value={data.total_trades||0}/>
            </div>

            {mktOrder.map(mktId=>{
              const d=byMkt[mktId]
              if(!d) return null
              const mktColor=MARKETS.find(m=>m.id===mktId)?.color||P.textMuted
              const sessWinRate=d.sessions>0?d.wins/d.sessions:null
              return(
                <div key={mktId} style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:isMobile?"14px":"16px 20px",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:mktColor,flexShrink:0}}/>
                    <span style={{fontWeight:700,fontSize:14}}>{mktNames[mktId]}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:isMobile?8:12}}>
                    {[
                      ["训练次数", d.sessions, P.text],
                      ["累计收益率", d.total_pnl_pct!=null?fmtPct(d.total_pnl_pct):"—", (d.total_pnl_pct||0)>=0?P.up:P.down],
                      ["总交易",    d.trade_count+"次", P.text],
                      ["盈利局数",  sessWinRate!=null?(sessWinRate*100).toFixed(0)+"%":"—", sessWinRate>=0.5?P.up:P.textMuted],
                    ].map(([l,v,c])=>(
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

// ─── 训练模块根组件（挂载到底部导航"训练"）─────────────────────────────────────
export default function TrainModule({symbols}){
  const [page,setPage]   = useState("home")
  const [trainMkt,setTrainMkt] = useState(null)

  if(page==="train"&&trainMkt) return <TrainView marketType={trainMkt} onBack={()=>setPage("home")} symbols={symbols}/>
  if(page==="history") return <HistoryPage onBack={()=>setPage("home")}/>
  if(page==="stats")   return <StatsPage   onBack={()=>setPage("home")}/>

  return (
    <TrainHome
      onSelect={mkt=>{setTrainMkt(mkt);setPage("train")}}
      onShowStats={()=>setPage("stats")}
      onShowHistory={()=>setPage("history")}
    />
  )
}
