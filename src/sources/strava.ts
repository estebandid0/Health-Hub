import { inActions, need, sleep } from '../env';
import { saveSecret } from '../tokens';
import { p, upsert } from '../notion';

const form = { 'Content-Type': 'application/x-www-form-urlencoded' };

export async function stravaToken(params: Record<string, string>) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: form,
    body: new URLSearchParams({ client_id: need('STRAVA_CLIENT_ID'), client_secret: need('STRAVA_CLIENT_SECRET'), ...params }),
  });
  const j: any = await res.json();
  if (!res.ok) throw new Error(`Strava login failed: ${JSON.stringify(j)}`);
  if (j.refresh_token && j.refresh_token !== process.env.STRAVA_REFRESH_TOKEN) saveSecret('STRAVA_REFRESH_TOKEN', j.refresh_token);
  return j.access_token as string;
}

export async function syncStrava(since: Date): Promise<number> {
  const token = await stravaToken({ grant_type: 'refresh_token', refresh_token: need('STRAVA_REFRESH_TOKEN') });
  const after = Math.floor(since.getTime() / 1000);
  let count = 0;
  for (let page = 1; ; page++) {
    const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      if (inActions) throw new Error('Strava rate limit reached; the next run will catch up.');
      console.log('Strava limit reached. Waiting 15 minutes, then continuing. Leave this window open.');
      await sleep(15 * 60 * 1000);
      page--;
      continue;
    }
    if (!res.ok) throw new Error(`Strava ${res.status}: ${await res.text()}`);
    const list: any[] = await res.json();
    if (!list.length) break;
    for (const a of list) {
      await upsert('strava', { prop: 'Strava ID', type: 'number', value: a.id }, {
        'Name': p.title(a.name || 'Activity'),
        'Date': p.date(a.start_date),
        'Sport': p.select(a.sport_type || a.type),
        'Distance (km)': p.num(a.distance / 1000),
        'Moving time (min)': p.num(a.moving_time / 60),
        'Elevation gain (m)': p.num(a.total_elevation_gain),
        'Avg HR': p.num(a.average_heartrate),
        'Max HR': p.num(a.max_heartrate),
        'Strava link': p.url(`https://www.strava.com/activities/${a.id}`),
        'Strava ID': { number: a.id },
      });
      count++;
    }
    if (page % 5 === 0) console.log(`Strava: ${count} activities so far…`);
  }
  return count;
}
