import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { aProject, aTask, db, feedOf, rowOf } from '../helpers/db.ts';
import { tasks } from '#db/schema.server.ts';
import { inArray } from 'drizzle-orm';
import { drain, releaseClaims, setStageRunner, tick } from '#modules/pipeline/worker.server.ts';
import { SYSTEM_TRANSITIONS } from '#modules/tasks/utils/state-machine.ts';
import type { Task } from '#db/schema.server.ts';

const advance = async (t: Task) => SYSTEM_TRANSITIONS[t.status] ?? null;

beforeEach(async () => {
  await drain();
  await db.update(tasks).set({ status: 'done', claimedAt: null }).where(inArray(tasks.status, ['backlog', 'in_progress']));
  process.env.GENIE_CONCURRENCY = '5';
});
afterEach(async () => {
  await drain();
  setStageRunner(null);
});

test('a tick walks a card forward one column at a time', async () => {
  setStageRunner(advance);
  const p = await aProject();
  const t = await aTask(p.id);
  assert.deepEqual(await tick(), [t.id]);
  await drain();
  assert.equal((await rowOf(t.id)).status, 'in_progress');
  await tick();
  await drain();
  const row = await rowOf(t.id);
  assert.equal(row.status, 'review');
  assert.equal(row.claimedAt, null);
  assert.deepEqual(await tick(), []);
});

test('one task per repository runs at a time, oldest first', async () => {
  let release = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  setStageRunner(async (t) => { await gate; return advance(t); });
  const p = await aProject();
  const first = await aTask(p.id, { createdAt: new Date(1000) });
  await aTask(p.id, { createdAt: new Date(2000) });
  const other = await aTask((await aProject()).id, { createdAt: new Date(3000) });
  assert.deepEqual(await tick(), [first.id, other.id]);
  assert.deepEqual(await tick(), []);
  release();
});

test('the concurrency limit holds across overlapping ticks', async () => {
  process.env.GENIE_CONCURRENCY = '1';
  let release = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  setStageRunner(async (t) => { await gate; return advance(t); });
  await aTask((await aProject()).id);
  await aTask((await aProject()).id);
  const [a, b] = await Promise.all([tick(), tick()]);
  assert.equal(a.length + b.length, 1);
  release();
});

test('a throwing stage leaves a red card and is not picked up again', async () => {
  setStageRunner(async () => { throw new Error('boom test-github-token'); });
  const t = await aTask((await aProject()).id);
  await tick();
  await drain();
  const row = await rowOf(t.id);
  assert.equal(row.status, 'backlog');
  assert.equal(row.error, 'boom [redacted]');
  assert.equal(row.claimedAt, null);
  assert.ok((await feedOf(t.id)).includes('boom [redacted]'));
  assert.deepEqual(await tick(), []);
});

test('a stage past its deadline fails instead of holding the slot', async () => {
  setStageRunner(() => new Promise(() => {}), 10);
  const t = await aTask((await aProject()).id);
  await tick();
  await drain();
  assert.match((await rowOf(t.id)).error ?? '', /Gave up/);
});

test('a card deleted after the query is not run', async () => {
  let ran = false;
  setStageRunner(async (t) => { ran = true; return advance(t); });
  const t = await aTask((await aProject()).id);
  const started = tick();
  await db.delete(tasks).where(inArray(tasks.id, [t.id]));
  await started;
  await drain();
  assert.equal(ran, false);
});

test('a card another process already claimed is not run again', async () => {
  let ran = false;
  setStageRunner(async (t) => { ran = true; return advance(t); });
  const t = await aTask((await aProject()).id, { claimedAt: new Date() });
  await tick();
  await drain();
  assert.equal(ran, false);
  await db.update(tasks).set({ status: 'done', claimedAt: null }).where(inArray(tasks.id, [t.id]));
});

test('a restart releases the dead process claims so the next tick resumes them', async () => {
  const t = await aTask((await aProject()).id, { status: 'in_progress', claimedAt: new Date() });
  const released = await releaseClaims();
  assert.deepEqual(released.map((r) => r.id), [t.id]);
  assert.equal((await rowOf(t.id)).claimedAt, null);
  assert.ok((await feedOf(t.id)).some((m) => m.includes('Interrupted by a restart')));
});
