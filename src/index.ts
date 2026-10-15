import { run } from './run';

// Re-check the last 3 days each hour. Rows are matched by ID, so nothing is duplicated.
const days = Number(process.env.LOOKBACK_DAYS ?? 3);
run(new Date(Date.now() - days * 86_400_000)).catch((e) => {
  console.error(e);
  process.exit(1);
});
