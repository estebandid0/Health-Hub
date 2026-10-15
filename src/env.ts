import 'dotenv/config';

export function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}. Add it to .env (on your Mac) or to GitHub secrets.`);
  return v;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const inActions = !!process.env.GITHUB_ACTIONS;
