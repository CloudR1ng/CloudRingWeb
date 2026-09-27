import { describe, expect, it } from 'vitest';
import { backupChanges, createWorkspaceBackup, parseWorkspaceBackup, previewBackup, type BackupData } from './backup';
import type { WorkspaceSnapshot } from '../data/workspace';

const projectId='10000000-0000-4000-8000-000000000001';
const taskId='20000000-0000-4000-8000-000000000001';
const goalId='30000000-0000-4000-8000-000000000001';
const linkId='40000000-0000-4000-8000-000000000001';
const eventId='50000000-0000-4000-8000-000000000001';
const data:BackupData={schemaVersion:1,
  projects:[{id:projectId,title:'project',overview:'',description:'',representative_image_path:null,milestones:[],collaborator_roles:[],device_paths:[],related_links:[],category:'학업',tools:[],devices:[],collaborators:[],status:'active',progress_mode:'target_value',manual_progress:null,current_value:2,target_value:8,starts_on:null,due_on:null}],
  tasks:[{id:taskId,project_id:projectId,title:'task',category:'학업',planned_on:null,planned_at:null,due_on:null,due_at:null,status:'paused',progress:40,weight:2}],
  events:[{id:eventId,project_id:projectId,title:'event',category:'개인생활',all_day:false,event_on:null,starts_at:'2026-09-27T14:30:00Z',ends_at:'2026-09-27T15:30:00Z',timezone:'Asia/Seoul',location:'',notes:''}],
  goals:[{id:goalId,parent_goal_id:null,title:'goal',period_type:'year',starts_on:'2026-01-01',ends_on:'2026-12-31',progress_mode:'task_weighted',manual_progress:null,current_value:null,target_value:null}],
  goal_links:[{id:linkId,goal_id:goalId,target_goal_id:null,target_project_id:projectId,target_task_id:null,weight:1}],
};
const empty:WorkspaceSnapshot={projects:[],tasks:[],events:[],goals:[],goal_links:[]};

describe('workspace backup validation and merge preview',()=>{
  it('validates references and project progress, strips identity metadata, and creates additive upserts',()=>{
    const raw=JSON.parse(JSON.stringify(data));raw.projects[0].owner_id='secret-owner';raw.projects[0].version=99;raw.projects[0].service_role='secret';
    const parsed=parseWorkspaceBackup(JSON.stringify(raw));
    expect(parsed.projects[0]).toMatchObject({current_value:2,target_value:8});
    expect(parsed.projects[0]).not.toHaveProperty('owner_id');
    expect(parsed.projects[0]).not.toHaveProperty('service_role');
    const counts=previewBackup(parsed,empty);
    expect(counts).toMatchObject({projects:{incoming:1,existing:0,new:1},goal_links:{incoming:1,existing:0,new:1}});
    expect(backupChanges(parsed,empty)).toHaveLength(5);
  });

  it('exports only workspace data and omits owner, version, and injected credential fields',()=>{
    const row={...data.projects[0],owner_id:'owner-id',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',version:4,auth_token:'should-not-export'};
    const snapshot={projects:[row],tasks:[],events:[],goals:[],goal_links:[]} as unknown as WorkspaceSnapshot;
    const exported=createWorkspaceBackup(snapshot);
    expect(exported.projects[0]).not.toHaveProperty('owner_id');
    expect(exported.projects[0]).not.toHaveProperty('version');
    expect(exported.projects[0]).not.toHaveProperty('auth_token');
  });

  it('marks demo exports and refuses them for private-account restore',()=>{
    const demoFile=JSON.stringify({...data,demo:true});
    expect(()=>parseWorkspaceBackup(demoFile)).toThrow(/데모 샘플/);
    expect(parseWorkspaceBackup(demoFile,{allowDemo:true}).projects).toHaveLength(1);
  });

  it('uses the server row version to update matching ids without deleting unmatched rows',()=>{
    const parsed=parseWorkspaceBackup(JSON.stringify(data));
    const current={...empty,projects:[{...data.projects[0],owner_id:'owner',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-02T00:00:00Z',version:7}]};
    const changes=backupChanges(parsed,current);
    expect(changes.find(change=>change.table==='projects')).toMatchObject({op:'update',id:projectId,version:7});
    expect(changes).toHaveLength(5);
  });

  it('rejects bad dates, missing references, cycles, duplicate ids, and oversized files',()=>{
    const badDate=JSON.parse(JSON.stringify(data));badDate.tasks[0].due_on='2026-02-30';
    expect(()=>parseWorkspaceBackup(JSON.stringify(badDate))).toThrow(/날짜/);
    const missingRef=JSON.parse(JSON.stringify(data));missingRef.tasks[0].project_id='90000000-0000-4000-8000-000000000001';
    expect(()=>parseWorkspaceBackup(JSON.stringify(missingRef))).toThrow(/프로젝트/);
    const duplicate=JSON.parse(JSON.stringify(data));duplicate.tasks.push({...duplicate.tasks[0]});
    expect(()=>parseWorkspaceBackup(JSON.stringify(duplicate))).toThrow(/중복/);
    const cycle=JSON.parse(JSON.stringify(data));cycle.goals[0].parent_goal_id=goalId;
    expect(()=>parseWorkspaceBackup(JSON.stringify(cycle))).toThrow(/상위 목표|자신/);
    expect(()=>parseWorkspaceBackup(' '.repeat(5*1024*1024+1))).toThrow(/5MB/);
  });

  it('rejects malformed nested details, invalid event timestamps, and multiple goal targets',()=>{
    const malformed=JSON.parse(JSON.stringify(data));malformed.projects[0].milestones=[{title:4,dueOn:'2026-02-30',progress:900}];
    expect(()=>parseWorkspaceBackup(JSON.stringify(malformed))).toThrow(/마일스톤/);
    const badEvent=JSON.parse(JSON.stringify(data));badEvent.events[0].ends_at='invalid';
    expect(()=>parseWorkspaceBackup(JSON.stringify(badEvent))).toThrow(/일정/);
    const multiTarget=JSON.parse(JSON.stringify(data));multiTarget.goal_links[0].target_task_id=taskId;
    expect(()=>parseWorkspaceBackup(JSON.stringify(multiTarget))).toThrow(/목표 연결/);
  });

  it('validates incoming links against the preserved server graph before creating changes',()=>{
    const secondId='30000000-0000-4000-8000-000000000002',existingLinkId='40000000-0000-4000-8000-000000000002';
    const incoming=JSON.parse(JSON.stringify(data)) as BackupData;
    incoming.goal_links=[{id:linkId,goal_id:goalId,target_goal_id:secondId,target_project_id:null,target_task_id:null,weight:1}];
    const current:WorkspaceSnapshot={...empty,
      goals:[{id:secondId,owner_id:'owner',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',version:1,parent_goal_id:null,title:'other',period_type:'year',starts_on:'2026-01-01',ends_on:'2026-12-31',progress_mode:'manual',manual_progress:10,current_value:null,target_value:null}],
      goal_links:[{id:existingLinkId,owner_id:'owner',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',version:1,goal_id:secondId,target_goal_id:goalId,target_project_id:null,target_task_id:null,weight:1}],
    };
    expect(()=>backupChanges(incoming,current)).toThrow(/순환/);
  });
});
