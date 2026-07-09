import { useState } from "react"
import { P, MA_COLORS, VOL_MA_COLORS } from "./theme"
import { useIsMobile } from "./utils"
import ImportModal from "./ImportModal"
import { useIndicatorSettings } from "./indicatorSettings"

// ─── 小组件：分组标题 ──────────────────────────────────────────────────────────
function SectionTitle({children}){
  return <div style={{fontSize:11,color:P.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",margin:"22px 0 10px",fontWeight:700}}>{children}</div>
}

// ─── 小组件：带颜色选择的指标开关行 ──────────────────────────────────────────────
function IndicatorRow({label, enabled, onToggleEnabled, color, onColorChange, extra}){
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:P.surface,borderRadius:8,marginBottom:8,border:`1px solid ${P.border}`}}>
      <input type="checkbox" checked={enabled} onChange={e=>onToggleEnabled(e.target.checked)} style={{accentColor:color||P.red,width:16,height:16,flexShrink:0}}/>
      <span style={{fontSize:13,fontWeight:600,flex:1}}>{label}</span>
      {extra}
      {onColorChange&&(
        <input type="color" value={color} onChange={e=>onColorChange(e.target.value)}
          style={{width:28,height:28,border:"none",borderRadius:6,background:"none",cursor:"pointer",padding:0}}/>
      )}
    </div>
  )
}

// ─── 小组件：周期数字输入 ───────────────────────────────────────────────────────
function PeriodInput({value,onChange,width=52}){
  return (
    <input type="number" value={value} min={1} max={500}
      onChange={e=>onChange(Math.max(1,parseInt(e.target.value)||1))}
      style={{width,background:P.panel,border:`1px solid ${P.border}`,borderRadius:6,padding:"5px 6px",color:P.text,fontSize:12,textAlign:"center"}}/>
  )
}

// ─── 账户信息 ─────────────────────────────────────────────────────────────────
function AccountSection({user,onLogout}){
  return (
    <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:12,padding:"16px 18px",display:"flex",alignItems:"center",gap:14}}>
      <div style={{width:44,height:44,background:P.red,borderRadius:22,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <span style={{fontSize:18,fontWeight:900,color:"#fff"}}>{(user||"?")[0]?.toUpperCase()}</span>
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:700,fontSize:15}}>{user}</div>
        <div style={{fontSize:12,color:P.textMuted}}>TradeTrainer 账户</div>
      </div>
      <button onClick={onLogout} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${P.red}`,background:"rgba(232,64,64,0.08)",color:P.red,fontSize:13,fontWeight:600,cursor:"pointer",flexShrink:0}}>
        退出登录
      </button>
    </div>
  )
}

// ─── 设置模块根组件 ───────────────────────────────────────────────────────────
export default function SettingsModule({user,onLogout}){
  const isMobile=useIsMobile()
  const [showImport,setShowImport] = useState(false)
  const { settings, update, resetAll } = useIndicatorSettings()

  return (
    <div style={{height:"100%",overflowY:"auto",background:P.bg,color:P.text}}>
      <div style={{maxWidth:640,margin:"0 auto",padding:isMobile?"16px 14px 40px":"24px 24px 48px"}}>
        <div style={{fontSize:isMobile?20:24,fontWeight:900,marginBottom:18}}>设置</div>

        {/* ── 账户 ── */}
        <AccountSection user={user} onLogout={onLogout}/>

        {/* ── 数据管理 ── */}
        <SectionTitle>数据管理</SectionTitle>
        <button onClick={()=>setShowImport(true)}
          style={{width:"100%",padding:"14px 16px",borderRadius:10,border:`1px solid ${P.border}`,background:P.surface,color:P.text,fontSize:14,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:18}}>📥</span>
          <span style={{flex:1,textAlign:"left"}}>导入K线数据（CSV）</span>
          <span style={{color:P.textMuted,fontSize:18}}>›</span>
        </button>
        <div style={{fontSize:11,color:P.textMuted,marginTop:6,lineHeight:1.6,padding:"0 4px"}}>
          期货/加密货币自动从交易所更新行情（5m/15m/30m/1h/1d），股票每日自动更新（1d）。
          手动上传 1m/5m 数据会自动聚合生成其余周期（股票除外）。<br/>
          重新上传同一标的会按时间戳<b style={{color:P.text}}>合并更新</b>——已有数据自动跳过/更新，缺失部分自动补全，不会丢失原有数据。
          手动上传的标的会标注"手动"，不参与系统的定时自动更新。
        </div>

        {/* ── 蜡烛颜色 ── */}
        <SectionTitle>K线颜色</SectionTitle>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1,background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:13,flex:1}}>阳线（涨）</span>
            <input type="color" value={settings.candle.upColor} onChange={e=>update("candle.upColor",e.target.value)}
              style={{width:28,height:28,border:"none",borderRadius:6,background:"none",cursor:"pointer"}}/>
          </div>
          <div style={{flex:1,background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:13,flex:1}}>阴线（跌）</span>
            <input type="color" value={settings.candle.downColor} onChange={e=>update("candle.downColor",e.target.value)}
              style={{width:28,height:28,border:"none",borderRadius:6,background:"none",cursor:"pointer"}}/>
          </div>
        </div>

        {/* ── 均线 MA ── */}
        <SectionTitle>移动均线 MA</SectionTitle>
        <IndicatorRow label="启用均线" enabled={settings.ma.enabled} onToggleEnabled={v=>update("ma.enabled",v)}/>
        {settings.ma.enabled&&Object.keys(settings.ma.periods).map(k=>(
          <IndicatorRow key={k}
            label={k.toUpperCase()}
            enabled={settings.ma.periods[k]}
            onToggleEnabled={v=>update(`ma.periods.${k}`,v)}
            color={settings.ma.colors[k]}
            onColorChange={c=>update(`ma.colors.${k}`,c)}/>
        ))}

        {/* ── 成交量均线 ── */}
        <SectionTitle>成交量均线</SectionTitle>
        <IndicatorRow label="启用成交量均线" enabled={settings.volMa.enabled} onToggleEnabled={v=>update("volMa.enabled",v)}/>
        {settings.volMa.enabled&&Object.keys(settings.volMa.periods).map(k=>(
          <IndicatorRow key={k}
            label={k.toUpperCase()}
            enabled={settings.volMa.periods[k]}
            onToggleEnabled={v=>update(`volMa.periods.${k}`,v)}
            color={settings.volMa.colors[k]}
            onColorChange={c=>update(`volMa.colors.${k}`,c)}/>
        ))}

        {/* ── ATR ── */}
        <SectionTitle>ATR 平均真实波幅</SectionTitle>
        <IndicatorRow label="启用 ATR" enabled={settings.atr.enabled} onToggleEnabled={v=>update("atr.enabled",v)}
          color={settings.atr.color} onColorChange={c=>update("atr.color",c)}
          extra={<span style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:P.textMuted}}>周期<PeriodInput value={settings.atr.period} onChange={v=>update("atr.period",v)}/></span>}/>

        {/* ── MACD ── */}
        <SectionTitle>MACD</SectionTitle>
        <IndicatorRow label="启用 MACD" enabled={settings.macd.enabled} onToggleEnabled={v=>update("macd.enabled",v)}/>
        {settings.macd.enabled&&(
          <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8,display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"flex",gap:14,fontSize:12,color:P.textMuted,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{display:"flex",alignItems:"center",gap:6}}>快线<PeriodInput value={settings.macd.fast} onChange={v=>update("macd.fast",v)}/></span>
              <span style={{display:"flex",alignItems:"center",gap:6}}>慢线<PeriodInput value={settings.macd.slow} onChange={v=>update("macd.slow",v)}/></span>
              <span style={{display:"flex",alignItems:"center",gap:6}}>信号<PeriodInput value={settings.macd.signal} onChange={v=>update("macd.signal",v)}/></span>
            </div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              {[["MACD线","macd"],["信号线","signal"],["柱(涨)","histUp"],["柱(跌)","histDown"]].map(([label,key])=>(
                <span key={key} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:P.textMuted}}>
                  {label}
                  <input type="color" value={settings.macd.colors[key]} onChange={e=>update(`macd.colors.${key}`,e.target.value)}
                    style={{width:22,height:22,border:"none",borderRadius:5,background:"none",cursor:"pointer"}}/>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── RSI ── */}
        <SectionTitle>RSI 相对强弱指标</SectionTitle>
        <IndicatorRow label="启用 RSI" enabled={settings.rsi.enabled} onToggleEnabled={v=>update("rsi.enabled",v)}
          color={settings.rsi.color} onColorChange={c=>update("rsi.color",c)}
          extra={<span style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:P.textMuted}}>周期<PeriodInput value={settings.rsi.period} onChange={v=>update("rsi.period",v)}/></span>}/>

        {/* ── 布林带 BOLL ── */}
        <SectionTitle>布林带 BOLL</SectionTitle>
        <IndicatorRow label="启用布林带" enabled={settings.boll.enabled} onToggleEnabled={v=>update("boll.enabled",v)}
          extra={<span style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:P.textMuted}}>周期<PeriodInput value={settings.boll.period} onChange={v=>update("boll.period",v)}/></span>}/>
        {settings.boll.enabled&&(
          <div style={{background:P.surface,border:`1px solid ${P.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8,display:"flex",gap:16,flexWrap:"wrap"}}>
            {[["中轨","mid"],["上轨","upper"],["下轨","lower"]].map(([label,key])=>(
              <span key={key} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:P.textMuted}}>
                {label}
                <input type="color" value={settings.boll.colors[key]} onChange={e=>update(`boll.colors.${key}`,e.target.value)}
                  style={{width:22,height:22,border:"none",borderRadius:5,background:"none",cursor:"pointer"}}/>
              </span>
            ))}
          </div>
        )}

        {/* ── 恢复默认 ── */}
        <SectionTitle>其他</SectionTitle>
        <button onClick={resetAll}
          style={{width:"100%",padding:"13px 0",borderRadius:10,border:`1px solid ${P.border}`,background:"transparent",color:P.textMuted,fontSize:13,fontWeight:600,cursor:"pointer"}}>
          恢复全部指标默认设置
        </button>

        <div style={{fontSize:11,color:P.textDim,textAlign:"center",marginTop:24}}>TradeTrainer · 专业交易训练平台</div>
      </div>

      {showImport&&<ImportModal onClose={()=>setShowImport(false)}/>}
    </div>
  )
}
