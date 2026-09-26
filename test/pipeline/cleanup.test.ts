// The machine sweep: the pure decision against a fixture that covers every
// rule, then runCleanup over a plain fake client that records its calls. No
// real machine is ever touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Machine } from '@pilots/sdk';

const { db, eventsOf } = await import('../helpers/db.ts');
const { projects, tasks } = await import('#db/schema.server.ts');
const { planCleanup, runCleanup } = await import('#modules/pipeline/cleanup.server.ts');
import type { Task } from '#modules/tasks/types.ts';

const DAY_MS = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const seconds = (ms: number) => Math.floor(ms / 1000);

function machine(over: Partial<Machine> & { id: string; name: string }): Machine {
  return {
    host_id: 'h1',
    state: 'suspended',
    knobs: { auto_stop: 'suspend', auto_start: true, min_machines_running: 0, soft_limit: 0, hard_limit: 0, idle_timeout: 60, schedules: null },
    vcpus: 1,
    mem_mib: 2048,
    url: `https://${over.name}.pilots.test`,
    created_at: seconds(NOW - 10 * DAY_MS),
    last_activity: seconds(NOW),
    ...over,
  };
}

const [project] = await db.insert(projects).values({ name: 'c', githubRepo: `harness/cleanup-${Date.now()}` }).returning();

async function task(over: Partial<typeof tasks.$inferInsert> & { title: string }): Promise<Task> {
  const [row] = await db.insert(tasks).values({ projectId: project.id, ...over }).returning();
  return row;
}

test('planCleanup applies the rules in order and never lists a tombstone', async () => {
  const done = await task({ title: 'done', status: 'done', machineId: 'm-done' });
  const oldFail = await task({ title: 'old fail', status: 'in_progress', error: 'boom', machineName: 'genie-repo-oldfail1', updatedAt: new Date(NOW - 5 * DAY_MS) });
  const newFail = await task({ title: 'new fail', status: 'planning', error: 'boom', machineId: 'm-newfail', updatedAt: new Date(NOW - 1 * DAY_MS) });
  const live = await task({ title: 'live', status: 'in_progress', machineId: 'm-live' });
  const baseJoined = await task({ title: 'base joined', status: 'done', machineId: 'm-base' });
  const fleet = [
    machine({ id: 'm-base', name: 'genie-base', labels: { genie_base: '1' } }),
    machine({ id: 'm-done', name: 'genie-repo-done0000' }),
    machine({ id: 'm-oldfail', name: 'genie-repo-oldfail1' }),
    machine({ id: 'm-newfail', name: 'genie-repo-newfail1' }),
    machine({ id: 'm-live', name: 'genie-repo-live0000' }),
    machine({ id: 'm-orphan-old', name: 'genie-repo-orphan01', created_at: seconds(NOW - 4 * DAY_MS) }),
    machine({ id: 'm-orphan-new', name: 'genie-repo-orphan02', created_at: seconds(NOW - 1 * DAY_MS) }),
    machine({ id: 'm-other', name: 'scratch', created_at: seconds(NOW - 400 * DAY_MS) }),
    machine({ id: 'm-gone', name: 'genie-repo-gone0000', state: 'destroyed' }),
  ];
  const plan = planCleanup(fleet, [done, oldFail, newFail, live, baseJoined], { now: NOW, olderThanDays: 3 });
  const by = Object.fromEntries(plan.map((d) => [d.machine.id, d]));
  assert.equal(plan.length, 8, 'the tombstone is not listed');
  assert.equal(by['m-gone'], undefined);
  assert.deepEqual([by['m-base'].action, by['m-base'].reason], ['keep', 'base checkpoint source']);
  assert.equal(by['m-base'].task, null, 'rule 2 beats the join: a done task pointing at genie-base does not doom it');
  assert.deepEqual([by['m-done'].action, by['m-done'].reason, by['m-done'].task?.id], ['destroy', 'task done', done.id]);
  assert.deepEqual([by['m-oldfail'].action, by['m-oldfail'].reason, by['m-oldfail'].task?.id], ['destroy', 'failed 5 days ago', oldFail.id], 'joined by name only');
  assert.deepEqual([by['m-newfail'].action, by['m-newfail'].reason], ['keep', 'failed recently, may be retried']);
  assert.deepEqual([by['m-live'].action, by['m-live'].reason], ['keep', 'in flight']);
  assert.deepEqual([by['m-orphan-old'].action, by['m-orphan-old'].reason], ['destroy', 'orphan, created 4 days ago']);
  assert.deepEqual([by['m-orphan-new'].action, by['m-orphan-new'].reason], ['keep', 'orphan, too young']);
  assert.deepEqual([by['m-other'].action, by['m-other'].reason], ['keep', 'not a genie machine'], 'no prefix and no join: kept however old');

  // A base machine that lost its label is still recognised by name.
  const [unlabeled] = planCleanup([machine({ id: 'm-base2', name: 'genie-base' })], [], { now: NOW, olderThanDays: 3 });
  assert.equal(unlabeled.action, 'keep');
});

test('the --days boundary is exact to the minute', async () => {
  const cutoffMinusOne = await task({ title: 'kept', status: 'in_progress', error: 'x', machineId: 'm-b1', updatedAt: new Date(NOW - 3 * DAY_MS + 60_000) });
  const cutoffPlusOne = await task({ title: 'gone', status: 'in_progress', error: 'x', machineId: 'm-b2', updatedAt: new Date(NOW - 3 * DAY_MS - 60_000) });
  const plan = planCleanup(
    [machine({ id: 'm-b1', name: 'genie-repo-b1' }), machine({ id: 'm-b2', name: 'genie-repo-b2' })],
    [cutoffMinusOne, cutoffPlusOne],
    { now: NOW, olderThanDays: 3 },
  );
  assert.deepEqual(plan.map((d) => d.action), ['keep', 'destroy']);
});

function fakeClient(fleet: Machine[]) {
  const destroyed: string[] = [];
  return {
    destroyed,
    client: {
      machines: {
        list: async () => fleet,
        destroy: async (id: string) => { destroyed.push(id); },
      },
    },
  };
}

test('runCleanup destroys nothing on a dry run, and on --yes destroys, clears the task and writes the feed line', async () => {
  const done = await task({ title: 'run done', status: 'done', machineId: 'm-run-done', machineName: 'genie-repo-rundone0' });
  const live = await task({ title: 'run live', status: 'planning', machineId: 'm-run-live' });
  const fleet = [
    machine({ id: 'm-base', name: 'genie-base', labels: { genie_base: '1' } }),
    machine({ id: 'm-run-done', name: 'genie-repo-rundone0' }),
    machine({ id: 'm-run-live', name: 'genie-repo-runlive0' }),
    machine({ id: 'm-run-orphan', name: 'genie-repo-orphan99', created_at: seconds(NOW - 30 * DAY_MS) }),
  ];

  const dry = fakeClient(fleet);
  const dryLines: string[] = [];
  const dryPlan = await runCleanup({ client: dry.client, dryRun: true, olderThanDays: 3, log: (l) => dryLines.push(l), now: NOW });
  assert.equal(dry.destroyed.length, 0);
  assert.equal(dryPlan.filter((d) => d.action === 'destroy').length, 2);
  assert.equal(dryLines.length, 5, 'one line per machine plus the summary');
  assert.match(dryLines.at(-1)!, /4 machine\(s\) seen, 2 kept, 0 destroyed \(2 would be, pass --yes\), 16 of 20 quota slots free/);
  assert.equal((await db.query.tasks.findFirst({ where: { id: done.id } }))!.machineId, 'm-run-done', 'a dry run touches no row');

  const wet = fakeClient(fleet);
  const lines: string[] = [];
  await runCleanup({ client: wet.client, dryRun: false, olderThanDays: 3, log: (l) => lines.push(l), now: NOW });
  assert.deepEqual(wet.destroyed.sort(), ['m-run-done', 'm-run-orphan']);
  const after = (await db.query.tasks.findFirst({ where: { id: done.id } }))!;
  assert.equal(after.machineId, null);
  assert.equal(after.machineName, null);
  assert.ok((await eventsOf(done.id)).some((e) => e.message === 'Machine genie-repo-rundone0 destroyed by cleanup (task done)'));
  assert.equal((await db.query.tasks.findFirst({ where: { id: live.id } }))!.machineId, 'm-run-live', 'the live task keeps its machine');
  assert.match(lines.at(-1)!, /4 machine\(s\) seen, 2 kept, 2 destroyed, 18 of 20 quota slots free/);
});
