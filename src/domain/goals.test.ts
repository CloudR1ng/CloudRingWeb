import { describe, expect, it } from 'vitest';
import { calculateGoalProgress, goalPeriodBounds, validateGoal, validateGoalLinks, type Goal, type GoalLink, type GoalProgressSources } from './goals';

const year: Goal = { id: 'year', title: '연간 목표', periodType: 'year', startsOn: '2026-01-01', endsOn: '2026-12-31', progressMode: 'task_weighted' };
const quarter: Goal = { id: 'quarter', title: '분기 목표', periodType: 'quarter', startsOn: '2026-04-01', endsOn: '2026-06-30', parentGoalId: 'year', progressMode: 'task_weighted' };
const task = (id: string, progress: number, projectId?: string, status: GoalProgressSources['tasks'][number]['status'] = 'in_progress') => ({ id, progress, projectId, status });
const link = (goalId: string, targetType: GoalLink['targetType'], targetId: string, weight = 1): GoalLink => ({ id: `${goalId}-${targetType}-${targetId}`, goalId, targetType, targetId, weight });

describe('goal period and hierarchy rules', () => {
  it('returns exact date boundaries for year, quarter, half-year, month, week and day', () => {
    expect(goalPeriodBounds('year', '2024-02-29')).toEqual({ startsOn: '2024-01-01', endsOn: '2024-12-31' });
    expect(goalPeriodBounds('quarter', '2026-12-31')).toEqual({ startsOn: '2026-10-01', endsOn: '2026-12-31' });
    expect(goalPeriodBounds('quarter', '2026-04-01')).toEqual({ startsOn: '2026-04-01', endsOn: '2026-06-30' });
    expect(goalPeriodBounds('half_year', '2026-11-02')).toEqual({ startsOn: '2026-07-01', endsOn: '2026-12-31' });
    expect(goalPeriodBounds('month', '2024-02-12')).toEqual({ startsOn: '2024-02-01', endsOn: '2024-02-29' });
    expect(goalPeriodBounds('week', '2026-12-31')).toEqual({ startsOn: '2026-12-28', endsOn: '2027-01-03' });
    expect(goalPeriodBounds('day', '2026-03-02')).toEqual({ startsOn: '2026-03-02', endsOn: '2026-03-02' });
    expect(() => validateGoal({ ...year, startsOn: '2026-02-30' }, [])).toThrow(/시작일/);
  });

  it('requires children to fit inside their parent period and blocks parent cycles', () => {
    expect(() => validateGoal(quarter, [year, quarter])).not.toThrow();
    expect(() => validateGoal({ ...quarter, startsOn: '2025-12-01' }, [year, quarter])).toThrow(/기간/);
    const child = { ...quarter, id: 'child', parentGoalId: 'quarter' };
    const proposed = { ...quarter, parentGoalId: 'child' };
    expect(() => validateGoal(proposed, [year, quarter, child])).toThrow(/순환/);
    expect(() => validateGoal({ ...year, endsOn: '2026-03-31', parentGoalId: null }, [year, { ...quarter, startsOn: '2026-04-01' }])).toThrow(/하위 목표/);
  });
});

describe('goal progress and direct weighted links', () => {
  it('calculates task-weighted progress from direct links and does not inherit a child by parent relation alone', () => {
    const sources: GoalProgressSources = {
      goals: [year, quarter], links: [link('quarter', 'task', 't1')], projects: [], tasks: [task('t1', 70)],
    };
    expect(calculateGoalProgress('quarter', sources)).toBe(70);
    expect(calculateGoalProgress('year', sources)).toBeNull();
  });

  it('supports manual and target-value progress with a 100 percent cap', () => {
    const sources: GoalProgressSources = {
      goals: [
        { ...year, id: 'manual', progressMode: 'manual', manualProgress: 42 },
        { ...year, id: 'numeric', progressMode: 'target_value', currentValue: 18, targetValue: 10 },
      ], links: [], projects: [], tasks: [],
    };
    expect(calculateGoalProgress('manual', sources)).toBe(42);
    expect(calculateGoalProgress('numeric', sources)).toBe(100);
    expect(calculateGoalProgress('missing', sources)).toBeNull();
  });

  it('averages link weights, excludes cancelled targets, and ignores projects with no eligible tasks', () => {
    const sources: GoalProgressSources = {
      goals: [year],
      links: [link('year', 'task', 'done', 2), link('year', 'task', 'cancelled', 7), link('year', 'task', 'half', 1)],
      projects: [], tasks: [task('done', 100, undefined, 'completed'), task('cancelled', 100, undefined, 'cancelled'), task('half', 50)],
    };
    expect(calculateGoalProgress('year', sources)).toBe(83);
    expect(calculateGoalProgress('year', { ...sources, links: [link('year', 'project', 'empty')], projects: [{ id: 'empty' }] })).toBeNull();
  });

  it('reads manually managed project progress and positive weights only', () => {
    const sources: GoalProgressSources = {
      goals: [year], links: [link('year', 'project', 'manual-project', 2)],
      projects: [{ id: 'manual-project', progressMode: 'manual', manualProgress: 65 }], tasks: [],
    };
    expect(calculateGoalProgress('year', sources)).toBe(65);
    expect(() => validateGoalLinks('year', [link('year', 'project', 'manual-project', 0)], sources)).toThrow(/가중치/);
  });

  it('uses capped target-value progress for a directly linked project', () => {
    const sources: GoalProgressSources = {
      goals: [year], links: [link('year', 'project', 'numeric-project')],
      projects: [{ id: 'numeric-project', progressMode: 'target_value', currentValue: 3, targetValue: 10 }], tasks: [],
    };
    expect(calculateGoalProgress('year', sources)).toBe(30);
    expect(calculateGoalProgress('year', { ...sources, projects: [{ id: 'numeric-project', progressMode: 'target_value', currentValue: 15, targetValue: 10 }] })).toBe(100);
    expect(calculateGoalProgress('year', { ...sources, projects: [{ id: 'numeric-project', progressMode: 'target_value', currentValue: 1, targetValue: 0 }] })).toBeNull();
  });

  it('rejects direct, project-task, descendant-goal, and goal-link-cycle duplicate contributions', () => {
    const grandchild = { ...quarter, id: 'grandchild', parentGoalId: 'quarter' };
    const base: GoalProgressSources = { goals: [year, quarter, grandchild], links: [], projects: [{ id: 'p1' }], tasks: [task('t1', 20, 'p1')] };
    expect(() => validateGoalLinks('year', [link('year', 'task', 't1'), link('year', 'task', 't1')], base)).toThrow(/두 번/);
    expect(() => validateGoalLinks('year', [link('year', 'project', 'p1'), link('year', 'task', 't1')], base)).toThrow(/중복/);
    const childHasTask = { ...base, links: [link('quarter', 'task', 't1')] };
    expect(() => validateGoalLinks('year', [link('year', 'goal', 'quarter'), link('year', 'task', 't1')], childHasTask)).toThrow(/중복/);
    const manualProject = { ...base, projects: [{ id: 'p1', progressMode: 'manual' as const, manualProgress: 40 }] };
    expect(() => validateGoalLinks('year', [link('year', 'project', 'p1'), link('year', 'task', 't1')], manualProject)).toThrow(/중복/);
    const cancelledTask = { ...base, tasks: [task('t1', 20, 'p1', 'cancelled')] };
    expect(() => validateGoalLinks('year', [link('year', 'project', 'p1'), link('year', 'task', 't1')], cancelledTask)).toThrow(/중복/);
    const cycle = { ...base, goals: [year, { ...quarter, progressMode: 'manual' as const, manualProgress: 30 }], links: [link('quarter', 'goal', 'year')] };
    expect(() => validateGoalLinks('year', [link('year', 'goal', 'quarter')], cycle)).toThrow(/순환/);
  });

  it('uses task weights while calculating an automatically managed linked project', () => {
    const sources: GoalProgressSources = {
      goals: [year], links: [link('year', 'project', 'p1')], projects: [{ id: 'p1', progressMode: 'task_weighted' }],
      tasks: [{ ...task('heavy', 100, 'p1'), weight: 2 }, { ...task('light', 50, 'p1'), weight: 1 }],
    };
    expect(calculateGoalProgress('year', sources)).toBe(83);
  });
});
