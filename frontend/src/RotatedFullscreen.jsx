import { useEffect } from "react"
import { P } from "./theme"

// ─── RotatedFullscreen ────────────────────────────────────────────────────────
// 看盘类App标准的"横屏沉浸模式"实现：不依赖手机物理转向/陀螺仪，而是用户点击
// 全屏图标按钮后，把图表容器用CSS旋转90度并撑满视口（宽高互换），与币安/同花顺
// 等App点击右上角全屏图标的行为完全一致。再次点击退出按钮即可旋转回竖屏布局。
//
// 实现方式：fixed定位铺满整个屏幕，rotate(90deg)后宽高对调，
// 因此容器实际渲染宽度=屏幕高度，渲染高度=屏幕宽度，子元素（图表）会感知到"横屏"的宽高比。
export default function RotatedFullscreen({active, children}){
  useEffect(()=>{
    if(active){
      const prevOverflow = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return ()=>{ document.body.style.overflow = prevOverflow }
    }
  },[active])

  if(!active) return children

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:1000,
      background:P.bg,
      display:"flex", alignItems:"center", justifyContent:"center",
      overflow:"hidden",
    }}>
      <div style={{
        position:"absolute",
        width:"100vh", height:"100vw",
        transform:"rotate(90deg)",
        transformOrigin:"center center",
      }}>
        {children}
      </div>
    </div>
  )
}
