import { call, childDatabases, DB, notion } from '../src/notion';
import { need } from '../src/env';

const page = need('NOTION_PAGE_ID');
const num = { number: { format: 'number' } };
const txt = { rich_text: {} };
const date = { date: {} };

async function create(title: string, properties: Record<string, any>, formulas: Record<string, string> = {}): Promise<string> {
  const existing = (await childDatabases())[title];
  if (existing) { console.log(`• ${title} already exists, skipped`); return existing; }
  const db: any = await call(() => notion.databases.create({
    parent: { type: 'page_id', page_id: page },
    title: [{ type: 'text', text: { content: title } }],
    is_inline: true,
    properties,
  } as any));
  for (const [name, expression] of Object.entries(formulas)) {
    try {
      await call(() => notion.databases.update({ database_id: db.id, properties: { [name]: { formula: { expression } } } as any }));
    } catch (e: any) {
      console.log(`  (could not add the "${name}" formula; you can add it by hand in Notion: ${e.message})`);
    }
  }
  console.log(`✓ Created ${title}`);
  return db.id;
}

await create(DB.strava, {
  'Name': { title: {} },
  'Date': date,
  'Sport': { select: {} },
  'Distance (km)': num,
  'Moving time (min)': num,
  'Elevation gain (m)': num,
  'Avg HR': num,
  'Max HR': num,
  'Strava link': { url: {} },
  'Strava ID': num,
}, {
  'Pace (min/km)': 'if(prop("Distance (km)") > 0, let(s, round(prop("Moving time (min)") * 60 / prop("Distance (km)")), format(floor(s / 60)) + ":" + padStart(format(s % 60), 2, "0")), "")',
});

const workouts = await create(DB.workouts, {
  'Title': { title: {} },
  'Date': date,
  'Duration (min)': num,
  'Total volume (kg)': num,
  'Working sets': num,
  'Exercises': { multi_select: {} },
  'Muscle groups': { multi_select: {} },
  'Notes': txt,
  'Hevy ID': txt,
});

await create(DB.sets, {
  'Exercise': { title: {} },
  'Date': date,
  'Set #': num,
  'Set type': { select: {} },
  'Weight (kg)': num,
  'Reps': num,
  'RPE': num,
  'Set key': txt,
  'Workout': { relation: { database_id: workouts, type: 'single_property', single_property: {} } },
}, {
  'Est. 1RM (kg)': 'round(prop("Weight (kg)") * (1 + prop("Reps") / 30) * 10) / 10',
});

await create(DB.body, {
  'Measurement': { title: {} },
  'Date': date,
  'Weight (kg)': num,
  'Body fat (%)': num,
  'Muscle mass (kg)': num,
  'Bone mass (kg)': num,
  'Water (kg)': num,
  'Systolic (mmHg)': num,
  'Diastolic (mmHg)': num,
  'Heart rate (bpm)': num,
  'Group ID': num,
});

await create(DB.log, {
  'Run': { title: {} },
  'Started': date,
  'Status': { select: { options: [{ name: 'OK', color: 'green' }, { name: 'Partial', color: 'yellow' }, { name: 'Failed', color: 'red' }] } },
  'Source': { select: {} },
  'Strava': num,
  'Hevy': num,
  'Withings': num,
  'Error': txt,
  'GitHub run': { url: {} },
});

console.log('\nAll set. Open your Health Hub page in Notion to see the databases.');
