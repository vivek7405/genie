// The activity feed and the error column never hold a secret value.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../helpers/db.ts');
const { projects, tasks } = await import('#db/schema.server.ts');
const { recordEvent } = await import('#modules/pipeline/events.server.ts');
const { failStage } = await import('#modules/pipeline/transitions.server.ts');
const { listEvents } = await import('#modules/tasks/queries/list-events.server.ts');

const [project] = await db.insert(projects).values({ name: 'e', githubRepo: `harness/events-${Date.now()}` }).returning();

afterEach(() => {
  delete process.env.GH_TOKEN;
});

test('recordEvent stores [redacted] in place of a secret value', async () => {
  process.env.GH_TOKEN = 'abc123';
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'redact', status: 'planning' }).returning();
  await recordEvent(task.id, 'log', 'fatal: https://x-access-token:abc123@github.com/x/y.git rejected abc123');
  const [event] = await listEvents(task.id);
  assert.equal(event.message, 'fatal: https://x-access-token:[redacted]@github.com/x/y.git rejected [redacted]');
});

test('failStage redacts the error column and the feed line', async () => {
  process.env.GH_TOKEN = 'abc123';
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'fail', status: 'planning' }).returning();
  await failStage(task.id, 'git push failed: token abc123 was refused');
  const row = await db.query.tasks.findFirst({ where: { id: task.id } });
  assert.equal(row?.error, 'git push failed: token [redacted] was refused');
  const errors = (await listEvents(task.id)).filter((e) => e.kind === 'error');
  assert.equal(errors.length, 1);
  assert.ok(!errors[0].message.includes('abc123'));
});
