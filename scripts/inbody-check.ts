import { flatten, inbodyScans } from '../src/sources/inbody';

// Logs in to InBody and prints your newest scan's values, so the column mapping can be checked.
// Personal details (phone, email, name, IDs, tokens) are left out of the printout.
const scans = await inbodyScans();
console.log(`✓ Logged in to InBody. Scans found: ${scans.length}`);
if (scans.length) {
  const f = flatten(scans[0]);
  const hide = /PHONE|EMAIL|NAME|UID|TOKEN|ID$|PW|BIRTH/;
  const lines = Object.entries(f).filter(([k, v]) => !hide.test(k) && v !== '' && v != null).map(([k, v]) => `${k}=${v}`);
  console.log('\nNewest scan:\n' + lines.join('  '));
}
