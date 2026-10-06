# Local development and nutrition data

- `src/data/food-logs/*.json` is canonical nutrition input. Edit those logs, not the derived nutrition fields in `src/data/health-data.json`.
- `npm run sync:food` regenerates the aggregate with `scripts/sync-food-logs.py`. It replaces each canonical day's nutrition/meals while retaining legacy days, activity and workouts.
- `npm run build` automatically runs that sync before TypeScript and Vite. Python 3 and the Node dependencies are required.
- For development, run `npm run sync:food` before `npm run dev` after editing food logs.
- `npm test` uses isolated synthetic fixtures for the real sync CLI and compiles/tests the UI nutrition helpers; no food-log files are modified by tests.
- `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` serves the production build locally at `/health-dashboard/`.

The HTML entry points to `src/main.tsx`, not a previous hashed production bundle. `src/index.css` imports the existing checked-in stylesheet to preserve the dashboard's appearance, plus a chart-sizing fix; the old compiled JS is not used by the source build.

Unknown nutrients stay `null`: the UI displays Pending, omits unknown chart values and suppresses unavailable macro percentages. Rolling averages use actual seven-calendar-day windows, known values only, and exclude explicitly incomplete days. Legacy records without completeness metadata remain eligible. Incomplete-day calorie totals describe logged intake, not a full day's intake or target deficit.

## Verification performed locally

- `npm test`: 2 Python integration tests and 3 Node nutrition tests passed.
- `npm run build`: successful; 648 modules transformed. Vite reports a nonblocking >500 kB bundle-size warning.
- Real aggregate resync was byte-identical, with 42 unique dates; all activity/workout fields from 38 staged-baseline dates were preserved.
- Production preview returned HTTP 200. Browser checks passed for Dashboard, Nutrition, Activity, Workouts and Next Workout, with zero console messages or JavaScript errors.
- Browser assertions verified pending macro labels, no fabricated pie, incomplete-day totals, no NaN and chart bounds within their cards.

Build output includes personal health data. Keep it local unless publication is separately authorized. No commit, push or deployment was performed.
