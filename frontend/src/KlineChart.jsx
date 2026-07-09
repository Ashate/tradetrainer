import { useRef, useCallback, useEffect } from "react"
import { P, MA_COLORS, VOL_MA_COLORS } from "./theme"
import { fmt, fmtMMDD, fmtK, calcMA, calcATR, calcVolMA } from "./utils"

// ─── KlineChart ───────────────────────────────────────────────────────────────
// displayData: 固定50根，始终填满画布
// allData: 用于计算指标（包含预热数据）
// isMobile: 控制字体大小和padding
// 这是"训练"模块专用的固定窗口K线图（无手势缩放/平移）。
// "行情"模块使用另一个支持手势交互的图表组件（见 MarketChart.jsx）。
export default function KlineChart({displayData,allData,maSettings,volMASettings,showATR,isMobile=false}){
  const priceRef=useRef(null),volRef=useRef(null),atrRef=useRef(null)

  const draw=useCallback(()=>{
    if(!priceRef.current||!displayData.length) return
    const dpr=window.devicePixelRatio||1
    const drawOn=(c,fn)=>{
      if(!c) return
      const W=c.offsetWidth,H=c.offsetHeight
      if(!W||!H) return
      c.width=W*dpr;c.height=H*dpr
      const ctx=c.getContext("2d");ctx.scale(dpr,dpr);fn(ctx,W,H)
    }

    const n=displayData.length  // 固定50，铺满画布

    // ── 价格图 ──────────────────────────────────────────────────────────
    drawOn(priceRef.current,(ctx,W,H)=>{
      // 与MarketChart(行情/模拟模块)保持一致：只在右侧留价格轴，左侧K线直接铺到画布边界
      const padL=isMobile?8:12, padR=isMobile?56:64, padT=isMobile?10:12, padB=isMobile?18:22
      const cW=W-padL-padR, cH=H-padT-padB
      ctx.fillStyle=P.bg;ctx.fillRect(0,0,W,H)

      // 每根K线精确等分画布宽度
      const slotW=cW/n
      // body宽度：参考图二/图三比例，约65%slot宽，移动端稍细
      const bodyW=Math.max(isMobile?3:4, Math.floor(slotW*(isMobile?0.6:0.65)))
      const bodyOff=Math.floor((slotW-bodyW)/2)

      // 价格范围（仅基于displayData）
      let minP=Infinity,maxP=-Infinity
      displayData.forEach(d=>{minP=Math.min(minP,d.low);maxP=Math.max(maxP,d.high)})

      // MA（基于allData，取最后n根的值）
      const maVals={}
      Object.entries(maSettings).forEach(([k,on])=>{
        if(!on) return
        const p=parseInt(k.replace("ma",""))
        const full=calcMA(allData,p)
        maVals[k]=full.slice(allData.length-n)
        maVals[k].forEach(v=>{if(v!=null){minP=Math.min(minP,v);maxP=Math.max(maxP,v)}})
      })

      const margin=(maxP-minP)*0.08
      minP-=margin;maxP+=margin
      const pr=maxP-minP||1
      const py=p=>padT+(1-(p-minP)/pr)*cH

      // 水平网格线 + 价格
      const gc=isMobile?4:5
      ctx.strokeStyle="#242830";ctx.lineWidth=0.5
      const fontSize=isMobile?9:10
      ctx.font=`${fontSize}px monospace`
      for(let i=0;i<=gc;i++){
        const y=padT+(i/gc)*cH
        ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke()
        const price=maxP-(i/gc)*pr
        const priceStr=fmt(price,price>100?2:3)
        ctx.fillStyle=P.textMuted;ctx.textAlign="left"
        ctx.fillText(priceStr,W-padR+4,y+3)
      }

      // 时间轴（底部日期）
      const timeStep=Math.max(1,Math.floor(n/(isMobile?5:8)))
      ctx.font="9px monospace";ctx.fillStyle=P.textMuted;ctx.textAlign="center"
      for(let i=0;i<n;i+=timeStep){
        ctx.fillText(fmtMMDD(displayData[i].time),padL+(i+0.5)*slotW,H-4)
      }

      // 竖向网格线
      ctx.strokeStyle="#1e2028";ctx.lineWidth=0.5
      for(let i=0;i<n;i+=timeStep){
        const x=padL+(i+0.5)*slotW
        ctx.beginPath();ctx.moveTo(x,padT);ctx.lineTo(x,padT+cH);ctx.stroke()
      }

      // MA线
      Object.entries(maVals).forEach(([k,vals])=>{
        ctx.strokeStyle=MA_COLORS[k];ctx.lineWidth=isMobile?1:1.2;ctx.beginPath()
        let started=false
        vals.forEach((v,i)=>{
          if(v==null) return
          const x=padL+(i+0.5)*slotW,y=py(v)
          started?ctx.lineTo(x,y):(ctx.moveTo(x,y),started=true)
        });ctx.stroke()
      })

      // 蜡烛
      displayData.forEach((d,i)=>{
        const isUp=d.close>=d.open
        const cx=padL+(i+0.5)*slotW
        const bx=padL+i*slotW+bodyOff
        const yH=py(d.high),yL=py(d.low),yO=py(d.open),yC=py(d.close)
        const bTop=Math.min(yO,yC),bHgt=Math.max(Math.abs(yC-yO),1.5)
        const col=isUp?P.up:P.down

        // 影线（细线穿过整个high-low范围）
        ctx.strokeStyle=col;ctx.lineWidth=isMobile?0.8:1
        ctx.beginPath();ctx.moveTo(cx,yH);ctx.lineTo(cx,yL);ctx.stroke()

        if(isUp){
          // 阳线：实心红
          ctx.fillStyle=col;ctx.fillRect(bx,bTop,bodyW,bHgt)
        } else {
          // 阴线：空心绿（同花顺风格）
          ctx.strokeStyle=col;ctx.lineWidth=isMobile?0.8:1
          if(bodyW>=3){
            ctx.strokeRect(bx+0.5,bTop+0.5,bodyW-1,bHgt-1)
          } else {
            ctx.fillStyle=col;ctx.fillRect(bx,bTop,bodyW,bHgt)
          }
        }
      })

      // 最新收盘价浮动标签
      const last=displayData[n-1]
      if(last){
        const y=py(last.close)
        const isUp=last.close>=last.open
        ctx.strokeStyle=isUp?P.up:P.down
        ctx.lineWidth=0.8;ctx.setLineDash([4,3])
        ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke()
        ctx.setLineDash([])
        const labelW=padR-2
        ctx.fillStyle=isUp?P.up:P.down
        ctx.fillRect(W-padR+1,y-8,labelW,17)
        ctx.fillStyle="#fff";ctx.font=`bold ${isMobile?9:10}px monospace`;ctx.textAlign="center"
        ctx.fillText(fmt(last.close,last.close>100?2:3),W-padR+labelW/2+1,y+4)
      }
    })

    // ── 成交量图 ──────────────────────────────────────────────────────
    drawOn(volRef.current,(ctx,W,H)=>{
      const padL=isMobile?8:12,padR=isMobile?56:64,padT=6,padB=14
      const cH=H-padT-padB
      ctx.fillStyle=P.bg;ctx.fillRect(0,0,W,H)
      ctx.strokeStyle="#252830";ctx.lineWidth=0.5
      ctx.beginPath();ctx.moveTo(padL,padT);ctx.lineTo(W-padR,padT);ctx.stroke()

      const slotW=(W-padL-padR)/n
      const bodyW=Math.max(isMobile?3:4,Math.floor(slotW*(isMobile?0.6:0.65)))
      const bodyOff=Math.floor((slotW-bodyW)/2)
      const maxV=Math.max(...displayData.map(d=>d.volume),1)

      // Vol MA
      const vMaSlices={}
      Object.entries(volMASettings).forEach(([k,on])=>{
        if(!on) return
        const p={volma5:5,volma10:10,volma20:20}[k]
        vMaSlices[k]=calcVolMA(allData,p).slice(allData.length-n)
      })

      displayData.forEach((d,i)=>{
        const isUp=d.close>=d.open
        const bx=padL+i*slotW+bodyOff
        const bh=Math.max(1,(d.volume/maxV)*cH)
        ctx.fillStyle=isUp?P.volUp:P.volDown
        ctx.fillRect(bx,H-padB-bh,bodyW,bh)
      })

      Object.entries(vMaSlices).forEach(([k,vals])=>{
        ctx.strokeStyle=VOL_MA_COLORS[k];ctx.lineWidth=1;ctx.beginPath()
        let started=false
        vals.forEach((v,i)=>{
          if(v==null) return
          const x=padL+(i+0.5)*slotW,y=H-padB-(v/maxV)*cH
          started?ctx.lineTo(x,y):(ctx.moveTo(x,y),started=true)
        });ctx.stroke()
      })

      ctx.fillStyle=P.textMuted;ctx.font="9px monospace";ctx.textAlign="left"
      ctx.fillText("VOL "+fmtK(maxV),4,padT+10)
    })

    // ── ATR图 ─────────────────────────────────────────────────────────
    if(showATR){
      drawOn(atrRef.current,(ctx,W,H)=>{
        const padL=isMobile?8:12,padR=isMobile?56:64,padT=6,padB=12
        const cH=H-padT-padB
        ctx.fillStyle=P.bg;ctx.fillRect(0,0,W,H)
        ctx.strokeStyle="#252830";ctx.lineWidth=0.5
        ctx.beginPath();ctx.moveTo(padL,padT);ctx.lineTo(W-padR,padT);ctx.stroke()

        const slotW=(W-padL-padR)/n
        const full=calcATR(allData,14)
        const slice=full.slice(allData.length-n)
        const valid=slice.filter(v=>v!=null)
        if(!valid.length) return
        const minA=Math.min(...valid),maxA=Math.max(...valid),ar=maxA-minA||1

        ctx.strokeStyle=P.purple;ctx.lineWidth=1.5;ctx.beginPath()
        let started=false
        slice.forEach((v,i)=>{
          if(v==null) return
          const x=padL+(i+0.5)*slotW,y=padT+(1-(v-minA)/ar)*cH
          started?ctx.lineTo(x,y):(ctx.moveTo(x,y),started=true)
        });ctx.stroke()

        const last=valid[valid.length-1]
        ctx.fillStyle=P.textMuted;ctx.font="9px monospace";ctx.textAlign="left"
        ctx.fillText("ATR "+fmt(last,2),4,padT+10)
      })
    }
  },[displayData,allData,maSettings,volMASettings,showATR,isMobile])

  useEffect(()=>{draw()},[draw])
  useEffect(()=>{
    const ro=new ResizeObserver(()=>draw())
    if(priceRef.current) ro.observe(priceRef.current.parentElement)
    return()=>ro.disconnect()
  },[draw])

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",gap:1,background:P.bg}}>
      <canvas ref={priceRef} style={{flex:"1 1 0",width:"100%",display:"block",minHeight:0}}/>
      <canvas ref={volRef}   style={{height:isMobile?68:80,width:"100%",display:"block",flexShrink:0}}/>
      {showATR&&<canvas ref={atrRef} style={{height:isMobile?44:52,width:"100%",display:"block",flexShrink:0}}/>}
    </div>
  )
}
