import { describe, expect, it } from 'vitest';
import { validateProjectDates } from './projects';

describe('project date consistency',()=>{
  it('accepts optional dates and ordered valid milestones',()=>{
    expect(()=>validateProjectDates(undefined,undefined,[])).not.toThrow();
    expect(()=>validateProjectDates('2024-02-01','2024-02-29',[{dueOn:'2024-02-15'}])).not.toThrow();
  });
  it('rejects invalid/reversed project dates and milestones outside the period',()=>{
    expect(()=>validateProjectDates('2026-09-30','2026-09-01')).toThrow(/마감일/);
    expect(()=>validateProjectDates(undefined,'2026-02-30')).toThrow(/날짜/);
    expect(()=>validateProjectDates('2026-09-01','2026-09-30',[{dueOn:'2026-10-01'}])).toThrow(/마일스톤/);
  });
});
