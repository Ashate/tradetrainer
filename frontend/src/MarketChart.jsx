import { useRef, useState, useCallback, useEffect, useMemo } from "react"
import { P } from "./theme"
import { fmt, fmtK, fmtTimeFull, calcMA, calcVolMA, calcBOLL } from "./utils"

// ─── MarketChart ──────────────────────────────────────────────────────────────
// 交互式K线图：缩放/平移手势、十字光标、画线工具（水平线 + 两点射线，可选中拖动）。
//
// 画线交互（参考币安）：
//   - 水平线：单击图表即落线（只需一个点，价格=点击处，横跨全宽）
//   - 射线：需要两次点击 —— 第一次点击=起点，第二次点击=终点，两点连线方向决定射线朝终点
//     方向延伸到图表边界（不是只能水平，可以是任意角度）
//   - 选中已有线：单击线附近(命中容差内) → 高亮+显示拖动手柄
//     - 水平线：垫直拖动改变价格（左右拖动对它无意义，因为横跨全宽）
//     - 射线：拖动起点手柄 = 同时移动起点的时间和价格；拖动终点手柄 = 只改变方向(终点价格+时间)；
//             拖动线身(非手柄处) = 整条线平移(起点终点同时按相同的时间/价格偏移移动)
//
// priceLines: 只读的系统参考线(止盈/止损/强平价等)，与用户画的drawings是不同图层——
//   不可选中/拖动/删除，只是把持仓状态可视化展示在图表上，订单平仓后由调用方从数组中移除即自动消失。
//   格式: [{price, color, label}]
//
// 触屏修复：onTouchEnd 后浏览器会自动合成 mouseup/click，必须 preventDefault 阻止，
// 否则 handlePointerUp 会被触发两次，导致单击画线时画出两条完全相同的线。
export default function MarketChart({
  klines, onNeedMoreHistory, drawTool, drawings=[], priceLines=[],
  onAddDrawing, onUpdateDrawing, onDeleteDrawing, isMobile=false,
  indicatorSettings=null,
}){
  const priceCanvasRef = useRef(null)
  const volCanvasRef = useRef(null)

  const maSettings = indicatorSettings?.ma
  const volMaSettings = indicatorSettings?.volMa
  const bollSettings = indicatorSettings?.boll
  const candleSettings = indicatorSettings?.candle

  // MA/BOLL/成交量MA基于全量klines计算一次即可，不依赖视口平移/十字光标，
  // 避免每次交互（比如拖动十字光标）都重新遍历全部数据。
  const maSeries = useMemo(()=>{
    if(!maSettings?.enabled) return {}
    const out = {}
    Object.entries(maSettings.periods||{}).forEach(([k,on])=>{
      if(!on) return
      out[k] = calcMA(klines, parseInt(k.replace("ma","")))
    })
    return out
  },[klines, maSettings])

  const bollSeries = useMemo(()=>{
    if(!bollSettings?.enabled) return null
    return calcBOLL(klines, bollSettings.period, bollSettings.mult)
  },[klines, bollSettings])

  const volMaSeries = useMemo(()=>{
    if(!volMaSettings?.enabled) return {}
    const periodMap = {volma5:5, volma10:10, volma20:20}
    const out = {}
    Object.entries(volMaSettings.periods||{}).forEach(([k,on])=>{
      if(!on) return
      out[k] = calcVolMA(klines, periodMap[k])
    })
    return out
  },[klines, volMaSettings])

  const [visibleCount, setVisibleCount] = useState(80)
  const [rightOffset, setRightOffset]   = useState(0)
  const [crosshair, setCrosshair] = useState(null)
  const [pendingRayStart, setPendingRayStart] = useState(null)
  const [selectedDrawingId, setSelectedDrawingId] = useState(null)

  const chartLocked = crosshair !== null || !!drawTool

  // dragMode: null | "pan" | "crosshair" | "drawing-handle1" | "drawing-handle2" | "drawing-body"
  const gestureRef = useRef({
    active:false, lastX:0, lastY:0, moved:false,
    pinchDist:0, pinchVisibleCount:80,
    dragMode:null, dragDrawingId:null,
    dragOrigin:null,   // 拖动开始时的画线原始数据快照，用于计算整体平移量
    lastEventTime:0,   // 用于防抖：避免touchend+mouseup在短时间内重复触发同一次点击
  })

  const n = klines.length
  const clampOffset = useCallback((offset, vc)=>{
    const maxOffset = Math.max(0, n - vc)
    return Math.min(Math.max(0, offset), maxOffset)
  },[n])

  const endIdx   = Math.max(0, n - rightOffset)
  const startIdx = Math.max(0, endIdx - visibleCount)
  const visible   = klines.slice(startIdx, endIdx)

  useEffect(()=>{
    if(startIdx <= 5 && n > 0){
      onNeedMoreHistory?.()
    }
  },[startIdx, n, onNeedMoreHistory])

  // 当前价格映射范围（绘制和坐标转换共用，避免重复计算逻辑不一致）
  const getPriceRange = useCallback(()=>{
    let minP = Infinity, maxP = -Infinity
    visible.forEach(d=>{ minP=Math.min(minP,d.low); maxP=Math.max(maxP,d.high) })
    for(let i=startIdx;i<endIdx;i++){
      Object.values(maSeries).forEach(arr=>{
        const v = arr[i]
        if(v!=null){ minP=Math.min(minP,v); maxP=Math.max(maxP,v) }
      })
      if(bollSeries){
        const u = bollSeries.upper[i], l = bollSeries.lower[i]
        if(u!=null) maxP = Math.max(maxP, u)
        if(l!=null) minP = Math.min(minP, l)
      }
    }
    drawings.forEach(dw=>{
      if(dw.price!=null){ minP=Math.min(minP,dw.price); maxP=Math.max(maxP,dw.price) }
      if(dw.price2!=null){ minP=Math.min(minP,dw.price2); maxP=Math.max(maxP,dw.price2) }
    })
    priceLines.forEach(pl=>{
      if(pl.price!=null){ minP=Math.min(minP,pl.price); maxP=Math.max(maxP,pl.price) }
    })
    if(pendingRayStart) { minP=Math.min(minP,pendingRayStart.price); maxP=Math.max(maxP,pendingRayStart.price) }
    const margin = (maxP-minP)*0.08 || 1
    return { minP: minP-margin, maxP: maxP+margin }
  },[visible, drawings, priceLines, pendingRayStart, maSeries, bollSeries, startIdx, endIdx])

  // ── 绘制 ──────────────────────────────────────────────────────────────────
  const draw = useCallback(()=>{
    const priceCanvas = priceCanvasRef.current
    const volCanvas = volCanvasRef.current
    if(!priceCanvas || !visible.length) return
    const dpr = window.devicePixelRatio || 1

    const drawOn = (c, fn) => {
      if(!c) return
      const W = c.offsetWidth, H = c.offsetHeight
      if(!W || !H) return
      c.width = W*dpr; c.height = H*dpr
      const ctx = c.getContext("2d"); ctx.scale(dpr, dpr); fn(ctx, W, H)
    }

    const m = visible.length
    const padL = isMobile?8:12, padR = isMobile?56:64, padT = 8, padB = isMobile?16:20

    drawOn(priceCanvas, (ctx, W, H)=>{
      const cW = W - padL - padR, cH = H - padT - padB
      ctx.fillStyle = P.bg; ctx.fillRect(0,0,W,H)

      // 关键修复：slotW 必须基于"期望显示的根数"(visibleCount)而不是"实际可见根数"(m)计算。
      // 否则当某标的总数据量很少(比如只有2根1d数据)时，m会远小于visibleCount，
      // 用cW/m算出的slotW会被拉得极宽，导致K线撑满整个画布看起来像放大bug。
      // 用cW/visibleCount保持每根K线的宽度恒定，数据不够时自然在右侧(最新数据靠右对齐)留白。
      const slotW = cW / visibleCount
      const bodyW = Math.max(1, Math.floor(slotW * 0.7))
      const bodyOff = Math.floor((slotW - bodyW)/2)
      // 数据根数少于visibleCount时，已有数据要对齐到最右侧（最新K线始终贴右边界），
      // 左侧空出的部分留白，这样视觉上符合"看最新数据"的预期，与数据充足时的位置一致
      const leftPad = (visibleCount - m) * slotW

      const { minP, maxP } = getPriceRange()
      const pr = maxP - minP || 1
      const py = p => padT + (1-(p-minP)/pr)*cH
      const px = i => padL + leftPad + (i+0.5)*slotW
      // 把全局K线索引(可能在visible窗口之外)转换为屏幕x坐标，用于画延伸到窗口外的射线方向计算
      const pxGlobal = globalIdx => padL + leftPad + (globalIdx - startIdx + 0.5)*slotW

      const gc = 5
      ctx.strokeStyle = "#202430"; ctx.lineWidth = 0.5
      ctx.font = `${isMobile?10:11}px monospace`
      for(let i=0;i<=gc;i++){
        const y = padT + (i/gc)*cH
        ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke()
        const price = maxP - (i/gc)*pr
        ctx.fillStyle = P.textMuted; ctx.textAlign = "left"
        ctx.fillText(fmt(price, price>100?2:4), W-padR+6, y+4)
      }

      const timeStep = Math.max(1, Math.floor(m/6))
      ctx.fillStyle = P.textMuted; ctx.font = "9px monospace"; ctx.textAlign = "center"
      for(let i=0;i<m;i+=timeStep){
        const d = new Date(visible[i].time)
        const label = `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`
        ctx.fillText(label, px(i), H-5)
      }

      // ── MA / BOLL 均线叠加（读取全局指标设置，画在蜡烛下方）──────────────────
      if(maSettings?.enabled){
        Object.entries(maSeries).forEach(([k,arr])=>{
          ctx.strokeStyle = maSettings.colors?.[k] || P.yellow
          ctx.lineWidth = isMobile?1:1.2
          ctx.beginPath()
          let started = false
          for(let i=startIdx;i<endIdx;i++){
            const v = arr[i]
            if(v==null){ started=false; continue }
            const x = px(i-startIdx), y = py(v)
            started ? ctx.lineTo(x,y) : (ctx.moveTo(x,y), started=true)
          }
          ctx.stroke()
        })
      }
      if(bollSeries){
        ;[["mid",bollSeries.mid,false],["upper",bollSeries.upper,true],["lower",bollSeries.lower,true]].forEach(([key,arr,dashed])=>{
          ctx.strokeStyle = bollSettings.colors?.[key] || P.blue
          ctx.lineWidth = isMobile?1:1.2
          ctx.setLineDash(dashed?[4,3]:[])
          ctx.beginPath()
          let started = false
          for(let i=startIdx;i<endIdx;i++){
            const v = arr[i]
            if(v==null){ started=false; continue }
            const x = px(i-startIdx), y = py(v)
            started ? ctx.lineTo(x,y) : (ctx.moveTo(x,y), started=true)
          }
          ctx.stroke()
          ctx.setLineDash([])
        })
      }

      const upColor = candleSettings?.upColor || P.up
      const downColor = candleSettings?.downColor || P.down

      visible.forEach((d,i)=>{
        const isUp = d.close >= d.open
        const cx = px(i)
        const bx = padL + leftPad + i*slotW + bodyOff
        const yH=py(d.high), yL=py(d.low), yO=py(d.open), yC=py(d.close)
        const bTop = Math.min(yO,yC), bHgt = Math.max(Math.abs(yC-yO),1)
        const col = isUp ? upColor : downColor

        ctx.strokeStyle = col; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(cx,yH); ctx.lineTo(cx,yL); ctx.stroke()

        if(isUp){
          ctx.fillStyle = col; ctx.fillRect(bx,bTop,bodyW,bHgt)
        } else {
          ctx.strokeStyle = col
          if(bodyW>=3) ctx.strokeRect(bx+0.5,bTop+0.5,bodyW-1,bHgt-1)
          else { ctx.fillStyle=col; ctx.fillRect(bx,bTop,bodyW,bHgt) }
        }
      })

      const last = visible[m-1]
      if(last){
        const y = py(last.close)
        const isUp = last.close >= last.open
        ctx.strokeStyle = isUp?upColor:downColor; ctx.lineWidth=0.8; ctx.setLineDash([4,3])
        ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = isUp?upColor:downColor
        ctx.fillRect(W-padR+1, y-8, padR-2, 16)
        ctx.fillStyle = "#fff"; ctx.font = `bold ${isMobile?9:10}px monospace`; ctx.textAlign = "center"
        ctx.fillText(fmt(last.close, last.close>100?2:4), W-padR/2+1, y+3)
      }

      // ── 画线图层 ──────────────────────────────────────────────────────
      drawings.forEach(dw=>{
        const isSelected = dw.id === selectedDrawingId
        ctx.strokeStyle = dw.color || P.yellow
        ctx.lineWidth = isSelected ? 2.4 : 1.2

        if(dw.type === "horizontal"){
          const y = py(dw.price)
          ctx.setLineDash([6,4])
          ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke()
          ctx.setLineDash([])

          if(isSelected){
            ctx.fillStyle = dw.color || P.yellow
            ctx.beginPath(); ctx.arc(padL+30, y, 5, 0, Math.PI*2); ctx.fill()
            ctx.strokeStyle = "#fff"; ctx.lineWidth=1.5
            ctx.beginPath(); ctx.arc(padL+30, y, 5, 0, Math.PI*2); ctx.stroke()
          }
          ctx.fillStyle = dw.color || P.yellow
          ctx.font = isSelected ? "bold 10px monospace" : "10px monospace"
          ctx.textAlign = "left"
          ctx.fillText(fmt(dw.price, dw.price>100?2:4), padL+4, y-4)

        } else if(dw.type === "ray" && dw.time2!=null && dw.price2!=null){
          // ── 两点射线：找到起点/终点在当前视口的全局索引，用真实斜率延伸到边界 ──
          const startGlobalIdx = klines.findIndex(k=>k.time >= dw.time)
          const endGlobalIdx   = klines.findIndex(k=>k.time >= dw.time2)
          if(startGlobalIdx < 0 || endGlobalIdx < 0) return

          const x1 = pxGlobal(startGlobalIdx), y1 = py(dw.price)
          const x2 = pxGlobal(endGlobalIdx),   y2 = py(dw.price2)

          // 方向向量，从起点指向终点，再延伸到画布边界
          const dx = x2 - x1, dy = y2 - y1
          let farX, farY
          if(Math.abs(dx) < 0.01){
            // 垂直线：直接延伸到顶/底边界
            farX = x2; farY = dy >= 0 ? H : 0
          } else {
            const slope = dy/dx
            // 沿终点方向延伸：若终点在起点右侧，延伸到右边界(W-padR)；否则延伸到左边界(padL)
            const targetX = dx >= 0 ? (W-padR) : padL
            farX = targetX
            farY = y1 + slope*(targetX-x1)
          }

          ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(farX,farY); ctx.stroke()

          if(isSelected){
            // 起点手柄
            ctx.fillStyle = dw.color || P.yellow
            ctx.beginPath(); ctx.arc(x1, y1, 5, 0, Math.PI*2); ctx.fill()
            ctx.strokeStyle = "#fff"; ctx.lineWidth=1.5
            ctx.beginPath(); ctx.arc(x1, y1, 5, 0, Math.PI*2); ctx.stroke()
            // 终点手柄（空心，区分起点）
            ctx.fillStyle = P.bg
            ctx.beginPath(); ctx.arc(x2, y2, 5, 0, Math.PI*2); ctx.fill()
            ctx.strokeStyle = dw.color || P.yellow; ctx.lineWidth=2
            ctx.beginPath(); ctx.arc(x2, y2, 5, 0, Math.PI*2); ctx.stroke()
          }
          ctx.fillStyle = dw.color || P.yellow
          ctx.font = isSelected ? "bold 10px monospace" : "10px monospace"
          ctx.textAlign = "left"
          ctx.fillText(fmt(dw.price, dw.price>100?2:4), x1+8, y1-6)
        }
      })

      // ── 系统参考线：止盈/止损/强平等只读价位线（不可选中拖动，订单平仓后由调用方移除即消失）──
      priceLines.forEach(pl=>{
        const y = py(pl.price)
        ctx.strokeStyle = pl.color || P.yellow
        ctx.lineWidth = 1
        ctx.setLineDash([2,4])
        ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke()
        ctx.setLineDash([])

        if(pl.label){
          ctx.font = "9px monospace"; ctx.textAlign = "left"
          const labelText = `${pl.label} ${fmt(pl.price, pl.price>100?2:4)}`
          const labelW = ctx.measureText(labelText).width + 8
          ctx.fillStyle = pl.color || P.yellow
          ctx.fillRect(padL, y-13, labelW, 13)
          ctx.fillStyle = "#000"; ctx.font="bold 9px monospace"
          ctx.fillText(labelText, padL+4, y-3)
        }
      })

      // 正在画射线：已点起点，等待终点（实时跟随当前pending状态，终点位置由后续点击决定，这里只标记起点）
      if(pendingRayStart){
        const y = py(pendingRayStart.price)
        const startGlobalIdx = klines.findIndex(k=>k.time >= pendingRayStart.time)
        const x = startGlobalIdx>=0 ? pxGlobal(startGlobalIdx) : padL+8
        ctx.fillStyle = P.yellow
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.fill()
        ctx.strokeStyle = "#fff"; ctx.lineWidth=1.5
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.stroke()
        ctx.fillStyle = P.yellow; ctx.font = "10px monospace"; ctx.textAlign="left"
        ctx.fillText("点击设置终点", Math.min(x+10, W-padR-90), y+4)
      }

      // ── 十字光标 ──
      if(crosshair && crosshair.dataIdx>=0 && crosshair.dataIdx<m){
        const idx = crosshair.dataIdx
        const d = visible[idx]
        const cx = px(idx)
        const cy = crosshair.y

        ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth=0.6; ctx.setLineDash([3,3])
        ctx.beginPath(); ctx.moveTo(cx,padT); ctx.lineTo(cx,padT+cH); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(padL,cy); ctx.lineTo(W-padR,cy); ctx.stroke()
        ctx.setLineDash([])

        const hoverPrice = maxP - ((cy-padT)/cH)*pr
        ctx.fillStyle = P.panel
        ctx.fillRect(W-padR+1, cy-8, padR-2, 16)
        ctx.fillStyle = "#fff"; ctx.font = "10px monospace"; ctx.textAlign="center"
        ctx.fillText(fmt(hoverPrice, hoverPrice>100?2:4), W-padR/2+1, cy+3)

        const timeLabel = fmtTimeFull(d.time)
        const labelW = isMobile?100:130
        ctx.fillStyle = P.panel
        ctx.fillRect(cx-labelW/2, H-padB, labelW, 14)
        ctx.fillStyle = P.text; ctx.font="9px monospace"; ctx.textAlign="center"
        ctx.fillText(timeLabel, cx, H-padB+10)

        const infoW = isMobile?210:280
        const infoX = Math.min(Math.max(cx-infoW/2, 4), W-infoW-4)
        ctx.fillStyle = "rgba(20,22,28,0.92)"
        ctx.fillRect(infoX, 2, infoW, 16)
        ctx.font = "9px monospace"; ctx.textAlign="left"
        ctx.fillStyle = P.textMuted
        ctx.fillText(`开${fmt(d.open,2)} 高${fmt(d.high,2)} 低${fmt(d.low,2)} 收${fmt(d.close,2)}`, infoX+4, 13)
      }
    })

    drawOn(volCanvas, (ctx, W, H)=>{
      const cH = H - 4
      ctx.fillStyle = P.bg; ctx.fillRect(0,0,W,H)
      const slotW = (W-padL-padR)/visibleCount
      const bodyW = Math.max(1, Math.floor(slotW*0.7))
      const bodyOff = Math.floor((slotW-bodyW)/2)
      const leftPad = (visibleCount - m) * slotW
      const maxV = Math.max(...visible.map(d=>d.volume),1)

      visible.forEach((d,i)=>{
        const isUp = d.close>=d.open
        const bx = padL + leftPad + i*slotW + bodyOff
        const bh = Math.max(1,(d.volume/maxV)*cH)
        ctx.fillStyle = isUp?P.volUp:P.volDown
        ctx.fillRect(bx, H-bh, bodyW, bh)
      })

      if(volMaSettings?.enabled){
        Object.entries(volMaSeries).forEach(([k,arr])=>{
          ctx.strokeStyle = volMaSettings.colors?.[k] || P.yellow
          ctx.lineWidth = 1
          ctx.beginPath()
          let started = false
          for(let i=startIdx;i<endIdx;i++){
            const v = arr[i]
            if(v==null){ started=false; continue }
            const x = padL + leftPad + (i-startIdx+0.5)*slotW
            const y = H - (v/maxV)*cH
            started ? ctx.lineTo(x,y) : (ctx.moveTo(x,y), started=true)
          }
          ctx.stroke()
        })
      }

      if(crosshair && crosshair.dataIdx>=0 && crosshair.dataIdx<m){
        const cx = padL + leftPad + (crosshair.dataIdx+0.5)*slotW
        ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth=0.6; ctx.setLineDash([3,3])
        ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,H); ctx.stroke()
        ctx.setLineDash([])
      }

      ctx.fillStyle = P.textMuted; ctx.font="9px monospace"; ctx.textAlign="left"
      ctx.fillText("VOL "+fmtK(maxV), 4, 11)
    })
  },[visible, klines, drawings, priceLines, pendingRayStart, crosshair, isMobile, startIdx, endIdx, selectedDrawingId, getPriceRange, visibleCount, maSettings, maSeries, bollSettings, bollSeries, volMaSettings, volMaSeries, candleSettings])

  useEffect(()=>{ draw() },[draw])
  useEffect(()=>{
    const ro = new ResizeObserver(()=>draw())
    if(priceCanvasRef.current) ro.observe(priceCanvasRef.current.parentElement)
    return ()=>ro.disconnect()
  },[draw])

  // ── 坐标转换 ─────────────────────────────────────────────────────────────
  // 注意：必须用visibleCount(期望显示根数)算slotW，并加上leftPad偏移，
  // 与绘制函数(draw)用的是完全相同的坐标系——否则数据根数少于visibleCount时
  // (比如某标的只有2根1d数据)，点击/拖动的坐标判断会跟视觉上的K线位置错位。
  const xToDataIdx = useCallback((clientX)=>{
    const rect = priceCanvasRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const padL = isMobile?8:12, padR = isMobile?56:64
    const cW = rect.width - padL - padR
    const slotW = cW / visibleCount
    const leftPad = (visibleCount - visible.length) * slotW
    return Math.floor((x - padL - leftPad) / slotW)
  },[visible.length, visibleCount, isMobile])

  const xToGlobalTime = useCallback((clientX)=>{
    const dataIdx = xToDataIdx(clientX)
    const globalIdx = Math.max(0, Math.min(klines.length-1, startIdx+dataIdx))
    return klines[globalIdx]?.time
  },[xToDataIdx, startIdx, klines])

  const yToPrice = useCallback((clientY)=>{
    const rect = priceCanvasRef.current.getBoundingClientRect()
    const padT = 8, padB = isMobile?16:20
    const cH = rect.height - padT - padB
    const { minP, maxP } = getPriceRange()
    const pr = maxP-minP || 1
    const y = clientY - rect.top
    return maxP - ((y-padT)/cH)*pr
  },[isMobile, getPriceRange])

  const priceToY = useCallback((price)=>{
    const rect = priceCanvasRef.current.getBoundingClientRect()
    const padT = 8, padB = isMobile?16:20
    const cH = rect.height - padT - padB
    const { minP, maxP } = getPriceRange()
    const pr = maxP-minP || 1
    return padT + (1-(price-minP)/pr)*cH
  },[isMobile, getPriceRange])

  const timeToX = useCallback((time)=>{
    const rect = priceCanvasRef.current.getBoundingClientRect()
    const padL=isMobile?8:12, padR=isMobile?56:64
    const slotW = (rect.width-padL-padR)/visibleCount
    const leftPad = (visibleCount - visible.length) * slotW
    const globalIdx = klines.findIndex(k=>k.time >= time)
    if(globalIdx<0) return null
    return padL + leftPad + (globalIdx-startIdx+0.5)*slotW
  },[klines, startIdx, visible.length, visibleCount, isMobile])

  // 命中检测：返回 {id, part} part为 "handle1"|"handle2"|"body"|null
  const HIT_TOLERANCE = 12
  const hitTestDrawing = useCallback((clientX, clientY)=>{
    const rect = priceCanvasRef.current.getBoundingClientRect()
    const cx = clientX - rect.left
    const cy = clientY - rect.top

    for(const dw of drawings){
      if(dw.type === "horizontal"){
        const lineY = priceToY(dw.price)
        if(Math.abs(cy - lineY) <= HIT_TOLERANCE){
          return { id: dw.id, part: "body" }
        }
      } else if(dw.type === "ray" && dw.time2!=null){
        const x1 = timeToX(dw.time), y1 = priceToY(dw.price)
        const x2 = timeToX(dw.time2), y2 = priceToY(dw.price2)
        if(x1==null || x2==null) continue

        if(Math.hypot(cx-x1, cy-y1) <= HIT_TOLERANCE) return { id: dw.id, part: "handle1" }
        if(Math.hypot(cx-x2, cy-y2) <= HIT_TOLERANCE) return { id: dw.id, part: "handle2" }

        // 点到线段的距离（含延伸方向之外的部分简化为只检测起点-终点段+延伸方向一侧）
        const dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy)
        if(len < 0.01) continue
        const t = Math.max(-50, Math.min(50, ((cx-x1)*dx+(cy-y1)*dy)/(len*len)))  // 允许沿延伸方向之外一定范围
        const projX = x1+t*dx, projY = y1+t*dy
        const dist = Math.hypot(cx-projX, cy-projY)
        if(dist <= HIT_TOLERANCE) return { id: dw.id, part: "body" }
      }
    }
    return null
  },[drawings, priceToY, timeToX])

  // ── 点击处理（仅在确认非拖动的真实单击时调用）──────────────────────────────
  const handleClick = useCallback((clientX, clientY)=>{
    const price = yToPrice(clientY)
    const time = xToGlobalTime(clientX)

    if(drawTool === "horizontal"){
      onAddDrawing?.({ type:"horizontal", price, time:null, price2:null, time2:null })
      return
    }
    if(drawTool === "ray"){
      if(!pendingRayStart){
        if(time!=null) setPendingRayStart({price, time})
      } else {
        onAddDrawing?.({ type:"ray", price:pendingRayStart.price, time:pendingRayStart.time, price2:price, time2:time })
        setPendingRayStart(null)
      }
      return
    }

    const hit = hitTestDrawing(clientX, clientY)
    if(hit){
      setSelectedDrawingId(prev => prev === hit.id ? null : hit.id)
      setCrosshair(null)
      return
    }
    if(selectedDrawingId != null){
      setSelectedDrawingId(null)
      return
    }

    const rect = priceCanvasRef.current.getBoundingClientRect()
    const dataIdx = xToDataIdx(clientX)
    setCrosshair(prev => prev ? null : {dataIdx, y: clientY-rect.top})
  },[drawTool, pendingRayStart, xToDataIdx, yToPrice, xToGlobalTime, onAddDrawing, hitTestDrawing, selectedDrawingId])

  // ── 拖动手势 ─────────────────────────────────────────────────────────────
  const handlePointerDown = useCallback((clientX, clientY)=>{
    gestureRef.current.active = true
    gestureRef.current.lastX = clientX
    gestureRef.current.lastY = clientY
    gestureRef.current.moved = false
    gestureRef.current.dragMode = null
    gestureRef.current.dragDrawingId = null

    if(selectedDrawingId != null){
      const hit = hitTestDrawing(clientX, clientY)
      if(hit && hit.id === selectedDrawingId){
        const dw = drawings.find(d=>d.id===hit.id)
        gestureRef.current.dragMode = hit.part === "handle1" ? "drawing-handle1" : hit.part === "handle2" ? "drawing-handle2" : "drawing-body"
        gestureRef.current.dragDrawingId = hit.id
        gestureRef.current.dragOrigin = dw ? {...dw} : null
      }
    }
  },[selectedDrawingId, hitTestDrawing, drawings])

  const handlePointerMoveCore = useCallback((clientX, clientY)=>{
    if(!gestureRef.current.active) return
    const dx = clientX - gestureRef.current.lastX
    const dy = clientY - gestureRef.current.lastY
    if(Math.abs(dx) > 3 || Math.abs(dy) > 3) gestureRef.current.moved = true

    const mode = gestureRef.current.dragMode

    // ── 拖动画线的某个手柄：只移动该端点(时间+价格都跟随) ──
    if(mode === "drawing-handle1" || mode === "drawing-handle2"){
      const newPrice = yToPrice(clientY)
      const newTime = xToGlobalTime(clientX)
      const id = gestureRef.current.dragDrawingId
      if(mode === "drawing-handle1"){
        onUpdateDrawing?.(id, { price:newPrice, time:newTime })
      } else {
        onUpdateDrawing?.(id, { price2:newPrice, time2:newTime })
      }
      return
    }

    // ── 拖动线身：整条线平移(水平线只改价格；射线起点终点同时按相同偏移移动) ──
    if(mode === "drawing-body"){
      const origin = gestureRef.current.dragOrigin
      if(!origin) return
      const newPriceAtCursor = yToPrice(clientY)
      const startPriceAtCursor = yToPrice(gestureRef.current.lastY)  // 用首次按下位置作参照系更准确，但简化为增量计算
      const id = gestureRef.current.dragDrawingId

      if(origin.type === "horizontal"){
        onUpdateDrawing?.(id, { price: newPriceAtCursor })
      } else {
        // 射线整体平移：用价格增量(Δprice)和时间增量(Δtime，按index近似)
        const rect = priceCanvasRef.current.getBoundingClientRect()
        const padT=8, padB=isMobile?16:20
        const cH = rect.height-padT-padB
        const { minP, maxP } = getPriceRange()
        const pr = maxP-minP || 1
        const deltaPrice = -(dy/cH)*pr

        const padL=isMobile?8:12, padR=isMobile?56:64
        const slotW = (rect.width-padL-padR)/visibleCount
        const deltaIdx = Math.round(dx/slotW)
        const newTime1 = _shiftTimeByBars(klines, origin.time, deltaIdx)
        const newTime2 = _shiftTimeByBars(klines, origin.time2, deltaIdx)

        onUpdateDrawing?.(id, {
          price: origin.price + deltaPrice,
          price2: origin.price2 + deltaPrice,
          time: newTime1 ?? origin.time,
          time2: newTime2 ?? origin.time2,
        })
      }
      return
    }

    // ── 十字光标/画线工具激活 → 图表锁定，不平移，只更新十字光标 ──
    if(chartLocked){
      if(crosshair){
        const rect = priceCanvasRef.current.getBoundingClientRect()
        const dataIdx = xToDataIdx(clientX)
        setCrosshair({dataIdx, y: clientY-rect.top})
      }
      return
    }

    // ── 正常平移图表：右滑看更早历史，左滑看更新K线 ──
    if(Math.abs(dx) < 1) return
    const rect = priceCanvasRef.current.getBoundingClientRect()
    const padL=isMobile?8:12, padR=isMobile?56:64
    const slotW = (rect.width-padL-padR)/visibleCount
    const barsDelta = Math.round(dx/slotW)
    if(barsDelta !== 0){
      setRightOffset(prev=>clampOffset(prev+barsDelta, visibleCount))
      gestureRef.current.lastX = clientX
    }
  },[visibleCount, clampOffset, isMobile, crosshair, chartLocked, xToDataIdx, yToPrice, xToGlobalTime, onUpdateDrawing, klines, getPriceRange])

  const handlePointerUpCore = useCallback((clientX, clientY)=>{
    if(!gestureRef.current.active) return
    gestureRef.current.active = false
    const wasDraggingDrawing = gestureRef.current.dragMode != null
    gestureRef.current.dragMode = null
    gestureRef.current.dragOrigin = null

    if(!gestureRef.current.moved && !wasDraggingDrawing){
      handleClick(clientX, clientY)
    }
  },[handleClick])

  // ── 事件绑定：用单一事件源(touch优先，PC用mouse)，防止触屏合成事件重复触发 ──
  const handleMouseDown = useCallback((e)=>{ handlePointerDown(e.clientX, e.clientY) },[handlePointerDown])
  const handleMouseMove = useCallback((e)=>{ handlePointerMoveCore(e.clientX, e.clientY) },[handlePointerMoveCore])
  const handleMouseUp   = useCallback((e)=>{ handlePointerUpCore(e.clientX, e.clientY) },[handlePointerUpCore])

  const handleTouchStart = useCallback((e)=>{
    e.preventDefault()  // 阻止触屏后自动合成mouse事件，避免单击画两条线的bug
    if(e.touches.length === 2 && !chartLocked){
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      gestureRef.current.pinchDist = Math.sqrt(dx*dx+dy*dy)
      gestureRef.current.pinchVisibleCount = visibleCount
      gestureRef.current.active = false
    } else {
      const t = e.touches[0]
      handlePointerDown(t.clientX, t.clientY)
    }
  },[visibleCount, handlePointerDown, chartLocked])

  const handleTouchMove = useCallback((e)=>{
    e.preventDefault()
    if(e.touches.length === 2 && !chartLocked){
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx*dx+dy*dy)
      if(gestureRef.current.pinchDist > 0){
        const scale = gestureRef.current.pinchDist / dist
        const next = Math.round(Math.min(300, Math.max(20, gestureRef.current.pinchVisibleCount*scale)))
        setVisibleCount(next)
        setRightOffset(r=>clampOffset(r,next))
      }
    } else {
      const t = e.touches[0]
      handlePointerMoveCore(t.clientX, t.clientY)
    }
  },[clampOffset, handlePointerMoveCore, chartLocked])

  const handleTouchEnd = useCallback((e)=>{
    e.preventDefault()
    const t = e.changedTouches[0]
    handlePointerUpCore(t.clientX, t.clientY)
  },[handlePointerUpCore])

  const handleWheel = useCallback((e)=>{
    if(chartLocked) return
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.1 : 0.9
    setVisibleCount(prev=>{
      const next = Math.round(Math.min(300, Math.max(20, prev*factor)))
      setRightOffset(r=>clampOffset(r, next))
      return next
    })
  },[clampOffset, chartLocked])

  const resetView = useCallback(()=>{
    setVisibleCount(80); setRightOffset(0); setCrosshair(null); setPendingRayStart(null); setSelectedDrawingId(null)
  },[])

  const deleteSelected = useCallback(()=>{
    if(selectedDrawingId != null){
      onDeleteDrawing?.(selectedDrawingId)
      setSelectedDrawingId(null)
    }
  },[selectedDrawingId, onDeleteDrawing])

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",gap:1,background:P.bg,position:"relative",touchAction:"none"}}>
      <canvas ref={priceCanvasRef}
        style={{flex:"1 1 0",width:"100%",display:"block",minHeight:0,cursor:drawTool?"crosshair":(selectedDrawingId!=null?"move":"grab")}}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={()=>gestureRef.current.active=false}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      />
      <canvas ref={volCanvasRef} style={{height:isMobile?56:64,width:"100%",display:"block",flexShrink:0}}/>

      {rightOffset>0 && !chartLocked && (
        <button onClick={resetView}
          style={{position:"absolute",bottom:isMobile?12:16,right:10,background:P.panel,border:`1px solid ${P.borderLight}`,borderRadius:20,padding:"6px 12px",fontSize:11,color:P.text,cursor:"pointer",zIndex:10}}>
          → 最新
        </button>
      )}

      {selectedDrawingId != null && (
        <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",background:P.panel,border:`1px solid ${P.borderLight}`,borderRadius:20,padding:"5px 6px 5px 14px",display:"flex",alignItems:"center",gap:8,zIndex:10,boxShadow:"0 4px 16px rgba(0,0,0,0.4)"}}>
          <span style={{fontSize:11,color:P.textMuted}}>已选中 · 拖动手柄/线身可移动</span>
          <button onClick={deleteSelected}
            style={{background:P.red,border:"none",borderRadius:14,width:26,height:26,color:"#fff",fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

// 辅助函数：把某个时间点沿K线序列移动N根(用于整体平移射线时计算新的起点/终点时间)
function _shiftTimeByBars(klines, time, deltaBars){
  if(time == null) return null
  const idx = klines.findIndex(k=>k.time >= time)
  if(idx < 0) return null
  const newIdx = Math.max(0, Math.min(klines.length-1, idx+deltaBars))
  return klines[newIdx]?.time ?? null
}
