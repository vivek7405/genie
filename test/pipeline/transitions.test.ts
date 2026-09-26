// deferTask parks a task without failing it, a completed stage clears the
// deferral history, and Retry starts the attempt count over. Runs against
// its own migrated temp database (test/helpers/db.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { db, eventsOf } = await import('../helpers/db.ts');
const { projects, tasks } = await import('#db/schema.server.ts');
const { deferTask, transition } = await import('#modules/pipeline/transitions.server.ts');
const { retryTask } = await import('#modules/tasks/actions/retry-task.server.ts');
const { clock } = await import('#modules/tasks/utils/ui/clock.ts');
const { signInAs, actingAs } = await import('../helpers/auth.ts');

const { user, cookies } = await signInAs('harness');
const [project] = await db.insert(projects).values({ userId: user.id, name: 't', githubRepo: `harness/transitions-${Date.now()}` }).returning();

async function load(id: string) {
  return (await db.query.tasks.findFirst({ where: { id } }))!;
}

test('deferTask sets the three columns, releases the claim and writes the feed line', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'wait', status: 'planning', claimedAt: new Date(), attempt: 2 }).returning();
  const until = Date.now() + 5 * 60_000;
  await deferTask(task.id, until, 'Waiting for Claude quota');
  const row = await load(task.id);
  assert.equal(row.deferredUntil?.getTime(), until);
  assert.equal(row.deferReason, 'Waiting for Claude quota');
  assert.equal(row.deferCount, 1);
  assert.equal(row.claimedAt, null);
  assert.equal(row.error, null, 'a deferral is not a failure');
  assert.equal(row.attempt, 2, 'the stage keeps its attempt number');
  const line = (await eventsOf(task.id)).find((e) => e.kind === 'log');
  assert.equal(line?.message, `Waiting for Claude quota, retrying at ${clock(new Date(until))}`);

  await deferTask(task.id, until + 60_000, 'Waiting for Claude quota');
  assert.equal((await load(task.id)).deferCount, 2, 'consecutive deferrals count up');
});

test('a system transition resets the deferral history', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'done-with-it', status: 'planning' }).returning();
  await deferTask(task.id, Date.now() + 60_000, 'Waiting for Claude quota');
  const moved = await transition(task.id, 'in_progress', 'system');
  assert.equal(moved.success, true);
  const row = await load(task.id);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.deferredUntil, null);
  assert.equal(row.deferReason, null);
  assert.equal(row.deferCount, 0);
  assert.equal(row.claimedAt, null);
});

test('retryTask clears the error, the deferral and the attempt count', async () => {
  const [task] = await db.insert(tasks).values({
    projectId: project.id, title: 'again', status: 'in_progress', error: 'boom', attempt: 3,
    deferredUntil: new Date(Date.now() + 60_000), deferReason: 'Waiting for Claude quota', deferCount: 2,
  }).returning();
  const form = new FormData();
  form.set('taskId', task.id);
  const result = await actingAs(cookies, () => retryTask(form));
  assert.equal(result.success, true);
  const row = await load(task.id);
  assert.equal(row.error, null);
  assert.equal(row.attempt, 0);
  assert.equal(row.deferredUntil, null);
  assert.equal(row.deferReason, null);
  assert.equal(row.deferCount, 0);
  assert.equal(row.status, 'in_progress', 'the task stays in the column it failed in');
});
