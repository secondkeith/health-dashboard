import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
