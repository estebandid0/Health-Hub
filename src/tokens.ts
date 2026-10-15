import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { inActions } from './env';

// Strava and Withings hand out a new refresh token from time to time.
// Save it everywhere it's needed so the next run can still log in.
export function saveSecret(name: string, value: string) {
  process.env[name] = value;
  const gh = spawnSync('gh', ['secret', 'set', name, '--body', value], { stdio: 'pipe' });
  if (inActions) {
    if (gh.status !== 0) throw new Error(`Could not save ${name} to GitHub secrets. Check the GH_PAT secret. ${gh.stderr}`);
    return;
  }
  const file = '.env';
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, () => line) : (text && !text.endsWith('\n') ? text + '\n' : text) + line + '\n';
  writeFileSync(file, text);
}
