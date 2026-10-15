import { Client } from '@notionhq/client';
import { need, sleep } from './env';

export const notion = new Client({ auth: need('NOTION_TOKEN') });

// Notion allows about 3 requests per second.
let last = 0;
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = last + 350 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      return await fn();
    } catch (e: any) {
      if (attempt < 4 && (e?.status === 429 || e?.status >= 500)) { await sleep(2000 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

export const DB = {
  strava: 'Strava Activities',
  workouts: 'Hevy Workouts',
  sets: 'Hevy Sets',
  body: 'Withings Body',
  log: 'Sync Log',
} as const;
export type DbKey = keyof typeof DB;

export async function childDatabases(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  let cursor: string | undefined;
  do {
    const res: any = await call(() => notion.blocks.children.list({ block_id: need('NOTION_PAGE_ID'), start_cursor: cursor }));
    for (const b of res.results) if (b.type === 'child_database') found[b.child_database.title] = b.id;
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return found;
}

let ids: Record<DbKey, string> | null = null;
export async function dbIds(): Promise<Record<DbKey, string>> {
  if (ids) return ids;
  const found = await childDatabases();
  const missing = Object.values(DB).filter((t) => !found[t]);
  if (missing.length) throw new Error(`Missing on the Health Hub page: ${missing.join(', ')}. Run: npm run setup`);
  ids = Object.fromEntries(Object.entries(DB).map(([k, t]) => [k, found[t]])) as Record<DbKey, string>;
  return ids;
}

export const p = {
  title: (s: string) => ({ title: [{ text: { content: String(s).slice(0, 2000) } }] }),
  text: (s?: string | null) => ({ rich_text: s ? [{ text: { content: String(s).slice(0, 2000) } }] : [] }),
  num: (n?: number | null) => ({ number: n == null || Number.isNaN(n) ? null : Math.round(n * 100) / 100 }),
  date: (iso: string) => ({ date: { start: iso } }),
  select: (s?: string | null) => ({ select: s ? { name: s.replace(/,/g, ' ') } : null }),
  multi: (arr: string[]) => ({ multi_select: [...new Set(arr.filter(Boolean))].slice(0, 100).map((name) => ({ name: name.replace(/,/g, ' ') })) }),
  url: (u?: string | null) => ({ url: u ?? null }),
  rel: (pageIds: string[]) => ({ relation: pageIds.map((id) => ({ id })) }),
};

type Key = { prop: string; type: 'number' | 'rich_text'; value: number | string };

async function find(db: DbKey, key: Key): Promise<string | undefined> {
  const filter = key.type === 'number'
    ? { property: key.prop, number: { equals: Number(key.value) } }
    : { property: key.prop, rich_text: { equals: String(key.value) } };
  const res: any = await call(() => notion.databases.query({ database_id: ids![db], filter: filter as any, page_size: 1 }));
  return res.results[0]?.id;
}

// Update the row if it already exists (matched by the app's own ID), otherwise create it.
export async function upsert(db: DbKey, key: Key, properties: Record<string, any>): Promise<string> {
  await dbIds();
  const existing = await find(db, key);
  if (existing) {
    await call(() => notion.pages.update({ page_id: existing, properties }));
    return existing;
  }
  const page: any = await call(() => notion.pages.create({ parent: { database_id: ids![db] }, properties }));
  return page.id;
}

export async function archive(db: DbKey, key: Key) {
  await dbIds();
  const existing = await find(db, key);
  if (existing) await call(() => notion.pages.update({ page_id: existing, archived: true }));
}
