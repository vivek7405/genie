// The worker with the M1 stub stage: one tick claims a Todo task and the stub
// walks it to Review. Human verdicts then move it on. Runs against
// its own migrated temp database (test/helpers/db.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GENIE_STUB_STEP_MS = '0';

const { db } = await import('../helpers/db.ts');
const { projects, tasks } = await import('#db/schema.server.ts');
const { tick, drain } = await import('#modules/pipeline/worker.server.ts');
const { transition } = await import('#modules/pipeline/transitions.server.ts');
const { listEvents } = await import('#modules/tasks/queries/list-events.server.ts');

const [project] = await db.insert(projects).values({ name: 'w', githubRepo: `harness/worker-${Date.now()}` }).returning();

async function statusOf(id: string) {
  return (await db.query.tasks.findFirst({ where: { id } }))!.status;
}

test('the stub pipeline walks a task from todo to ready_for_review', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'walk' }).returning();
  for (let i = 0; i < 3; i++) {
    const started = await tick({ concurrency: 1 });
    assert.ok(started.includes(task.id), `tick ${i} claims the task`);
    await drain();
  }
  assert.equal(await statusOf(task.id), 'ready_for_review');
  assert.deepEqual((await tick({ concurrency: 1 })).includes(task.id), false, 'nothing left for the system to do');
  const kinds = (await listEvents(task.id)).map((e) => e.kind);
  assert.ok(kinds.includes('log') && kinds.includes('status'));
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
  assert.equal(await statusOf(task.id), 'in_progress');
});
