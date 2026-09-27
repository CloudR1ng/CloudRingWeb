export const ownerTables = ['projects', 'tasks', 'events', 'goals', 'goal_links'] as const
export type OwnerTable = (typeof ownerTables)[number]

export interface VersionedRow {
  id: string
  owner_id: string
  created_at: string
  updated_at: string
  version: number
}

export interface ProjectRow extends VersionedRow {
  title: string
  overview: string
  description: string
  representative_image_path: string | null
  milestones: Array<{ id: string; title: string; dueOn: string | null; progress: number }>
  collaborator_roles: Array<{ name: string; role: string }>
  device_paths: Array<{ name: string; path: string }>
  related_links: Array<{ label: string; url: string }>
  category: '학업' | '대회' | '자기개발' | '개인생활'
  tools: string[]
  devices: string[]
  collaborators: string[]
  status: 'planned' | 'active' | 'paused' | 'completed' | 'archived'
  progress_mode: 'task_weighted' | 'manual' | 'target_value'
  manual_progress: number | null
  current_value: number | null
  target_value: number | null
  starts_on: string | null
  due_on: string | null
}

export interface TaskRow extends VersionedRow {
  project_id: string | null
  title: string
  category: '학업' | '대회' | '자기개발' | '개인생활'
  planned_on: string | null
  planned_at: string | null
  due_on: string | null
  due_at: string | null
  status: 'todo' | 'in_progress' | 'paused' | 'completed' | 'cancelled'
  progress: number
  weight: number
}

export interface EventRow extends VersionedRow {
  project_id: string | null
  title: string
  category: '학업' | '대회' | '자기개발' | '개인생활'
  all_day: boolean
  event_on: string | null
  starts_at: string | null
  ends_at: string | null
  timezone: string
  location: string
  notes: string
}

export interface GoalRow extends VersionedRow {
  parent_goal_id: string | null
  title: string
  period_type: 'day' | 'week' | 'month' | 'quarter' | 'half_year' | 'year' | 'custom'
  starts_on: string
  ends_on: string
  progress_mode: 'task_weighted' | 'manual' | 'target_value'
  manual_progress: number | null
  current_value: number | null
  target_value: number | null
}

export interface GoalLinkRow extends VersionedRow {
  goal_id: string
  target_goal_id: string | null
  target_project_id: string | null
  target_task_id: string | null
  weight: number
}

export interface RowByTable {
  projects: ProjectRow
  tasks: TaskRow
  events: EventRow
  goals: GoalRow
  goal_links: GoalLinkRow
}

type Editable<T extends VersionedRow> = Omit<T, keyof VersionedRow>
export type NewRow<K extends OwnerTable> = Editable<RowByTable[K]>
export type RowPatch<K extends OwnerTable> = Partial<Editable<RowByTable[K]>>
