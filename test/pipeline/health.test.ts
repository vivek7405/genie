// GET /health through the real request pipeline (the worker is off in tests,
// GENIE_WORKER=0), then the wedged check with a started worker whose last
// tick is forced ten intervals into the past.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { db, appDir } = await import('../helpers/db.ts');
const { projects, tasks } = await import('#db/schema.server.ts');
const { createRequestHandler } = await import('@webjsdev/server');
const { testRequest } = await import('@webjsdev/server/testing');
const { getHealth } = await import('#modules/pipeline/health.server.ts');
const { startWorker, stopWorker, drain } = await import('#modules/pipeline/worker.server.ts');

const app = await createRequestHandler({ appDir, dev: true });
const [project] = await db.insert(projects).values({ name: 'h', githubRepo: `harness/health-${Date.now()}` }).returning();

after(async () => {
  await stopWorker();
  await drain();
});

test('GET /health is JSON with the worker off and the task counts', async () => {
  await db.insert(tasks).values([
    { projectId: project.id, title: 'claimed', status: 'ready_for_review', claimedAt: new Date() },
    { projectId: project.id, title: 'deferred', status: 'ready_for_review', deferredUntil: new Date(Date.now() + 60_000) },
    { projectId: project.id, title: 'was deferred', status: 'ready_for_review', deferredUntil: new Date(Date.now() - 60_000) },
    { projectId: project.id, title: 'failed one', status: 'ready_for_review', error: 'x' },
    { projectId: project.id, title: 'failed two', status: 'ready_for_review', error: 'y' },
  ]);
  const res = await testRequest(app.handle, '/health');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.worker.enabled, false);
  assert.deepEqual(body.worker.running, []);
  assert.deepEqual(body.tasks, { claimed: 1, deferred: 1, failed: 2 });
  assert.equal(body.sync.running, false);
  assert.equal(typeof body.uptimeSec, 'number');
});

test('a started worker that stopped ticking answers 503', async () => {
  startWorker({ intervalMs: 60_000, concurrency: 1 });
  // The first tick is kicked off synchronously; let it land.
  await new Promise((r) => setTimeout(r, 100));
  const fresh = await getHealth();
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.worker.enabled, true);
  assert.ok(fresh.body.worker.lastTickAt, 'the first tick has landed');

  const later = await getHealth(Date.now() + 10 * 60_000);
  assert.equal(later.status, 503);
  assert.equal(later.body.ok, false);
  assert.equal(later.body.worker.enabled, true);

  await stopWorker();
  const stopped = await getHealth(Date.now() + 10 * 60_000);
  assert.equal(stopped.status, 200, 'a stopped worker is not wedged');
  assert.equal(stopped.body.worker.enabled, false);
});
