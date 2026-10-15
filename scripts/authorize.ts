import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { need } from '../src/env';
import { stravaToken } from '../src/sources/strava';
import { withingsToken } from '../src/sources/withings';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const which = process.argv[2]; // optional: "strava" or "withings"
const openUrl = (url: string) => spawnSync('open', [url]);
const codeFrom = (pasted: string) => {
  try { return new URL(pasted.trim()).searchParams.get('code') ?? ''; } catch { return pasted.trim(); }
};

if (!which || which === 'strava') {
  const url = `https://www.strava.com/oauth/authorize?client_id=${need('STRAVA_CLIENT_ID')}&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=read,activity:read_all`;
  console.log('\nSTRAVA');
  console.log('1. Your browser is opening Strava. Click Authorize.');
  console.log('2. The next page says it can\'t connect. That\'s expected.');
  console.log('3. Copy the whole address from the address bar and paste it below.\n');
  openUrl(url);
  const code = codeFrom(await rl.question('Paste the address, then press Enter: '));
  await stravaToken({ grant_type: 'authorization_code', code });
  console.log('✓ Strava connected. The token was saved to .env.\n');
}

if (!which || which === 'withings') {
  const redirect = process.env.WITHINGS_REDIRECT_URI ?? 'https://github.com/estebandid0';
  const url = `https://account.withings.com/oauth2_user/authorize2?response_type=code&client_id=${need('WITHINGS_CLIENT_ID')}&scope=user.metrics&redirect_uri=${encodeURIComponent(redirect)}&state=healthhub`;
  console.log('WITHINGS');
  console.log('1. Your browser is opening Withings. Click Allow.');
  console.log('2. You land on your GitHub profile.');
  console.log('3. Copy the whole address from the address bar and paste it below. Be quick: the code expires after 30 seconds.\n');
  openUrl(url);
  const code = codeFrom(await rl.question('Paste the address, then press Enter: '));
  await withingsToken({ grant_type: 'authorization_code', code, redirect_uri: redirect });
  console.log('✓ Withings connected. The token was saved to .env.\n');
}

rl.close();
