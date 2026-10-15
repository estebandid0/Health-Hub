# Health Hub

Syncs Strava, Hevy and Withings into Notion every hour, using GitHub Actions.

- `npm run setup` creates the Notion databases on the Health Hub page
- `npm run authorize` logs in to Strava and Withings once
- `npm run backfill` imports your full history
- `npm run sync` runs one normal sync (what GitHub runs hourly)

Keys live in `.env` on your Mac (never committed) and in the repo's GitHub secrets.
