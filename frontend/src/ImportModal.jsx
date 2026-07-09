import { useState } from "react"
import { P } from "./theme"
import { importAPI } from "./api"

export default function ImportModal({onClose}){
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
          <div style={{marginTop:6,color:"#f0b429"}}>上传 1m/5m 周期数据会自动聚合生成 15m/30m/1h/1d（股票除外）</div>
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
