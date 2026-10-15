import { need } from '../env';
import { saveSecret } from '../tokens';
import { p, upsert } from '../notion';

async function wpost(path: string, params: Record<string, string>, token?: string): Promise<any> {
  const res = await fetch(`https://wbsapi.withings.net${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: new URLSearchParams(params),
  });
  const j: any = await res.json();
  if (j.status !== 0) throw new Error(`Withings ${path} returned status ${j.status} ${j.error ?? ''}`);
  return j.body;
}

// Withings issues a new refresh token on every login, so it is saved each time.
export async function withingsToken(params: Record<string, string>): Promise<string> {
  const body = await wpost('/v2/oauth2', {
    action: 'requesttoken',
    client_id: need('WITHINGS_CLIENT_ID'),
    client_secret: need('WITHINGS_CLIENT_SECRET'),
    ...params,
  });
  saveSecret('WITHINGS_REFRESH_TOKEN', body.refresh_token);
  return body.access_token;
}

const TYPES: Record<number, string> = {
  1: 'Weight (kg)',
  6: 'Body fat (%)',
  76: 'Muscle mass (kg)',
  88: 'Bone mass (kg)',
  77: 'Water (kg)',
  10: 'Systolic (mmHg)',
  9: 'Diastolic (mmHg)',
  11: 'Heart rate (bpm)',
};

export async function syncWithings(since: Date): Promise<number> {
  const token = await withingsToken({ grant_type: 'refresh_token', refresh_token: need('WITHINGS_REFRESH_TOKEN') });
  let offset: number | undefined;
  let count = 0;
  do {
    const body = await wpost('/measure', {
      action: 'getmeas',
      meastypes: Object.keys(TYPES).join(','),
      category: '1',
      lastupdate: String(Math.floor(since.getTime() / 1000)),
      ...(offset ? { offset: String(offset) } : {}),
    }, token);
    for (const g of body.measuregrps ?? []) {
      const props: Record<string, any> = {};
      const types = new Set<number>();
      for (const m of g.measures ?? []) {
        if (!TYPES[m.type]) continue;
        types.add(m.type);
        props[TYPES[m.type]] = p.num(m.value * 10 ** m.unit);
      }
      const label = types.has(1) ? 'Weigh-in' : types.has(10) ? 'Blood pressure' : 'Measurement';
      await upsert('body', { prop: 'Group ID', type: 'number', value: g.grpid }, {
        'Measurement': p.title(label),
        'Date': p.date(new Date(g.date * 1000).toISOString()),
        'Group ID': { number: g.grpid },
        ...props,
      });
      count++;
    }
    offset = body.more ? body.offset : undefined;
  } while (offset);
  return count;
}
