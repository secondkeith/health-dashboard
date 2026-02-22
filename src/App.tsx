import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import healthData from './data/health-data.json';

type Meal = {
  time: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
};

type Workout = {
  name: string;
  weight: number;
  sets: number;
  reps: number | string;
};

type Day = {
  date: string;
  weight: number | null;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  steps: number | null;
  caloriesBurned: number | null;
  restingHR: number | null;
  meals: Meal[];
  workouts: Workout[];
};

type View = 'Dashboard' | 'Nutrition' | 'Activity' | 'Workouts' | 'Next Workout';

const views: View[] = ['Dashboard', 'Nutrition', 'Activity', 'Workouts', 'Next Workout'];
// Caloric targets based on Keith's stats: Male, 48yo, 5'9", 285 lbs
// BMR (Mifflin-St Jeor): ~2,150 cal | TDEE (sedentary): ~3,010 cal
// Moderate deficit zone: 2,000 - 2,500 cal/day for steady weight loss
const targetCalories = { min: 2000, max: 2500 };
const bmr = 2150;

const formatShortDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const formatFullDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const parseReps = (value: number | string): number => {
  if (typeof value === 'number') {
    return value;
  }

  return value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((sum, n) => sum + n, 0);
};

const macroPercentages = (day: Day) => {
  const total = day.protein + day.fat + day.carbs;
  if (!total) {
    return { protein: 0, fat: 0, carbs: 0 };
  }

  return {
    protein: (day.protein / total) * 100,
    fat: (day.fat / total) * 100,
    carbs: (day.carbs / total) * 100,
  };
};

const App = () => {
  const [view, setView] = useState<View>('Dashboard');
  const [expandedDate, setExpandedDate] = useState<string | null>(healthData.days[healthData.days.length - 1]?.date ?? null);

  const days = useMemo(() => (healthData.days as Day[]).slice().sort((a, b) => a.date.localeCompare(b.date)), []);
  if (!days.length) {
    return <div className="p-6 text-slate-200">No health data found.</div>;
  }

  const latestDay = days[days.length - 1];

  const caloriesData = days.slice(-7).map((day) => ({
    date: formatShortDate(day.date),
    calories: day.calories,
    inRange: day.calories >= targetCalories.min && day.calories <= targetCalories.max,
  }));

  const macroTrendData = days.map((day) => ({
    date: formatShortDate(day.date),
    protein: day.protein,
    fat: day.fat,
    carbs: day.carbs,
  }));

  const weightTrendData = days
    .filter((day) => day.weight !== null)
    .map((day) => ({
      date: formatShortDate(day.date),
      weight: day.weight,
    }));

  const activityData = days.map((day) => ({
    date: formatShortDate(day.date),
    steps: day.steps,
    consumed: day.calories,
    burned: day.caloriesBurned,
    restingHR: day.restingHR,
  }));

  const rollingAverages = days.map((_, idx) => {
    const start = Math.max(0, idx - 6);
    const window = days.slice(start, idx + 1);
    const avg = (field: keyof Pick<Day, 'calories' | 'protein' | 'fat' | 'carbs'>) =>
      window.reduce((sum, day) => sum + day[field], 0) / window.length;

    return {
      date: formatShortDate(days[idx].date),
      calories: Number(avg('calories').toFixed(1)),
      protein: Number(avg('protein').toFixed(1)),
      fat: Number(avg('fat').toFixed(1)),
      carbs: Number(avg('carbs').toFixed(1)),
    };
  });

  const volumeData = useMemo(() => {
    const byDateExercise = days.flatMap((day) =>
      day.workouts.map((workout) => ({
        date: formatShortDate(day.date),
        exercise: workout.name,
        volume: workout.sets * workout.weight * parseReps(workout.reps),
      })),
    );

    return byDateExercise;
  }, [days]);

  const exercises = Array.from(new Set(volumeData.map((item) => item.exercise)));

  // Build next workout recommendations based on progressive overload
  const nextWorkoutRecs = useMemo(() => {
    // Collect all workouts across all days, most recent first
    const allWorkouts: { date: string; workout: Workout }[] = [];
    for (const day of [...days].reverse()) {
      for (const w of day.workouts) {
        allWorkouts.push({ date: day.date, workout: w });
      }
    }

    // Group by exercise name, get the most recent entry for each
    const latestByExercise = new Map<string, { date: string; workout: Workout; history: { date: string; workout: Workout }[] }>();
    for (const entry of allWorkouts) {
      const name = entry.workout.name;
      if (!latestByExercise.has(name)) {
        latestByExercise.set(name, { ...entry, history: [] });
      }
      latestByExercise.get(name)!.history.push(entry);
    }

    // Generate recommendations using progressive overload principles
    return Array.from(latestByExercise.entries()).map(([name, { date, workout, history }]) => {
      const lastReps = workout.reps;
      const lastWeight = workout.weight;
      const lastSets = workout.sets;

      // Parse reps — if all sets hit target (10), recommend weight increase
      // If some sets fell short, recommend same weight with target reps
      let repValues: number[];
      if (typeof lastReps === 'string') {
        repValues = lastReps.split(',').map(r => parseInt(r.trim(), 10));
      } else {
        repValues = Array(lastSets).fill(lastReps);
      }

      const targetReps = 10;
      const allSetsHitTarget = repValues.every(r => r >= targetReps);
      const avgReps = repValues.reduce((a, b) => a + b, 0) / repValues.length;

      let recWeight = lastWeight;
      let recReps = `${targetReps}`;
      let recSets = lastSets;
      let note = '';

      if (allSetsHitTarget) {
        // All sets hit target — increase weight by ~5-10%
        const increment = lastWeight < 100 ? 5 : 10;
        recWeight = lastWeight + increment;
        recReps = `${targetReps}`;
        note = `✅ Hit all ${targetReps} reps last time — increase weight by ${increment} lbs`;
      } else if (avgReps >= targetReps - 2) {
        // Close to target — same weight, push for full reps
        recWeight = lastWeight;
        recReps = `${targetReps}`;
        note = `🔄 Almost there (avg ${avgReps.toFixed(0)} reps) — same weight, aim for all ${targetReps}s`;
      } else {
        // Struggling — consider dropping weight or same weight with fewer reps target
        recWeight = lastWeight;
        recReps = `${Math.min(targetReps, Math.ceil(avgReps) + 1)}`;
        note = `⚠️ Avg ${avgReps.toFixed(0)} reps — hold weight, build up reps`;
      }

      return {
        name,
        lastDate: date,
        lastWeight,
        lastSets,
        lastReps,
        recWeight,
        recSets,
        recReps,
        note,
        sessionCount: history.length,
      };
    });
  }, [days]);

  return (
    <div className="min-h-screen text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
        <aside className="card md:sticky md:top-6 md:h-fit md:w-56">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Health Dashboard</p>
          <h1 className="mt-2 text-2xl font-semibold">Keith</h1>
          <nav className="mt-4 flex flex-wrap gap-2 md:flex-col">
            {views.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={`rounded-lg px-3 py-2 text-left text-sm transition ${
                  view === item
                    ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-300/40'
                    : 'bg-slate-800/70 text-slate-300 hover:bg-slate-700/80 hover:text-slate-100'
                }`}
              >
                {item}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 space-y-4 md:space-y-6">
          {view === 'Dashboard' && (
            <section className="space-y-4 md:space-y-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="card h-80">
                  <h2 className="mb-3 text-lg font-medium">Daily Calories (Last 7 Days)</h2>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={caloriesData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" domain={[0, 3200]} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                      {/* Ideal caloric intake zone */}
                      <ReferenceArea y1={targetCalories.min} y2={targetCalories.max} fill="#22d3ee" fillOpacity={0.08} />
                      <ReferenceLine y={targetCalories.min} stroke="#22d3ee" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: `${targetCalories.min} min`, position: 'right', fill: '#22d3ee', fontSize: 11 }} />
                      <ReferenceLine y={targetCalories.max} stroke="#22d3ee" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: `${targetCalories.max} max`, position: 'right', fill: '#22d3ee', fontSize: 11 }} />
                      <ReferenceLine y={bmr} stroke="#f43f5e" strokeDasharray="6 3" strokeOpacity={0.4} label={{ value: `BMR ${bmr}`, position: 'left', fill: '#f43f5e', fontSize: 11 }} />
                      <Bar dataKey="calories" radius={[6, 6, 0, 0]}>
                        {caloriesData.map((entry) => (
                          <Cell key={entry.date} fill={entry.inRange ? '#06b6d4' : '#f97316'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="card h-80">
                  <h2 className="mb-3 text-lg font-medium">Macro Trend (g)</h2>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={macroTrendData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                      <Legend />
                      <Bar dataKey="protein" stackId="a" fill="#22d3ee" />
                      <Bar dataKey="fat" stackId="a" fill="#f59e0b" />
                      <Bar dataKey="carbs" stackId="a" fill="#34d399" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="card h-80">
                  <h2 className="mb-3 text-lg font-medium">Weight Trend</h2>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weightTrendData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#94a3b8" />
                      <YAxis domain={['dataMin - 2', 'dataMax + 2']} stroke="#94a3b8" />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                      <Line type="monotone" dataKey="weight" stroke="#f43f5e" strokeWidth={3} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="card">
                  <h2 className="text-lg font-medium">Today&apos;s Summary</h2>
                  <p className="mt-1 text-sm text-slate-400">{formatFullDate(latestDay.date)}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-slate-800/80 p-3">
                      <p className="text-slate-400">Calories</p>
                      <p className="text-xl font-semibold text-cyan-300">{latestDay.calories}</p>
                      <p className={`text-xs mt-1 ${latestDay.calories >= targetCalories.min && latestDay.calories <= targetCalories.max ? 'text-green-400' : latestDay.calories < targetCalories.min ? 'text-amber-400' : 'text-red-400'}`}>
                        {latestDay.calories < targetCalories.min ? `${targetCalories.min - latestDay.calories} under target` : latestDay.calories > targetCalories.max ? `${latestDay.calories - targetCalories.max} over target` : 'In target zone ✓'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-800/80 p-3">
                      <p className="text-slate-400">Meals</p>
                      <p className="text-xl font-semibold text-cyan-300">{latestDay.meals.length}</p>
                    </div>
                    <div className="rounded-lg bg-slate-800/80 p-3">
                      <p className="text-slate-400">Protein / Fat / Carbs</p>
                      <p className="text-sm font-semibold text-slate-100">
                        {latestDay.protein}g / {latestDay.fat}g / {latestDay.carbs}g
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-800/80 p-3">
                      <p className="text-slate-400">Workout Entries</p>
                      <p className="text-xl font-semibold text-cyan-300">{latestDay.workouts.length}</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    {latestDay.meals.map((meal, index) => (
                      <div key={`${meal.time}-${index}`} className="rounded-lg border border-slate-800 bg-slate-800/60 p-2">
                        <p className="text-xs text-slate-400">{meal.time}</p>
                        <p className="text-sm">{meal.name}</p>
                        <p className="text-xs text-slate-400">{meal.calories} kcal</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {view === 'Nutrition' && (
            <section className="space-y-4 md:space-y-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="card h-80">
                  <h2 className="mb-3 text-lg font-medium">Macro % by Latest Day</h2>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                      <Legend />
                      <Pie
                        data={Object.entries(macroPercentages(latestDay)).map(([key, value]) => ({ name: key, value }))}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={95}
                        label={(p) => `${p.name}: ${Number(p.value).toFixed(1)}%`}
                      >
                        <Cell fill="#22d3ee" />
                        <Cell fill="#f59e0b" />
                        <Cell fill="#34d399" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="card h-80">
                  <h2 className="mb-3 text-lg font-medium">7-Day Rolling Averages</h2>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rollingAverages} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                      <Legend />
                      <Line type="monotone" dataKey="calories" stroke="#38bdf8" strokeWidth={2} />
                      <Line type="monotone" dataKey="protein" stroke="#22d3ee" strokeWidth={2} />
                      <Line type="monotone" dataKey="fat" stroke="#f59e0b" strokeWidth={2} />
                      <Line type="monotone" dataKey="carbs" stroke="#34d399" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-3">
                {days
                  .slice()
                  .reverse()
                  .map((day) => {
                    const expanded = expandedDate === day.date;
                    const pct = macroPercentages(day);

                    return (
                      <article key={day.date} className="card">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 text-left"
                          onClick={() => setExpandedDate(expanded ? null : day.date)}
                        >
                          <div>
                            <p className="text-sm text-slate-400">{formatFullDate(day.date)}</p>
                            <p className="font-medium">{day.calories} kcal</p>
                          </div>
                          <p className="text-sm text-cyan-300">
                            P {pct.protein.toFixed(0)}% • F {pct.fat.toFixed(0)}% • C {pct.carbs.toFixed(0)}%
                          </p>
                        </button>
                        {expanded && (
                          <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                            {day.meals.map((meal, index) => (
                              <div key={`${meal.time}-${index}`} className="rounded-lg bg-slate-800/70 p-3 text-sm">
                                <div className="flex justify-between gap-3">
                                  <p className="font-medium">{meal.name}</p>
                                  <p className="text-slate-400">{meal.time}</p>
                                </div>
                                <p className="mt-1 text-slate-300">
                                  {meal.calories} kcal • P {meal.protein}g • F {meal.fat}g • C {meal.carbs}g
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
              </div>
            </section>
          )}

          {view === 'Activity' && (
            <section className="grid gap-4 md:gap-6">
              <div className="card h-80">
                <h2 className="mb-3 text-lg font-medium">Steps Per Day</h2>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activityData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                    <Bar dataKey="steps" fill="#22d3ee" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card h-80">
                <h2 className="mb-3 text-lg font-medium">Calories Burned vs Consumed</h2>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activityData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                    <Legend />
                    <Line type="monotone" dataKey="consumed" name="Consumed" stroke="#34d399" strokeWidth={3} />
                    <Line type="monotone" dataKey="burned" name="Burned" stroke="#f97316" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="card h-80">
                <h2 className="mb-3 text-lg font-medium">Resting Heart Rate</h2>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activityData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                    <Line type="monotone" dataKey="restingHR" stroke="#a78bfa" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {view === 'Next Workout' && (
            <section className="space-y-4 md:space-y-6">
              <div className="card">
                <h2 className="mb-1 text-lg font-medium">🏋️ Next Workout Plan</h2>
                <p className="mb-4 text-sm text-slate-400">
                  Progressive overload recommendations based on your last session. Pull this up at the gym!
                </p>
                {nextWorkoutRecs.length === 0 ? (
                  <p className="text-slate-400">No workout data yet. Log your first session!</p>
                ) : (
                  <div className="space-y-3">
                    {nextWorkoutRecs.map((rec, idx) => (
                      <div key={rec.name} className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-base font-semibold text-cyan-200">
                              {idx + 1}. {rec.name}
                            </h3>
                            <p className="mt-1 text-xs text-slate-500">
                              Last: {formatFullDate(rec.lastDate)} — {rec.lastWeight} lbs × {rec.lastSets} sets × {rec.lastReps} reps
                            </p>
                          </div>
                          <span className="rounded-md bg-slate-700/80 px-2 py-1 text-xs text-slate-300">
                            {rec.sessionCount} session{rec.sessionCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-3">
                          <div className="rounded-lg bg-slate-900/60 p-3 text-center">
                            <p className="text-xs text-slate-400">Weight</p>
                            <p className="text-2xl font-bold text-cyan-300">{rec.recWeight}</p>
                            <p className="text-xs text-slate-500">lbs</p>
                          </div>
                          <div className="rounded-lg bg-slate-900/60 p-3 text-center">
                            <p className="text-xs text-slate-400">Sets</p>
                            <p className="text-2xl font-bold text-cyan-300">{rec.recSets}</p>
                          </div>
                          <div className="rounded-lg bg-slate-900/60 p-3 text-center">
                            <p className="text-xs text-slate-400">Reps</p>
                            <p className="text-2xl font-bold text-cyan-300">{rec.recReps}</p>
                            <p className="text-xs text-slate-500">per set</p>
                          </div>
                        </div>
                        <p className="mt-3 text-sm text-slate-300">{rec.note}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <h2 className="mb-3 text-lg font-medium">💡 How This Works</h2>
                <div className="space-y-2 text-sm text-slate-400">
                  <p>• <span className="text-green-400">✅ All sets hit 10 reps?</span> → Increase weight (5 lbs if under 100, 10 lbs if over)</p>
                  <p>• <span className="text-cyan-400">🔄 Averaged 8-9 reps?</span> → Same weight, push for all 10s</p>
                  <p>• <span className="text-amber-400">⚠️ Averaged below 8?</span> → Hold weight, focus on building up reps</p>
                  <p className="mt-2 text-slate-500">Recommendations update automatically as you log workouts.</p>
                </div>
              </div>
            </section>
          )}

          {view === 'Workouts' && (
            <section className="space-y-4 md:space-y-6">
              <div className="card overflow-x-auto">
                <h2 className="mb-3 text-lg font-medium">Exercise Log</h2>
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="px-2 py-2 font-medium">Date</th>
                      <th className="px-2 py-2 font-medium">Exercise</th>
                      <th className="px-2 py-2 font-medium">Weight</th>
                      <th className="px-2 py-2 font-medium">Sets</th>
                      <th className="px-2 py-2 font-medium">Reps</th>
                      <th className="px-2 py-2 font-medium">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.flatMap((day) =>
                      day.workouts.map((workout, index) => {
                        const reps = parseReps(workout.reps);
                        const volume = reps * workout.sets * workout.weight;

                        return (
                          <tr key={`${day.date}-${workout.name}-${index}`} className="border-b border-slate-800/60">
                            <td className="px-2 py-2 align-top">{formatFullDate(day.date)}</td>
                            <td className="px-2 py-2 align-top">{workout.name}</td>
                            <td className="px-2 py-2 align-top">{workout.weight}</td>
                            <td className="px-2 py-2 align-top">{workout.sets}</td>
                            <td className="px-2 py-2 align-top">{workout.reps}</td>
                            <td className="px-2 py-2 align-top text-cyan-300">{volume}</td>
                          </tr>
                        );
                      }),
                    )}
                  </tbody>
                </table>
              </div>

              <div className="card h-96">
                <h2 className="mb-3 text-lg font-medium">Volume Tracking by Exercise</h2>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={volumeData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                    <Legend />
                    {exercises.map((exercise, idx) => (
                      <Line
                        key={exercise}
                        name={exercise}
                        type="monotone"
                        dataKey="volume"
                        data={volumeData.filter((item) => item.exercise === exercise)}
                        stroke={['#22d3ee', '#34d399', '#f59e0b', '#f97316', '#f43f5e', '#a78bfa'][idx % 6]}
                        strokeWidth={2}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
