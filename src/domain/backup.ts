import type { RowByTable } from '../data/models';
import type { WorkspaceSnapshot, WorkspaceChange } from '../data/workspace';
import { validateGoal, validateGoalLinks, type Goal, type GoalLink } from './goals';

export type BackupData = {
  schemaVersion: 1;
  demo?: true;
  projects: Array<Omit<RowByTable['projects'],'owner_id'|'created_at'|'updated_at'|'version'>>;
  tasks: Array<Omit<RowByTable['tasks'],'owner_id'|'created_at'|'updated_at'|'version'>>;
  events: Array<Omit<RowByTable['events'],'owner_id'|'created_at'|'updated_at'|'version'>>;
  goals: Array<Omit<RowByTable['goals'],'owner_id'|'created_at'|'updated_at'|'version'>>;
  goal_links: Array<Omit<RowByTable['goal_links'],'owner_id'|'created_at'|'updated_at'|'version'>>;
};
export type BackupTable='projects'|'tasks'|'events'|'goals'|'goal_links';
export type BackupCounts = Record<BackupTable,{incoming:number;existing:number;new:number}>;
const maxBackupChars=5*1024*1024;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&(()=>{const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()+1===m&&date.getUTCDate()===d})();
const categories=['학업','대회','자기개발','개인생활'];
const projectStatuses=['planned','active','paused','completed','archived'];
const taskStatuses=['todo','in_progress','paused','completed','cancelled'];
const modes=['manual','target_value','task_weighted'];
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)}
function rows<T>(root:Record<string,unknown>,key:string):T[]{const value=root[key];if(!Array.isArray(value))throw new Error(`${key} 목록이 올바르지 않습니다.`);return value as T[]}
function pickRows(root:Record<string,unknown>,table:string,keys:string[]):Array<Record<string,unknown>>{return rows<unknown>(root,table).map(value=>{if(!record(value))throw new Error(`${table} 항목 형식이 올바르지 않습니다.`);return Object.fromEntries(keys.filter(key=>Object.prototype.hasOwnProperty.call(value,key)).map(key=>[key,value[key]]))})}
function validateProjectDetails(p:BackupData['projects'][number]){const text=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max;const list=(value:unknown):value is unknown[]=>Array.isArray(value);if(!text(p.title,200)||!text(p.overview,500)||!text(p.description,10000)||!Array.isArray(p.tools)||p.tools.some(v=>!text(v,100))||!Array.isArray(p.devices)||p.devices.some(v=>!text(v,100))||!Array.isArray(p.collaborators)||p.collaborators.some(v=>!text(v,100)))throw new Error('프로젝트 문자열과 도구·기기·협업자 목록을 확인해 주세요.');if(!list(p.milestones)||p.milestones.some(item=>!record(item)||!text(item.title,200)||item.dueOn!==null&&!isoDate(item.dueOn)||!Number.isFinite(item.progress)||Number(item.progress)<0||Number(item.progress)>100))throw new Error('프로젝트 마일스톤을 확인해 주세요.');if(!list(p.collaborator_roles)||p.collaborator_roles.some(item=>!record(item)||!text(item.name,100)||!text(item.role,200)))throw new Error('프로젝트 협업 역할을 확인해 주세요.');if(!list(p.device_paths)||p.device_paths.some(item=>!record(item)||!text(item.name,100)||!text(item.path,1000)))throw new Error('프로젝트 기기별 경로를 확인해 주세요.');if(!list(p.related_links)||p.related_links.some(item=>!record(item)||!text(item.label,200)||!text(item.url,2000)||!/^https:\/\//i.test(String(item.url))))throw new Error('프로젝트 관련 링크는 HTTPS 주소로 입력해 주세요.');if(p.representative_image_path!==null&&(!text(p.representative_image_path,500)||!/^([0-9a-f-]+)\/projects\/[0-9a-f-]+\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i.test(p.representative_image_path)))throw new Error('프로젝트 대표 이미지 경로가 올바르지 않습니다.');}
function uniqueIds(items:Array<{id:string}>,label:string){const ids=new Set<string>();for(const item of items){if(!uuid.test(item.id)||ids.has(item.id))throw new Error(`${label} ID가 올바르지 않거나 중복되었습니다.`);ids.add(item.id)}return ids}

/** Validates an exported file without accepting owner/session/service credentials. */
export function parseWorkspaceBackup(text:string,options:{allowDemo?:boolean}={}):BackupData{
  if(text.length>maxBackupChars)throw new Error('백업 파일은 5MB 이하만 가져올 수 있습니다.');
  let raw:unknown;try{raw=JSON.parse(text)}catch{throw new Error('JSON 파일을 읽을 수 없습니다.')}
  if(!record(raw)||raw.schemaVersion!==1)throw new Error('지원하지 않는 백업 형식입니다.');
  if(raw.demo===true&&!options.allowDemo)throw new Error('데모 샘플 파일은 개인 계정으로 복원할 수 없습니다.');
  const data:BackupData={schemaVersion:1,
    projects:pickRows(raw,'projects',['id','title','overview','description','representative_image_path','milestones','collaborator_roles','device_paths','related_links','category','tools','devices','collaborators','status','progress_mode','manual_progress','current_value','target_value','starts_on','due_on']) as BackupData['projects'],
    tasks:pickRows(raw,'tasks',['id','project_id','title','category','planned_on','planned_at','due_on','due_at','status','progress','weight']) as BackupData['tasks'],
    events:pickRows(raw,'events',['id','project_id','title','category','all_day','event_on','starts_at','ends_at','timezone','location','notes']) as BackupData['events'],
    goals:pickRows(raw,'goals',['id','parent_goal_id','title','period_type','starts_on','ends_on','progress_mode','manual_progress','current_value','target_value']) as BackupData['goals'],
    goal_links:pickRows(raw,'goal_links',['id','goal_id','target_goal_id','target_project_id','target_task_id','weight']) as BackupData['goal_links']};
  const projectIds=uniqueIds(data.projects,'프로젝트'),taskIds=uniqueIds(data.tasks,'할 일'),goalIds=uniqueIds(data.goals,'목표');
  uniqueIds(data.events,'일정');uniqueIds(data.goal_links,'목표 연결');
  for(const p of data.projects){if(!categories.includes(p.category)||!projectStatuses.includes(p.status)||!modes.includes(p.progress_mode)||!p.title?.trim())throw new Error('프로젝트 입력을 확인해 주세요.');validateProjectDetails(p);if(p.starts_on!==null&&!isoDate(p.starts_on)||p.due_on!==null&&!isoDate(p.due_on)||p.starts_on&&p.due_on&&p.starts_on>p.due_on)throw new Error('프로젝트 날짜가 올바르지 않습니다.');if(p.progress_mode==='manual'&&(!Number.isFinite(p.manual_progress)||p.manual_progress!<0||p.manual_progress!>100))throw new Error('프로젝트 수동 진행도를 확인해 주세요.');if(p.progress_mode==='target_value'&&(!Number.isFinite(p.current_value)||p.current_value!<0||!Number.isFinite(p.target_value)||p.target_value!<=0))throw new Error('프로젝트 현재값과 목표값을 확인해 주세요.');}
  for(const t of data.tasks){if(!categories.includes(t.category)||!taskStatuses.includes(t.status)||!t.title?.trim()||!Number.isInteger(t.weight)||t.weight<1||t.weight>10||!Number.isFinite(t.progress)||t.progress<0||t.progress>100||t.status==='completed'&&t.progress!==100||t.progress===100&&t.status!=='completed')throw new Error('할 일 입력을 확인해 주세요.');if(t.project_id&&!projectIds.has(t.project_id))throw new Error('할 일에서 찾을 수 없는 프로젝트를 참조합니다.');if(t.planned_on!==null&&!isoDate(t.planned_on)||t.due_on!==null&&!isoDate(t.due_on)||t.planned_at!==null&&!Number.isFinite(Date.parse(t.planned_at))||t.due_at!==null&&!Number.isFinite(Date.parse(t.due_at))||t.planned_on!==null&&t.planned_at!==null||t.due_on!==null&&t.due_at!==null)throw new Error('할 일 날짜와 시각을 확인해 주세요.');}
  for(const e of data.events){if(!categories.includes(e.category)||!e.title?.trim()||typeof e.all_day!=='boolean'||e.timezone!=='Asia/Seoul')throw new Error('일정 입력을 확인해 주세요.');if(e.project_id&&!projectIds.has(e.project_id))throw new Error('일정에서 찾을 수 없는 프로젝트를 참조합니다.');if(e.all_day?(!isoDate(e.event_on)||e.starts_at!==null||e.ends_at!==null):(e.event_on!==null||!e.starts_at||!e.ends_at||!Number.isFinite(Date.parse(e.starts_at))||!Number.isFinite(Date.parse(e.ends_at))||Date.parse(e.ends_at)<=Date.parse(e.starts_at)))throw new Error('일정 날짜·종일 설정·시각을 확인해 주세요.');}
  const goals:Goal[]=data.goals.map(g=>({id:g.id,title:g.title,periodType:g.period_type,startsOn:g.starts_on,endsOn:g.ends_on,parentGoalId:g.parent_goal_id,progressMode:g.progress_mode,manualProgress:g.manual_progress,currentValue:g.current_value,targetValue:g.target_value}));
  for(const goal of goals)validateGoal(goal,goals);
  if(data.goal_links.some(l=>[l.target_goal_id,l.target_project_id,l.target_task_id].filter(target=>target!==null&&target!==undefined).length!==1))throw new Error('목표 연결 대상은 하나만 지정해야 합니다.');
  const links:GoalLink[]=data.goal_links.map(l=>({id:l.id,goalId:l.goal_id,targetType:l.target_goal_id?'goal':l.target_project_id?'project':'task',targetId:l.target_goal_id??l.target_project_id??l.target_task_id??'',weight:l.weight}));
  if(links.some(link=>!goalIds.has(link.goalId)||!Number.isFinite(link.weight)||link.weight<=0||link.targetType==='goal'&&!goalIds.has(link.targetId)||link.targetType==='project'&&!projectIds.has(link.targetId)||link.targetType==='task'&&!taskIds.has(link.targetId)))throw new Error('목표 연결 대상 또는 가중치를 확인해 주세요.');
  for(const goal of goals)validateGoalLinks(goal.id,links.filter(l=>l.goalId===goal.id),{goals,links,projects:data.projects.map(p=>({id:p.id,progressMode:p.progress_mode,manualProgress:p.manual_progress,currentValue:p.current_value,targetValue:p.target_value})),tasks:data.tasks.map(t=>({id:t.id,projectId:t.project_id??undefined,progress:t.progress,weight:t.weight,status:t.status}))});
  return data;
}

export function createWorkspaceBackup(snapshot:WorkspaceSnapshot,demo=false):BackupData{
  const strip=<T extends {id:string}>(items:T[],keys:string[])=>items.map(row=>Object.fromEntries(keys.filter(key=>key in row).map(key=>[key,(row as Record<string,unknown>)[key]])));
  return {schemaVersion:1,...(demo?{demo:true as const}:{}),
    projects:strip(snapshot.projects,['id','title','overview','description','representative_image_path','milestones','collaborator_roles','device_paths','related_links','category','tools','devices','collaborators','status','progress_mode','manual_progress','current_value','target_value','starts_on','due_on']) as BackupData['projects'],
    tasks:strip(snapshot.tasks,['id','project_id','title','category','planned_on','planned_at','due_on','due_at','status','progress','weight']) as BackupData['tasks'],
    events:strip(snapshot.events,['id','project_id','title','category','all_day','event_on','starts_at','ends_at','timezone','location','notes']) as BackupData['events'],
    goals:strip(snapshot.goals,['id','parent_goal_id','title','period_type','starts_on','ends_on','progress_mode','manual_progress','current_value','target_value']) as BackupData['goals'],
    goal_links:strip(snapshot.goal_links,['id','goal_id','target_goal_id','target_project_id','target_task_id','weight']) as BackupData['goal_links']};
}
export function previewBackup(data:BackupData,current:WorkspaceSnapshot):BackupCounts{
  const count=<T extends {id:string}>(incoming:T[],existing:T[])=>({incoming:incoming.length,existing:incoming.filter(x=>existing.some(y=>y.id===x.id)).length,new:incoming.filter(x=>!existing.some(y=>y.id===x.id)).length});
  return {projects:count(data.projects,current.projects),tasks:count(data.tasks,current.tasks),events:count(data.events,current.events),goals:count(data.goals,current.goals),goal_links:count(data.goal_links,current.goal_links)};
}
export function backupChanges(data:BackupData,current:WorkspaceSnapshot):WorkspaceChange[]{
  const existing=createWorkspaceBackup(current);
  const merged=(table:BackupTable)=>{const incoming=data[table] as Array<{id:string}&Record<string,unknown>>,old=existing[table] as Array<{id:string}&Record<string,unknown>>,byId=new Map<string,{id:string}&Record<string,unknown>>();for(const row of old)byId.set(row.id,row);for(const row of incoming)byId.set(row.id,row);return [...byId.values()]};
  parseWorkspaceBackup(JSON.stringify({schemaVersion:1,projects:merged('projects'),tasks:merged('tasks'),events:merged('events'),goals:merged('goals'),goal_links:merged('goal_links')}));
  const changes:WorkspaceChange[]=[];
  const merge=(table:BackupTable,existing:Array<{id:string;version:number}>)=>{for(const row of data[table] as Array<{id:string}&Record<string,unknown>>){const currentRow=existing.find(item=>item.id===row.id);const {id,...values}=row;if(currentRow)changes.push({table,op:'update',id,version:currentRow.version,values} as WorkspaceChange);else changes.push({table,op:'insert',id,values} as WorkspaceChange)}};
  merge('projects',current.projects);merge('tasks',current.tasks);merge('events',current.events);merge('goals',current.goals);merge('goal_links',current.goal_links);if(changes.length>200)throw new Error('한 번에 복원할 수 있는 항목은 200개까지입니다. 범위를 나눠 내보내 주세요.');return changes;
}
