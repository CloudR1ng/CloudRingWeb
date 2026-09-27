export interface NotificationSettingsValue { enabled:boolean; daily_digest_enabled:boolean; daily_digest_time:string; event_lead_minutes:number; date_due_time:string; include_details:boolean }
export const defaultNotificationSettings: NotificationSettingsValue = { enabled:false,daily_digest_enabled:true,daily_digest_time:'08:00',event_lead_minutes:30,date_due_time:'17:00',include_details:false }
export interface ReminderSource { id:string; version:number; status?:string; deleted?:boolean }
export function seoulParts(instant:Date):{date:string;time:string}{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant)
  const get=(type:string)=>parts.find(part=>part.type===type)?.value??''
  return {date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`}
}
export function summarizeToday<T extends {id:string}>(items:T[]):{count:number;unique:T[]}{const seen=new Set<string>();const unique=items.filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true});return {count:unique.length,unique}}
export function sourceIsCurrent(expected:ReminderSource,latest:ReminderSource|null,expiresAt:Date,now:Date):boolean{if(expiresAt.getTime()<=now.getTime()||!latest||latest.deleted||latest.version!==expected.version)return false;return latest.status!=='completed'&&latest.status!=='cancelled'}
export function dedupeKey(input:{owner:string;kind:string;date?:string;id?:string;version?:number}):string{return input.date?`${input.kind}:${input.date}`:`${input.kind}:${input.id}:${input.version}`}
export function retryDelaySeconds(attempt:number):number{if(!Number.isInteger(attempt)||attempt<1)return 30;return Math.min(1800,30*2**Math.min(attempt,5))}
export function isRetryablePushStatus(status:number|null):boolean{return status===null||status===408||status===425||status===429||status>=500}
export type DeliveryOutcome='accepted'|'expired'|'retry'|'failed'
export function deliveryOutcome(status:number|null):DeliveryOutcome{
  if(status===201||status===202)return 'accepted'
  if(status===404||status===410)return 'expired'
  if(isRetryablePushStatus(status))return 'retry'
  return 'failed'
}
const allowedPushHosts=new Set(['web.push.apple.com','updates.push.services.mozilla.com','push.services.mozilla.com','fcm.googleapis.com'])
export function isAllowedPushEndpoint(value:string):boolean{try{const url=new URL(value);const host=url.hostname.toLowerCase();return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&(allowedPushHosts.has(host)||host.endsWith('.fcm.googleapis.com')||host.endsWith('.push.services.mozilla.com')||/^wns2-[a-z0-9-]+\.notify\.windows\.com$/.test(host))}catch{return false}}
export function safeNotificationTarget(value:string,appScope:string,origin='https://example.test'):string|null{try{const scope=new URL(appScope,origin);const target=new URL(value,scope);if(target.origin!==scope.origin||!target.pathname.startsWith(scope.pathname)||target.username||target.password)return null;return target.href}catch{return null}}
