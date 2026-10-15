import { call, dbIds, notion, p } from './notion';
import { inActions } from './env';
import { syncStrava } from './sources/strava';
import { syncHevy } from './sources/hevy';
import { syncWithings } from './sources/withings';
import { syncInBody } from './sources/inbody';

const SOURCES = [
  ['Strava', syncStrava],
  ['Hevy', syncHevy],
  ['Withings', syncWithings],
  ['InBody', syncInBody],
] as const;

export async function run(since: Date) {
  const started = new Date();
  const counts: Record<string, number | null> = {};
  const errors: string[] = [];
  await dbIds();

  for (const [name, sync] of SOURCES) {
    try {
      counts[name] = await sync(since);
      console.log(`✓ ${name}: ${counts[name]} records`);
    } catch (e: any) {
      counts[name] = null;
      errors.push(`${name}: ${e.message}`);
      console.error(`✗ ${name}: ${e.message}`);
    }
  }

  const status = errors.length === 0 ? 'OK' : errors.length === SOURCES.length ? 'Failed' : 'Partial';
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  const ids = await dbIds();
  await call(() => notion.pages.create({
    parent: { database_id: ids.log },
    properties: {
      'Run': p.title(started.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
      'Started': p.date(started.toISOString()),
      'Status': p.select(status),
      'Source': p.select(inActions ? 'GitHub' : 'Mac'),
      'Strava': p.num(counts.Strava),
      'Hevy': p.num(counts.Hevy),
      'Withings': p.num(counts.Withings),
      'InBody': p.num(counts.InBody),
      'Error': p.text(errors.join('\n')),
      'GitHub run': p.url(runUrl),
    },
  }));

  console.log(`Done: ${status}`);
  if (status !== 'OK') process.exitCode = 1;
}
