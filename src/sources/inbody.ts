import { need } from '../env';
import { p, upsert } from '../notion';

// Unofficial: talks to the same servers as the InBody phone app. If InBody changes
// their app, this source fails on its own and the other sources keep working.
const COMMON = 'https://appapicommon.lookinbody.com';
const ALL = '1990-01-01 11:11:11';
const APP = {
  Language: 'en', LogCode: '', AppType: 'Android', OSVersion: '14',
  PhoneModel: 'Google Pixel 6 Pro', RegAppType: 'InBody', AppVersion: '2.8.31_914',
};

async function post(url: string, body: object, token?: string): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': token ? 'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 6 Pro Build/AP2A.240905.003.F1)' : 'okhttp/4.12.0',
      ...(token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`InBody ${new URL(url).pathname} returned HTTP ${res.status}`);
  const j: any = await res.json();
  if (j && j.IsSuccess === false) throw new Error(`InBody ${new URL(url).pathname}: ${j.ErrorMsg || 'request refused'}`);
  return j;
}

export async function inbodyLogin() {
  const country = (process.env.INBODY_COUNTRY_CODE || 'US').toUpperCase();
  const info = await post(`${COMMON}/CommonAPI/GetCountryInfoV2`, { ...APP, CountryCode: '', SyncDatetime: ALL });
  const row = (info.Data ?? []).find((r: any) => r.Type === 'API' && String(r.Code2).toUpperCase() === country);
  if (!row) throw new Error(`InBody has no server for country ${country}`);
  const base = String(row.Domain).replace(/\/$/, '');
  const cc = String(row.Number);
  const login = await post(`${base}/V2/Main/GetLoginWithSyncDataPartV2`, {
    ...APP, CountryCode: cc, AuthProvider: '', AuthProviderID: '', AuthToken: '', CustomKey: '',
    DeviceType: 'Pixel 6 Pro 14', LoginID: need('INBODY_LOGIN_ID').replace(/\D/g, ''), LoginPW: need('INBODY_LOGIN_PW'),
    Type: 'Login', SyncDatetime: ALL, SyncDatetimeBasalMedical: ALL, SyncDatetimeCardiac: ALL,
    SyncDatetimeExercise: ALL, SyncDatetimeInBody: ALL, SyncDatetimeNutrition: ALL, SyncDatetimeSleep: ALL,
    SyncType: 'Main;InBody;Exercise;Nutrition;Sleep;EasyTrainning;BasalMedical;',
  });
  const uid = login.Data?.UID;
  if (!login.Token || !uid) throw new Error('InBody login failed. Check INBODY_LOGIN_ID (phone number, digits only) and INBODY_LOGIN_PW.');
  return { base, cc, uid, token: login.Token as string };
}

export async function inbodyScans(): Promise<any[]> {
  const s = await inbodyLogin();
  const all: any[] = [];
  for (let index = 0; index < 2000; index += 100) {
    const page = await post(`${s.base}/V2/InBody/GetInBodyData`, {
      ...APP, CountryCode: s.cc, uid: s.uid, syncDatetime: ALL, NumberPerData: '100',
      CurrentIndex: String(index), Language: 'en-US', UseInBodyHomeDevice: 'false',
    }, s.token);
    const rows = page.Data ?? [];
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}

// Scan records nest values in BCA / MFA / IMP blocks. Flatten them into one lookup.
export function flatten(o: any, out: Record<string, any> = {}): Record<string, any> {
  if (Array.isArray(o)) o.forEach((v) => flatten(v, out));
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') flatten(v, out);
      else { const key = k.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!(key in out)) out[key] = v; }
    }
  }
  return out;
}

const COLS: Record<string, string[]> = {
  'Weight (kg)': ['WT', 'WEIGHT'],
  'Skeletal muscle (kg)': ['SMM'],
  'Body fat (kg)': ['BFM'],
  'Body fat (%)': ['PBF'],
  'BMI': ['BMI'],
  'Total body water (kg)': ['TBW'],
  'Fat-free mass (kg)': ['FFM'],
  'Protein (kg)': ['PROTEIN', 'PM'],
  'Minerals (kg)': ['MINERAL', 'MINERALS'],
  'Visceral fat level': ['VFL', 'LVF', 'IVFL'],
  'BMR (kcal)': ['BMR'],
  'ECW/TBW': ['ECWTBW', 'WED'],
  'InBody score': ['TOTSCORE', 'HSCORENEW', 'INBODYSCORE', 'IBS'],
};

function num(v: any): number | null {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// "20260912103000" or "2026-09-12 10:30:00" → "2026-09-12T10:30:00" (gym's local time)
function when(raw: string): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length < 8) return null;
  const t = d.padEnd(14, '0');
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}`;
}

export async function syncInBody(since: Date): Promise<number> {
  const after = since.toISOString().slice(0, 10);
  let count = 0;
  for (const scan of await inbodyScans()) {
    const f = flatten(scan);
    const raw = String(f.DATETIMES ?? f.DATETIME ?? '');
    const date = when(raw);
    if (!date || date.slice(0, 10) < after) continue;
    const props: Record<string, any> = {};
    for (const [col, keys] of Object.entries(COLS)) {
      const k = keys.find((k) => num(f[k]) != null);
      props[col] = p.num(k ? num(f[k]) : null);
    }
    await upsert('inbody', { prop: 'Scan key', type: 'rich_text', value: raw }, {
      'Scan': p.title(`InBody ${date.slice(0, 10)}`),
      'Date': p.date(date),
      'Scan key': p.text(raw),
      ...props,
    });
    count++;
  }
  return count;
}
