import { useState } from "react"
import { P } from "./theme"
import { useIsMobile } from "./utils"
import { authAPI } from "./api"

export default function LoginPage({onLogin}){
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
