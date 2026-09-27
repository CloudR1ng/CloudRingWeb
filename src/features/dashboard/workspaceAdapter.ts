import type { EventRow, GoalLinkRow, GoalRow, ProjectRow, TaskRow } from '../../data/models';
import type { Goal, GoalLink, GoalProgressMode, GoalTargetType } from '../../domain/goals';
import { seoulDate } from '../../domain/dates';

export type WorkspaceRows = { projects: ProjectRow[]; tasks: TaskRow[]; events: EventRow[]; goals: GoalRow[]; goal_links: GoalLinkRow[] };
export type ProjectModel = {id:string;version:number;ownerId:string;createdAt:string;updatedAt:string;title:string;overview:string;description:string;representativeImagePath:string|null;milestones:ProjectRow['milestones'];collaboratorRoles:ProjectRow['collaborator_roles'];devicePaths:ProjectRow['device_paths'];relatedLinks:ProjectRow['related_links'];category:ProjectRow['category'];tools:string[];devices:string[];collaborators:string[];status:ProjectRow['status'];progressMode:ProjectRow['progress_mode'];manualProgress:number|null;currentValue:number|null;targetValue:number|null;startsOn:string|null;deadline:string|null};
export type TaskModel = {id:string;version:number;ownerId:string;createdAt:string;updatedAt:string;projectId:string|null;title:string;category:TaskRow['category'];plannedOn:string|null;plannedAt:string|null;dueOn:string|null;dueAt:string|null;date?:string;time?:string;deadline?:string;deadlineTime?:string;status:TaskRow['status'];progress:number;weight:number};
export type EventModel = {id:string;version:number;ownerId:string;createdAt:string;updatedAt:string;projectId:string|null;title:string;category:EventRow['category'];allDay:boolean;eventOn:string|null;startsAt:string|null;endsAt:string|null;date:string;time:string;endDate:string;endTime:string;timezone:string;location:string;notes:string};
export type GoalModel = Goal & {version:number;ownerId:string;createdAt:string;updatedAt:string};
export type GoalLinkModel = GoalLink & {version:number;ownerId:string;createdAt:string;updatedAt:string};
export type WorkspaceView = {projects:ProjectModel[];tasks:TaskModel[];events:EventModel[];goals:GoalModel[];goalLinks:GoalLinkModel[]};

function seoulParts(value:string){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('저장된 시각 형식이 올바르지 않습니다.');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const part=(name:Intl.DateTimeFormatPartTypes)=>parts.find(item=>item.type===name)?.value??'00';
  return {date:`${part('year')}-${part('month')}-${part('day')}`,time:`${part('hour')}:${part('minute')}`};
}

/** Convert a Seoul-local date and time input to an ISO UTC timestamp. */
export function seoulInputToUtc(date:string,time:string):string{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('날짜와 시각을 확인해 주세요.');
  const [year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
  const localMs=Date.UTC(year,month-1,day,hour,minute),normalized=new Date(localMs);
  if(normalized.getUTCFullYear()!==year||normalized.getUTCMonth()+1!==month||normalized.getUTCDate()!==day)throw new Error('날짜와 시각을 확인해 주세요.');
  const {date:zoneDate,time:zoneTime}=seoulParts(new Date(localMs).toISOString());
  const [zy,zm,zd]=zoneDate.split('-').map(Number),[zh,zmin]=zoneTime.split(':').map(Number),zoneAsUtc=Date.UTC(zy,zm-1,zd,zh,zmin);
  return new Date(localMs-(zoneAsUtc-localMs)).toISOString();
}

function target(row:GoalLinkRow):{targetType:GoalTargetType;targetId:string}{
  const values:[GoalTargetType,string|null][]=[['goal',row.target_goal_id],['project',row.target_project_id],['task',row.target_task_id]];
  const targets=values.filter(([,id])=>id!==null) as [GoalTargetType,string][];
  if(targets.length!==1)throw new Error('저장된 목표 연결 대상이 하나로 정해져 있지 않습니다.');
  return {targetType:targets[0][0],targetId:targets[0][1]};
}

export function workspaceRowsToView(rows:WorkspaceRows):WorkspaceView{
  return {
    projects:rows.projects.map(p=>({id:p.id,version:p.version,ownerId:p.owner_id,createdAt:p.created_at,updatedAt:p.updated_at,title:p.title,overview:p.overview,description:p.description,representativeImagePath:p.representative_image_path,milestones:p.milestones,collaboratorRoles:p.collaborator_roles,devicePaths:p.device_paths,relatedLinks:p.related_links,category:p.category,tools:p.tools,devices:p.devices,collaborators:p.collaborators,status:p.status,progressMode:p.progress_mode,manualProgress:p.manual_progress,currentValue:p.current_value,targetValue:p.target_value,startsOn:p.starts_on,deadline:p.due_on})),
    tasks:rows.tasks.map(t=>{const plannedTime=t.planned_at?seoulParts(t.planned_at):undefined,dueTime=t.due_at?seoulParts(t.due_at):undefined;return{id:t.id,version:t.version,ownerId:t.owner_id,createdAt:t.created_at,updatedAt:t.updated_at,projectId:t.project_id,title:t.title,category:t.category,plannedOn:t.planned_on,plannedAt:t.planned_at,dueOn:t.due_on,dueAt:t.due_at,date:t.planned_on??plannedTime?.date,time:plannedTime?.time,deadline:t.due_on??dueTime?.date,deadlineTime:dueTime?.time,status:t.status,progress:t.progress,weight:t.weight}}),
    events:rows.events.map(e=>{const stamp=e.starts_at?seoulParts(e.starts_at):undefined;const end=e.ends_at?seoulParts(e.ends_at):undefined;return{id:e.id,version:e.version,ownerId:e.owner_id,createdAt:e.created_at,updatedAt:e.updated_at,projectId:e.project_id,title:e.title,category:e.category,allDay:e.all_day,eventOn:e.event_on,startsAt:e.starts_at,endsAt:e.ends_at,date:e.event_on??stamp?.date??'',time:stamp?.time??'',endDate:end?.date??e.event_on??'',endTime:end?.time??'',timezone:e.timezone,location:e.location,notes:e.notes}}),
    goals:rows.goals.map(g=>({id:g.id,version:g.version,ownerId:g.owner_id,createdAt:g.created_at,updatedAt:g.updated_at,title:g.title,periodType:g.period_type,startsOn:g.starts_on,endsOn:g.ends_on,parentGoalId:g.parent_goal_id,progressMode:g.progress_mode as GoalProgressMode,manualProgress:g.manual_progress,currentValue:g.current_value,targetValue:g.target_value})),
    goalLinks:rows.goal_links.map(l=>({id:l.id,version:l.version,ownerId:l.owner_id,createdAt:l.created_at,updatedAt:l.updated_at,goalId:l.goal_id,...target(l),weight:l.weight})),
  };
}

/** Keep a date-only value as a calendar date; never shift it through a timezone. */
export function displayDateOnly(value:string|null|undefined):string{return value??''}
export function currentSeoulDate():string{return seoulDate()}
