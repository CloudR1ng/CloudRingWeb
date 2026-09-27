import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Bell, BellOff, Check, Clock3, Smartphone } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { defaultNotificationSettings, type NotificationSettingsValue } from './core'
import './notifications.css'

type Device = { id:string; endpoint:string; device_name:string; active:boolean }
const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?:boolean}).standalone === true
const supportsPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
function decodeVapidKey(value:string):ArrayBuffer {
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/')
  const raw=window.atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'='))
  const bytes=Uint8Array.from(raw,character=>character.charCodeAt(0))
  const buffer=new ArrayBuffer(bytes.length);new Uint8Array(buffer).set(bytes);return buffer
}

export default function NotificationSettings({session}:{session:Session|null}) {
  const [settings,setSettings]=useState<NotificationSettingsValue>(defaultNotificationSettings)
  const [devices,setDevices]=useState<Device[]>([])
  const [settingsVersion,setSettingsVersion]=useState(0)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [settingsConflict,setSettingsConflict]=useState<{version:number;latest:NotificationSettingsValue}|null>(null)
  const [permission,setPermission]=useState<NotificationPermission| 'unsupported'>(()=>supportsPush()?Notification.permission:'unsupported')
  const [installed,setInstalled]=useState(isStandalone)
  const generation=useRef(0)
  const busy=useRef(false)

  const reload=useCallback(async(isCurrent:()=>boolean=()=>true)=>{
    if(!supabase||!session){setLoading(false);return}
    const [{data:userData,error:userError},{data:aalData,error:aalError}]=await Promise.all([supabase.auth.getUser(),supabase.auth.mfa.getAuthenticatorAssuranceLevel()])
    if(!isCurrent())return
    if(userError||!userData.user||userData.user.id!==session.user.id)throw new Error('로그인 세션이 변경되었거나 만료되었습니다.')
    if(aalError||aalData.currentLevel!=='aal2')throw new Error('TOTP 2단계 인증 후 다시 접근할 수 있습니다.')
    const [{data:stored,error:settingsError},{data:list,error:listError}]=await Promise.all([
      supabase.from('notification_settings').select('enabled,daily_digest_enabled,daily_digest_time,event_lead_minutes,date_due_time,include_details,version').eq('owner_id',session.user.id).maybeSingle(),
      supabase.from('push_devices').select('id,endpoint,device_name,active').eq('owner_id',session.user.id).eq('active',true).order('created_at',{ascending:false}),
    ])
    if(!isCurrent())return
    if(settingsError)throw settingsError
    if(listError)throw listError
    if(stored){setSettings({enabled:stored.enabled,daily_digest_enabled:stored.daily_digest_enabled,daily_digest_time:String(stored.daily_digest_time).slice(0,5),event_lead_minutes:stored.event_lead_minutes,date_due_time:String(stored.date_due_time).slice(0,5),include_details:stored.include_details});setSettingsVersion(stored.version)}else{setSettings(defaultNotificationSettings);setSettingsVersion(0)}
    setDevices((list??[]) as Device[])
    if(supportsPush())setPermission(Notification.permission)
  },[session])

  useEffect(()=>{
    const current=++generation.current
    const isCurrent=()=>generation.current===current
    setLoading(true);setSaving(false);setError('');setMessage('')
    void reload(isCurrent).catch(reason=>{if(isCurrent())setError(reason instanceof Error?reason.message:'알림 설정을 읽지 못했습니다.')}).finally(()=>{if(isCurrent())setLoading(false)})
    const updateInstalled=()=>setInstalled(isStandalone())
    window.addEventListener('appinstalled',updateInstalled)
    return()=>{generation.current+=1;window.removeEventListener('appinstalled',updateInstalled)}
  },[reload])

  const saveSettings=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!supabase||!session)return
    if(busy.current)return;busy.current=true;const current=generation.current
    setSaving(true);setMessage('');setError('')
    try{
      const {data,error:saveError}=await supabase.rpc('save_notification_settings',{p_expected_version:settingsVersion,p_values:settings})
      if(saveError){
        if((saveError as {code?:string}).code==='40001'){
          const {data:latest,error:readError}=await supabase.from('notification_settings').select('enabled,daily_digest_enabled,daily_digest_time,event_lead_minutes,date_due_time,include_details,version').eq('owner_id',session.user.id).maybeSingle()
          if(readError)throw readError
          if(generation.current!==current)return
          const remote=latest?{enabled:latest.enabled,daily_digest_enabled:latest.daily_digest_enabled,daily_digest_time:String(latest.daily_digest_time).slice(0,5),event_lead_minutes:latest.event_lead_minutes,date_due_time:String(latest.date_due_time).slice(0,5),include_details:latest.include_details}:defaultNotificationSettings
          setSettingsConflict({version:latest?.version??0,latest:remote})
          setError('다른 저장본이 먼저 변경되었습니다. 최신 저장본을 확인하고 현재 입력을 다시 적용할 수 있습니다.')
          return
        }
        throw saveError
      }
      if(generation.current!==current)return
      if(!data)throw new Error('저장 버전을 확인하지 못했습니다.')
      setSettingsConflict(null)
      setSettingsVersion(data.version)
      setMessage('알림 설정을 저장했습니다.')
    }catch(reason){if(generation.current===current)setError(reason instanceof Error?reason.message:'알림 설정을 저장하지 못했습니다.')}
    finally{if(generation.current===current)setSaving(false);busy.current=false}
  }

  const adoptLatestVersion=()=>{
    if(!settingsConflict)return
    setSettingsVersion(settingsConflict.version)
    setSettingsConflict(null)
    setError('최신 저장본의 버전을 적용했습니다. 현재 입력 내용을 다시 저장할 수 있습니다.')
  }

  const enableThisDevice=async()=>{
    if(busy.current)return
    if(!supabase||!session){setError('개인 데이터 연결을 설정한 뒤 사용할 수 있습니다.');return}
    if(!supportsPush()){setError('이 브라우저는 Web Push를 지원하지 않습니다.');setPermission('unsupported');return}
    if(!isStandalone()){setError('iPhone에서는 먼저 Safari 공유 메뉴에서 홈 화면에 추가한 뒤 CloudRing을 여세요.');return}
    if(!vapidKey){setError('서버 알림 설정이 아직 준비되지 않았습니다.');return}
    busy.current=true;const current=generation.current;setMessage('');setError('')
    try{
      const permissionRequest=Notification.requestPermission()
      const result=await permissionRequest
      if(generation.current!==current)return
      setPermission(result)
      if(result!=='granted'){setMessage(result==='denied'?'브라우저 알림 권한이 거부되었습니다. 기기 설정에서 권한을 바꾼 뒤 다시 시도하세요.':'알림 권한 요청이 완료되지 않았습니다.');return}
      const [{data:userData,error:userError},{data:aalData,error:aalError}]=await Promise.all([supabase.auth.getUser(),supabase.auth.mfa.getAuthenticatorAssuranceLevel()])
      if(generation.current!==current)return
      if(userError||userData.user?.id!==session.user.id||aalError||aalData.currentLevel!=='aal2')throw new Error('로그인 세션과 2단계 인증을 다시 확인해 주세요.')
      const worker=await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`,{scope:import.meta.env.BASE_URL})
      const readyWorker=await navigator.serviceWorker.ready
      if(generation.current!==current)return
      if(readyWorker.scope!==worker.scope)throw new Error('서비스 워커가 앱 경로에 준비되지 않았습니다.')
      const subscription=await readyWorker.pushManager.getSubscription()??await readyWorker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapidKey(vapidKey)})
      const json=subscription.toJSON()
      if(!subscription.endpoint||!json.keys?.p256dh||!json.keys.auth)throw new Error('브라우저가 구독 정보를 완성하지 못했습니다.')
      const {data,error:registerError}=await supabase.rpc('register_push_device',{p_endpoint:subscription.endpoint,p_p256dh:json.keys.p256dh,p_auth:json.keys.auth,p_device_name:'이 기기'})
      if(registerError)throw registerError
      if(generation.current!==current)return
      if(!data)throw new Error('서버가 구독 저장을 확인하지 못했습니다.')
      setMessage('이 기기의 구독이 서버에 저장되었습니다. 서버 발송과 실제 수신은 별도로 확인됩니다.')
      await reload(()=>generation.current===current)
    }catch(reason){if(generation.current===current)setError(reason instanceof Error?reason.message:'이 기기의 구독을 저장하지 못했습니다.')}
    finally{busy.current=false}
  }

  const disableDevice=async(device:Device)=>{
    if(!supabase||!session)return
    if(busy.current)return;busy.current=true;const current=generation.current;setMessage('');setError('')
    try{
      const {data,error:disableError}=await supabase.rpc('deactivate_push_device',{p_device_id:device.id})
      if(disableError)throw disableError
      if(generation.current!==current)return
      if(data!==true)throw new Error('서버에서 구독 해제 상태를 확인하지 못했습니다.')
      const registration=await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL)
      const subscription=await registration?.pushManager.getSubscription()
      if(generation.current!==current)return
      if(subscription?.endpoint===device.endpoint){
        const removed=await subscription.unsubscribe()
        if(generation.current!==current)return
        if(!removed){setMessage('서버 발송은 중지했지만 브라우저 구독 해제는 확인되지 않았습니다. 이 기기에서 다시 시도하세요.');await reload(()=>generation.current===current);return}
      }
      setMessage(subscription?.endpoint===device.endpoint?'서버와 브라우저에서 구독을 해제했습니다.':'서버에서 해당 기기의 발송을 중지했습니다.')
      await reload(()=>generation.current===current)
    }catch(reason){if(generation.current===current)setError(reason instanceof Error?reason.message:'구독 해제를 완료하지 못했습니다.')}
    finally{busy.current=false}
  }

  const testSend=async()=>{
    if(!supabase)return
    if(busy.current)return;busy.current=true;const current=generation.current;setMessage('');setError('')
    try{
      const {data,error:testError}=await supabase.rpc('queue_test_notification')
      if(testError)throw testError
      if(generation.current!==current)return
      if(!data){setMessage('활성 구독이 없어 테스트 발송을 등록하지 않았습니다.');return}
      setMessage(`서버 발송 대기열에 ${data}건을 등록했습니다. 서비스 접수와 기기 수신 여부는 별도로 확인해야 합니다.`)
    }catch(reason){if(generation.current===current)setError(reason instanceof Error?reason.message:'테스트 발송을 등록하지 못했습니다.')}
    finally{busy.current=false}
  }

  if(!session)return <section className="cr-notify"><h2><Bell size={18}/> 기기 알림</h2><p>소유자 로그인과 TOTP 2단계 인증이 완료된 뒤 알림을 설정할 수 있습니다.</p></section>
  return <section className="cr-notify" aria-labelledby="cr-notify-title">
    <div className="cr-notify-heading"><div><p className="cr-notify-kicker">DEVICE NOTIFICATIONS</p><h2 id="cr-notify-title"><Bell size={19}/> 기기 알림</h2></div><span className={`cr-notify-permission cr-notify-permission-${permission}`}>{permission==='granted'?'권한 허용':permission==='denied'?'권한 거부':permission==='unsupported'?'미지원':'권한 미요청'}</span></div>
    <p className="cr-notify-intro">매일 요약과 일정 알림을 등록할 수 있습니다. 서버 저장, 발송 접수, 실제 기기 수신을 각각 구분합니다.</p>
    {!installed&&<p className="cr-notify-install"><Smartphone size={17}/> iPhone에서는 Safari 공유 메뉴에서 ‘홈 화면에 추가’를 선택한 다음 앱을 열어 주세요.</p>}
    {loading?<p className="cr-notify-status">알림 설정을 확인하고 있습니다…</p>:<>
      {!supabase&&<p className="cr-notify-error">Supabase 연결 설정이 없어 구독을 저장할 수 없습니다.</p>}
      <form className="cr-notify-form" onSubmit={saveSettings}>
        <label className="cr-notify-toggle"><input type="checkbox" checked={settings.enabled} onChange={e=>setSettings({...settings,enabled:e.target.checked})}/><span><b>알림 사용</b><small>서버 예약 작업이 켜져 있을 때 적용됩니다.</small></span></label>
        <label className="cr-notify-toggle"><input type="checkbox" checked={settings.daily_digest_enabled} onChange={e=>setSettings({...settings,daily_digest_enabled:e.target.checked})}/><span><b>매일 일정 요약</b><small>서울 시간 기준으로 발송합니다.</small></span></label>
      <label>요약 시각<input type="time" value={settings.daily_digest_time} onChange={e=>setSettings({...settings,daily_digest_time:e.target.value})}/></label>
        <label>일정 사전 알림<select value={settings.event_lead_minutes} onChange={e=>setSettings({...settings,event_lead_minutes:Number(e.target.value)})}><option value={0}>정시</option><option value={10}>10분 전</option><option value={30}>30분 전</option><option value={60}>1시간 전</option><option value={1440}>하루 전</option></select></label>
        <label>날짜형 마감 알림 시각<input type="time" value={settings.date_due_time} onChange={e=>setSettings({...settings,date_due_time:e.target.value})}/></label>
        <label className="cr-notify-toggle"><input type="checkbox" checked={settings.include_details} onChange={e=>setSettings({...settings,include_details:e.target.checked})}/><span><b>잠금 화면에 항목명 표시</b><small>기본값은 일정·마감 건수만 표시합니다.</small></span></label>
        <button className="cr-notify-button" type="submit" disabled={saving||!supabase}>{saving?'저장 중…':'설정 저장'} <Check size={15}/></button>
      </form>
      {settingsConflict&&<div className="cr-notify-conflict" role="status"><b>최신 저장본을 확인해 주세요</b><p>알림 {settingsConflict.latest.enabled?'사용':'끔'} · 매일 요약 {settingsConflict.latest.daily_digest_enabled?settingsConflict.latest.daily_digest_time:'끔'} · 항목명 {settingsConflict.latest.include_details?'표시':'숨김'}</p><button className="cr-notify-button" type="button" onClick={adoptLatestVersion}>최신 버전을 적용하고 현재 입력 다시 저장</button></div>}
      <div className="cr-notify-device-head"><h3><Smartphone size={16}/> 등록된 기기</h3><span>{devices.length}대</span></div>
      <button className="cr-notify-button" type="button" onClick={()=>void enableThisDevice()} disabled={!supabase||!installed||!supportsPush()||!vapidKey}><Bell size={15}/> 이 기기에서 알림 받기</button>
      {!vapidKey&&<p className="cr-notify-status">공개 키 설정이 준비되지 않았습니다. 기기 권한 요청은 시작되지 않았습니다.</p>}
      {devices.map(device=><div className="cr-notify-device" key={device.id}><span><b>{device.device_name}</b><small>{device.active?'서버 활성 구독':'해제됨'}</small></span><button type="button" onClick={()=>void disableDevice(device)}><BellOff size={14}/> 해제</button></div>)}
      <button className="cr-notify-test" type="button" onClick={()=>void testSend()} disabled={!supabase||devices.length===0}><Clock3 size={14}/> 테스트 알림 발송 요청</button>
    </>}
    {message&&<p className="cr-notify-success" role="status">{message}</p>}{error&&<p className="cr-notify-error" role="alert">{error}</p>}
  </section>
}
