export type Nutrients = {
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
};

type NutritionDay = Nutrients & { date: string; complete_day?: boolean };

export const formatMacro = (value: number | null) => value === null ? 'Pending' : `${value}g`;

export const macroPercentages = ({ protein, fat, carbs }: Pick<Nutrients, 'protein' | 'fat' | 'carbs'>) => {
  if (protein === null || fat === null || carbs === null) return null;
  const total = protein + fat + carbs;
  if (!total) return null;
  return { protein: protein / total * 100, fat: fat / total * 100, carbs: carbs / total * 100 };
};

// Legacy days have no completeness flag; only explicitly incomplete days are excluded.
export const averageNutrient = (days: NutritionDay[], field: keyof Nutrients): number | null => {
  const values = days.filter(day => day.complete_day !== false)
    .map(day => day[field]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null;
};

export const rollingWindow = <T extends { date: string }>(days: T[], date: string): T[] => {
  const end = Date.parse(`${date}T00:00:00Z`);
  const start = end - 6 * 24 * 60 * 60 * 1000;
  return days.filter(day => {
    const time = Date.parse(`${day.date}T00:00:00Z`);
    return time >= start && time <= end;
  });
};
