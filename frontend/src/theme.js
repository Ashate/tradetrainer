// ─── 全局配色与常量 ─────────────────────────────────────────────────────────────
export const P = {
  bg:"#181a20",surface:"#1e2028",panel:"#23252f",
  border:"#2e3140",borderLight:"#3a3f52",
  red:"#e84040",green:"#00b87a",yellow:"#f0b429",purple:"#a78bfa",blue:"#4b9eff",
  text:"#e8eaf0",textMuted:"#7b8099",textDim:"#3d4260",
  up:"#e84040",down:"#00b87a",
  volUp:"rgba(232,64,64,0.82)",volDown:"rgba(0,184,122,0.82)",
}

export const MA_COLORS    = {ma5:"#ffdd00",ma10:"#ff9900",ma20:"#dd44ff",ma60:"#4499ff",ma120:"#ff4466"}
export const VOL_MA_COLORS= {volma5:"#ffdd00",volma10:"#ff9900",volma20:"#4499ff"}

export const MARKETS=[
  {id:"stock",  label:"股票训练", icon:"📈",color:"#e84040",desc:"A股·沪深"},
  {id:"futures",label:"期货训练", icon:"⚡",color:"#f0b429",desc:"国内期货"},
  {id:"crypto", label:"加密货币", icon:"₿", color:"#4b9eff",desc:"数字货币"},
]
export const MKT_LABEL={stock:"股票",futures:"期货",crypto:"数字货币"}

export const GLOBAL_STYLE = `*{box-sizing:border-box;margin:0;padding:0}select,input{outline:none;color-scheme:dark}button{font-family:inherit}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${P.border}}@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`
