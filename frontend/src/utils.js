import { useState, useEffect } from "react"

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
export const fmt    = (n,d=2)=>n==null?"—":Number(n).toFixed(d)
export const fmtPct = (n)=>n==null?"—":(n>=0?"+":"")+Number(n).toFixed(2)+"%"
export const fmtK   = (n)=>!n?"0":n>=1e8?(n/1e8).toFixed(1)+"亿":n>=1e4?(n/1e4).toFixed(1)+"万":n.toFixed(0)
export const fmtMMDD= (ts)=>{const d=new Date(ts);return `${d.getFullYear()%100}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`}
export const fmtDate= (ts)=>ts?String(ts).slice(0,10):"—"
export const fmtTimeFull = (ts)=>{
  const d=new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`
}
export const fmtDur = (ms)=>{
  const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60)
  return h>0?`${h}h${m%60}m`:`${m}m${s%60}s`
}

// ─── 响应式 ───────────────────────────────────────────────────────────────────
// 注意：isMobile 不能只用 innerWidth<768 判断——手机横屏后 innerWidth 会超过768，
// 会导致"是否移动设备"和"是否横屏"两个独立维度被错误耦合（横屏时误判为PC）。
// 改为检测触控能力 + 屏幕较短边尺寸，与当前方向无关。
function _detectMobile(){
  const hasTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0
  const shortEdge = Math.min(window.innerWidth, window.innerHeight)
  return hasTouch && shortEdge < 900
}
export function useIsMobile(){
  const [m,setM]=useState(_detectMobile)
  useEffect(()=>{
    const h=()=>setM(_detectMobile())
    window.addEventListener("resize",h)
    window.addEventListener("orientationchange",h)
    return()=>{window.removeEventListener("resize",h);window.removeEventListener("orientationchange",h)}
  },[])
  return m
}

// 注：横屏沉浸模式不依赖物理设备方向(陀螺仪/orientationchange)，
// 而是由用户点击全屏图标按钮手动触发，通过CSS旋转容器实现(见 MarketModule.jsx / SimulateModule.jsx)。
// 这是看盘类App的标准做法(币安/同花顺等)，避免依赖不稳定的Screen Orientation API权限和锁定行为。

// ─── 本地K线生成（fallback，后端无数据时使用）──────────────────────────────────
function seededRNG(seed){let s=seed;return()=>{s=(s*1664525+1013904223)&0xffffffff;return(s>>>0)/0xffffffff}}
export function generateLocalKlines(symbol,count=400){
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

// ─── 指标计算 ─────────────────────────────────────────────────────────────────
export function calcMA(data,period){
  const r=new Array(data.length).fill(null);let sum=0
  for(let i=0;i<data.length;i++){sum+=data[i].close;if(i>=period)sum-=data[i-period].close;if(i>=period-1)r[i]=sum/period}
  return r
}
export function calcATR(data,period=14){
  const tr=data.map((d,i)=>i===0?d.high-d.low:Math.max(d.high-d.low,Math.abs(d.high-data[i-1].close),Math.abs(d.low-data[i-1].close)))
  const r=new Array(data.length).fill(null);let sum=0
  for(let i=0;i<data.length;i++){sum+=tr[i];if(i>=period)sum-=tr[i-period];if(i>=period-1)r[i]=sum/period}
  return r
}
export function calcVolMA(data,period){
  const r=new Array(data.length).fill(null);let sum=0
  for(let i=0;i<data.length;i++){sum+=data[i].volume;if(i>=period)sum-=data[i-period].volume;if(i>=period-1)r[i]=sum/period}
  return r
}
export function calcEMA(data,period){
  const r=new Array(data.length).fill(null)
  const k=2/(period+1)
  let prevEma=null
  for(let i=0;i<data.length;i++){
    if(i<period-1){continue}
    if(prevEma==null){
      // 用前period根SMA作为EMA初始值
      let sum=0
      for(let j=i-period+1;j<=i;j++) sum+=data[j].close
      prevEma=sum/period
    } else {
      prevEma=data[i].close*k+prevEma*(1-k)
    }
    r[i]=prevEma
  }
  return r
}
export function calcMACD(data,fast=12,slow=26,signal=9){
  const emaFast=calcEMA(data,fast)
  const emaSlow=calcEMA(data,slow)
  const macdLine=data.map((_,i)=>(emaFast[i]!=null&&emaSlow[i]!=null)?emaFast[i]-emaSlow[i]:null)
  // signal线是macdLine的EMA，需要用伪数据结构复用calcEMA
  const macdAsData=macdLine.map(v=>({close:v??0}))
  const validStart=macdLine.findIndex(v=>v!=null)
  const signalLine=new Array(data.length).fill(null)
  if(validStart>=0){
    let prevEma=null
    const k=2/(signal+1)
    for(let i=validStart;i<data.length;i++){
      if(i<validStart+signal-1){continue}
      if(prevEma==null){
        let sum=0
        for(let j=i-signal+1;j<=i;j++) sum+=macdLine[j]
        prevEma=sum/signal
      } else {
        prevEma=macdLine[i]*k+prevEma*(1-k)
      }
      signalLine[i]=prevEma
    }
  }
  const hist=data.map((_,i)=>(macdLine[i]!=null&&signalLine[i]!=null)?macdLine[i]-signalLine[i]:null)
  return {macdLine,signalLine,hist}
}
export function calcRSI(data,period=14){
  const r=new Array(data.length).fill(null)
  let gainSum=0,lossSum=0
  for(let i=1;i<data.length;i++){
    const chg=data[i].close-data[i-1].close
    const gain=chg>0?chg:0, loss=chg<0?-chg:0
    if(i<=period){
      gainSum+=gain;lossSum+=loss
      if(i===period){
        const avgG=gainSum/period, avgL=lossSum/period
        r[i]=avgL===0?100:100-100/(1+avgG/avgL)
      }
    } else {
      gainSum=(gainSum*(period-1)+gain)/period
      lossSum=(lossSum*(period-1)+loss)/period
      r[i]=lossSum===0?100:100-100/(1+gainSum/lossSum)
    }
  }
  return r
}
export function calcBOLL(data,period=20,mult=2){
  const mid=calcMA(data,period)
  const upper=new Array(data.length).fill(null)
  const lower=new Array(data.length).fill(null)
  for(let i=period-1;i<data.length;i++){
    let sumSq=0
    for(let j=i-period+1;j<=i;j++) sumSq+=Math.pow(data[j].close-mid[i],2)
    const std=Math.sqrt(sumSq/period)
    upper[i]=mid[i]+mult*std
    lower[i]=mid[i]-mult*std
  }
  return {mid,upper,lower}
}
