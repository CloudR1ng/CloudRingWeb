import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import webPush from 'npm:web-push@3.6.7'
import { dailySummaryBody, deliveryOutcome, isAllowedPushEndpoint, safeNotificationTarget, seoulParts, sourceIsCurrent, summarizeToday } from '../../../src/features/notifications/core.ts'

type Claimed = {delivery_id:string;job_id:string;owner_id:string;device_id:string;endpoint:string;p256dh:string;auth_secret:string;kind:string;source_table:string|null;source_id:string|null;source_version:number|null;scheduled_at:string;expires_at:string;attempt_count:number;include_details:boolean;lease_token:string}
type SourceStatus = 'todo'|'in_progress'|'paused'|'completed'|'cancelled'
type SourceRow = {id:string;owner_id:string;version:number;status?:SourceStatus|null;title:string;planned_on?:string|null;due_on?:string|null;planned_at?:string|null;due_at?:string|null;category?:string;all_day?:boolean;event_on?:string|null;starts_at?:string|null;ends_at?:string|null;timezone?:string;location?:string}
type PushMessage = {title:string;body:string;url:string;tag:string;icon?:string;badge?:string}
const endpoint = Deno.env.get('SUPABASE_URL')
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const cronSecret = Deno.env.get('PUSH_CRON_SECRET')
const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
const vapidSubject = Deno.env.get('VAPID_SUBJECT')
const appBase = Deno.env.get('APP_BASE_URL')

function json(status:number,value:Record<string,unknown>){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
function genericMessage(job:Claimed,appUrl:string):PushMessage{
  const title=job.kind==='daily_digest'?'CloudRing 오늘의 요약':job.kind==='test'?'CloudRing 테스트 알림':job.kind==='event_start'?'일정 알림':job.kind==='task_start'?'할 일 알림':'마감 알림'
  const body=job.kind==='test'?'서버에서 테스트 알림을 처리했습니다.':job.kind==='daily_digest'?'오늘 예정된 일정과 마감을 확인해 보세요.':'등록된 일정이 가까워졌습니다.'
  return {title,body,url:appUrl,tag:`cloudring-${job.job_id}`}
}
async function currentSource(admin:SupabaseClient,job:Claimed):Promise<SourceRow|null>{
  if(!job.source_table||!job.source_id||job.source_version===null)return null
  if(job.source_table==='tasks'){
    const {data,error}=await admin.from('tasks').select('id,owner_id,version,status,title,planned_on,due_on,planned_at,due_at,category').eq('owner_id',job.owner_id).eq('id',job.source_id).maybeSingle()
    if(error)throw error
    return data
  }
  if(job.source_table==='events'){
    const {data,error}=await admin.from('events').select('id,owner_id,version,title,all_day,event_on,starts_at,ends_at,timezone,location,category').eq('owner_id',job.owner_id).eq('id',job.source_id).maybeSingle()
    if(error)throw error
    return data
  }
  return null
}
async function dailyMessage(admin:SupabaseClient,job:Claimed,appUrl:string,includeDetails:boolean):Promise<PushMessage>{
  const today=seoulParts(new Date()).date
  const [{data:tasks,error:taskError},{data:events,error:eventError},{data:projects,error:projectError},{data:goals,error:goalError}]=await Promise.all([
    admin.from('tasks').select('id,title,status,planned_on,planned_at,due_on,due_at').eq('owner_id',job.owner_id),
    admin.from('events').select('id,title,all_day,event_on,starts_at,ends_at,timezone,location').eq('owner_id',job.owner_id),
    admin.from('projects').select('id,title,due_on,status').eq('owner_id',job.owner_id),
    admin.from('goals').select('id,title,ends_on,progress_mode,manual_progress,current_value,target_value').eq('owner_id',job.owner_id),
  ])
  if(taskError||eventError||projectError||goalError)throw taskError??eventError??projectError??goalError
  const tasksToday=(tasks??[]).filter((task:any)=>task.status!=='completed'&&task.status!=='cancelled'&&((task.planned_on===today)||(task.planned_at&&seoulParts(new Date(task.planned_at)).date===today)||(task.due_on===today)||(task.due_at&&seoulParts(new Date(task.due_at)).date===today)))
  const eventsToday=(events??[]).filter((event:any)=>event.all_day?event.event_on===today:!!event.starts_at&&!!event.ends_at&&seoulParts(new Date(event.starts_at)).date<=today&&seoulParts(new Date(event.ends_at)).date>=today)
  const projectsToday=(projects??[]).filter((project:any)=>project.status!=='completed'&&project.due_on===today)
  const goalsToday=(goals??[]).filter((goal:any)=>goal.ends_on===today&&!(goal.progress_mode==='manual'&&goal.manual_progress===100)&&!(goal.progress_mode==='target_value'&&Number(goal.current_value)>=Number(goal.target_value)))
  const uniqueTasks=summarizeToday(tasksToday).unique
  const uniqueEvents=summarizeToday(eventsToday).unique
  const uniqueProjects=summarizeToday(projectsToday).unique
  const uniqueGoals=summarizeToday(goalsToday).unique
  const names=includeDetails?[...uniqueTasks,...uniqueEvents,...uniqueProjects,...uniqueGoals].map((item:any)=>String(item.title)):[]
  const body=dailySummaryBody({tasks:uniqueTasks.length,events:uniqueEvents.length,projects:uniqueProjects.length,goals:uniqueGoals.length},names,includeDetails)
  return {title:'CloudRing 오늘의 요약',body,url:appUrl,tag:`cloudring-${job.job_id}`}
}
async function upToDateSettings(admin:SupabaseClient,job:Claimed){
  const [{data:device,error:deviceError},{data:settings,error:settingsError},{data:owner,error:ownerError}]=await Promise.all([
    admin.from('push_devices').select('id,owner_id,active').eq('owner_id',job.owner_id).eq('id',job.device_id).maybeSingle(),
    admin.from('notification_settings').select('enabled,include_details').eq('owner_id',job.owner_id).maybeSingle(),
    admin.from('owner_registry').select('owner_id').eq('owner_id',job.owner_id).maybeSingle(),
  ])
  if(deviceError||settingsError||ownerError)throw deviceError??settingsError??ownerError
  return {active:Boolean(owner&&device?.active&&(job.kind==='test'||settings?.enabled)),includeDetails:Boolean(settings?.include_details)}
}

Deno.serve(async request=>{
  if(request.method!=='POST')return json(405,{error:'method_not_allowed'})
  if(!cronSecret||request.headers.get('x-cron-secret')!==cronSecret)return json(401,{error:'unauthorized'})
  if(!endpoint||!key||!vapidPublic||!vapidPrivate||!vapidSubject||!appBase)return json(503,{error:'server_configuration_missing'})
  const appUrl=safeNotificationTarget('#/app',appBase)
  if(!appUrl)return json(503,{error:'app_base_url_invalid'})
  let admin
  try{admin=createClient(endpoint,key,{auth:{persistSession:false,autoRefreshToken:false}});webPush.setVapidDetails(vapidSubject,vapidPublic,vapidPrivate)}catch{return json(503,{error:'push_configuration_invalid'})}
  let planned=0,attempted=0,accepted=0,obsolete=0
  let needsReplan=false
  try{
    const {data:planCount,error:planError}=await admin.rpc('plan_notification_jobs')
    if(planError)throw planError
    planned=Number(planCount??0)
    const {data:claims,error:claimError}=await admin.rpc('claim_push_deliveries',{p_limit:10})
    if(claimError)throw claimError
    for(const job of (claims??[]) as Claimed[]){
      attempted+=1
      const finish=async(outcome:string,status:number|null=null)=>{
        const {data,error}=await admin.rpc('finish_push_delivery',{p_delivery_id:job.delivery_id,p_lease_token:job.lease_token,p_outcome:outcome,p_status_code:status})
        if(error)throw error
        if(data!==true)throw new Error('delivery_lease_lost')
      }
      if(Date.parse(job.expires_at)<=Date.now()){await finish('expired');continue}
      if(!isAllowedPushEndpoint(job.endpoint)){await finish('failed',400);continue}
      let currentSettings=await upToDateSettings(admin,job)
      if(!currentSettings.active){await finish('obsolete');continue}
      let message:PushMessage
      if(job.source_table){
        const latest=await currentSource(admin,job)
        const valid=sourceIsCurrent({id:job.source_id!,version:job.source_version!},latest?{id:latest.id,version:latest.version,status:latest.status??undefined}:null,new Date(job.expires_at),new Date())
        if(!valid){await finish('obsolete');obsolete+=1;needsReplan=true;continue}
        message=genericMessage(job,appUrl)
        if(currentSettings.includeDetails&&latest?.title)message.body=`${String(latest.title).slice(0,80)} 일정이 가까워졌습니다.`
      }else if(job.kind==='daily_digest')message=await dailyMessage(admin,job,appUrl,currentSettings.includeDetails)
      else message=genericMessage(job,appUrl)
      const ttl=Math.max(0,Math.floor((Date.parse(job.expires_at)-Date.now())/1000))
      if(ttl<=0){await finish('expired');continue}
      // Recheck opt-out, ownership, and device revocation after source/digest reads, immediately before network send.
      currentSettings=await upToDateSettings(admin,job)
      if(!currentSettings.active){await finish('obsolete');continue}
      if(job.source_table){
        const latest=await currentSource(admin,job)
        const valid=sourceIsCurrent({id:job.source_id!,version:job.source_version!},latest?{id:latest.id,version:latest.version,status:latest.status??undefined}:null,new Date(job.expires_at),new Date())
        if(!valid){await finish('obsolete');obsolete+=1;needsReplan=true;continue}
      }
      if(job.kind==='daily_digest'&&!currentSettings.includeDetails){message=await dailyMessage(admin,job,appUrl,false)}
      if(job.source_table&&!currentSettings.includeDetails)message.body=genericMessage(job,appUrl).body
      message.tag=`cloudring-${job.kind}-${job.source_id??job.job_id}`
      try{
        const result=await webPush.sendNotification({endpoint:job.endpoint,keys:{p256dh:job.p256dh,auth:job.auth_secret}},JSON.stringify(message),{TTL:ttl,urgency:'normal',timeout:10000})
        const code=Number(result.statusCode)
        const outcome=deliveryOutcome(code)
        await finish(outcome,code)
        if(outcome==='accepted')accepted+=1
      }catch(error){
        const code=Number((error as {statusCode?:number})?.statusCode)||null
        await finish(deliveryOutcome(code),code)
      }
    }
    if(needsReplan)await admin.rpc('plan_notification_jobs')
    return json(200,{planned,attempted,accepted,obsolete})
  }catch{
    return json(500,{error:'notification_dispatch_failed',planned,attempted,accepted})
  }
})
