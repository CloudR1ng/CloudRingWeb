import { describe, expect, it } from 'vitest';
import { calculateProjectProgress, weightedProgress } from './progress';

describe('project progress', () => {
  it('uses weighted task progress and ignores cancelled tasks', () => {
    expect(calculateProjectProgress({ progressMode: 'task_weighted' }, [
      { id: 'heavy', progress: 100, weight: 2 },
      { id: 'light', progress: 50, weight: 1 },
      { id: 'cancelled', progress: 0, weight: 10, cancelled: true },
    ])).toBe(83);
    expect(weightedProgress([{ id: 'cancelled', cancelled: true }])).toBeNull();
  });

  it('supports manual and capped numeric progress with null for invalid values', () => {
    expect(calculateProjectProgress({ progressMode: 'manual', manualProgress: 45 }, [])).toBe(45);
    expect(calculateProjectProgress({ progressMode: 'target_value', currentValue: 2, targetValue: 8 }, [])).toBe(25);
    expect(calculateProjectProgress({ progressMode: 'target_value', currentValue: 9, targetValue: 8 }, [])).toBe(100);
    expect(calculateProjectProgress({ progressMode: 'target_value', currentValue: 0, targetValue: 0 }, [])).toBeNull();
  });
});
