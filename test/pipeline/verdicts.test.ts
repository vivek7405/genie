import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PilotsClient } from '@pilots/sdk';
import { aProject, aTask, db, feedOf, json, rowOf } from '../helpers/db.ts';
import { taskEvents } from '#db/schema.server.ts';
import { setGithubTransport } from '#modules/github/client.server.ts';
import { setPilotsClient } from '#modules/pipeline/pilots.server.ts';
import { approve, removeTask, requestChanges, retry, stop } from '#modules/pipeline/verdicts.server.ts';
import { canDelete, canStop, STOPPED } from '#modules/tasks/utils/state-machine.ts';
import { failStage, transition } from '#modules/pipeline/transitions.server.ts';
import { recordEvent } from '#modules/pipeline/events.server.ts';

function githubPr(pr: { merged?: boolean; state?: string }, mergeStatus = 200) {
  const calls: string[] = [];
  setGithubTransport(async (url, init) => {
    calls.push(`${init.method} ${url.replace('https://api.github.com/', '')}`);
    if (init.method === 'PUT') return mergeStatus === 200 ? json({ merged: true }) : json({ message: 'Merge conflict' }, mergeStatus);
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    return json({ number: 5, html_url: 'u', merged: pr.merged ?? false, state: pr.state ?? 'open', head: { ref: 'genie/x' } });
  });
  return calls;
}

function pilots() {
  const destroyed: string[] = [];
  setPilotsClient({ machines: { destroy: async (id: string) => { destroyed.push(id); } } } as unknown as PilotsClient);
  return destroyed;
}

function execs() {
  const cmds: string[] = [];
  setPilotsClient({ machines: { exec: async (_id: string, req: { cmd: string }) => {
    cmds.push(req.cmd);
    return { stdout: '', stderr: '', exit_code: 0 };
  } } } as unknown as PilotsClient);
  return cmds;
}

afterEach(() => {
  setGithubTransport(async () => new Response('offline', { status: 503 }));
  setPilotsClient(null);
});

test('approve squash merges, deletes the branch, destroys the machine, lands in Done', async () => {
  const calls = githubPr({});
  const destroyed = pilots();
  const p = await aProject();
  const t = await aTask(p.id, { status: 'review', prNumber: 5, machineId: 'm1' });
  const r = await approve(t, p);
  assert.equal(r.success, true);
  assert.ok(calls.some((c) => c.startsWith('PUT') && c.includes('/pulls/5/merge')));
  assert.ok(calls.some((c) => c.startsWith('DELETE') && c.endsWith('git/refs/heads/genie/x')));
  assert.deepEqual(destroyed, ['m1']);
  const row = await rowOf(t.id);
  assert.equal(row.status, 'done');
  assert.equal(row.machineId, null);
});

test('a refused merge stays in Review with the reason and keeps the machine', async () => {
  githubPr({}, 405);
  const destroyed = pilots();
  const p = await aProject();
  const t = await aTask(p.id, { status: 'review', prNumber: 5, machineId: 'm1' });
  const r = await approve(t, p);
  assert.equal(r.success, false);
  assert.match(!r.success ? r.error ?? '' : '', /Merge conflict/);
  assert.equal((await rowOf(t.id)).status, 'review');
  assert.deepEqual(destroyed, []);
});

test('a PR merged on GitHub already is not merged twice', async () => {
  const calls = githubPr({ merged: true });
  pilots();
  const p = await aProject();
  const t = await aTask(p.id, { status: 'review', prNumber: 5 });
  assert.equal((await approve(t, p)).success, true);
  assert.ok(!calls.some((c) => c.startsWith('PUT')));
  assert.equal((await rowOf(t.id)).status, 'done');
});

test('a PR closed on GitHub is reported, not claimed as merged', async () => {
  githubPr({ state: 'closed' });
  const p = await aProject();
  const t = await aTask(p.id, { status: 'review', prNumber: 5 });
  assert.equal((await approve(t, p)).success, false);
  assert.equal((await rowOf(t.id)).status, 'review');
});

test('approving something not in review is refused', async () => {
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', prNumber: 5 });
  assert.equal((await approve(t, p)).success, false);
});

test('request changes sends the card back with the feedback', async () => {
  const p = await aProject();
  const t = await aTask(p.id, { status: 'review', prNumber: 5, ciStatus: 'passing', previewUrl: 'https://old' });
  assert.equal((await requestChanges(t, 'Make it blue')).success, true);
  const row = await rowOf(t.id);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.feedback, 'Make it blue');
  assert.equal(row.ciStatus, null);
  assert.equal(row.previewUrl, null);
  assert.equal((await requestChanges(row, 'again')).success, false);
});

test('retry clears the error and keeps the column and machine', async () => {
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', error: 'boom', machineId: 'm1' });
  assert.equal((await retry(t)).success, true);
  const row = await rowOf(t.id);
  assert.equal(row.error, null);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.machineId, 'm1');
});

test('any idle card short of Done can be removed, so none is ever stuck', () => {
  const base = { error: null, claimedAt: null };
  assert.equal(canDelete({ ...base, status: 'backlog' }), true);
  assert.equal(canDelete({ ...base, status: 'backlog', claimedAt: new Date() }), false);
  assert.equal(canDelete({ ...base, status: 'in_progress' }), false);
  assert.equal(canDelete({ ...base, status: 'in_progress', error: 'x' }), true);
  assert.equal(canDelete({ ...base, status: 'review' }), true);
  assert.equal(canDelete({ ...base, status: 'done' }), false);
});

test('delete removes the card, its feed and its machine', async () => {
  const destroyed = pilots();
  const p = await aProject();
  const t = await aTask(p.id, { machineId: 'm1' });
  await recordEvent(t.id, 'log', 'hello');
  assert.equal((await removeTask(t)).success, true);
  assert.deepEqual(destroyed, ['m1']);
  assert.deepEqual(await feedOf(t.id), []);
  assert.equal(await db.query.tasks.findFirst({ where: { id: t.id } }), undefined);
  assert.ok(taskEvents);
});

test('stop marks the card and ends Claude on its machine', async () => {
  const cmds = execs();
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1', claimedAt: new Date() });
  assert.equal((await stop(t)).success, true);
  const row = await rowOf(t.id);
  assert.equal(row.error, STOPPED);
  assert.equal(row.claimedAt, null);
  assert.equal(row.status, 'in_progress');
  assert.ok(cmds.some((c) => c.includes('pkill')));
});

test('a run unwinding after a stop cannot move the card or replace the message', async () => {
  execs();
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', claimedAt: new Date() });
  await stop(t);
  assert.equal(await transition(t, 'review', 'system'), null);
  await failStage(t.id, 'pkill ended the run');
  const row = await rowOf(t.id);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.error, STOPPED);
});

test('only a queued or running card can be stopped', async () => {
  assert.equal(canStop({ status: 'backlog', error: null }), true);
  assert.equal(canStop({ status: 'in_progress', error: null }), true);
  assert.equal(canStop({ status: 'in_progress', error: 'x' }), false);
  assert.equal(canStop({ status: 'review', error: null }), false);
  const p = await aProject();
  assert.equal((await stop(await aTask(p.id, { status: 'review' }))).success, false);
});
