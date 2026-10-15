import { run } from '../src/run';

console.log('Importing your full history. This can take a while; leave this window open.\n');
run(new Date(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
