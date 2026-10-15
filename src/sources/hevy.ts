import { need, sleep } from '../env';
import { archive, p, upsert } from '../notion';

async function hevy(path: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.hevyapp.com/v1${path}`, { headers: { 'api-key': need('HEVY_API_KEY'), accept: 'application/json' } });
    if (res.status === 429 && attempt < 5) { await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`Hevy ${res.status} on ${path}: ${await res.text()}`);
    return res.json();
  }
}

const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const muscles = new Map<string, string>();
async function muscleFor(templateId?: string): Promise<string> {
  if (!templateId) return '';
  if (!muscles.has(templateId)) {
    try {
      const t = await hevy(`/exercise_templates/${templateId}`);
      muscles.set(templateId, t.primary_muscle_group ? pretty(t.primary_muscle_group) : '');
    } catch {
      muscles.set(templateId, '');
    }
  }
  return muscles.get(templateId)!;
}

async function writeWorkout(w: any) {
  const exercises: any[] = w.exercises ?? [];
  let volume = 0, working = 0;
  const groups: string[] = [];
  for (const ex of exercises) {
    groups.push(await muscleFor(ex.exercise_template_id));
    for (const s of ex.sets ?? []) {
      if (s.type === 'warmup') continue;
      working++;
      volume += (s.weight_kg ?? 0) * (s.reps ?? 0);
    }
  }
  const minutes = (new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60000;
  const workoutPage = await upsert('workouts', { prop: 'Hevy ID', type: 'rich_text', value: w.id }, {
    'Title': p.title(w.title || 'Workout'),
    'Date': p.date(w.start_time),
    'Duration (min)': p.num(minutes),
    'Total volume (kg)': p.num(volume),
    'Working sets': p.num(working),
    'Exercises': p.multi(exercises.map((e) => e.title)),
    'Muscle groups': p.multi(groups),
    'Notes': p.text(w.description),
    'Hevy ID': p.text(w.id),
  });
  for (const ex of exercises) {
    for (const s of ex.sets ?? []) {
      const key = `${w.id}:${ex.index}:${s.index}`;
      await upsert('sets', { prop: 'Set key', type: 'rich_text', value: key }, {
        'Exercise': p.title(ex.title),
        'Date': p.date(w.start_time),
        'Set #': p.num((s.index ?? 0) + 1),
        'Set type': p.select(s.type),
        'Weight (kg)': p.num(s.weight_kg),
        'Reps': p.num(s.reps),
        'RPE': p.num(s.rpe),
        'Set key': p.text(key),
        'Workout': p.rel([workoutPage]),
      });
    }
  }
}

export async function syncHevy(since: Date): Promise<number> {
  let count = 0;
  for (let page = 1; ; page++) {
    const r = await hevy(`/workouts/events?since=${encodeURIComponent(since.toISOString())}&page=${page}&pageSize=10`);
    for (const ev of r.events ?? []) {
      if (ev.type === 'deleted') {
        await archive('workouts', { prop: 'Hevy ID', type: 'rich_text', value: ev.id });
        continue;
      }
      await writeWorkout(ev.workout);
      count++;
    }
    if (page >= (r.page_count ?? 1)) break;
    if (page % 5 === 0) console.log(`Hevy: ${count} workouts so far…`);
  }
  return count;
}
