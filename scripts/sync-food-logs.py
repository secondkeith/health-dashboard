#!/usr/bin/env python3
"""
Sync food-logs/*.json into health-data.json
Runs automatically to keep dashboard current.
"""
import json, subprocess
from pathlib import Path
from datetime import datetime

REPO_DIR = Path(__file__).parent.parent
FOOD_DIR = REPO_DIR / "src/data/food-logs"
DATA_FILE = REPO_DIR / "src/data/health-data.json"

# Load health data
with open(DATA_FILE) as f:
    health_data = json.load(f)

# Process all food log files
changed = False
for log_file in sorted(FOOD_DIR.glob("*.json")):
    with open(log_file) as f:
        food_log = json.load(f)
    
    target_date = food_log['date']
    
    # Find or create day entry
    day_entry = None
    for day in health_data['days']:
        if day['date'] == target_date:
            day_entry = day
            break
    
    if not day_entry:
        # Create new entry with empty Fitbit data
        day_entry = {
            'date': target_date,
            'weight': None,
            'calories': 0,
            'protein': 0,
            'fat': 0,
            'carbs': 0,
            'steps': None,
            'caloriesBurned': None,
            'restingHR': None,
            'activeMinutes': None,
            'sleepMinutes': None,
            'meals': [],
            'workouts': []
        }
        health_data['days'].append(day_entry)
        health_data['days'].sort(key=lambda d: d['date'])
    
    # Update from food log
    if food_log.get('weight'):
        if day_entry['weight'] != food_log['weight']:
            day_entry['weight'] = food_log['weight']
            changed = True
    
    # Calculate totals
    total_cal = sum(item['calories'] for item in food_log['items'])
    total_prot = sum(item['protein'] for item in food_log['items'])
    total_fat = sum(item['fat'] for item in food_log['items'])
    total_carbs = sum(item['carbs'] for item in food_log['items'])
    
    if (day_entry['calories'] != total_cal or 
        day_entry['protein'] != total_prot or
        day_entry['meals'] != food_log['items'] or
        day_entry['workouts'] != food_log['workouts']):
        day_entry['calories'] = total_cal
        day_entry['protein'] = total_prot
        day_entry['fat'] = round(total_fat)
        day_entry['carbs'] = total_carbs
        day_entry['meals'] = food_log['items']
        day_entry['workouts'] = food_log['workouts']
        changed = True

if changed:
    # Write updated health data
    with open(DATA_FILE, 'w') as f:
        json.dump(health_data, f, indent=2)
        f.write('\n')
    
    # Git commit and push
    subprocess.run(['git', 'add', 'src/data/'], cwd=REPO_DIR, check=True)
    result = subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=REPO_DIR)
    if result.returncode != 0:
        subprocess.run(['git', 'commit', '-m', f'Auto-sync food logs {datetime.now().strftime("%Y-%m-%d %H:%M")}'], cwd=REPO_DIR, check=True)
        subprocess.run(['git', 'push'], cwd=REPO_DIR, check=True)
        print(f"✓ Synced and pushed food logs to dashboard")
    else:
        print("No changes to sync")
else:
    print("No changes to sync")
