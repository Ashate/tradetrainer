import { useState, useEffect, useCallback, useRef } from "react"
import { authAPI, klinesAPI, sessionsAPI, tradesAPI, statsAPI, importAPI, trainAPI } from "./api"

// ─── 配色 ─────────────────────────────────────────────────────────────────────
const P = {
  bg:"#181a20",surface:"#1e2028",panel:"#23252f",
  border:"#2e3140",borderLight:"#3a3f52",
  red:"#e84040",green:"#00b87a",yellow:"#f0b429",purple:"#a78bfa",blue:"#4b9eff",
  text:"#e8eaf0",textMuted:"#7b8099",textDim:"#3d4260",
  up:"#e84040",down:"#00b87a",
  volUp:"rgba(232,64,64,0.82)",volDown:"rgba(0,184,122,0.82)",
}
const MA_COLORS={ma5:"#ffdd00",ma10:"#ff9900",ma20:"#dd44ff",ma60:"#4499ff",ma120:"#ff4466"}
const VOL_MA_COLORS={volma5:"#ffdd00",volma10:"#ff9900",volma20:"#4499ff"}
const MARKETS=[
  {id:"stock",  label:"股票训练", icon:"📈",color:"#e84040",desc:"A股·沪深"},
  {id:"futures",label:"期货训练", icon:"⚡",color:"#f0b429",desc:"国内期货"},
  {id:"crypto", label:"加密货币", icon:"₿", color:"#4b9eff",desc:"数字货币"},
]
const MKT_LABEL={stock:"股票",futures:"期货",crypto:"数字货币"}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
const fmt    = (n,d=2)=>n==null?"—":Number(n).toFixed(d)
const fmtPct = (n)=>n==null?"—":(n>=0?"+":"")+Number(n).toFixed(2)+"%"
const fmtK   = (n)=>!n?"0":n>=1e8?(n/1e8).toFixed(1)+"亿":n>=1e4?(n/1e4).toFixed(1)+"万":n.toFixed(0)
const fmtMMDD= (ts)=>{const d=new Date(ts);return `${d.getFullYear()%100}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`}
const fmtDate= (ts)=>ts?String(ts).slice(0,10):"—"

// ─── 响应式 ───────────────────────────────────────────────────────────────────
function useIsMobile(){
  const [m,setM]=useState(()=>window.innerWidth<768)
  useEffect(()=>{const h=()=>setM(window.innerWidth<768);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h)},[])
  return m
}

// ─── 本地K线生成（fallback）──────────────────────────────────────────────────
function seededRNG(seed){let s=seed;return()=>{s=(s*1664525+1013904223)&0xffffffff;return(s>>>0)/0xffffffff}}
function generateLocalKlines(symbol,count=400){
  const seed=symbol.split("").reduce((a,c)=>a+c.charCodeAt(0),0)
  const rng=seededRNG(seed+Date.now()%9999)
  const base={BTC:45000,ETH:2800,IF:4200,CU:68000,"600519":1680,"000001":12.5}[symbol]||3000
  const vol={BTC:0.022,ETH:0.028,IF:0.01,CU:0.013}[symbol]||0.016
  let price=base,ts=Date.now()-count*24*3600000,trend=0,tLen=0
  return Array.from({length:count},()=>{
    if(tLen--<=0){trend=(rng()-0.5)*2;tLen=Math.floor(rng()*60)+20}
    const chg=(rng()-0.485+trend*0.06)*vol*price
    const o=price;price=Math.max(price+chg,price*0.9)
    const wick=Math.abs(chg)*(0.4+rng()*1.2)
    const h=Math.max(o,price)+wick*rng()*0.5
    const l=Math.min(o,price)-wick*rng()*0.5
    const v=Math.floor((500+rng()*3000)*(1+Math.abs(chg/price)*20))
    const k={time:ts,open:o,high:h,low:l,close:price,volume:v,amount:v*(o+price)/2}
    ts+=24*3600000;return k
  })
}

// ─── 指标 ─────────────────────────────────────────────────────────────────────
function calcMA(data,period){
  const r=new Array(data.length).fill(null);let sum=0
  for(let i=0;i<data.length;i++){sum+=data[i].close;if(i>=period)sum-=data[i-period].close;if(i>=period-1)r[i]=sum/period}
  return r
}
function calcATR(data,period=14){
  const tr=data.map((d,i)=>i===0?d.high-d.low:Math.max(d.high-d.low,Math.abs(d.high-data[i-1].close),Math.abs(d.low-data[i-1].close)))
  const r=new Array(data.length).fill(null);let sum=0
  for(let i=0;i<data.length;i++){sum+=tr[i];if(i>=period)sum-=tr[i-period];if(i>=period-1)r[i]=sum/period}
  return r
}
function calcVolMA(data,period){
  const r=new Array(data.length).fill(null);let sum=0
  for(let i=0;i<data.length;i++){sum+=data[i].volume;if(i>=period)sum-=data[i-period].volume;if(i>=period-1)r[i]=sum/period}
  return r
}

// ─── KlineChart ───────────────────────────────────────────────────────────────
// displayData: 固定50根，始终填满画布
// allData: 用于计算指标（包含预热数据）
// isMobile: 控制字体大小和padding
function KlineChart({displayData,allData,maSettings,volMASettings,showATR,isMobile=false}){
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
      // PC端留右侧价格轴，移动端略微缩减padding
      const padL=isMobile?52:68, padR=isMobile?58:72, padT=isMobile?10:12, padB=isMobile?18:22
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
        ctx.fillStyle=P.textMuted;ctx.textAlign="right"
        ctx.fillText(priceStr,padL-5,y+3)
        ctx.textAlign="left"
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
      const padL=isMobile?52:68,padR=isMobile?58:72,padT=6,padB=14
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

      ctx.fillStyle=P.textMuted;ctx.font="9px monospace"
      ctx.textAlign="left";ctx.fillText("VOL",3,padT+10)
      ctx.textAlign="right";ctx.fillText(fmtK(maxV),padL-4,padT+10)
    })

    // ── ATR图 ─────────────────────────────────────────────────────────
    if(showATR){
      drawOn(atrRef.current,(ctx,W,H)=>{
        const padL=isMobile?52:68,padR=isMobile?58:72,padT=6,padB=12
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
        ctx.fillStyle=P.textMuted;ctx.font="9px monospace"
        ctx.textAlign="left";ctx.fillText("ATR",3,padT+10)
        ctx.fillStyle=P.purple;ctx.textAlign="right"
        ctx.fillText(fmt(last,2),padL-4,padT+10)
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

// ─── 登录页 ───────────────────────────────────────────────────────────────────
function LoginPage({onLogin}){
  const isMobile=useIsMobile()
  const [mode,setMode]=useState("login")
  const [form,setForm]=useState({username:"",email:"",password:""})
  const [error,setError]=useState("");const [loading,setLoading]=useState(false)
  const submit=async()=>{
    setError("");setLoading(true)
    try{
      if(mode==="login"){
        const res=await authAPI.login(form.username,form.password)
        localStorage.setItem("tt_token",res.data.access_token)
        localStorage.setItem("tt_username",res.data.username)
        onLogin(res.data.username)
      } else {await authAPI.register(form);setMode("login");setError("注册成功，请登录")}
    }catch(e){setError(e.response?.data?.detail||"操作失败")}
    finally{setLoading(false)}
  }
  const I=(field,type,ph)=>({type,placeholder:ph,value:form[field],
    onChange:e=>setForm(p=>({...p,[field]:e.target.value})),
    onKeyDown:e=>e.key==="Enter"&&submit(),
    style:{width:"100%",background:"#1e2028",border:`1px solid ${P.border}`,borderRadius:10,padding:"14px 16px",color:P.text,fontSize:16,boxSizing:"border-box"}
  })
  return(
    <div style={{minHeight:"100vh",background:P.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}select,input{outline:none;color-scheme:dark}button{font-family:inherit}`}</style>
      <div style={{width:"100%",maxWidth:380,background:P.surface,border:isMobile?"none":`1px solid ${P.border}`,borderRadius:16,padding:isMobile?"40px 20px":"40px"}}>
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:32}}>
          <div style={{width:44,height:44,background:P.red,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:22,fontWeight:900,color:"#fff"}}>T</span>
          </div>
          <div>
            <div style={{fontWeight:800,fontSize:19}}>TradeTrainer</div>
            <div style={{fontSize:12,color:P.textMuted}}>专业交易训练平台</div>
          </div>
        </div>
        <div style={{display:"flex",gap:4,marginBottom:22,background:P.panel,borderRadius:10,padding:4}}>
          {["login","register"].map(m=>(
            <button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:"9px 0",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:14,background:mode===m?P.surface:"transparent",color:mode===m?P.text:P.textMuted}}>
              {m==="login"?"登录":"注册"}
            </button>
          ))}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <input {...I("username","text","用户名")}/>
          {mode==="register"&&<input {...I("email","email","邮箱")}/>}
          <input {...I("password","password","密码")}/>
          {error&&<div style={{fontSize:13,color:error.includes("成功")?P.green:P.red,textAlign:"center"}}>{error}</div>}
          <button onClick={submit} disabled={loading} style={{padding:"14px 0",borderRadius:10,border:"none",cursor:"pointer",background:P.red,color:"#fff",fontWeight:800,fontSize:16,marginTop:4}}>
            {loading?"处理中...":mode==="login"?"登录":"注册"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 导入弹窗 ─────────────────────────────────────────────────────────────────
function ImportModal({onClose}){
  const [sym,setSym]=useState("");const [market,setMarket]=useState("stock");const [iv,setIv]=useState("1d")
  const [file,setFile]=useState(null);const [msg,setMsg]=useState("");const [loading,setLoading]=useState(false)
  const submit=async()=>{
    if(!sym||!file) return setMsg("请填写品种代码并选择文件")
    setLoading(true);setMsg("")
    try{const res=await importAPI.csv(sym,market,iv,file);setMsg(`✅ ${res.data.message||`成功导入 ${res.data.imported} 根K线`}`)}
    catch(e){setMsg("❌ "+(e.response?.data?.detail||"导入失败"))}finally{setLoading(false)}
  }
  const S={width:"100%",background:P.panel,border:`1px solid ${P.border}`,borderRadius:8,padding:"11px 14px",color:P.text,fontSize:14,boxSizing:"border-box"}
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500}}>
      <div style={{background:P.surface,border:`1px solid ${P.borderLight}`,borderRadius:14,padding:28,width:460,maxWidth:"95vw"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <span style={{fontSize:16,fontWeight:700}}>导入K线数据</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:P.textMuted,cursor:"pointer",fontSize:22}}>×</button>
        </div>
        <div style={{fontSize:12,color:P.textMuted,marginBottom:16,padding:"10px 14px",background:P.panel,borderRadius:8,lineHeight:1.9}}>
          <div>必填列: <code style={{color:"#4b9eff"}}>time, open, high, low, close, volume</code></div>
          <div>可选列: <code style={{color:P.textMuted}}>amount, open_interest</code></div>
          <div>time 为 Unix 毫秒时间戳 · 支持 UTF-8 / GBK · 自动跳过无效行</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          <input placeholder="品种代码 (如: 600519 / BTC / IF2409)" value={sym} onChange={e=>setSym(e.target.value)} style={S}/>
          <select value={market} onChange={e=>setMarket(e.target.value)} style={S}><option value="stock">股票</option><option value="futures">期货</option><option value="crypto">数字货币</option></select>
          <select value={iv} onChange={e=>setIv(e.target.value)} style={S}>{["1m","5m","15m","30m","1h","4h","1d","1w"].map(v=><option key={v} value={v}>{v}</option>)}</select>
          <input type="file" accept=".csv" onChange={e=>setFile(e.target.files[0])} style={{...S,padding:"9px 14px"}}/>
          {msg&&<div style={{fontSize:13,color:msg.startsWith("✅")?P.green:P.red,padding:"8px 12px",background:msg.startsWith("✅")?"rgba(0,184,122,0.1)":"rgba(232,64,64,0.1)",borderRadius:6}}>{msg}</div>}
          <button onClick={submit} disabled={loading} style={{padding:"13px 0",borderRadius:9,border:"none",cursor:"pointer",background:P.red,color:"#fff",fontWeight:800,fontSize:14}}>{loading?"导入中...":"开始导入"}</button>
        </div>
      </div>
    </div>
  )
}

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
        // 立即记录这笔开仓
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

    // 先把持仓平掉
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

    // 写入训练记录（session 必须存在才写，否则不计入）
    if(sessionId){
      try{await sessionsAPI.end({session_id:sessionId,data_end_ts:currentCandle?.time,pnl_pct:resObj.pnlPct})}catch{}
    } else if(finalTrades.length>0){
      // 有交易但session还没创建（纯本地模式或首次开仓还未完成）→ 补创建
      try{
        const r=await sessionsAPI.create({symbol:currentSymbol,market:marketType,interval:currentInterval,data_start_ts:allData[trainStartIdx]?.time,start_index:trainStartIdx})
        await sessionsAPI.end({session_id:r.data.session_id,data_end_ts:currentCandle?.time,pnl_pct:resObj.pnlPct})
      }catch{}
    }
    // 没有任何交易 → 不写记录（session 从未创建）
  },[sessionEnded,trades,position,currentCandle,tradeId,sessionId,currentSymbol,marketType,currentInterval,initPrice,trainStartIdx,allData])

  // ── 布局 ──
  const btnBase={border:"none",cursor:"pointer",fontWeight:800,borderRadius:10,fontSize:isMobile?16:17,flex:1}

  // MA值显示
  const maDisplayVals=Object.entries(maSettings).filter(([,on])=>on).map(([k])=>{
    const p=parseInt(k.replace("ma",""))
    const full=calcMA(chartAllData,p)
    return {k,val:full[full.length-1]}
  }).filter(x=>x.val!=null)

  return(
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:P.bg,color:P.text,overflow:"hidden",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}select,input{outline:none;color-scheme:dark}button{font-family:inherit}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${P.border}}`}</style>

      {/* ── 顶部区域 ── */}
      <div style={{background:P.surface,borderBottom:`1px solid ${P.border}`,flexShrink:0}}>
        {/* 行1：导航 */}
        <div style={{display:"flex",alignItems:"center",padding:isMobile?"8px 12px":"8px 16px",gap:10,borderBottom:`1px solid ${P.border}`}}>
          <button onClick={onBack} style={{background:"none",border:"none",color:P.textMuted,fontSize:isMobile?20:22,cursor:"pointer",padding:"0 4px",fontWeight:400,lineHeight:1}}>‹</button>
          <span style={{fontWeight:700,fontSize:isMobile?14:15}}>K线训练</span>
          <span style={{fontSize:12,color:P.textMuted}}>· {currentSymbol} · {MKT_LABEL[marketType]||marketType}</span>
          <div style={{marginLeft:"auto",display:"flex",gap:isMobile?6:8,alignItems:"center"}}>
            {/* close/open 成交模式切换 */}
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

        {/* pending order 提示条 */}
        {pendingOrder&&(
          <div style={{padding:"6px 16px",background:"rgba(240,180,41,0.12)",borderBottom:`1px solid rgba(240,180,41,0.3)`,fontSize:12,color:P.yellow,display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:14}}>⏳</span>
            {pendingOrder.type==="open"
              ? `挂单中：将以下一根K线开盘价 ${pendingOrder.direction==="long"?"开多":"开空"}`
              : "挂单中：将以下一根K线开盘价平仓"}
          </div>
        )}

        {/* 行2：收益率 + OHLC */}
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

        {/* 行3：MA值 */}
        {maDisplayVals.length>0&&(
          <div style={{padding:isMobile?"2px 12px 6px":"2px 16px 6px",display:"flex",gap:isMobile?10:14,fontSize:isMobile?11:12,fontFamily:"monospace",flexWrap:"wrap"}}>
            {maDisplayVals.map(({k,val})=>(
              <span key={k} style={{color:MA_COLORS[k]}}>{k.toUpperCase()}: {fmt(val)}</span>
            ))}
            {showATR&&currentATR>0&&<span style={{color:P.purple}}>ATR: {fmt(currentATR)}</span>}
          </div>
        )}
      </div>

      {/* ── 图表区（flex:1，按比例分配给价格图和vol图）── */}
      <div style={{flex:1,overflow:"hidden",position:"relative",minHeight:0}}>
        {loading&&(
          <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,background:P.bg}}>
            <div style={{fontSize:36,animation:"spin 1s linear infinite"}}>⟳</div>
            <div style={{fontSize:13,color:P.textMuted}}>正在加载真实K线数据...</div>
            <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
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

        {/* 设置浮层 */}
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

      {/* ── 底部操作区 ── */}
      <div style={{background:P.surface,borderTop:`1px solid ${P.border}`,flexShrink:0,padding:isMobile?"10px 10px 16px":"10px 14px 12px"}}>
        {/* 持仓信息 */}
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

        {/* 按钮行 */}
        <div style={{display:"flex",gap:isMobile?8:10,height:isMobile?54:58}}>
          {/* 买入/开多 */}
          {!position&&(
            <button onClick={()=>openTrade("long",1)} disabled={!!pendingOrder}
              style={{...btnBase,background:pendingOrder?"#5a2020":P.up,color:"#fff",cursor:pendingOrder?"not-allowed":"pointer"}}>
              {isStock?"买入":"开多"}
            </button>
          )}
          {/* 开空（期货/加密） */}
          {!position&&!isStock&&(
            <button onClick={()=>openTrade("short",1)} disabled={!!pendingOrder}
              style={{...btnBase,background:pendingOrder?"#1a4a3a":P.down,color:"#fff",cursor:pendingOrder?"not-allowed":"pointer"}}>
              开空
            </button>
          )}
          {/* 卖出/平仓 */}
          {position&&(
            <button onClick={()=>closeTrade()} disabled={!!pendingOrder}
              style={{...btnBase,flex:2,background:position.direction==="long"?P.down:P.up,color:"#fff",opacity:pendingOrder?0.5:1,cursor:pendingOrder?"not-allowed":"pointer"}}>
              {isStock?"卖出":"平仓"}
            </button>
          )}
          {/* 走图 */}
          <button onClick={nextBar} disabled={atEnd||sessionEnded}
            style={{...btnBase,background:atEnd||sessionEnded?"#262830":"#2a2d3a",color:atEnd||sessionEnded?P.textMuted:P.text,border:`1px solid ${P.border}`}}>
            走图
          </button>
          {/* 结算 */}
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

// ─── 首页 ─────────────────────────────────────────────────────────────────────
function HomePage({onSelect,onShowStats,onShowHistory,onShowImport,user,onLogout}){
  const isMobile=useIsMobile()
  return(
    <div style={{minHeight:"100vh",background:P.bg,color:P.text,display:"flex",flexDirection:"column",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}select,input{outline:none;color-scheme:dark}button{font-family:inherit}`}</style>
      <div style={{display:"flex",alignItems:"center",padding:isMobile?"12px 16px":"14px 24px",background:P.surface,borderBottom:`1px solid ${P.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:36,height:36,background:P.red,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:18,fontWeight:900,color:"#fff"}}>T</span>
          </div>
          <div>
            <span style={{fontWeight:800,fontSize:16}}>TradeTrainer</span>
            <span style={{fontSize:13,color:P.textMuted,marginLeft:8}}>贸易培训师</span>
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <button onClick={onShowImport} style={{padding:"6px 14px",borderRadius:7,border:`1px solid ${P.border}`,background:"transparent",color:P.textMuted,fontSize:12,cursor:"pointer"}}>导入数据</button>
          <button onClick={onLogout} style={{padding:"6px 14px",borderRadius:7,border:`1px solid ${P.border}`,background:"transparent",color:P.textMuted,fontSize:12,cursor:"pointer"}}>{user} · 退出</button>
        </div>
      </div>

      <div style={{flex:1,display:"flex",flexDirection:"column",maxWidth:600,margin:"0 auto",width:"100%",padding:isMobile?"24px 16px":"40px 20px"}}>
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
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:P.bg,color:P.text,fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}`}</style>
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

  // 按市场统计（来自backend的by_market字段）
  const byMkt=data?.by_market||{}
  const mktOrder=["stock","futures","crypto"]
  const mktNames={stock:"股票",futures:"期货",crypto:"加密货币"}

  return(
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:P.bg,color:P.text,fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:P.surface,borderBottom:`1px solid ${P.border}`,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:P.textMuted,cursor:"pointer",fontSize:22,lineHeight:1}}>‹</button>
        <span style={{fontSize:16,fontWeight:700}}>数据统计</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:isMobile?"12px":"16px 20px"}}>
        {loading&&<div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>加载中...</div>}
        {!loading&&!data&&<div style={{color:P.textMuted,textAlign:"center",paddingTop:40}}>暂无统计数据</div>}
        {data&&(
          <>
            {/* 总览：训练次数 + 累计收益率 */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10,marginBottom:10}}>
              <Card label="训练次数" value={data.total_sessions} big/>
              <Card label="K线训练累计收益率" value={data.total_pnl_pct!=null?fmtPct(data.total_pnl_pct):"—"} color={(data.total_pnl_pct||0)>=0?P.up:P.down} big/>
            </div>
            {/* 综合指标 */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:isMobile?16:20}}>
              <Card label="综合胜率"    value={data.win_rate?(data.win_rate*100).toFixed(1)+"%":"—"} color={(data.win_rate||0)>=0.5?P.up:P.down}/>
              <Card label="平均盈亏比"  value={data.avg_rr?fmt(data.avg_rr):"—"}/>
              <Card label="总交易次数"  value={data.total_trades||0}/>
            </div>

            {/* ─ 按市场分类统计 ─ */}
            {mktOrder.map(mktId=>{
              const d=byMkt[mktId]
              if(!d) return null
              const mktColor=MARKETS.find(m=>m.id===mktId)?.color||P.textMuted
              const sessWinRate=d.sessions>0?d.wins/d.sessions:null
              const avgPct=d.sessions>0?d.total_pnl_pct/d.sessions:null
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

// ─── 应用路由 ─────────────────────────────────────────────────────────────────
export default function App(){
  const [user,setUser]=useState(()=>localStorage.getItem("tt_username"))
  const [page,setPage]=useState("home")
  const [trainMkt,setTrainMkt]=useState(null)
  const [symbols,setSymbols]=useState([])
  const [showImport,setShowImport]=useState(false)

  useEffect(()=>{
    if(!user) return
    klinesAPI.symbols().then(r=>{if(r.data?.length>0) setSymbols(r.data.map(s=>({id:s.symbol,name:s.symbol,market:s.market,interval:s.interval})))}).catch(()=>{})
  },[user])

  const handleLogout=()=>{localStorage.removeItem("tt_token");localStorage.removeItem("tt_username");setUser(null)}

  if(!user) return <LoginPage onLogin={u=>setUser(u)}/>
  if(page==="train"&&trainMkt) return <TrainView marketType={trainMkt} onBack={()=>setPage("home")} symbols={symbols}/>
  if(page==="history") return <HistoryPage onBack={()=>setPage("home")}/>
  if(page==="stats")   return <StatsPage   onBack={()=>setPage("home")}/>

  return(
    <>
      <HomePage user={user} onLogout={handleLogout}
        onSelect={mkt=>{setTrainMkt(mkt);setPage("train")}}
        onShowStats={()=>setPage("stats")}
        onShowHistory={()=>setPage("history")}
        onShowImport={()=>setShowImport(true)}/>
      {showImport&&<ImportModal onClose={()=>setShowImport(false)}/>}
    </>
  )
}
