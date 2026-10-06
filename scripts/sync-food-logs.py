"""Refresh dashboard nutrition from canonical food logs; preserve activity and legacy days."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data_path = root / 'src/data/health-data.json'
data = json.loads(data_path.read_text())
days = {day['date']: day for day in data['days']}
for path in sorted((root / 'src/data/food-logs').glob('*.json')):
    log = json.loads(path.read_text())
    assert path.stem == log['date'], f'Date mismatch: {path}'
    items = log['items']
    day = days.setdefault(log['date'], {'date': log['date'], 'steps': None, 'caloriesBurned': None, 'restingHR': None})
    for nutrient in ('calories', 'protein', 'fat', 'carbs'):
        values = [item.get(nutrient) for item in items]
        day[nutrient] = sum(values) if all(isinstance(v, (float, int)) for v in values) else None
    day['meals'] = items
    if log.get('weight') is not None or 'weight' not in day:
        day['weight'] = log.get('weight')
    day.setdefault('workouts', log.get('workouts', []))
    day['nutrition_source'] = f'food-logs/{path.name}'
    day['macros_complete'] = all(day[n] is not None for n in ('protein', 'fat', 'carbs'))
    day['complete_day'] = log.get('complete_day', False)
data['days'] = sorted(days.values(), key=lambda day: day['date'])
data_path.write_text(json.dumps(data, indent=2) + '\n')
print(f'Synced food logs; {len(days)} dashboard days retained.')
