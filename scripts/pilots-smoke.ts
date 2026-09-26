// The manual gate for the pilots layer. Not part of `npm run ci`: it creates
// real machines and pushes a real branch, and needs PILOT_API_KEY,
// CLAUDE_CODE_OAUTH_TOKEN and GH_TOKEN in .env.
//
//   npm run pilots:smoke -- [--repo owner/name] [--keep] [--rebuild-base]
//
// Steps, each timed: the base checkpoint, a task machine forked from it, the
// repo cloned into it, Claude asked to write HELLO.md, the file read back, a
// branch genie/smoke-<ts> committed and pushed, the .genie directory pulled
// out, and the machine destroyed (unless --keep). The first failure stops the
// run and leaves the machine alive with its name printed.
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';

const { values: flags } = parseArgs({
  options: {
    repo: { type: 'string', default: 'vivek7405/genie' },
    keep: { type: 'boolean', default: false },
    'rebuild-base': { type: 'boolean', default: false },
  },
});

for (const key of ['PILOT_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN']) {
  if (!process.env[key]) {
    console.error(`${key} is not set. Put it in .env (see .env.example) and run again.`);
    process.exit(2);
  }
}

const { pilots, createTaskMachine, readFile, execLong, pullTree, destroyMachine } = await import('#modules/pipeline/pilots.server.ts');
const { ensureBaseCheckpoint, rebuildBaseCheckpoint } = await import('#modules/pipeline/base-image.server.ts');
const { cloneRepo, pushBranch, DEFAULT_APP_DIR } = await import('#modules/pipeline/git.server.ts');
const { runClaude } = await import('#modules/pipeline/claude.server.ts');

const timings: Array<{ step: string; ms: number }> = [];
let machineName = '';

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`${name}... `);
  const started = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - started;
    timings.push({ step: name, ms });
    console.log(`ok (${(ms / 1000).toFixed(1)}s)`);
    return out;
  } catch (err) {
    const ms = Date.now() - started;
    timings.push({ step: name, ms });
    console.log(`FAILED (${(ms / 1000).toFixed(1)}s)`);
    console.error(err instanceof Error ? err.message : String(err));
    if (machineName) console.error(`The machine ${machineName} is left alive. Inspect it with: pilot machine exec ${machineName} -- bash`);
    printTimings();
    process.exit(1);
  }
}

function printTimings() {
  console.log('\nstep                     duration');
  for (const t of timings) console.log(`${t.step.padEnd(24)} ${(t.ms / 1000).toFixed(1)}s`);
  console.log(`${'total'.padEnd(24)} ${(timings.reduce((sum, t) => sum + t.ms, 0) / 1000).toFixed(1)}s`);
}

const repo = flags.repo;
const ts = Date.now();
const branch = `genie/smoke-${ts}`;

const checkpointId = await step('base checkpoint', () => (flags['rebuild-base'] ? rebuildBaseCheckpoint() : ensureBaseCheckpoint()));
console.log(`  checkpoint ${checkpointId}`);

const machine = await step('task machine', () => createTaskMachine({ id: randomUUID() }, { githubRepo: repo }));
machineName = machine.name;
const info = await pilots().machines.get(machine.id);
console.log(`  ${machine.name} (${machine.id}) ${machine.url}`);
console.log(`  mem_mib=${info.mem_mib} idle_timeout=${info.knobs?.idle_timeout} last_start=${info.last_start ?? 'n/a'}`);

await step('clone repo', () => cloneRepo(machine.id, { githubRepo: repo, defaultBranch: 'main' }));

const run = await step('claude run', () =>
  runClaude(machine.id, {
    prompt: 'Create a file named HELLO.md in the current directory containing the single line "hello". Do nothing else.',
    cwd: DEFAULT_APP_DIR,
    timeoutMs: 300_000,
    maxTurns: 5,
  }),
);
console.log(`  subtype=${run.subtype} costUsd=${run.costUsd ?? 'n/a'} numTurns=${run.numTurns ?? 'n/a'} isRateLimited=${run.isRateLimited} exit=${run.exitCode}`);
if (run.exitCode !== 0) {
  console.error(`  result: ${run.result.slice(-500)}`);
}

await step('read HELLO.md', async () => {
  const text = await readFile(machine.id, `${DEFAULT_APP_DIR}/HELLO.md`);
  if (!text.includes('hello')) throw new Error(`HELLO.md does not contain hello: ${JSON.stringify(text)}`);
});

await step('commit', async () => {
  const res = await execLong(
    machine.id,
    `git -C ${DEFAULT_APP_DIR} checkout -b ${branch} && git -C ${DEFAULT_APP_DIR} add HELLO.md && git -C ${DEFAULT_APP_DIR} commit -m "Add HELLO.md from the pilots smoke run"`,
    { timeoutMs: 60_000 },
  );
  if (res.exitCode !== 0) throw new Error(`commit failed (exit ${res.exitCode}): ${res.stderr}`);
});

await step('push branch', () => pushBranch(machine.id, DEFAULT_APP_DIR, branch));

const files = await step('pull .genie', () => pullTree(machine.id, '/home/pilot/.genie'));
for (const [name, data] of files) console.log(`  ${name} (${data.length} bytes)`);

if (flags.keep) {
  console.log(`keeping ${machine.name}; destroy it with: pilot machine destroy ${machine.name}`);
} else {
  await step('destroy machine', () => destroyMachine(machine.id));
}

printTimings();
console.log(`\nDelete the pushed branch when done:\n  git push origin --delete ${branch}`);
