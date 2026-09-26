// The worker with the M1 stub stage: one tick claims a Todo task and the stub
// walks it to Review. Human verdicts then move it on. Then the claim rules:
// deferrals, the per-project cap, stage-aware stale claims, the attempt
// ceiling, the drain on stop and the boot-time claim release. Runs against
// its own migrated temp database (test/helpers/db.ts).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.GENIE_STUB_STEP_MS = '0';

const { db } = await import('../helpers/db.ts');
const { projects, tasks } = await import('#db/schema.server.ts');
const { eq, inArray } = await import('drizzle-orm');
const { tick, drain, nextDeferral, releaseClaims, stopWorker, setStageRunner, workerStatus, STALE_AFTER_MS } = await import('#modules/pipeline/worker.server.ts');
const { transition } = await import('#modules/pipeline/transitions.server.ts');
const { listEvents } = await import('#modules/tasks/queries/list-events.server.ts');

const [project] = await db.insert(projects).values({ name: 'w', githubRepo: `harness/worker-${Date.now()}` }).returning();

// Every rule test gets its own project so the per-project cap never bleeds
// between tests.
let seq = 0;
async function freshProject() {
  const [p] = await db.insert(projects).values({ name: `p${seq}`, githubRepo: `harness/worker-${Date.now()}-${seq++}` }).returning();
  return p;
}

async function load(id: string) {
  return (await db.query.tasks.findFirst({ where: { id } }))!;
}
async function statusOf(id: string) {
  return (await load(id)).status;
}
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

// Each test starts with no claimable work left by the one before: whatever
// the stub walked part way is parked in Done, out of the worker's query.
beforeEach(async () => {
  await drain();
  await db.update(tasks).set({ status: 'done', claimedAt: null }).where(inArray(tasks.status, ['todo', 'planning', 'in_progress']));
});

afterEach(async () => {
  setStageRunner(null);
  delete process.env.GENIE_DRAIN_MS;
  delete process.env.GENIE_MAX_ATTEMPTS;
  await drain();
});

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

test('a deferred task is skipped until its deferral passes, then claimed and cleared', async () => {
  const p = await freshProject();
  const [task] = await db.insert(tasks).values({ projectId: p.id, title: 'later', deferredUntil: new Date(Date.now() + 60 * 60_000), deferReason: 'Waiting for Claude quota' }).returning();
  assert.equal((await tick({ concurrency: 2 })).includes(task.id), false, 'an hour ahead: not claimed');
  await db.update(tasks).set({ deferredUntil: minutesAgo(1) }).where(eq(tasks.id, task.id));
  assert.ok((await tick({ concurrency: 2 })).includes(task.id), 'in the past: claimed');
  await drain();
  const row = await load(task.id);
  assert.equal(row.deferredUntil, null);
  assert.equal(row.deferReason, null);
  assert.equal(row.status, 'planning');
});

test('nextDeferral follows 5, 15, 30, 60 minutes and trusts a plausible reset instant', () => {
  const now = 1_000_000_000_000;
  const minutes = (count: number, resetsAt: Date | null = null) => (nextDeferral(count, resetsAt, now) - now) / 60_000;
  assert.deepEqual([0, 1, 2, 3, 9].map((c) => minutes(c)), [5, 15, 30, 60, 60]);
  const soon = new Date(now + 40 * 60_000);
  assert.equal(nextDeferral(0, soon, now), soon.getTime() + 60_000, 'a reset 40 minutes out wins and lands a minute after it');
  assert.equal(minutes(0, new Date(now + 7 * 60 * 60_000)), 5, 'a reset 7 hours out is ignored');
  assert.equal(minutes(1, new Date(now - 60_000)), 15, 'a reset in the past is ignored');
});

test('a rate limit defers the task instead of failing it, and the resumed claim keeps its attempt', async () => {
  const p = await freshProject();
  const [task] = await db.insert(tasks).values({ projectId: p.id, title: 'quota' }).returning();
  let resetsAt: Date | null = null;
  setStageRunner(async () => {
    const err = new Error('Claude usage limit reached');
    err.name = 'RateLimitedError';
    Object.assign(err, { resetsAt });
    throw err;
  });
  assert.ok((await tick({ concurrency: 1 })).includes(task.id));
  await drain();
  let row = await load(task.id);
  assert.equal(row.error, null, 'a rate limit is a wait, not an error');
  assert.ok(row.deferredUntil && row.deferredUntil.getTime() > Date.now() + 4 * 60_000, 'deferred by the first backoff step');
  assert.equal(row.deferReason, 'Waiting for Claude quota');
  assert.equal(row.deferCount, 1);
  assert.equal(row.attempt, 1);
  assert.equal(row.claimedAt, null);
  assert.ok((await listEvents(task.id)).some((e) => e.kind === 'log' && e.message.includes('Waiting for Claude quota, retrying at')));

  // The window resets in 10 minutes: the deferral lands a minute after it.
  resetsAt = new Date(Date.now() + 10 * 60_000);
  await db.update(tasks).set({ deferredUntil: minutesAgo(1) }).where(eq(tasks.id, task.id));
  assert.ok((await tick({ concurrency: 1 })).includes(task.id), 'claimed again once the deferral passed');
  await drain();
  row = await load(task.id);
  assert.equal(row.attempt, 1, 'a deferred re-claim is the same attempt');
  assert.equal(row.deferCount, 2);
  assert.equal(row.deferredUntil?.getTime(), resetsAt.getTime() + 60_000);
  assert.equal(row.error, null);
});

test('at most one task per project runs at once, in memory', async () => {
  const one = await freshProject();
  const two = await freshProject();
  const same = await db.insert(tasks).values([{ projectId: one.id, title: 'x' }, { projectId: one.id, title: 'y' }]).returning();
  const started = await tick({ concurrency: 2 });
  assert.equal(started.filter((id) => same.some((r) => r.id === id)).length, 1, 'one project, one slot');
  await drain();

  const apart = await db.insert(tasks).values([{ projectId: two.id, title: 'x' }]).returning();
  await db.update(tasks).set({ status: 'ready_for_review' }).where(eq(tasks.projectId, one.id));
  const [free] = await db.insert(tasks).values([{ projectId: (await freshProject()).id, title: 'z' }]).returning();
  const both = await tick({ concurrency: 2 });
  assert.ok(both.includes(apart[0].id) && both.includes(free.id), 'two projects, two slots');
  await drain();
});

test('a fresh claim on a sibling blocks the project in SQL, not other projects', async () => {
  const a = await freshProject();
  const b = await freshProject();
  await db.insert(tasks).values({ projectId: a.id, title: 'running', status: 'in_progress', claimedAt: new Date() });
  const [siblingA] = await db.insert(tasks).values({ projectId: a.id, title: 'waits' }).returning();
  const [taskB] = await db.insert(tasks).values({ projectId: b.id, title: 'goes' }).returning();
  const started = await tick({ concurrency: 3 });
  assert.equal(started.includes(siblingA.id), false, 'project A has a live claim elsewhere');
  assert.ok(started.includes(taskB.id), 'project B is unaffected');
  await drain();
});

test('a stale claim is re-claimed after its stage window, with an expired line in the feed', async () => {
  const p = await freshProject();
  const [plan] = await db.insert(tasks).values({ projectId: p.id, title: 'crashed plan', status: 'planning', attempt: 1, claimedAt: minutesAgo(20) }).returning();
  assert.ok((await tick({ concurrency: 1 })).includes(plan.id), 'planning is stale after 15 minutes');
  await drain();
  assert.ok((await listEvents(plan.id)).some((e) => e.message === 'Claim from attempt 1 expired after 20 min, re-claiming'));
  assert.equal((await load(plan.id)).attempt, 2, 'a stale re-claim is a new attempt');
  await db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, plan.id));

  const q = await freshProject();
  const [build] = await db.insert(tasks).values({ projectId: q.id, title: 'long build', status: 'in_progress', attempt: 1, claimedAt: minutesAgo(20) }).returning();
  assert.equal((await tick({ concurrency: 1 })).includes(build.id), false, 'a 20 minute old build claim is live');
  await db.update(tasks).set({ claimedAt: minutesAgo(100) }).where(eq(tasks.id, build.id));
  assert.ok((await tick({ concurrency: 1 })).includes(build.id), 'at 100 minutes it is stale');
  await drain();
  assert.equal(STALE_AFTER_MS.in_progress, 90 * 60_000);
});

test('a stale task past the attempt ceiling is failed, not re-claimed', async () => {
  const p = await freshProject();
  const [task] = await db.insert(tasks).values({ projectId: p.id, title: 'loop', status: 'planning', attempt: 3, claimedAt: minutesAgo(20) }).returning();
  const started = await tick({ concurrency: 1 });
  assert.equal(started.includes(task.id), false);
  const row = await load(task.id);
  assert.equal(row.error, 'Gave up after 3 attempts: the stage never completed');
  assert.equal(row.status, 'planning');
  assert.equal(row.claimedAt, null);
  assert.ok((await listEvents(task.id)).some((e) => e.kind === 'error'));
});

test('stopWorker drains, then releases the claims of what is still running', async () => {
  const p = await freshProject();
  const [task] = await db.insert(tasks).values({ projectId: p.id, title: 'hangs' }).returning();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  setStageRunner(async () => { await gate; return null; });
  try {
    assert.ok((await tick({ concurrency: 1 })).includes(task.id));
    assert.equal(workerStatus().running.length, 1);

    process.env.GENIE_DRAIN_MS = '50';
    await stopWorker();
    const row = await load(task.id);
    assert.equal(row.claimedAt, null);
    assert.ok((await listEvents(task.id)).some((e) => e.message.startsWith('Interrupted by a shutdown during Todo')));
    assert.equal(workerStatus().stopping, false, 'the worker can be started again');
  } finally {
    finish();
  }
  await drain();
});

test('releaseClaims at boot clears system-stage claims only, and the first tick re-claims them', async () => {
  const p = await freshProject();
  const [live] = await db.insert(tasks).values({ projectId: p.id, title: 'interrupted', status: 'planning', attempt: 1, claimedAt: minutesAgo(2) }).returning();
  const [review] = await db.insert(tasks).values({ projectId: p.id, title: 'in review', status: 'ready_for_review', claimedAt: minutesAgo(180) }).returning();
  const released = await releaseClaims('restart');
  assert.deepEqual(released.map((r) => r.id), [live.id]);
  assert.equal((await load(live.id)).claimedAt, null);
  assert.equal((await load(review.id)).claimedAt?.getTime(), review.claimedAt?.getTime(), 'a human-owned row is untouched');
  assert.ok((await listEvents(live.id)).some((e) => e.message === 'Interrupted by a restart during Plan, the next worker resumes it'));
  assert.ok((await tick({ concurrency: 1 })).includes(live.id), 'no stale window to wait out');
  await drain();
  assert.equal(await statusOf(live.id), 'in_progress');
});
