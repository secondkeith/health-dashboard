import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'health-nutrition-'));
let nutrition;
try {
  execFileSync('node_modules/.bin/tsc', ['src/nutrition.ts', '--outDir', output,
    '--module', 'commonjs', '--target', 'ES2020', '--skipLibCheck', '--strict']);
  nutrition = createRequire(import.meta.url)(join(output, 'nutrition.js'));
} finally {
  rmSync(output, { recursive: true, force: true });
}

test('calorie series uses complete known observations, retains real zero and daily values', () => {
  const days = [
    { date: '2026-10-01', calories: 2000 },
    { date: '2026-10-02', calories: null },
    { date: '2026-10-03', calories: 0, complete_day: true },
    { date: '2026-10-04', calories: 9000, complete_day: false },
    { date: '2026-10-05' },
  ];
  assert.equal(typeof nutrition.calorieTrend, 'function');
  const result = nutrition.calorieTrend(days);
  assert.equal(result.at(-1).calorieAverage, 1000);
  assert.equal(result.at(-1).calorieAverageCount, 2);
  assert.deepEqual(result.map(({ calorieAverage, calorieAverageCount, ...day }) => day), days);
});

test('series sorts dates without mutation and computes before visible range filtering', () => {
  const days = [
    { date: '2026-10-10', calories: 3000 },
    { date: '2026-10-01', calories: 9000 },
    { date: '2026-10-04', calories: 1000 },
    { date: '2026-10-20', calories: null },
    { date: '2026-10-21', calories: Infinity },
  ];
  const before = structuredClone(days);
  const series = nutrition.calorieTrend(days);
  assert.deepEqual(series.map(day => day.date), ['2026-10-01', '2026-10-04', '2026-10-10', '2026-10-20', '2026-10-21']);
  const visible = nutrition.rollingWindow(series, '2026-10-15');
  assert.equal(visible[0].calorieAverage, 2000);
  assert.equal(visible[0].calorieAverageCount, 2);
  assert.equal(series.at(-1).calorieAverage, null);
  assert.equal(series.at(-1).calorieAverageCount, 0);
  assert.deepEqual(days, before);
});

test('all three calorie charts expose the same labeled average and sample-aware tooltip', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.equal((app.match(/dataKey="calorieAverage"/g) ?? []).length, 3);
  assert.match(app, /7-day average \(kcal\/day\)/);
  assert.match(app, /calorieAverageCount/);
  assert.match(app, /rollingWindow\(calorieSeries, latestDay.date\)/);
  assert.match(app, /<ComposedChart/);
});

test('unknown macros are pending, not zero or fabricated percentages', () => {
  assert.equal(nutrition.formatMacro(null), 'Pending');
  assert.equal(nutrition.formatMacro(0), '0g');
  assert.equal(nutrition.macroPercentages({ protein: null, fat: 10, carbs: 20 }), null);
  assert.deepEqual(nutrition.macroPercentages({ protein: 10, fat: 10, carbs: 20 }),
    { protein: 25, fat: 25, carbs: 50 });
});

test('averages exclude unknown values and incomplete days, preserving true zero', () => {
  const days = [
    { date: '2026-10-01', protein: 20, complete_day: true },
    { date: '2026-10-02', protein: null, complete_day: true },
    { date: '2026-10-03', protein: 0, complete_day: true },
    { date: '2026-10-04', protein: 90, complete_day: false },
  ];
  assert.equal(nutrition.averageNutrient(days, 'protein'), 10);
  assert.equal(nutrition.averageNutrient(days.slice(1, 2), 'protein'), null);
  assert.equal(nutrition.averageNutrient(days.slice(3), 'protein'), null);
});

test('seven day window uses calendar dates, not seven widely separated logs', () => {
  const days = [{ date: '2026-06-30' }, { date: '2026-09-29' },
    { date: '2026-09-30' }, { date: '2026-10-06' }];
  assert.deepEqual(nutrition.rollingWindow(days, '2026-10-06'), days.slice(2));
});
