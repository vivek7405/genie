// The three real stages against the dependency fake: no machine, no Claude,
// no GitHub. Each test inserts its own task row and calls runStage directly.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../helpers/db.ts');
const { fakeDeps } = await import('../helpers/stage-deps.ts');
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

test('runStage returns null for a status the system does not own', async () => {
  const task = await insertTask({ status: 'ready_for_review' });
  assert.equal(await runStage(task), null);
  assert.equal(fake.execs.length, 0);
});
