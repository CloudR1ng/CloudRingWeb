import { describe, expect, it } from 'vitest';
import { displayDateOnly, seoulInputToUtc, workspaceRowsToView, type WorkspaceRows } from './workspaceAdapter';

describe('workspace screen adapter',()=>{
  it('converts Seoul clock inputs to UTC instants and rejects invalid values',()=>{
    expect(seoulInputToUtc('2026-09-27','09:00')).toBe('2026-09-27T00:00:00.000Z');
    expect(seoulInputToUtc('2026-09-27','23:30')).toBe('2026-09-27T14:30:00.000Z');
    expect(()=>seoulInputToUtc('2026-02-30','09:00')).toThrow(/날짜와 시각/);
    expect(()=>seoulInputToUtc('2026-09-27','24:00')).toThrow(/날짜와 시각/);
  });

  it('keeps date-only deadlines unchanged and maps server ids and versions',()=>{
    const base={owner_id:'owner',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',project_id:null,category:'학업' as const,status:'paused' as const,progress:30,weight:2};
    const rows:WorkspaceRows={projects:[],tasks:[{...base,id:'task-uuid',version:4,title:'기한만 날짜로 지정',planned_on:null,planned_at:null,due_on:'2024-02-29',due_at:null},{...base,id:'task-time-uuid',version:1,title:'서울 자정 일정',planned_on:null,planned_at:'2026-09-26T15:00:00.000Z',due_on:null,due_at:'2026-09-26T16:30:00.000Z'}],events:[],goals:[],goal_links:[]};
    const view=workspaceRowsToView(rows);
    expect(view.tasks[0]).toMatchObject({id:'task-uuid',version:4,deadline:'2024-02-29',status:'paused'});
    expect(view.tasks[1]).toMatchObject({id:'task-time-uuid',date:'2026-09-27',time:'00:00',deadline:'2026-09-27',deadlineTime:'01:30'});
    expect(displayDateOnly('2024-02-29')).toBe('2024-02-29');
  });

  it('round-trips numeric project progress and dates spanning Seoul midnight',()=>{
    const base={owner_id:'owner',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',version:3};
    const rows:WorkspaceRows={
      projects:[{...base,id:'project-numeric',title:'수치 프로젝트',overview:'요약',description:'상세 설명',representative_image_path:null,milestones:[],collaborator_roles:[],device_paths:[],related_links:[],category:'학업',tools:[],devices:[],collaborators:[],status:'active',progress_mode:'target_value',manual_progress:null,current_value:2,target_value:8,starts_on:null,due_on:null}],
      tasks:[],events:[{...base,id:'event-spanning',project_id:null,title:'심야 약속',category:'개인생활',all_day:false,event_on:null,starts_at:'2026-09-27T14:30:00.000Z',ends_at:'2026-09-27T15:30:00.000Z',timezone:'Asia/Seoul',location:'',notes:''}],goals:[],goal_links:[],
    };
    const view=workspaceRowsToView(rows);
    expect(view.projects[0]).toMatchObject({id:'project-numeric',version:3,progressMode:'target_value',currentValue:2,targetValue:8});
    expect(view.events[0]).toMatchObject({date:'2026-09-27',time:'23:30',endDate:'2026-09-28',endTime:'00:30'});
  });
});
