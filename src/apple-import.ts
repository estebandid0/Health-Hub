import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { call, dbIds, notion, p } from './notion';
import { importApple } from './sources/apple';

// Processes every file the iPhone uploaded to inbox/, then deletes it.
// GitHub Actions commits the deletion, so each upload is imported once.
const dir = 'inbox';
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.txt')).sort() : [];

async function main() {
  if (!files.length) { console.log('No uploads in inbox/.'); return; }
  const ids = await dbIds();
  for (const f of files) {
    const started = new Date();
    let status = 'OK', error = '', days: number | null = null;
    try {
      const r = await importApple(readFileSync(`${dir}/${f}`, 'utf8'));
      days = r.days;
      if (r.samples === 0) { status = 'Partial'; error = 'The upload had no Health data. The iPhone was probably locked when the shortcut ran.'; }
      else if (r.unknown.length) error = `Skipped unknown types: ${r.unknown.join(', ')}`;
      console.log(`✓ ${f}: ${r.samples} samples, ${r.days} days, ${r.workouts} Hevy workouts with heart rate`);
      rmSync(`${dir}/${f}`);
    } catch (e: any) {
      status = 'Failed';
      error = `${f}: ${e.message}`;
      console.error(`✗ ${error}`);
      process.exitCode = 1;
    }
    const runUrl = process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
    await call(() => notion.pages.create({
      parent: { database_id: ids.log },
      properties: {
        'Run': p.title(started.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
        'Started': p.date(started.toISOString()),
        'Status': p.select(status),
        'Source': p.select('iPhone'),
        'Apple Health': p.num(days),
        'Error': p.text(error),
        'GitHub run': p.url(runUrl),
      },
    }));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
