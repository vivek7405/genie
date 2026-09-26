// The three real stages against the dependency fake: no machine, no Claude,
// no GitHub. Each test inserts its own task row and calls runStage directly.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../helpers/db.ts');
const { fakeDeps, okRun, PLAN_TEXT } = await import('../helpers/stage-deps.ts');
const { projects, tasks } = await import('#db/schema.server.ts');
const stages = await import('#modules/pipeline/stages.server.ts');
const { runStage, setStageDeps, APP_DIR } = stages;
const { listEvents } = await import('#modules/tasks/queries/list-events.server.ts');

type Fake = ReturnType<typeof fakeDeps>;
type TaskRow = typeof tasks.$inferSelect;
type TaskInsert = typeof tasks.$inferInsert;

const [project] = await db.insert(projects).values({ name: 'stages', githubRepo: 'harness/stages', defaultBranch: 'main' }).returning();

let fake: Fake;
let restore: () => void;
beforeEach(() => {
  fake = fakeDeps();
  restore = setStageDeps(fake.deps);
});
afterEach(() => {
  restore();
  delete process.env.GENIE_SELF_REVIEW;
});

async function insertTask(patch: Partial<TaskInsert> = {}): Promise<TaskRow> {
  const [row] = await db.insert(tasks).values({ projectId: project.id, title: 'Add an about page', ...patch }).returning();
  return row;
}

async function reload(id: string): Promise<TaskRow> {
  return (await db.query.tasks.findFirst({ where: { id } }))!;
}

async function messages(id: string, kind?: string): Promise<string[]> {
  return (await listEvents(id)).filter((e) => !kind || e.kind === kind).map((e) => e.message);
}

// Stage 1: todo to planning.

test('todo creates a machine, clones the repository and stores the machine on the row', async () => {
  const task = await insertTask();
  assert.equal(await runStage(task), 'planning');
  assert.equal(fake.machines.length, 1);
  assert.deepEqual(fake.clones, [{ machineId: 'm-1', dir: APP_DIR }]);
  const row = await reload(task.id);
  assert.equal(row.machineId, 'm-1');
  assert.equal(row.machineName, `genie-stages-${task.id.slice(0, 8)}`);
  const logs = await messages(task.id, 'log');
  assert.ok(logs.some((m) => m.startsWith('Machine genie-stages-')));
  assert.ok(logs.some((m) => m === `Cloned harness/stages into ${APP_DIR}`));
});

test('todo reuses a live machine that already holds the clone', async () => {
  const task = await insertTask({ machineId: 'm1', machineName: 'genie-stages-m1' });
  assert.equal(await runStage(task), 'planning');
  assert.equal(fake.machines.length, 0, 'no new machine');
  assert.equal(fake.clones.length, 0, 'no clone');
  assert.equal(fake.commands('test -d /home/pilot/app/.git').length, 1, 'one probe');
});

test('todo clones again into a live machine that lost the clone', async () => {
  fake.onCommand('test -d /home/pilot/app/.git', { stdout: '', exitCode: 1 });
  const task = await insertTask({ machineId: 'm1', machineName: 'genie-stages-m1' });
  assert.equal(await runStage(task), 'planning');
  assert.equal(fake.machines.length, 0);
  assert.deepEqual(fake.clones, [{ machineId: 'm1', dir: APP_DIR }]);
});

test('todo creates a new machine when the probe throws', async () => {
  fake.onCommand('test -d /home/pilot/app/.git', new Error('machine not found'));
  const task = await insertTask({ machineId: 'm-gone', machineName: 'genie-stages-gone' });
  assert.equal(await runStage(task), 'planning');
  assert.equal(fake.machines.length, 1);
  assert.deepEqual(fake.clones, [{ machineId: 'm-1', dir: APP_DIR }]);
  assert.equal((await reload(task.id)).machineId, 'm-1');
});

// Stage 2: planning to in_progress.

test('planning runs one timeboxed Claude run, stores the plan and comments on the issue', async () => {
  const task = await insertTask({ status: 'planning', machineId: 'm1', machineName: 'genie-stages-m1', githubIssueNumber: 4 });
  assert.equal(await runStage(task), 'in_progress');
  assert.equal(fake.claudeRuns.length, 1);
  const run = fake.claudeRuns[0];
  assert.equal(run.maxTurns, 12);
  assert.equal(run.timeoutMs, 180_000);
  assert.equal(run.logPath, '/home/pilot/agent.log');
  assert.equal(run.cwd, APP_DIR);
  assert.ok(run.prompt.includes('Issue #4: Issue 4 title'), 'the issue text is the task text');
  assert.ok(run.prompt.includes('Issue 4 body'));
  assert.ok(run.prompt.includes('Write the plan to `/home/pilot/PLAN.md`'));
  assert.ok(!run.prompt.includes('{{'));
  assert.deepEqual(fake.issueReads, [4]);
  assert.deepEqual(fake.fileReads, ['/home/pilot/PLAN.md']);
  assert.equal((await reload(task.id)).plan, PLAN_TEXT);
  assert.equal(fake.comments.length, 1);
  assert.equal(fake.comments[0].issueNumber, 4);
  assert.ok(fake.comments[0].body.startsWith('<!-- genie-plan -->\n'));
  assert.ok(fake.comments[0].body.includes(PLAN_TEXT));
  assert.ok((await messages(task.id, 'github')).includes('Plan posted on issue #4'));
});

test('planning without an issue uses the task text and posts no comment', async () => {
  const task = await insertTask({ status: 'planning', machineId: 'm1', description: 'Team list at /about.' });
  assert.equal(await runStage(task), 'in_progress');
  assert.equal(fake.issueReads.length, 0);
  assert.equal(fake.comments.length, 0);
  assert.ok(fake.claudeRuns[0].prompt.includes('Task: Add an about page'));
  assert.ok(fake.claudeRuns[0].prompt.includes('Team list at /about.'));
});

test('planning tells the prompt when the repository is empty, and only then', async () => {
  for (const [probe, expected] of [['0\n3\n', 'The Stack line is therefore `empty-repo-webjs`'], ['1\n3\n', 'already has code'], ['0\n40\n', 'already has code'], ['garbage\n', 'already has code']] as const) {
    fake = fakeDeps().onCommand('git ls-files | wc -l', { stdout: probe });
    restore();
    restore = setStageDeps(fake.deps);
    const task = await insertTask({ status: 'planning', machineId: 'm1' });
    await runStage(task);
    assert.ok(fake.claudeRuns[0].prompt.includes(expected), `probe ${JSON.stringify(probe)} yields ${expected}`);
  }
});

test('stackFromPlan parses the three branches and defaults to existing', () => {
  assert.deepEqual(stages.stackFromPlan('## Stack\nempty-repo-webjs\n\n## Files to touch'), { kind: 'empty-repo-webjs' });
  assert.deepEqual(stages.stackFromPlan('# Plan\n\n## Stack\n\nnew-app-webjs: ./apps/web/\n'), { kind: 'new-app-webjs', dir: 'apps/web' });
  assert.deepEqual(stages.stackFromPlan('## Stack\n`existing: Go, chi`'), { kind: 'existing', stack: 'Go, chi' });
  assert.deepEqual(stages.stackFromPlan('## Files to touch\n- x'), { kind: 'existing', stack: 'unknown' });
  assert.deepEqual(stages.stackFromPlan(null), { kind: 'existing', stack: 'unknown' });
  assert.equal(stages.appDirOf({ plan: '## Stack\nnew-app-webjs: apps/web' }), `${APP_DIR}/apps/web`);
  assert.equal(stages.appDirOf({ plan: '## Stack\nexisting: Rails' }), APP_DIR);
});

test('planning accepts a non-zero exit when PLAN.md exists', async () => {
  fake.onClaude(() => okRun({ exitCode: 1, subtype: 'error_max_turns', result: '' }));
  const task = await insertTask({ status: 'planning', machineId: 'm1' });
  assert.equal(await runStage(task), 'in_progress');
  assert.equal((await reload(task.id)).plan, PLAN_TEXT);
});

test('planning fails when no PLAN.md was written', async () => {
  fake.onReadFile(() => { throw new Error('readFile /home/pilot/PLAN.md failed (exit 1): no such file'); });
  const task = await insertTask({ status: 'planning', machineId: 'm1', githubIssueNumber: 5 });
  await assert.rejects(runStage(task), /Planning produced no PLAN.md/);
  assert.equal((await reload(task.id)).plan, null);
  assert.equal(fake.comments.length, 0);
});

test('a rate-limited run throws RateLimitedError before the plan is read', async () => {
  const resetsAt = new Date('2026-09-26T12:00:00Z');
  fake.onClaude(() => okRun({ exitCode: 1, result: '', isRateLimited: true, resetsAt }));
  const task = await insertTask({ status: 'planning', machineId: 'm1' });
  await assert.rejects(runStage(task), (err: unknown) => {
    assert.ok(err instanceof stages.RateLimitedError);
    assert.equal(err.resetsAt, resetsAt);
    assert.match(err.message, /rate limited until 2026-09-26T12:00:00/);
    return true;
  });
  assert.equal(fake.fileReads.length, 0);
});

test('a re-run of planning overwrites the plan and does not repost the comment', async () => {
  const task = await insertTask({ status: 'planning', machineId: 'm1', githubIssueNumber: 6, plan: '## Stack\nexisting: old' });
  assert.equal(await runStage(task), 'in_progress');
  assert.equal(fake.claudeRuns.length, 1);
  assert.equal((await reload(task.id)).plan, PLAN_TEXT);
  assert.equal(fake.comments.length, 0);
});

test('planning without a machine fails with a pointer to Retry from Todo', async () => {
  const task = await insertTask({ status: 'planning' });
  await assert.rejects(runStage(task), /Task has no machine/);
});

test('runStage returns null for a status the system does not own', async () => {
  const task = await insertTask({ status: 'ready_for_review' });
  assert.equal(await runStage(task), null);
  assert.equal(fake.execs.length, 0);
});
