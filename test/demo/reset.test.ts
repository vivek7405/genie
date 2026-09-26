// resetDemo against the temp database: deletes one project's tasks and
// events, leaves the other project and the project row alone, reports only
// on dryRun, and drives gh through the injected runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../helpers/db.ts';
import { projects, tasks, taskEvents } from '#db/schema.server.ts';
import { resetDemo } from '#modules/demo/reset.server.ts';

const repo = `vivek7405/genie-demo-${Date.now()}`;

async function seed() {
  const [demo] = await db.insert(projects).values({ name: 'demo', githubRepo: repo }).returning();
  const [other] = await db.insert(projects).values({ name: 'other', githubRepo: `${repo}-other` }).returning();
  const [a, b] = await db.insert(tasks).values([
    { projectId: demo.id, title: 'about page' },
    { projectId: demo.id, title: 'dark mode', status: 'ready_for_review' },
  ]).returning();
  await db.insert(taskEvents).values([
    { taskId: a.id, kind: 'status', message: 'Created in Todo' },
    { taskId: a.id, kind: 'log', message: 'Planning' },
    { taskId: b.id, kind: 'status', message: 'Created in Todo' },
  ]);
  const [foreign] = await db.insert(tasks).values({ projectId: other.id, title: 'keep me' }).returning();
  await db.insert(taskEvents).values({ taskId: foreign.id, kind: 'status', message: 'Created in Todo' });
  return { demo, other, foreign };
}

async function counts(projectId: string) {
  const rows = await db.query.tasks.findMany({ where: { projectId }, columns: { id: true } });
  const ids = rows.map((r) => r.id);
  const events = ids.length ? await db.query.taskEvents.findMany({ where: { taskId: { in: ids } }, columns: { id: true } }) : [];
  return { tasks: ids.length, events: events.length };
}

test('dryRun reports the counts and deletes nothing', async () => {
  const { demo } = await seed();
  const report = await resetDemo({ repo, dryRun: true });
  assert.equal(report.projectId, demo.id);
  assert.equal(report.tasks, 2);
  assert.equal(report.events, 3);
  assert.deepEqual(await counts(demo.id), { tasks: 2, events: 3 });
});

test('deletes the demo project tasks and events, keeps the project and other projects', async () => {
  const demo = (await db.query.projects.findFirst({ where: { githubRepo: repo } }))!;
  const other = (await db.query.projects.findFirst({ where: { githubRepo: `${repo}-other` } }))!;
  const report = await resetDemo({ repo, github: false });
  assert.equal(report.tasks, 2);
  assert.equal(report.events, 3);
  assert.equal(report.prsClosed, 0);
  assert.equal(report.issuesClosed, 0);
  assert.deepEqual(await counts(demo.id), { tasks: 0, events: 0 });
  assert.deepEqual(await counts(other.id), { tasks: 1, events: 1 });
  assert.ok(await db.query.projects.findFirst({ where: { id: demo.id } }), 'the project row survives');
});

test('an unknown repo reports no project and touches nothing', async () => {
  const report = await resetDemo({ repo: 'nobody/nothing' });
  assert.equal(report.projectId, null);
  assert.equal(report.tasks, 0);
});

test('github: true closes the listed PRs then issues through the injected gh runner', async () => {
  const calls: string[][] = [];
  const exec = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify([{ number: 12, headRefName: 'genie/about' }, { number: 15, headRefName: 'genie/dark' }]);
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify([{ number: 11 }]);
    return '';
  };
  const report = await resetDemo({ repo, github: true, exec });
  assert.equal(report.prsClosed, 2);
  assert.equal(report.issuesClosed, 1);
  assert.deepEqual(calls, [
    ['gh', 'pr', 'list', '--repo', repo, '--label', 'genie', '--state', 'open', '--json', 'number,headRefName'],
    ['gh', 'issue', 'list', '--repo', repo, '--label', 'genie', '--state', 'open', '--json', 'number'],
    ['gh', 'pr', 'close', '12', '--repo', repo, '--delete-branch'],
    ['gh', 'pr', 'close', '15', '--repo', repo, '--delete-branch'],
    ['gh', 'issue', 'close', '11', '--repo', repo],
  ]);
});

test('github with dryRun lists but never closes', async () => {
  const calls: string[][] = [];
  const exec = async (_cmd: string, args: string[]) => {
    calls.push(args);
    return args[1] === 'list' ? JSON.stringify([{ number: 3 }]) : '';
  };
  const report = await resetDemo({ repo, github: true, dryRun: true, exec });
  assert.equal(report.prsClosed, 1);
  assert.equal(report.issuesClosed, 1);
  assert.ok(calls.every((a) => a[1] === 'list'));
});
