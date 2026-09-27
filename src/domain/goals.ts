import { addDays, startOfWeek } from './dates';
import { calculateProjectProgress } from './progress';

export type GoalPeriodType = 'day' | 'week' | 'month' | 'quarter' | 'half_year' | 'year' | 'custom';
export type GoalProgressMode = 'manual' | 'target_value' | 'task_weighted';
export type GoalTargetType = 'goal' | 'project' | 'task';
export type Goal = {
  id: string;
  title: string;
  periodType: GoalPeriodType;
  startsOn: string;
  endsOn: string;
  parentGoalId?: string | null;
  progressMode: GoalProgressMode;
  manualProgress?: number | null;
  currentValue?: number | null;
  targetValue?: number | null;
};
export type GoalLink = { id: string; goalId: string; targetType: GoalTargetType; targetId: string; weight: number };
export type GoalTask = { id: string; projectId?: string; progress: number; weight?: number; status?: 'todo' | 'in_progress' | 'paused' | 'completed' | 'cancelled' };
export type GoalProject = { id: string; progressMode?: 'manual' | 'task_weighted' | 'target_value'; manualProgress?: number | null; currentValue?:number|null; targetValue?:number|null };
export type GoalProgressSources = { goals: Goal[]; links: GoalLink[]; projects: GoalProject[]; tasks: GoalTask[] };

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
};
const targetKey = (type: GoalTargetType, id: string) => `${type}:${id}`;

function utcParts(date: string) {
  if (!validDate(date)) throw new Error('기준 날짜를 확인해 주세요.');
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function goalPeriodBounds(periodType: GoalPeriodType, anchor: string): { startsOn: string; endsOn: string } {
  const { year, month } = utcParts(anchor);
  if (periodType === 'day') return { startsOn: anchor, endsOn: anchor };
  if (periodType === 'week') {
    const startsOn = startOfWeek(anchor);
    return { startsOn, endsOn: addDays(startsOn, 6) };
  }
  if (periodType === 'month') return { startsOn: isoDate(year, month, 1), endsOn: isoDate(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()) };
  if (periodType === 'quarter') {
    const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return { startsOn: isoDate(year, firstMonth, 1), endsOn: isoDate(year, firstMonth + 3, 0) };
  }
  if (periodType === 'half_year') {
    const firstMonth = month <= 6 ? 1 : 7;
    return { startsOn: isoDate(year, firstMonth, 1), endsOn: isoDate(year, firstMonth + 6, 0) };
  }
  if (periodType === 'year') return { startsOn: isoDate(year, 1, 1), endsOn: isoDate(year, 12, 31) };
  return { startsOn: anchor, endsOn: addDays(anchor, 29) };
}

export function validateGoal(goal: Goal, goals: Goal[]): void {
  if (!goal.title.trim() || goal.title.trim().length > 200) throw new Error('목표 이름은 1~200자로 입력해 주세요.');
  if (!validDate(goal.startsOn) || !validDate(goal.endsOn) || goal.startsOn > goal.endsOn) throw new Error('목표 시작일과 마감일을 확인해 주세요.');
  if (goal.progressMode === 'manual' && (!Number.isFinite(goal.manualProgress) || goal.manualProgress! < 0 || goal.manualProgress! > 100)) throw new Error('수동 진행도는 0~100%로 입력해 주세요.');
  if (goal.progressMode === 'target_value' && (!Number.isFinite(goal.currentValue) || goal.currentValue! < 0 || !Number.isFinite(goal.targetValue) || goal.targetValue! <= 0)) throw new Error('현재값은 0 이상, 목표값은 0보다 큰 수로 입력해 주세요.');
  for (const child of goals.filter(item => item.parentGoalId === goal.id && item.id !== goal.id)) {
    if (goal.startsOn > child.startsOn || goal.endsOn < child.endsOn) throw new Error('상위 목표의 기간은 기존 하위 목표 기간을 포함해야 합니다.');
  }
  const parentId = goal.parentGoalId || null;
  if (!parentId) return;
  const parent = goals.find(item => item.id === parentId);
  if (!parent) throw new Error('상위 목표를 찾을 수 없습니다.');
  if (parent.id === goal.id) throw new Error('목표를 자기 자신의 상위 목표로 지정할 수 없습니다.');
  if (parent.startsOn > goal.startsOn || parent.endsOn < goal.endsOn) throw new Error('하위 목표 기간은 상위 목표 기간 안에 있어야 합니다.');
  const seen = new Set<string>([goal.id]);
  let cursor: Goal | undefined = parent;
  while (cursor) {
    if (seen.has(cursor.id)) throw new Error('상위 목표 연결에서 순환이 발생합니다.');
    seen.add(cursor.id);
    cursor = cursor.parentGoalId ? goals.find(item => item.id === cursor!.parentGoalId) : undefined;
  }
}

type ResolveSources = GoalProgressSources;

function linksWithCandidate(goalId: string, candidate: GoalLink[], links: GoalLink[]) {
  return [...links.filter(link => link.goalId !== goalId), ...candidate];
}

function contributionKeys(type: GoalTargetType, id: string, sources: ResolveSources, links: GoalLink[], stack: Set<string>): Set<string> {
  if (type === 'task') {
    const task = sources.tasks.find(item => item.id === id);
    return !task ? new Set() : new Set([targetKey(type, id)]);
  }
  if (type === 'project') {
    const project = sources.projects.find(item => item.id === id);
    if (!project) return new Set();
    return new Set([targetKey(type, id), ...sources.tasks.filter(task => task.projectId === id).map(task => targetKey('task', task.id))]);
  }
  const goal = sources.goals.find(item => item.id === id);
  if (!goal) return new Set();
  if (stack.has(id)) throw new Error('목표 연결에서 순환이 발생합니다.');
  if (goal.progressMode !== 'task_weighted') return new Set([targetKey('goal', id)]);
  const nested = links.filter(link => link.goalId === id);
  if (!nested.length) return new Set([targetKey('goal', id)]);
  const nextStack = new Set(stack);
  nextStack.add(id);
  return nested.reduce((keys, link) => new Set([...keys, ...contributionKeys(link.targetType, link.targetId, sources, links, nextStack)]), new Set<string>([targetKey('goal', id)]));
}

export function validateGoalLinks(goalId: string, candidateLinks: GoalLink[], sources: ResolveSources): void {
  const goal = sources.goals.find(item => item.id === goalId);
  if (!goal) throw new Error('목표를 찾을 수 없습니다.');
  const seenTargets = new Set<string>();
  for (const link of candidateLinks) {
    if (link.goalId !== goalId) throw new Error('목표 연결의 소유 목표가 올바르지 않습니다.');
    if (!Number.isFinite(link.weight) || link.weight <= 0) throw new Error('연결 가중치는 0보다 큰 수여야 합니다.');
    const key = targetKey(link.targetType, link.targetId);
    if (seenTargets.has(key)) throw new Error('같은 항목을 한 목표에 두 번 연결할 수 없습니다.');
    seenTargets.add(key);
    const exists = link.targetType === 'goal' ? sources.goals.some(item => item.id === link.targetId) : link.targetType === 'project' ? sources.projects.some(item => item.id === link.targetId) : sources.tasks.some(item => item.id === link.targetId);
    if (!exists) throw new Error('연결할 항목을 찾을 수 없습니다.');
    if (link.targetType === 'goal' && link.targetId === goalId) throw new Error('목표를 자기 자신에게 연결할 수 없습니다.');
  }

  const allLinks = linksWithCandidate(goalId, candidateLinks, sources.links);
  const graphGoals = sources.goals;
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (current: string) => {
    if (visiting.has(current)) throw new Error('목표 연결에서 순환이 발생합니다.');
    if (visited.has(current)) return;
    visiting.add(current);
    for (const link of allLinks.filter(item => item.goalId === current && item.targetType === 'goal')) visit(link.targetId);
    visiting.delete(current);
    visited.add(current);
  };
  graphGoals.forEach(item => visit(item.id));

  for (const item of graphGoals) {
    if (item.progressMode !== 'task_weighted') continue;
    const direct = allLinks.filter(link => link.goalId === item.id);
    const included = new Set<string>();
    for (const link of direct) {
      const keys = contributionKeys(link.targetType, link.targetId, sources, allLinks, new Set([item.id]));
      if ([...keys].some(key => included.has(key))) throw new Error('하위 목표·프로젝트에 포함된 같은 작업을 중복 집계할 수 없습니다.');
      keys.forEach(key => included.add(key));
    }
  }
}

function taskValue(task: GoalTask): number | null {
  if (task.status === 'cancelled') return null;
  if (task.status === 'completed') return 100;
  return Number.isFinite(task.progress) ? Math.max(0, Math.min(100, task.progress)) : null;
}

function weighted(values: { value: number | null; weight: number }[]): number | null {
  const usable = values.filter(item => item.value !== null && Number.isFinite(item.weight) && item.weight > 0);
  const total = usable.reduce((sum, item) => sum + item.weight, 0);
  return total ? Math.round(usable.reduce((sum, item) => sum + item.value! * item.weight, 0) / total) : null;
}

export function calculateGoalProgress(goalId: string, sources: GoalProgressSources): number | null {
  const goals = new Map(sources.goals.map(goal => [goal.id, goal]));
  const links = sources.links;
  const resolveGoal = (id: string, stack: Set<string>): number | null => {
    const goal = goals.get(id);
    if (!goal || stack.has(id)) return null;
    if (goal.progressMode === 'manual') return Number.isFinite(goal.manualProgress) ? Math.max(0, Math.min(100, goal.manualProgress!)) : null;
    if (goal.progressMode === 'target_value') {
      if (!Number.isFinite(goal.currentValue) || goal.currentValue! < 0 || !Number.isFinite(goal.targetValue) || goal.targetValue! <= 0) return null;
      return Math.min(100, Math.round((goal.currentValue! / goal.targetValue!) * 100));
    }
    const nextStack = new Set(stack);
    nextStack.add(id);
    const direct = links.filter(link => link.goalId === id);
    const unique = new Set<string>();
    return weighted(direct.map(link => {
      const key = targetKey(link.targetType, link.targetId);
      if (unique.has(key)) return { value: null, weight: link.weight };
      unique.add(key);
      let value: number | null = null;
      if (link.targetType === 'task') {
        const task = sources.tasks.find(item => item.id === link.targetId);
        value = task ? taskValue(task) : null;
      } else if (link.targetType === 'project') {
        const project = sources.projects.find(item => item.id === link.targetId);
        if(project)value=calculateProjectProgress(project,sources.tasks.filter(task=>task.projectId===project.id).map(task=>({id:task.id,completed:task.status==='completed',progress:task.progress,weight:task.weight,cancelled:task.status==='cancelled'})));
      } else value = resolveGoal(link.targetId, nextStack);
      return { value, weight: link.weight };
    }));
  };
  return resolveGoal(goalId, new Set());
}
