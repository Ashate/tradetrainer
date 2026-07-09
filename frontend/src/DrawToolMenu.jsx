import { useState } from "react"
import { P } from "./theme"

// ─── DrawToolMenu ─────────────────────────────────────────────────────────────
// 画线工具收纳菜单：单个图标按钮，点击展开工具选项（水平线/射线/管理画线列表）。
// 共享组件：行情模块和模拟模块都用这个，保持画线交互体验一致。
export default function DrawToolMenu({drawTool, setDrawTool, drawingCount, showDrawingList, setShowDrawingList}){
  const [expanded, setExpanded] = useState(false)
  const active = drawTool != null

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
      {expanded && (
        <div style={{display:"flex",flexDirection:"column",gap:6,background:P.panel,border:`1px solid ${P.borderLight}`,borderRadius:12,padding:6,boxShadow:"0 8px 24px rgba(0,0,0,0.5)"}}>
          {[["horizontal","─","水平线"],["ray","↗","射线"]].map(([tool,icon,label])=>(
            <button key={tool} onClick={()=>{ setDrawTool(prev=>prev===tool?null:tool); setExpanded(false) }}
              title={label}
              style={{width:34,height:34,borderRadius:8,border:`1px solid ${drawTool===tool?P.red:"transparent"}`,
                background:drawTool===tool?"rgba(232,64,64,0.18)":"rgba(255,255,255,0.06)",
                color:drawTool===tool?P.red:P.text,fontSize:15,fontWeight:700,cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center"}}>
              {icon}
            </button>
          ))}
          <div style={{height:1,background:P.border,margin:"2px 0"}}/>
          <button onClick={()=>{ setShowDrawingList(v=>!v); setExpanded(false) }}
            title="管理画线"
            style={{width:34,height:34,borderRadius:8,border:"none",background:showDrawingList?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.06)",color:P.textMuted,fontSize:11,fontWeight:700,cursor:"pointer"}}>
            {drawingCount}
          </button>
        </div>
      )}
      <button onClick={()=>setExpanded(v=>!v)}
        style={{width:36,height:36,borderRadius:18,border:`1px solid ${active?P.red:P.borderLight}`,
          background:active?"rgba(232,64,64,0.18)":P.panel,color:active?P.red:P.textMuted,
          fontSize:16,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,0.4)",
          display:"flex",alignItems:"center",justifyContent:"center"}}>
        ✏︎
      </button>
    </div>
  )
}
