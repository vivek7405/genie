// A deferred task reads as Waiting on the board and on its card, with the
// reason and the retry clock; a failed task still reads as Failed. Rendered
// through the real request pipeline against the test database.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { db, appDir } = await import('../helpers/db.ts');
const { projects, tasks } = await import('#db/schema.server.ts');
const { createRequestHandler } = await import('@webjsdev/server');
const { testRequest } = await import('@webjsdev/server/testing');
const { clock } = await import('#modules/tasks/utils/ui/clock.ts');

const app = await createRequestHandler({ appDir, dev: true });
const [project] = await db.insert(projects).values({ name: 'copy', githubRepo: `harness/copy-${Date.now()}` }).returning();

test('a deferred task shows Waiting and the retry clock on the board and the card', async () => {
  const until = new Date(Date.now() + 30 * 60_000);
  const [task] = await db.insert(tasks).values({
    projectId: project.id, title: 'Quota bound', status: 'planning', attempt: 1,
    deferredUntil: until, deferReason: 'Waiting for Claude quota', deferCount: 1,
  }).returning();
  const line = `Waiting for Claude quota, retrying at ${clock(until)}`;

  const board = await (await testRequest(app.handle, `/dashboard/projects/${project.id}`)).text();
  assert.ok(board.includes(line), 'the board card carries the one-liner');

  const card = await (await testRequest(app.handle, `/dashboard/projects/${project.id}/tasks/${task.id}`)).text();
  assert.match(card, />Waiting<\/span>/);
  assert.ok(card.includes(`${line}.`), 'the card page prints the reason under the badge');
  assert.doesNotMatch(card, />Plan<\/span>/, 'the stage label yields to Waiting');
});

test('a deferral in the past no longer reads as Waiting, and a failure wins over a deferral', async () => {
  const [past] = await db.insert(tasks).values({
    projectId: project.id, title: 'Back in line', status: 'planning', deferredUntil: new Date(Date.now() - 60_000), deferReason: 'Waiting for Claude quota',
  }).returning();
  const back = await (await testRequest(app.handle, `/dashboard/projects/${project.id}/tasks/${past.id}`)).text();
  assert.doesNotMatch(back, />Waiting<\/span>/);
  assert.match(back, />Plan<\/span>/);

  const [failed] = await db.insert(tasks).values({
    projectId: project.id, title: 'Broke', status: 'in_progress', attempt: 2, error: 'boom', deferredUntil: new Date(Date.now() + 60_000), deferReason: 'Waiting for Claude quota',
  }).returning();
  const red = await (await testRequest(app.handle, `/dashboard/projects/${project.id}/tasks/${failed.id}`)).text();
  assert.match(red, />Failed<\/span>/);
  assert.doesNotMatch(red, />Waiting<\/span>/);
  const board = await (await testRequest(app.handle, `/dashboard/projects/${project.id}`)).text();
  assert.match(board, /Failed on attempt 2, open to retry/);
});
