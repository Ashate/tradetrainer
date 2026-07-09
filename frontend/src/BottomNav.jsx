import { P } from "./theme"

const TABS = [
  { id:"market",   label:"行情", icon:"📊" },
  { id:"train",    label:"训练", icon:"🎯" },
  { id:"simulate",  label:"模拟", icon:"💰" },
  { id:"settings",  label:"设置", icon:"⚙️" },
]

export default function BottomNav({active,onChange}){
  return (
    <div style={{
      height:56, flexShrink:0, display:"flex",
      background:P.surface, borderTop:`1px solid ${P.border}`,
    }}>
      {TABS.map(tab=>{
        const isActive = active===tab.id
        return (
          <button key={tab.id} onClick={()=>onChange(tab.id)}
            style={{
              flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              gap:2, border:"none", background:"none", cursor:"pointer",
              color:isActive?P.red:P.textMuted,
            }}>
            <span style={{fontSize:19,lineHeight:1,filter:isActive?"none":"grayscale(0.4) opacity(0.7)"}}>{tab.icon}</span>
            <span style={{fontSize:11,fontWeight:isActive?700:500}}>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
