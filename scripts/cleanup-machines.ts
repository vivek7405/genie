// The machine sweep. Prints one decision per machine in the org and, with
// --yes, destroys the ones genie no longer needs: the machine of a task
// that is done, of a task that failed more than N days ago, and a genie-
// named machine older than N days that no task knows. It never destroys
// genie-base or a machine that is not genie's. Needs PILOT_API_KEY in .env.
//
//   npm run cleanup:machines               # dry run, the default
//   npm run cleanup:machines -- --yes      # act
//   npm run cleanup:machines -- --days 5   # override GENIE_CLEANUP_DAYS
import { parseArgs } from 'node:util';

const { values: flags } = parseArgs({
  options: {
    yes: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    days: { type: 'string' },
  },
});

if (!process.env.PILOT_API_KEY) {
  console.error('PILOT_API_KEY is not set. Put it in .env (see .env.example) and run again.');
  process.exit(2);
}

const { pilots } = await import('#modules/pipeline/pilots.server.ts');
const { runCleanup, DEFAULT_CLEANUP_DAYS } = await import('#modules/pipeline/cleanup.server.ts');

const days = Number(flags.days ?? process.env.GENIE_CLEANUP_DAYS ?? DEFAULT_CLEANUP_DAYS);
if (!Number.isFinite(days) || days < 0) {
  console.error(`--days must be a number of days, got ${flags.days ?? process.env.GENIE_CLEANUP_DAYS}`);
  process.exit(2);
}
const dryRun = !flags.yes || flags['dry-run'];
console.log(dryRun ? `Dry run (pass --yes to act). Failed and orphaned machines older than ${days} day(s) are destroyable.` : `Destroying. Failed and orphaned machines older than ${days} day(s) go.`);
await runCleanup({ client: pilots(), dryRun, olderThanDays: days, log: console.log });
