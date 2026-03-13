#!/usr/bin/env python3
"""
Nightly health dashboard update.
- Pulls Fitbit data for yesterday (or --date YYYY-MM-DD)
- Parses food log from memory/health/YYYY-MM-DD.md
- Updates src/data/health-data.json
- Commits and pushes to GitHub
"""
import os, sys, json, re, subprocess
from datetime import date, timedelta
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
REPO_DIR = SCRIPT_DIR.parent
DATA_FILE = REPO_DIR / "src" / "data" / "health-data.json"
HEALTH_DIR = Path.home() / ".openclaw" / "workspace" / "memory" / "health"
FITBIT_DIR = Path.home() / "Projects" / "fitbit"

sys.path.insert(0, str(FITBIT_DIR))

def get_fitbit_data(target_date: str) -> dict:
    """Pull Fitbit activity, sleep, and HR for a date."""
    try:
        # Ensure FITBIT env vars are set (vault injects them)
        if 'FITBIT_CLIENT_ID' not in os.environ:
            for vault_name, env_name in [('fitbit_client_id', 'FITBIT_CLIENT_ID'), ('fitbit_client_secret', 'FITBIT_CLIENT_SECRET')]:
                result = subprocess.run(
                    [str(Path.home() / "bin" / "vault"), "env", vault_name, env_name, "env"],
                    capture_output=True, text=True
                )
                for line in result.stdout.strip().split('\n'):
                    if '=' in line and line.startswith('FITBIT_'):
                        k, v = line.split('=', 1)
                        os.environ[k] = v

        from fitbit_api import api_get

        activity = api_get(f'/1/user/-/activities/date/{target_date}.json')
        summary = activity.get('summary', {})

        sleep_data = api_get(f'/1.2/user/-/sleep/date/{target_date}.json')
        sleep_summary = sleep_data.get('summary', {})
        total_sleep = sleep_summary.get('totalMinutesAsleep', 0)

        return {
            'steps': summary.get('steps', 0),
            'caloriesBurned': summary.get('caloriesOut', 0),
            'restingHR': summary.get('restingHeartRate'),
            'activeMinutes': summary.get('fairlyActiveMinutes', 0) + summary.get('veryActiveMinutes', 0),
            'sleepMinutes': total_sleep,
        }
    except Exception as e:
        print(f"Warning: Fitbit API error: {e}", file=sys.stderr)
        return {
            'steps': None,
            'caloriesBurned': None,
            'restingHR': None,
            'activeMinutes': None,
            'sleepMinutes': None,
        }


def parse_food_log(target_date: str) -> dict:
    """Parse a memory/health/YYYY-MM-DD.md food log into structured data."""
    log_file = HEALTH_DIR / f"{target_date}.md"
    if not log_file.exists():
        return {'meals': [], 'workouts': [], 'weight': None, 'calories': 0, 'protein': 0, 'fat': 0, 'carbs': 0}

    content = log_file.read_text()
    meals = []
    workouts = []
    weight = None
    total_cal = 0
    total_protein = 0
    total_fat = 0
    total_carbs = 0

    # Extract weight
    weight_match = re.search(r'\*\*(\d+\.?\d*)\s*lbs?\*\*', content)
    if weight_match:
        weight = float(weight_match.group(1))

    # NEW FORMAT: Parse ## Time - Item headers with bullet nutrition
    # Example: ## 6:41 PM - Tortilla\n- 60 calories\n- 7g protein
    header_sections = re.split(r'^##\s+(.+?)\s+-\s+(.+?)$', content, flags=re.MULTILINE)
    for i in range(1, len(header_sections), 3):
        if i+1 >= len(header_sections):
            break
        time_str = header_sections[i].strip()
        item_name = header_sections[i+1].strip()
        section_text = header_sections[i+2] if i+2 < len(header_sections) else ""
        
        # Extract nutrition from bullet list in this section
        cal_match = re.search(r'(\d+)\s*calories?', section_text, re.IGNORECASE)
        prot_match = re.search(r'(\d+\.?\d*)\s*g\s*protein', section_text, re.IGNORECASE)
        fat_match = re.search(r'(\d+\.?\d*)\s*g\s*fat', section_text, re.IGNORECASE)
        carb_match = re.search(r'(\d+\.?\d*)\s*g\s*carb', section_text, re.IGNORECASE)
        
        if cal_match:
            cal = int(cal_match.group(1))
            protein = int(float(prot_match.group(1))) if prot_match else 0
            fat = float(fat_match.group(1)) if fat_match else 0
            carbs = int(float(carb_match.group(1))) if carb_match else 0
            
            meals.append({
                'time': time_str,
                'name': item_name,
                'calories': cal,
                'protein': protein,
                'fat': fat,
                'carbs': carbs
            })
            total_cal += cal
            total_protein += protein
            total_fat += fat
            total_carbs += carbs
    
    # MID FORMAT: **Time** - Meal with detailed items
    # Pattern: **12:04 PM** - Lunch\n- Item: ... (290 cal, 10g protein, ...)
        # Pattern 1: **12:04 PM** - Lunch\n- Item: ... (290 cal, 10g protein, ...)
        time_meals = re.finditer(
            r'\*\*(\d+:\d+\s*[AP]M)\*\*\s*-\s*(.+?)$',
            content, re.MULTILINE
        )
        for tm in time_meals:
            time_str = tm.group(1).strip()
            meal_type = tm.group(2).strip()
            # Find the section after this header until the next header or end
            pos = tm.end()
            next_header = re.search(r'\n\*\*\d+:\d+\s*[AP]M\*\*', content[pos:])
            section_end = pos + next_header.start() if next_header else len(content)
            section = content[pos:section_end]
            
            # Parse all items in this meal section
            item_lines = re.finditer(
                r'^-\s+(.+?):\s*(.+?)\((\d+)\s*cal,\s*(\d+\.?\d*)g\s*protein,\s*(\d+\.?\d*)g\s*carbs,\s*(\d+\.?\d*)g\s*fat\)',
                section, re.MULTILINE
            )
            for item in item_lines:
                item_name = item.group(1).strip()
                cal = int(item.group(3))
                protein = int(float(item.group(4)))
                carbs = int(float(item.group(5)))
                fat = float(item.group(6))
                
                meals.append({
                    'time': time_str,
                    'name': f"{meal_type}: {item_name}",
                    'calories': cal,
                    'protein': protein,
                    'fat': fat,
                    'carbs': carbs
                })
                total_cal += cal
                total_protein += protein
                total_fat += fat
                total_carbs += carbs
    
    # Pattern 2: Simple "- **Name** — Xcal, Xg protein"
    if not meals:
        meal_lines = re.finditer(
            r'^-\s+(?:\*\*)?(.+?)(?:\*\*)?\s*—\s*(.+)$',
            content, re.MULTILINE
        )
        
        for ml in meal_lines:
            name = ml.group(1).strip()
            info = ml.group(2).strip()
            
            if ml.group(0).startswith('  '):
                continue
                
            cal_match = re.search(r'~?(\d+)\s*cal', info, re.IGNORECASE)
            prot_match = re.search(r'~?(\d+\.?\d*)\s*g?\s*protein', info, re.IGNORECASE)
            fat_match = re.search(r'~?(\d+\.?\d*)\s*g?\s*fat', info, re.IGNORECASE)
            carb_match = re.search(r'~?(\d+\.?\d*)\s*g?\s*carb', info, re.IGNORECASE)
            
            if cal_match:
                cal = int(cal_match.group(1))
                protein = int(float(prot_match.group(1))) if prot_match else 0
                fat = float(fat_match.group(1)) if fat_match else 0
                carbs = int(float(carb_match.group(1))) if carb_match else 0
                
                meals.append({
                    'time': '',
                    'name': name,
                    'calories': cal,
                    'protein': protein,
                    'fat': fat,
                    'carbs': carbs
                })
                total_cal += cal
                total_protein += protein
                total_fat += fat
                total_carbs += carbs
    
    # Final fallback: use "Running total" line if present
    if not meals or total_cal == 0:
        running = re.search(r'Running total.*?~?(\d+)\s*cal.*?(\d+)\s*g?\s*protein', content, re.IGNORECASE)
        if running:
            total_cal = int(running.group(1))
            total_protein = int(running.group(2))

    # Extract workouts — formats:
    # "1. Pectoral Fly (Life Fitness) — 70 lbs, 4×10"
    # "1. Lateral Raise (Matrix) — 80 lbs, 3 sets (10, 10, 6)"
    workout_pattern = re.compile(
        r'^\d+\.\s+(.+?)\s*(?:\(.*?\))?\s*—\s*(\d+)\s*lbs?,?\s*(\d+)[×x](\d+)',
        re.IGNORECASE | re.MULTILINE
    )
    workout_sets_pattern = re.compile(
        r'^\d+\.\s+(.+?)\s*(?:\(.*?\))?\s*—\s*(\d+)\s*lbs?,?\s*(\d+)\s*sets?\s*\(([^)]+)\)',
        re.IGNORECASE | re.MULTILINE
    )
    seen_workouts = set()
    for m in workout_pattern.finditer(content):
        name = m.group(1).strip()
        if name not in seen_workouts:
            seen_workouts.add(name)
            workouts.append({
                'name': name,
                'weight': int(m.group(2)),
                'sets': int(m.group(3)),
                'reps': int(m.group(4))
            })
    for m in workout_sets_pattern.finditer(content):
        name = m.group(1).strip()
        if name not in seen_workouts:
            seen_workouts.add(name)
            reps_str = m.group(4).strip()
            workouts.append({
                'name': name,
                'weight': int(m.group(2)),
                'sets': int(m.group(3)),
                'reps': reps_str
            })

    return {
        'meals': meals,
        'workouts': workouts,
        'weight': weight,
        'calories': total_cal,
        'protein': total_protein,
        'fat': round(total_fat),
        'carbs': total_carbs
    }


def update_dashboard(target_date: str):
    """Main update function."""
    print(f"Updating health dashboard for {target_date}...")

    # Load existing data
    with open(DATA_FILE) as f:
        data = json.load(f)

    # Check if date already exists
    existing_idx = None
    for i, day in enumerate(data['days']):
        if day['date'] == target_date:
            existing_idx = i
            break

    # Get data
    fitbit = get_fitbit_data(target_date)
    food = parse_food_log(target_date)

    day_entry = {
        'date': target_date,
        'weight': food['weight'],
        'calories': food['calories'],
        'protein': food['protein'],
        'fat': food['fat'],
        'carbs': food['carbs'],
        'steps': fitbit['steps'],
        'caloriesBurned': fitbit['caloriesBurned'],
        'restingHR': fitbit['restingHR'],
        'activeMinutes': fitbit['activeMinutes'],
        'sleepMinutes': fitbit['sleepMinutes'],
        'meals': food['meals'],
        'workouts': food['workouts'],
    }

    if existing_idx is not None:
        data['days'][existing_idx] = day_entry
        print(f"Updated existing entry for {target_date}")
    else:
        data['days'].append(day_entry)
        data['days'].sort(key=lambda d: d['date'])
        print(f"Added new entry for {target_date}")

    # Write
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

    print(f"  Calories: {food['calories']}, Protein: {food['protein']}g")
    print(f"  Meals: {len(food['meals'])}, Workouts: {len(food['workouts'])}")
    print(f"  Steps: {fitbit['steps']}, Burned: {fitbit['caloriesBurned']}, HR: {fitbit['restingHR']}")
    print(f"  Sleep: {fitbit['sleepMinutes']}min, Active: {fitbit['activeMinutes']}min")

    # Git commit and push
    os.chdir(REPO_DIR)
    subprocess.run(['git', 'add', 'src/data/health-data.json'], check=True)
    result = subprocess.run(['git', 'diff', '--cached', '--quiet'])
    if result.returncode != 0:
        subprocess.run(['git', 'commit', '-m', f'Update health data for {target_date}'], check=True)
        subprocess.run(['git', 'push'], check=True)
        print(f"Pushed update for {target_date}")
    else:
        print("No changes to commit")


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else (date.today() - timedelta(days=1)).isoformat()
    update_dashboard(target)
