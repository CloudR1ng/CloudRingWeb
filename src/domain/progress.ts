export type ProgressTask = { id: string; completed?: boolean; progress?: number; weight?: number; cancelled?: boolean };
export type ProjectProgressInput = { progressMode?: 'manual' | 'task_weighted' | 'target_value'; manualProgress?: number | null; currentValue?: number | null; targetValue?: number | null };

/** Computes one contribution per task ID; cancelled tasks do not contribute. */
export function weightedProgress(tasks: ProgressTask[]): number | null {
  const unique = new Map<string, ProgressTask>();
  tasks.forEach(task => { if (!unique.has(task.id)) unique.set(task.id, task); });
  const eligible = [...unique.values()].filter(task => !task.cancelled);
  if (!eligible.length) return null;
  const weights = eligible.map(task => Math.max(0, Number.isFinite(task.weight) ? task.weight! : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return null;
  const completed = eligible.reduce((sum, task, index) => {
    const progress = task.completed ? 100 : Math.max(0, Math.min(100, Number.isFinite(task.progress) ? task.progress! : 0));
    return sum + progress * weights[index];
  }, 0);
  return Math.round(completed / total);
}

export function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

/** Shared project progress calculation for dashboard cards and linked goals. */
export function calculateProjectProgress(project: ProjectProgressInput, tasks: ProgressTask[]): number | null {
  if (project.progressMode === 'manual') return Number.isFinite(project.manualProgress) ? clampProgress(project.manualProgress!) : null;
  if (project.progressMode === 'target_value') {
    if (!Number.isFinite(project.currentValue) || project.currentValue! < 0 || !Number.isFinite(project.targetValue) || project.targetValue! <= 0) return null;
    return Math.min(100, Math.round(project.currentValue! / project.targetValue! * 100));
  }
  return weightedProgress(tasks);
}
