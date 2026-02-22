#!/home/secondkeith/Projects/fitbit/.venv/bin/python
"""
Daily health dashboard updater.
Reads the day's food log from memory/health/YYYY-MM-DD.md,
pulls Fitbit data, appends to health-data.json, builds & deploys.
"""
import os, sys, re, json, subprocess
from datetime import date, timedelta
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
DASHBOARD_DIR = SCRIPT_DIR.parent
DATA_FILE = DASHBOARD_DIR / "src" / "data" / "health-data.json"
MEMORY_HEALTH_DIR = Path.home() / ".openclaw" / "workspace" / "memory" / "health"
FITBIT_DIR = Path.home() / "Projects" / "fitbit"

sys.path.insert(0, str(FITBIT_DIR))


def get_yesterday():
    """Default to yesterday since this runs after midnight."""
    return (date.today() - timedelta(days=1)).isoformat()


def parse_food_log(date_str):
    """Parse a memory/health/YYYY-MM-DD.md file into meals and totals."""
    log_file = MEMORY_HEALTH_DIR / f"{date_str}.md"
    if not log_file.exists():
        print(f"No food log found for {date_str}")
        return None, None

    content = log_file.read_text()
    meals = []
    totals = {"calories": 0, "protein": 0, "fat": 0, "carbs": 0}

    # Parse daily totals line if present
    totals_match = re.search(
        r"\*\*(?:Daily totals|Running total)[^*]*\*\*[:\s]*~?([\d,]+)\s*cal.*?~?([\d.]+)g\s*protein",
        content, re.IGNORECASE
    )
    if totals_match:
        totals["calories"] = int(totals_match.group(1).replace(",", ""))
        totals["protein"] = int(float(totals_match.group(2)))

    # Try to get fat and carbs from totals line
    fat_match = re.search(
        r"\*\*(?:Daily totals|Running total)[^*]*\*\*.*?~?([\d.]+)g\s*fat",
        content, re.IGNORECASE
    )
    carbs_match = re.search(
        r"\*\*(?:Daily totals|Running total)[^*]*\*\*.*?~?([\d.]+)g\s*carb",
        content, re.IGNORECASE
    )
    if fat_match:
        totals["fat"] = int(float(fat_match.group(1)))
    if carbs_match:
        totals["carbs"] = int(float(carbs_match.group(1)))

    # Parse individual meal items: lines starting with "- **item name**"
    current_time = ""
    # Find section headers with times like "## Lunch" or "## Evening Snacks (~4:30 PM)"
    sections = re.split(r'^## ', content, flags=re.MULTILINE)

    for section in sections:
        # Extract time from section header
        time_match = re.match(r'.*?\(~?([\d:]+\s*(?:AM|PM|am|pm)?)\)', section)
        section_name_match = re.match(r'(\w[\w\s&]*)', section)

        if time_match:
            current_time = time_match.group(1).strip()
        elif section_name_match:
            current_time = section_name_match.group(1).strip()

        # Find food items in two formats:
        # Format 1: "- **name** — Xcal, Xg protein, ..."
        # Format 2: "- **name** (...)\n  - ~Xcal, ~Xg protein, ..."
        lines = section.split('\n')
        i = 0
        while i < len(lines):
            line = lines[i]

            # Match a bold food item
            item_match = re.match(r'\s*-\s+\*\*(.+?)\*\*', line)
            if item_match:
                name = item_match.group(1).strip()
                cal = 0
                protein = 0
                fat = 0
                carbs = 0

                # Check if calories are on this line (Format 1)
                cal_on_line = re.search(r'[—\-]+\s*~?([\d,]+)\s*cal', line)
                if cal_on_line:
                    parse_line = line
                    cal = int(cal_on_line.group(1).replace(",", ""))
                else:
                    # Check next line for sub-bullet with calories (Format 2)
                    if i + 1 < len(lines):
                        next_line = lines[i + 1]
                        sub_cal = re.match(r'\s+-\s+~?([\d,]+)\s*cal', next_line)
                        if sub_cal:
                            parse_line = next_line
                            cal = int(sub_cal.group(1).replace(",", ""))
                            i += 1  # consume the sub-bullet
                        else:
                            # No calories found, skip (e.g. "Ice water")
                            i += 1
                            continue
                    else:
                        i += 1
                        continue

                p_match = re.search(r'([\d.]+)g\s*protein', parse_line)
                f_match = re.search(r'([\d.]+)g\s*fat', parse_line)
                c_match = re.search(r'([\d.]+)g\s*carb', parse_line)

                if p_match:
                    protein = int(float(p_match.group(1)))
                if f_match:
                    fat = int(float(f_match.group(1)))
                if c_match:
                    carbs = int(float(c_match.group(1)))

                meals.append({
                    "time": current_time,
                    "name": name,
                    "calories": cal,
                    "protein": protein,
                    "fat": fat,
                    "carbs": carbs
                })
            i += 1

    # Fill in any missing totals from meal sums
    if meals:
        meal_cal = sum(m["calories"] for m in meals)
        meal_pro = sum(m["protein"] for m in meals)
        meal_fat = sum(m["fat"] for m in meals)
        meal_carb = sum(m["carbs"] for m in meals)
        if totals["calories"] == 0:
            totals["calories"] = meal_cal
        if totals["protein"] == 0:
            totals["protein"] = meal_pro
        if totals["fat"] == 0:
            totals["fat"] = meal_fat
        if totals["carbs"] == 0:
            totals["carbs"] = meal_carb

    return meals, totals


def parse_workouts(date_str):
    """Parse workout entries from the food log (they're in the same file)."""
    log_file = MEMORY_HEALTH_DIR / f"{date_str}.md"
    if not log_file.exists():
        return []

    content = log_file.read_text()
    workouts = []

    # Look for workout section
    workout_section = re.search(r'## Workout.*?\n(.*?)(?=\n## |\Z)', content, re.DOTALL | re.IGNORECASE)
    if not workout_section:
        return []

    # Parse exercise lines like "1. Pectoral Fly (Life Fitness) — 70 lbs, 4×10"
    for line in workout_section.group(1).split('\n'):
        ex_match = re.match(
            r'\s*\d+\.\s+(.+?)\s*(?:\(.*?\))?\s*[—\-]+\s*(\d+)\s*(?:lbs?|pounds?)',
            line
        )
        if ex_match:
            name = ex_match.group(1).strip()
            weight = int(ex_match.group(2))

            sets_match = re.search(r'(\d+)\s*[×x]\s*(\d+)', line)
            sets = int(sets_match.group(1)) if sets_match else 0
            reps = sets_match.group(2) if sets_match else "0"

            # Check for variable reps like "3 sets (10, 10, 6)"
            var_reps = re.search(r'sets?\s*\(([^)]+)\)', line)
            if var_reps:
                reps = var_reps.group(1).replace(" ", "")

            workouts.append({
                "name": name,
                "weight": weight,
                "sets": sets,
                "reps": reps
            })

    return workouts


def get_fitbit_data(date_str):
    """Pull Fitbit stats for the given date."""
    try:
        from fitbit_api import api_get

        activity = api_get(f'/1/user/-/activities/date/{date_str}.json')
        summary = activity.get('summary', {})

        sleep_data = api_get(f'/1.2/user/-/sleep/date/{date_str}.json')
        sleep_minutes = sleep_data.get('summary', {}).get('totalMinutesAsleep', 0)

        # Get weight if logged
        weight_data = api_get(f'/1/user/-/body/log/weight/date/{date_str}.json')
        weight_entries = weight_data.get('weight', [])
        weight = weight_entries[0]['weight'] if weight_entries else None
        # Fitbit returns weight in user's unit (lbs for US)

        return {
            "steps": summary.get('steps', 0),
            "caloriesBurned": summary.get('caloriesOut', 0),
            "restingHR": summary.get('restingHeartRate', None),
            "activeMinutes": summary.get('fairlyActiveMinutes', 0) + summary.get('veryActiveMinutes', 0),
            "sleepMinutes": sleep_minutes,
            "weight": weight
        }
    except Exception as e:
        print(f"Fitbit API error: {e}")
        return {
            "steps": 0,
            "caloriesBurned": 0,
            "restingHR": None,
            "activeMinutes": 0,
            "sleepMinutes": 0,
            "weight": None
        }


def update_dashboard(date_str):
    """Main update function."""
    print(f"Updating health dashboard for {date_str}...")

    # Load existing data
    with open(DATA_FILE) as f:
        data = json.load(f)

    # Check if date already exists
    existing_dates = [d["date"] for d in data["days"]]
    if date_str in existing_dates:
        print(f"{date_str} already in dashboard, skipping.")
        return False

    # Parse food log
    meals, totals = parse_food_log(date_str)
    if meals is None:
        print(f"No data for {date_str}, skipping.")
        return False

    # Parse workouts
    workouts = parse_workouts(date_str)

    # Get Fitbit data
    fitbit = get_fitbit_data(date_str)

    # Build entry
    entry = {
        "date": date_str,
        "weight": fitbit["weight"],
        "calories": totals["calories"],
        "protein": totals["protein"],
        "fat": totals["fat"],
        "carbs": totals["carbs"],
        "steps": fitbit["steps"],
        "caloriesBurned": fitbit["caloriesBurned"],
        "restingHR": fitbit["restingHR"],
        "activeMinutes": fitbit["activeMinutes"],
        "sleepMinutes": fitbit["sleepMinutes"],
        "meals": [{"time": m["time"], "name": m["name"], "calories": m["calories"],
                    "protein": m["protein"], "fat": m["fat"], "carbs": m["carbs"]} for m in meals],
        "workouts": workouts
    }

    # Append and save
    data["days"].append(entry)
    data["days"].sort(key=lambda d: d["date"])

    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"Added {date_str} to health-data.json")

    # Build and deploy
    print("Building dashboard...")
    subprocess.run(["npm", "run", "build"], cwd=DASHBOARD_DIR, check=True)
    print("Deploying to GitHub Pages...")
    subprocess.run(["npm", "run", "deploy"], cwd=DASHBOARD_DIR, check=True)
    print("Done!")
    return True


if __name__ == "__main__":
    target_date = sys.argv[1] if len(sys.argv) > 1 else get_yesterday()
    update_dashboard(target_date)
