// The worker over the stage dependency fake: one tick claims a Todo task and
// the stages walk it to Review. Human verdicts then move it on. Runs against
// its own migrated temp database (test/helpers/db.ts).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../helpers/db.ts');
const { fakeDeps } = await import('../helpers/stage-deps.ts');
const { projects, tasks } = await import('#db/schema.server.ts');
const { setStageDeps } = await import('#modules/pipeline/stages.server.ts');
const { tick, drain } = await import('#modules/pipeline/worker.server.ts');
const { transition } = await import('#modules/pipeline/transitions.server.ts');
const { listEvents } = await import('#modules/tasks/queries/list-events.server.ts');

const [project] = await db.insert(projects).values({ name: 'w', githubRepo: `harness/worker-${Date.now()}` }).returning();

let fake: ReturnType<typeof fakeDeps>;
let restore: () => void;
beforeEach(() => {
  fake = fakeDeps();
  restore = setStageDeps(fake.deps);
});
afterEach(() => restore());

async function rowOf(id: string) {
  return (await db.query.tasks.findFirst({ where: { id } }))!;
}

test('the pipeline walks a task from todo to ready_for_review', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'walk' }).returning();
  for (let i = 0; i < 3; i++) {
    const started = await tick({ concurrency: 1 });
    assert.ok(started.includes(task.id), `tick ${i} claims the task`);
    await drain();
  }
  const row = await rowOf(task.id);
  assert.equal(row.status, 'ready_for_review');
  assert.equal(row.error, null);
  assert.equal(row.machineId, 'm-1');
  assert.deepEqual((await tick({ concurrency: 1 })).includes(task.id), false, 'nothing left for the system to do');
  const kinds = (await listEvents(task.id)).map((e) => e.kind);
  assert.ok(kinds.includes('log') && kinds.includes('status'));
});

test('a stage that throws leaves the task in its column with the error, and it is not re-claimed', async () => {
  fake.onCommand('test -d /home/pilot/app/.git', new Error('the fleet is down'));
  setStageDeps({ createTaskMachine: async () => { throw new Error('pilots machine quota reached (20). Destroy finished task machines and retry.'); } });
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'fails', machineId: 'm-old' }).returning();
  assert.ok((await tick({ concurrency: 1 })).includes(task.id));
  await drain();
  const row = await rowOf(task.id);
  assert.equal(row.status, 'todo');
  assert.match(row.error ?? '', /quota reached/);
  assert.equal(row.claimedAt, null);
  assert.ok((await listEvents(task.id)).some((e) => e.kind === 'error' && /quota reached/.test(e.message)));
  assert.equal((await tick({ concurrency: 1 })).includes(task.id), false, 'a failed task waits for Retry');
});

test('concurrency caps how many tasks run at once', async () => {
  const rows = await db.insert(tasks).values([
    { projectId: project.id, title: 'a' },
    { projectId: project.id, title: 'b' },
  ]).returning();
  const started = await tick({ concurrency: 1 });
  assert.equal(started.filter((id) => rows.some((r) => r.id === id)).length, 1);
  await drain();
});

test('the reviewer verdicts are enforced by the state machine', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'verdict', status: 'ready_for_review' }).returning();
  const early = await transition(task.id, 'done', 'system');
  assert.equal(early.success, false);
  const back = await transition(task.id, 'in_progress', 'human', 'nope');
  assert.equal(back.success, true);
  assert.equal((await rowOf(task.id)).status, 'in_progress');
});

test('Retry clears the failure and the attempt count, and the next tick re-runs the stage on the same machine', async () => {
  const { retryTask } = await import('#modules/tasks/actions/retry-task.server.ts');
  const { taskEvents } = await import('#db/schema.server.ts');
  // The tick claims the oldest claimable row first, so the queue must be empty.
  await db.delete(taskEvents);
  await db.delete(tasks);
  const [task] = await db.insert(tasks).values({
    projectId: project.id, title: 'retry', status: 'in_progress', error: 'npm test exited 1', attempt: 2, feedback: 'make it dark mode',
    machineId: 'm-kept', machineName: 'genie-w-kept', branch: 'genie/x', prNumber: 7, prUrl: 'https://github.com/harness/w/pull/7', claimedAt: new Date(),
  }).returning();
  const form = new FormData();
  form.set('taskId', task.id);
  const result = await retryTask(form);
  assert.ok(result.success);
  let row = await rowOf(task.id);
  assert.equal(row.error, null);
  assert.equal(row.claimedAt, null);
  assert.equal(row.attempt, 0);
  assert.equal(row.feedback, 'make it dark mode', 'the pending feedback survives a retry');
  assert.ok((await listEvents(task.id)).some((e) => e.message === 'Retrying'));

  const started = await tick({ concurrency: 1 });
  assert.ok(started.includes(task.id));
  await drain();
  row = await rowOf(task.id);
  assert.equal(row.attempt, 1, 'attempts count from the retry');
  assert.equal(row.status, 'ready_for_review');
  assert.equal(row.machineId, 'm-kept', 'the machine is reused');
  assert.equal(fake.machines.length, 0, 'no new machine');
  assert.deepEqual(fake.pushes.map((p) => p.machineId), ['m-kept']);
  assert.equal(row.feedback, null, 'the revise applied it');
});
