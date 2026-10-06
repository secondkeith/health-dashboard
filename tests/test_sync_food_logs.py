"""Exercise the real sync CLI in an isolated fixture, never personal food logs."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SyncFoodLogsTests(unittest.TestCase):
    def test_canonical_replacement_preserves_activity_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'scripts').mkdir()
            (root / 'src/data/food-logs').mkdir(parents=True)
            script = root / 'scripts/sync-food-logs.py'
            shutil.copy(ROOT / 'scripts/sync-food-logs.py', script)
            target = root / 'src/data/health-data.json'
            activity = {'weight': 200, 'steps': 1234, 'caloriesBurned': 2500,
                        'restingHR': 62, 'workouts': [{'name': 'Walk'}]}
            legacy = {'date': '2026-01-01', 'calories': 100, 'meals': []}
            target.write_text(json.dumps({'metadata': 'retained', 'days': [legacy,
                {'date': '2026-01-02', 'calories': 999, 'meals': [{'name': 'stale'}], **activity}]}))
            item = {'id': 'meal', 'name': 'Fixture meal', 'calories': 123,
                    'protein': None, 'fat': 0, 'carbs': 10}
            log = {'date': '2026-01-02', 'items': [item], 'weight': None,
                   'complete_day': False, 'workouts': []}
            (root / 'src/data/food-logs/2026-01-02.json').write_text(json.dumps(log))
            subprocess.run(['python3', str(script)], check=True, capture_output=True)
            first = target.read_bytes()
            subprocess.run(['python3', str(script)], check=True, capture_output=True)
            self.assertEqual(target.read_bytes(), first)
            data = json.loads(first)
            self.assertEqual(data['metadata'], 'retained')
            self.assertEqual(len(data['days']), 2)
            self.assertEqual(data['days'][0], legacy)
            day = data['days'][1]
            self.assertEqual(day['meals'], [item])
            self.assertEqual(day['calories'], 123)
            self.assertIsNone(day['protein'])
            self.assertEqual(day['fat'], 0)
            self.assertFalse(day['macros_complete'])
            self.assertFalse(day['complete_day'])
            for field, value in activity.items():
                self.assertEqual(day[field], value)

    def test_build_regenerates_nutrition_before_compiling(self):
        package = json.loads((ROOT / 'package.json').read_text())
        self.assertIn('sync-food-logs.py', package['scripts'].get('sync:food', ''))
        self.assertEqual(package['scripts'].get('prebuild'), 'npm run sync:food')


if __name__ == '__main__':
    unittest.main()
