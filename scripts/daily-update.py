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


def parse_nutrition_line(name, nut_text, time):
    """Extract calories/protein/fat/carbs from a nutrition string."""
    cal_match = re.search(r'~?([\d,]+)\s*cal', nut_text, re.IGNORECASE)
    if not cal_match:
        return None  # Skip items without calories
    
    cal = int(cal_match.group(1).replace(",", ""))
    
    p_match = re.search(r'([\d.]+)g?\s*protein', nut_text, re.IGNORECASE)
    f_match = re.search(r'([\d.]+)g?\s*fat', nut_text, re.IGNORECASE)
    c_match = re.search(r'([\d.]+)g?\s*carb', nut_text, re.IGNORECASE)
    
    protein = int(float(p_match.group(1))) if p_match else 0
    fat = int(float(f_match.group(1))) if f_match else 0
    carbs = int(float(c_match.group(1))) if c_match else 0
    
    return {
        "time": time,
        "name": name,
        "calories": cal,
        "protein": protein,
        "fat": fat,
        "carbs": carbs
    }


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

    # Parse individual meal items in multiple formats:
    # Format A (old): ## Section\n- **Item** — Xcal, Xg protein
    # Format B (new): ### HH:MM\n- Item\n  - Xcal, Xg protein
    # Format C (newer): ### HH:MM — Item\n- Xcal, Xg protein
    
    lines = content.split('\n')
    i = 0
    current_time = ""
    
    while i < len(lines):
        line = lines[i].strip()
        
        # Check for section headers with times
        # ### 12:49 PM or ### Afternoon (12:49 PM) or ## Lunch
        time_header = re.match(r'^###+\s*(.+?)(?:\s*—\s*(.+?))?$', line)
        if time_header:
            header_text = time_header.group(1).strip()
            item_on_header = time_header.group(2)  # For "### 12:49 — Item" format
            
            # Extract time from header
            time_match = re.search(r'(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)', header_text)
            if time_match:
                current_time = time_match.group(1).strip()
            else:
                # Use header text as section name if no time
                current_time = header_text
            
            # If item is on the same line as the header (Format C or D)
            if item_on_header:
                # Look for nutrition on next line(s)
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    
                    # Format D: - **Calories:** 320 (multi-line with bold labels)
                    if next_line.startswith('- **'):
                        cal = protein = fat = carbs = 0
                        j = i + 1
                        while j < len(lines) and lines[j].strip().startswith('- **'):
                            nutrient_line = lines[j].strip()
                            cal_match = re.search(r'\*\*Calories:\*\*\s*([\d,]+)', nutrient_line)
                            pro_match = re.search(r'\*\*Protein:\*\*\s*([\d.]+)g?', nutrient_line)
                            fat_match = re.search(r'\*\*Fat:\*\*\s*([\d.]+)g?', nutrient_line)
                            carb_match = re.search(r'\*\*Carbs:\*\*\s*([\d.]+)g?', nutrient_line)
                            
                            if cal_match:
                                cal = int(cal_match.group(1).replace(",", ""))
                            if pro_match:
                                protein = int(float(pro_match.group(1)))
                            if fat_match:
                                fat = int(float(fat_match.group(1)))
                            if carb_match:
                                carbs = int(float(carb_match.group(1)))
                            j += 1
                        
                        if cal > 0:
                            meals.append({
                                "time": current_time,
                                "name": item_on_header,
                                "calories": cal,
                                "protein": protein,
                                "fat": fat,
                                "carbs": carbs
                            })
                        i = j
                        continue
                    
                    # Format C: - Xcal, Xg protein (single line)
                    nut_match = re.match(r'^-\s*(.+)', next_line)
                    if nut_match:
                        nut_text = nut_match.group(1)
                        meal = parse_nutrition_line(item_on_header, nut_text, current_time)
                        if meal:
                            meals.append(meal)
                        i += 2
                        continue
            i += 1
            continue
        
        # Format A: - **Item** — Xcal, Xg protein (bold item, nutrition on same line)
        bold_item = re.match(r'^-\s+\*\*(.+?)\*\*\s*[—\-]+\s*(.+)', line)
        if bold_item:
            name = bold_item.group(1).strip()
            nut_text = bold_item.group(2)
            meal = parse_nutrition_line(name, nut_text, current_time)
            if meal:
                meals.append(meal)
            i += 1
            continue
        
        # Format B: - Item (not bold, nutrition on next line as sub-bullet)
        # or **Time** - Item (with time prefix)
        item_match = re.match(r'^(?:\*\*[\d:APM\s]+\*\*\s*-\s*|\*\*[\d:APM\s]+\*\*|\-\s+)(.+?)$', line)
        if item_match and not line.startswith('  -'):
            name = item_match.group(1).strip()
            # Remove trailing dashes if present
            name = re.sub(r'\s*—.*$', '', name)
            
            # Look for nutrition on next line (sub-bullet)
            if i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if next_line.startswith('-'):
                    nut_text = next_line.lstrip('- ').strip()
                    meal = parse_nutrition_line(name, nut_text, current_time)
                    if meal:
                        meals.append(meal)
                    i += 2
                    continue
        
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


def parse_weight(date_str):
    """Extract weight from markdown file if present."""
    log_file = MEMORY_HEALTH_DIR / f"{date_str}.md"
    if not log_file.exists():
        return None
    
    content = log_file.read_text()
    
    # Look for weight patterns:
    # ## Weight\n**Morning:** 277.6 lbs
    # ## Weight\n- 277.6 lbs
    # **Weight:** 277.6 lbs
    weight_match = re.search(r'(?:##\s*Weight|Weight:)[^\d]*([\d.]+)\s*lbs?', content, re.IGNORECASE)
    if weight_match:
        return float(weight_match.group(1))
    
    return None


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

    # Get weight from Fitbit or fall back to markdown
    weight = fitbit["weight"]
    if weight is None:
        weight = parse_weight(date_str)

    # Build entry
    entry = {
        "date": date_str,
        "weight": weight,
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
