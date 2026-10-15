import { call, dbIds, notion, p, upsert } from '../notion';

// Reads the text file the iPhone shortcut uploads. One sample per line:
//   Type|Start (ISO 8601)|End (ISO 8601)|Value
// The first line is W|<window start>, the earliest time the shortcut asked Health for.

type Kind = 'sleep' | 'hr' | 'hrv' | 'rhr' | 'resp' | 'spo2' | 'vo2' | 'temp' | 'disturb' | 'recovery';
type Stage = 'deep' | 'core' | 'rem' | 'awake' | 'inbed' | 'asleep';
type Sample = { kind: Kind; s: number; e: number; sIso: string; eIso: string; v: number; stage?: Stage };
type Span = [number, number];

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

function kindOf(type: string): Kind | null | 'skip' {
  const t = plain(type);
  if ((t.includes('sleep') || t.includes('sueno')) && t.includes('temp')) return 'temp';
  if (t.includes('temp')) return 'temp';
  if (t.includes('disturb') || t.includes('alteraciones')) return 'disturb';
  if (t.includes('sleep') || t.includes('sueno')) return 'sleep';
  if (t.includes('variab')) return 'hrv';
  if (t.includes('recover') || t.includes('recuperacion')) return 'recovery';
  if (t.includes('walking') || t.includes('caminando')) return 'skip';
  if (t.includes('resting') || t.includes('reposo')) return 'rhr';
  if (t.includes('heart') || t.includes('cardiaca')) return 'hr';
  if (t.includes('respirat')) return 'resp';
  if (t.includes('oxygen') || t.includes('oxigeno')) return 'spo2';
  if (t.includes('vo2') || t.includes('cardio fitness') || t.includes('capacidad cardio')) return 'vo2';
  return null;
}

function stageOf(value: string): Stage | undefined {
  const v = plain(value);
  if (v.includes('deep') || v.includes('profund')) return 'deep';
  if (v.includes('rem')) return 'rem';
  if (v.includes('core') || v.includes('basic') || v.includes('esencial') || v.includes('light')) return 'core';
  if (v.includes('awake') || v.includes('despiert')) return 'awake';
  if (v.includes('bed') || v.includes('cama')) return 'inbed';
  if (v.includes('asleep') || v.includes('dormid') || v.includes('unspecified')) return 'asleep';
  return undefined;
}

export function parse(text: string) {
  const samples: Sample[] = [];
  const unknown = new Set<string>();
  let windowStart = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split('|').map((x) => x.trim());
    if (parts[0] === 'W') { windowStart = Date.parse(parts[1]) || 0; continue; }
    const [type, sIso, eIso0, value = ''] = parts;
    const kind = kindOf(type ?? '');
    if (kind === 'skip') continue;
    if (!kind) { unknown.add(type); continue; }
    const eIso = eIso0 || sIso;
    const s = Date.parse(sIso), e = Date.parse(eIso);
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    if (kind === 'sleep') {
      const stage = stageOf(value);
      if (stage) samples.push({ kind, s, e, sIso, eIso, v: 0, stage });
      else unknown.add(`sleep value "${value}"`);
      continue;
    }
    const v = parseFloat(value.replace(',', '.').replace(/[^\d.\-]/g, ''));
    if (!Number.isNaN(v)) samples.push({ kind, s, e, sIso, eIso, v });
  }
  return { samples, windowStart, unknown: [...unknown] };
}

// Local date and clock time as recorded on the phone (the ISO text keeps the phone's time zone).
const localDay = (iso: string) => iso.slice(0, 10);
const localClock = (iso: string) => iso.slice(11, 16);
const min = (ms: number) => ms / 60000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function union(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
const total = (spans: Span[]) => spans.reduce((a, [s, e]) => a + (e - s), 0);
const overlap = (spans: Span[], from: number, to: number) =>
  spans.reduce((a, [s, e]) => a + Math.max(0, Math.min(e, to) - Math.max(s, from)), 0);

function night(sleep: Sample[], all: Sample[]) {
  const spans = (st: Stage[]) => union(sleep.filter((x) => st.includes(x.stage!)).map((x) => [x.s, x.e] as Span));
  const hasStages = sleep.some((x) => x.stage === 'deep' || x.stage === 'core' || x.stage === 'rem');
  const asleep = hasStages ? spans(['deep', 'core', 'rem']) : spans(['asleep']);
  if (!asleep.length) return null;
  const deep = spans(['deep']), core = spans(['core']), rem = spans(['rem']), awake = spans(['awake']);
  const first = sleep.reduce((a, b) => (b.s < a.s ? b : a));
  const bed = first.s;
  const onset = asleep[0][0];
  const wake = asleep[asleep.length - 1][1];
  const wakeIso = sleep.filter((x) => x.e === wake)[0]?.eIso ?? sleep[sleep.length - 1].eIso;
  const lastEnd = Math.max(...sleep.map((x) => x.e));
  const inBed = lastEnd - bed;
  const asleepMs = total(asleep);
  const breaks = awake.filter(([s, e]) => s > onset && e < wake && e - s >= 60000);
  const deepMs = total(deep), remMs = total(rem);
  const length = wake - onset;
  const during = (k: Kind) => all.filter((x) => x.kind === k && x.s >= bed && x.s <= lastEnd).map((x) => x.v);
  const touching = (k: Kind) => all.filter((x) => x.kind === k && x.e >= bed && x.s <= lastEnd).map((x) => x.v);
  const hr = during('hr');
  const spo2 = during('spo2').map((v) => (v <= 1 ? v * 100 : v));
  const temp = touching('temp'), dist = touching('disturb');
  return {
    day: localDay(wakeIso),
    props: {
      'Bedtime': p.text(localClock(first.sIso)),
      'Wake time': p.text(localClock(wakeIso)),
      'Time in bed (min)': p.num(min(inBed)),
      'Asleep (min)': p.num(min(asleepMs)),
      'Deep (min)': hasStages ? p.num(min(deepMs)) : null,
      'Core (min)': hasStages ? p.num(min(total(core))) : null,
      'REM (min)': hasStages ? p.num(min(remMs)) : null,
      'Awake (min)': p.num(min(overlap(awake, onset, wake))),
      'Sleep efficiency (%)': p.num(inBed > 0 ? (asleepMs / inBed) * 100 : null),
      'Fell asleep in (min)': p.num(min(onset - bed)),
      'Wake-ups': p.num(breaks.length),
      'Longest awake (min)': p.num(breaks.length ? min(Math.max(...breaks.map(([s, e]) => e - s))) : 0),
      'First deep after (min)': deep.length ? p.num(min(deep[0][0] - onset)) : null,
      'Deep in first half (%)': deepMs ? p.num((overlap(deep, onset, onset + length / 2) / deepMs) * 100) : null,
      'REM in last third (%)': remMs ? p.num((overlap(rem, wake - length / 3, wake) / remMs) * 100) : null,
      'Sleeping HR': hr.length ? p.num(avg(hr)) : null,
      'Lowest HR': hr.length ? p.num(Math.min(...hr)) : null,
      'HRV (ms)': during('hrv').length ? p.num(avg(during('hrv'))) : null,
      'Breathing rate': during('resp').length ? p.num(avg(during('resp'))) : null,
      'Blood oxygen (%)': spo2.length ? p.num(avg(spo2)) : null,
      'Lowest blood oxygen (%)': spo2.length ? p.num(Math.min(...spo2)) : null,
      'Wrist temp (°C)': temp.length ? p.num(temp[temp.length - 1]) : null,
      'Breathing disturbances': dist.length ? p.num(dist[dist.length - 1]) : null,
    } as Record<string, any>,
  };
}

// Group sleep samples into nights (gaps under 2 hours stay in the same night) and keep the
// longest one per wake-up date, so naps don't replace the main night.
function nights(samples: Sample[], windowStart: number) {
  const sleep = samples.filter((x) => x.kind === 'sleep').sort((a, b) => a.s - b.s);
  const groups: Sample[][] = [];
  let end = -Infinity;
  for (const x of sleep) {
    if (x.s - end > 2 * 3600_000) groups.push([]);
    groups[groups.length - 1].push(x);
    end = Math.max(end, x.e);
  }
  const best = new Map<string, { asleep: number; n: NonNullable<ReturnType<typeof night>> }>();
  for (const g of groups) {
    if (windowStart && g[0].s < windowStart + 15 * 60000) continue; // cut off by the window, sent again tomorrow
    const n = night(g, samples);
    if (!n) continue;
    const asleep = n.props['Asleep (min)'].number ?? 0;
    if ((best.get(n.day)?.asleep ?? -1) < asleep) best.set(n.day, { asleep, n });
  }
  return best;
}

function daily(samples: Sample[]) {
  const out = new Map<string, Record<string, any>>();
  const set = (k: Kind, prop: string) => {
    for (const x of samples.filter((s) => s.kind === k).sort((a, b) => a.s - b.s)) {
      const d = localDay(x.sIso);
      out.set(d, { ...out.get(d), [prop]: p.num(x.v) });
    }
  };
  set('rhr', 'Resting HR');
  set('vo2', 'VO2 max');
  set('recovery', 'Cardio recovery (bpm)');
  return out;
}

const label = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// Fields with no reading are left out, so a later upload never blanks out data that's already there.
const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v && !(v.number === null)));

async function writeDays(samples: Sample[], windowStart: number): Promise<number> {
  const ns = nights(samples, windowStart);
  const ds = daily(samples);
  const days = [...new Set([...ns.keys(), ...ds.keys()])].sort();
  for (const day of days) {
    await upsert('apple', { prop: 'Date key', type: 'rich_text', value: day }, {
      'Day': p.title(label(day)),
      'Date': p.date(day),
      'Date key': p.text(day),
      ...clean({ ...ns.get(day)?.n.props, ...ds.get(day) }),
    });
  }
  return days.length;
}

// Add heart rate to Hevy workouts that happened inside the upload window.
async function writeWorkoutHR(samples: Sample[], windowStart: number): Promise<number> {
  const hr = samples.filter((x) => x.kind === 'hr');
  if (!hr.length) return 0;
  const from = windowStart || Math.min(...hr.map((x) => x.s));
  const ids = await dbIds();
  const res: any = await call(() => notion.databases.query({
    database_id: ids.workouts,
    filter: { property: 'Date', date: { on_or_after: new Date(from).toISOString() } } as any,
    page_size: 100,
  }));
  let count = 0;
  for (const page of res.results) {
    const start = Date.parse(page.properties['Date']?.date?.start ?? '');
    const minutes = page.properties['Duration (min)']?.number;
    if (Number.isNaN(start) || !minutes) continue;
    const values = hr.filter((x) => x.s >= start && x.s <= start + minutes * 60000).map((x) => x.v);
    if (values.length < 3) continue;
    await call(() => notion.pages.update({
      page_id: page.id,
      properties: { 'Avg HR': p.num(Math.round(avg(values)!)), 'Max HR': p.num(Math.max(...values)) },
    }));
    count++;
  }
  return count;
}

export async function importApple(text: string) {
  const { samples, windowStart, unknown } = parse(text);
  const days = await writeDays(samples, windowStart);
  const workouts = await writeWorkoutHR(samples, windowStart);
  return { samples: samples.length, days, workouts, unknown };
}
