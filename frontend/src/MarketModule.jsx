import { useState, useEffect, useCallback, useRef } from "react"
import { P } from "./theme"
import { fmt, fmtPct, useIsMobile } from "./utils"
import MarketChart from "./MarketChart"
import RotatedFullscreen from "./RotatedFullscreen"
import DrawToolMenu from "./DrawToolMenu"
import { klinesAPI, marketAPI, drawingsAPI } from "./api"
import { useIndicatorSettings } from "./indicatorSettings"

const INTERVALS = ["5m","15m","30m","1h","1d"]
const PAGE_SIZE = 200

// ─── 标的列表页（行情首页）──────────────────────────────────────────────────────
function SymbolListPage({onSelect}){
  const isMobile = useIsMobile()
  const [symbols, setSymbols] = useState([])
  const [loading, setLoading] = useState(true)
  const [marketFilter, setMarketFilter] = useState("all")

  useEffect(()=>{
    setLoading(true)
    klinesAPI.symbols().then(r=>{
      const raw = (r.data||[])
      // 同一标的在多个周期(1m/5m/1d等)下都可能达到数据量门槛，被接口分别返回多条。
      // 列表只需要按symbol展示一次（周期切换在详情页里做），否则会出现"重复标的"的困惑。
      // 优先保留1d周期的记录作为默认展示（数据覆盖最长，最适合作为默认入口）。
      const bySymbol = new Map()
      const preferredOrder = ["1d","1h","30m","15m","5m"]
      for(const s of raw){
        const existing = bySymbol.get(s.symbol)
        if(!existing){
          bySymbol.set(s.symbol, s)
        } else {
          const curRank = preferredOrder.indexOf(existing.interval)
          const newRank = preferredOrder.indexOf(s.interval)
          if(newRank !== -1 && (curRank === -1 || newRank < curRank)){
            bySymbol.set(s.symbol, s)
          }
        }
      }
      setSymbols(Array.from(bySymbol.values()))
    }).catch(()=>setSymbols([])).finally(()=>setLoading(false))
  },[])

  const isCrypto = m => m==="crypto"||m==="数字货币"
  const isFutures = m => m==="futures"||m==="期货"
  const isStock = m => m==="stock"||m==="股票"

  const filtered = symbols.filter(s=>{
    if(marketFilter==="all") return true
    if(marketFilter==="crypto") return isCrypto(s.market)
    if(marketFilter==="futures") return isFutures(s.market)
    if(marketFilter==="stock") return isStock(s.market)
    return true
  })

  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:P.bg,color:P.text}}>
      <div style={{padding:isMobile?"14px 14px 0":"18px 20px 0",flexShrink:0}}>
        <div style={{fontSize:isMobile?18:20,fontWeight:800,marginBottom:12}}>行情</div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {[["all","全部"],["crypto","加密货币"],["futures","期货"],["stock","股票"]].map(([k,label])=>(
            <button key={k} onClick={()=>setMarketFilter(k)}
              style={{padding:"6px 14px",borderRadius:16,border:`1px solid ${marketFilter===k?P.red:P.border}`,
                background:marketFilter===k?"rgba(232,64,64,0.12)":"transparent",
                color:marketFilter===k?P.red:P.textMuted,fontSize:12,fontWeight:600,cursor:"pointer"}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:isMobile?"0 10px 16px":"0 16px 20px"}}>
        {loading && <div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>加载中...</div>}
        {!loading && filtered.length===0 && (
          <div style={{color:P.textMuted,textAlign:"center",paddingTop:40,lineHeight:1.8}}>
            暂无可用标的<br/>
            <span style={{fontSize:12}}>请在「设置」中导入数据，或等待自动数据源同步完成</span>
          </div>
        )}
        {filtered.map((s,i)=>(
          <button key={`${s.symbol}-${s.interval}-${i}`} onClick={()=>onSelect(s)}
            style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"14px 16px",background:P.surface,borderRadius:10,marginBottom:8,
              border:`1px solid ${P.border}`,cursor:"pointer",textAlign:"left"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontWeight:700,fontSize:15,color:P.text}}>{s.display_name || s.symbol}</span>
                <span style={{fontSize:11,color:P.textMuted,fontFamily:"monospace"}}>{s.symbol}</span>
                {s.source==="manual" && (
                  <span style={{fontSize:9,fontWeight:700,color:P.yellow,background:"rgba(240,180,41,0.15)",padding:"1px 6px",borderRadius:4}}>手动</span>
                )}
              </div>
              <div style={{fontSize:11,color:P.textMuted,marginTop:2}}>
                {isCrypto(s.market) ? "加密货币" : isStock(s.market) ? "股票" : "期货"}
              </div>
            </div>
            <span style={{color:P.textMuted,fontSize:20}}>›</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── 画线工具收纳菜单：单个图标按钮，点击展开工具选项 ───────────────────────────────
// ─── 画线工具收纳菜单已提取为共享组件，见 DrawToolMenu.jsx ──────────────────────────

// ─── 图表主视图：竖屏和横屏全屏模式共用同一份UI，靠 fullscreen 参数微调样式 ───────────
function ChartView({
  symbol, displayName, market, last, chg, chgPct, interval, setInterval_,
  loading, klines, loadMoreHistory, drawTool, setDrawTool, drawings,
  handleAddDrawing, handleUpdateDrawing, handleDeleteDrawing, handleColorChange,
  showDrawingList, setShowDrawingList, loadingMore,
  isMobile, fullscreen, onBack, onToggleFullscreen, indicatorSettings,
}){
  const isStock = market==="stock"||market==="股票"
  const intervals = isStock ? ["1d"] : INTERVALS
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:P.bg,color:P.text,overflow:"hidden"}}>
      {/* 顶部信息条：返回 + 标的名 + 价格 + 周期切换 + 全屏按钮 */}
      <div style={{flexShrink:0,background:P.surface,borderBottom:`1px solid ${P.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:fullscreen?"6px 10px":(isMobile?"8px 12px":"8px 16px")}}>
          <button onClick={onBack} style={{background:"none",border:"none",color:P.textMuted,fontSize:fullscreen?20:22,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>‹</button>
          <span style={{fontWeight:700,fontSize:fullscreen?13:(isMobile?15:16)}}>{displayName || symbol}</span>
          <span style={{fontSize:fullscreen?11:12,color:P.textMuted,fontFamily:"monospace"}}>{symbol}</span>
          {last&&<span style={{fontSize:fullscreen?13:(isMobile?15:16),fontWeight:700,fontFamily:"monospace",color:chg>=0?P.up:P.down}}>{fmt(last.close, last.close>100?2:4)}</span>}
          {last&&<span style={{fontSize:fullscreen?11:12,fontFamily:"monospace",color:chg>=0?P.up:P.down}}>{fmtPct(chgPct)}</span>}

          {/* 全屏切换图标：点击切换横屏沉浸模式，不依赖手机物理朝向 */}
          <button onClick={onToggleFullscreen} title={fullscreen?"退出全屏":"全屏横屏查看"}
            style={{marginLeft:"auto",background:"none",border:"none",color:P.textMuted,fontSize:fullscreen?16:18,cursor:"pointer",padding:"2px 6px",display:"flex",alignItems:"center"}}>
            {fullscreen ? "⤓" : "⛶"}
          </button>
        </div>
        <div style={{display:"flex",gap:fullscreen?4:6,padding:fullscreen?"0 10px 6px":"0 12px 8px",overflowX:"auto"}}>
          {intervals.map(iv=>(
            <button key={iv} onClick={()=>setInterval_(iv)}
              style={{padding:fullscreen?"3px 9px":"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:fullscreen?10:12,fontWeight:600,flexShrink:0,
                background:interval===iv?P.red:P.panel, color:interval===iv?"#fff":P.textMuted}}>
              {iv}
            </button>
          ))}
        </div>
      </div>

      {/* 图表区 */}
      <div style={{flex:1,overflow:"hidden",position:"relative",minHeight:0}}>
        {loading && (
          <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
            <div style={{fontSize:32,animation:"spin 1s linear infinite"}}>⟳</div>
            <div style={{fontSize:13,color:P.textMuted}}>加载K线数据...</div>
          </div>
        )}
        {!loading && klines.length===0 && (
          <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:P.textMuted,fontSize:13}}>
            该标的暂无 {interval} 周期数据
          </div>
        )}
        {!loading && klines.length>0 && (
          <MarketChart
            klines={klines}
            onNeedMoreHistory={loadMoreHistory}
            drawTool={drawTool}
            drawings={drawings}
            onAddDrawing={handleAddDrawing}
            onUpdateDrawing={handleUpdateDrawing}
            onDeleteDrawing={handleDeleteDrawing}
            isMobile={isMobile}
            indicatorSettings={indicatorSettings}
          />
        )}
        {loadingMore && (
          <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",background:P.panel,borderRadius:8,padding:"4px 12px",fontSize:11,color:P.textMuted,zIndex:5}}>
            加载历史数据...
          </div>
        )}

        {/* 画线工具收纳菜单：图表右上角 */}
        <div style={{position:"absolute",top:10,right:10,zIndex:18}}>
          <DrawToolMenu
            drawTool={drawTool} setDrawTool={setDrawTool}
            drawingCount={drawings.length}
            showDrawingList={showDrawingList} setShowDrawingList={setShowDrawingList}
          />
        </div>

        {showDrawingList && (
          <div style={{position:"absolute",top:10,right:56,background:P.panel,border:`1px solid ${P.borderLight}`,borderRadius:10,padding:12,minWidth:200,maxHeight:"60%",overflowY:"auto",zIndex:20,boxShadow:"0 8px 24px rgba(0,0,0,0.5)"}}>
            <div style={{fontSize:11,color:P.textMuted,marginBottom:8,fontWeight:700,textTransform:"uppercase"}}>已画线条</div>
            {drawings.length===0 && <div style={{fontSize:12,color:P.textDim}}>暂无画线</div>}
            {drawings.map(d=>(
              <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${P.border}`}}>
                <input type="color" value={d.color} onChange={e=>handleColorChange(d.id,e.target.value)}
                  style={{width:20,height:20,border:"none",borderRadius:4,background:"none",cursor:"pointer",padding:0}}/>
                <span style={{fontSize:12,flex:1}}>{d.type==="horizontal"?"水平线":"射线"} @ {fmt(d.price)}</span>
                <button onClick={()=>handleDeleteDrawing(d.id)} style={{background:"none",border:"none",color:P.red,cursor:"pointer",fontSize:14}}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 标的详情页：管理数据/状态，渲染ChartView（竖屏直接渲染，全屏时包一层RotatedFullscreen）──
function SymbolDetailPage({symbolInfo, onBack}){
  const isMobile = useIsMobile()
  const [fullscreen, setFullscreen] = useState(false)   // 点击图标手动触发，不依赖物理转向
  const { settings: indicatorSettings } = useIndicatorSettings()

  const [interval, setInterval_] = useState(symbolInfo.interval || "1h")
  const [klines, setKlines] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [drawTool, setDrawTool] = useState(null)
  const [drawings, setDrawings] = useState([])
  const [showDrawingList, setShowDrawingList] = useState(false)

  const symbol = symbolInfo.symbol
  const market = symbolInfo.market
  const loadingMoreRef = useRef(false)
  const commitTimerRef = useRef({})

  useEffect(()=>{
    setLoading(true)
    setKlines([])
    setHasMore(true)
    marketAPI.getData(symbol, interval, null, PAGE_SIZE)
      .then(r=>{ setKlines(r.data.klines||[]); setHasMore(r.data.has_more) })
      .catch(()=>setKlines([]))
      .finally(()=>setLoading(false))

    drawingsAPI.list(symbol, interval).then(r=>setDrawings(r.data||[])).catch(()=>setDrawings([]))
  },[symbol, interval])

  const loadMoreHistory = useCallback(()=>{
    if(loadingMoreRef.current || !hasMore || klines.length===0) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const earliestTime = klines[0].time
    marketAPI.getData(symbol, interval, earliestTime, PAGE_SIZE)
      .then(r=>{
        const newKlines = r.data.klines || []
        if(newKlines.length>0) setKlines(prev=>[...newKlines, ...prev])
        setHasMore(r.data.has_more)
      })
      .catch(()=>{})
      .finally(()=>{ loadingMoreRef.current=false; setLoadingMore(false) })
  },[symbol, interval, hasMore, klines])

  const handleAddDrawing = useCallback((data)=>{
    drawingsAPI.create({symbol, market, interval, color:"#f0b429", ...data})
      .then(r=>{
        setDrawings(prev=>[...prev, {id:r.data.id, color:"#f0b429", ...data}])
      }).catch(()=>{})
  },[symbol, market, interval])

  const handleDeleteDrawing = useCallback((id)=>{
    drawingsAPI.remove(id).then(()=>{
      setDrawings(prev=>prev.filter(d=>d.id!==id))
    }).catch(()=>{})
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

  const handleColorChange = useCallback((id, color)=>{
    drawingsAPI.updateColor(id, color).then(()=>{
      setDrawings(prev=>prev.map(d=>d.id===id?{...d,color}:d))
    }).catch(()=>{})
  },[])

  const last = klines[klines.length-1]
  const prev = klines[klines.length-2]
  const chg = last&&prev ? last.close-prev.close : 0
  const chgPct = prev&&prev.close ? (chg/prev.close)*100 : 0

  const viewProps = {
    symbol, displayName: symbolInfo.display_name, market,
    last, chg, chgPct, interval, setInterval_,
    loading, klines, loadMoreHistory, drawTool, setDrawTool, drawings,
    handleAddDrawing, handleUpdateDrawing, handleDeleteDrawing, handleColorChange,
    showDrawingList, setShowDrawingList, loadingMore, isMobile, indicatorSettings,
    onBack: fullscreen ? ()=>setFullscreen(false) : onBack,
    onToggleFullscreen: ()=>setFullscreen(v=>!v),
  }

  return (
    <>
      {/* 竖屏正常布局：始终渲染（全屏时被RotatedFullscreen覆盖在上层，这里隐藏避免重复挂载图表实例） */}
      {!fullscreen && <ChartView {...viewProps} fullscreen={false}/>}

      {/* 全屏沉浸模式：点击⛶图标触发，CSS旋转铺满整个视口，不依赖手机物理朝向 */}
      <RotatedFullscreen active={fullscreen}>
        <ChartView {...viewProps} fullscreen={true}/>
      </RotatedFullscreen>
    </>
  )
}

// ─── 行情模块根组件 ───────────────────────────────────────────────────────────
export default function MarketModule(){
  const [selected, setSelected] = useState(null)

  if(selected) return <SymbolDetailPage symbolInfo={selected} onBack={()=>setSelected(null)}/>
  return <SymbolListPage onSelect={setSelected}/>
}
