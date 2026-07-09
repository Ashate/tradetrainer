import { useState, useEffect } from "react"
import { P, GLOBAL_STYLE } from "./theme"
import LoginPage from "./LoginPage"
import BottomNav from "./BottomNav"
import MarketModule from "./MarketModule"
import TrainModule from "./TrainModule"
import SimulateModule from "./SimulateModule"
import SettingsModule from "./SettingsModule"
import { klinesAPI } from "./api"

// ─── 顶层应用：登录态 + 4模块底部导航路由 ──────────────────────────────────────
// 注：行情/模拟模块的全屏横屏模式由按钮触发，使用 fixed+rotate 的浮层(见 RotatedFullscreen.jsx)
// 自身的高 z-index 盖住底部导航，App层面不需要再额外处理隐藏逻辑。
export default function App(){
  const [user,setUser] = useState(()=>localStorage.getItem("tt_username"))
  const [tab,setTab]   = useState("train")   // market | train | simulate | settings
  const [symbols,setSymbols] = useState([])

  useEffect(()=>{
    if(!user) return
    klinesAPI.symbols().then(r=>{
      if(r.data?.length>0) setSymbols(r.data.map(s=>({id:s.symbol,name:s.symbol,market:s.market,interval:s.interval})))
    }).catch(()=>{})
  },[user])

  const handleLogout=()=>{
    localStorage.removeItem("tt_token")
    localStorage.removeItem("tt_username")
    setUser(null)
  }

  if(!user) return <LoginPage onLogin={u=>setUser(u)}/>

  return (
    <div style={{height:"100vh",maxHeight:"100dvh",display:"flex",flexDirection:"column",background:P.bg,color:P.text,overflow:"hidden",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <style>{GLOBAL_STYLE}</style>

      <div style={{flex:1,overflow:"hidden",minHeight:0}}>
        {tab==="market"   && <MarketModule/>}
        {tab==="train"    && <TrainModule symbols={symbols}/>}
        {tab==="simulate" && <SimulateModule/>}
        {tab==="settings" && <SettingsModule user={user} onLogout={handleLogout}/>}
      </div>

      <BottomNav active={tab} onChange={setTab}/>
    </div>
  )
}
