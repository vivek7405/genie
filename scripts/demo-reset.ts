// Empties the demo project's tasks so the walkthrough can run again.
//
//   npm run demo:reset                       report only, exits 1
//   npm run demo:reset -- --yes              delete the tasks and events
//   npm run demo:reset -- --yes --github     also close genie-labeled PRs and issues
//   npm run demo:reset -- --repo owner/name  another project
//
// Runs with plain node (Node 24 strips the types) and loads .env when there
// is one, so it works on a laptop and inside the Pilots replica alike.
import { resetDemo, DEMO_REPO } from '#modules/demo/reset.server.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const repoIndex = args.indexOf('--repo');
const repo = repoIndex >= 0 ? args[repoIndex + 1] : DEMO_REPO;
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('--repo needs an owner/name value');
  process.exit(2);
}

const yes = flag('--yes');
const github = flag('--github');
const report = await resetDemo({ repo, github, dryRun: !yes });

const verb = yes ? 'Deleted' : 'Would delete';
console.log(`${report.projectId ? `Project ${repo} (${report.projectId})` : `No project connected for ${repo}`}`);
console.log(`${verb} ${report.tasks} task(s) and ${report.events} event(s).`);
if (github) console.log(`${yes ? 'Closed' : 'Would close'} ${report.prsClosed} PR(s) and ${report.issuesClosed} issue(s) labeled genie on ${repo}.`);
if (!yes) {
  console.log('Nothing changed. Re-run with --yes to apply.');
  process.exit(1);
}
