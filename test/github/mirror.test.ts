// The genie-to-GitHub direction: a transition moves the card and comments,
// a new task becomes an issue, and the verdict helpers post feedback. Over
// the scripted fake, with a project row whose board ids are resolved.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, eventsOf } from '../helpers/db.ts';
import { fakeGithub } from '../helpers/github.ts';
import { projects, tasks } from '#db/schema.server.ts';
import { setGithubTransport } from '#modules/github/client.server.ts';
import { publishTask } from '#modules/github/mirror.server.ts';
import { transition } from '#modules/pipeline/transitions.server.ts';
import { approve, requestChanges } from '#modules/pipeline/verdicts.server.ts';

const fake = fakeGithub();
setGithubTransport(fake.transport);
after(() => setGithubTransport(null));
beforeEach(() => {
  fake.reset();
  fake.graphql.length = 0;
});

const repo = `harness/mirror-${Date.now()}`;
const optionIds = { todo: 'todo-id', planning: 'plan-id', in_progress: 'ip-id', ready_for_review: 'review-id', done: 'done-id' };
const [project] = await db.insert(projects).values({ name: 'm', githubRepo: repo, githubProjectNumber: 11, githubProjectId: 'PVT_1', statusFieldId: 'FIELD_1', statusOptionIds: optionIds }).returning();

const moves = () => fake.calls.filter((c) => String(c.body?.query).includes('updateProjectV2ItemFieldValue')).map((c) => c.body?.variables as Record<string, string>);
const commentsPosted = (issue: number) => fake.calls.filter((c) => c.method === 'POST' && c.path === `repos/${repo}/issues/${issue}/comments`).map((c) => String(c.body?.body));
const moveOk = () => fake.onGraphql('updateProjectV2ItemFieldValue', () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: 'x' } } }));
const commentOk = (issue: number) => fake.on('POST', `repos/${repo}/issues/${issue}/comments`, () => ({ id: 1, body: '', user: null, created_at: 't', html_url: 'u' }));

async function taskRow(id: string) {
  return (await db.query.tasks.findFirst({ where: { id } }))!;
}

test('a transition to review moves the card and posts the ready comment', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 't', status: 'in_progress', githubIssueNumber: 21, githubItemId: 'ITEM_21', prUrl: `https://github.com/${repo}/pull/9`, prNumber: 9 }).returning();
  moveOk();
  commentOk(21);
  const result = await transition(task.id, 'ready_for_review', 'system');
  assert.equal(result.success, true);
  assert.deepEqual(moves(), [{ projectId: 'PVT_1', itemId: 'ITEM_21', fieldId: 'FIELD_1', optionId: 'review-id' }]);
  const posted = commentsPosted(21);
  assert.equal(posted.length, 1);
  assert.ok(posted[0].startsWith('<!-- genie-ready_for_review -->'));
  assert.match(posted[0], /pull\/9/);
  assert.match(posted[0], /GENIE:/);
  const row = await taskRow(task.id);
  assert.ok(row.syncedAt instanceof Date);
  assert.ok((await eventsOf(task.id)).some((e) => e.kind === 'github' && e.message === 'Mirrored Review to GitHub'));
});

test('a task without an item id looks it up from the issue node and stores it', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 't', status: 'todo', githubIssueNumber: 22 }).returning();
  fake.onGraphql('projectItems', () => ({ repository: { issue: { id: 'I_22', projectItems: { nodes: [{ id: 'ITEM_22', project: { id: 'PVT_1' } }] } } } }));
  moveOk();
  await transition(task.id, 'planning', 'system');
  assert.equal((await taskRow(task.id)).githubItemId, 'ITEM_22');
  assert.deepEqual(moves(), [{ projectId: 'PVT_1', itemId: 'ITEM_22', fieldId: 'FIELD_1', optionId: 'plan-id' }]);
  assert.equal(commentsPosted(22).length, 0, 'planning is a silent move');
});

test('an issue not yet on the board is added to it first', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 't', status: 'todo', githubIssueNumber: 23 }).returning();
  fake.onGraphql('projectItems', () => ({ repository: { issue: { id: 'I_23', projectItems: { nodes: [] } } } }));
  fake.on('GET', `repos/${repo}/issues/23`, () => ({ number: 23, node_id: 'I_23', title: 't', body: '', state: 'open', labels: [], html_url: 'u', updated_at: 't' }));
  fake.onGraphql('addProjectV2ItemById', (variables) => {
    assert.equal(variables.contentId, 'I_23');
    return { addProjectV2ItemById: { item: { id: 'ITEM_23' } } };
  });
  moveOk();
  await transition(task.id, 'planning', 'system');
  assert.equal((await taskRow(task.id)).githubItemId, 'ITEM_23');
});

test('a task with no issue number makes no request', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'unlinked', status: 'todo' }).returning();
  await transition(task.id, 'planning', 'system');
  assert.equal(fake.calls.length, 0);
});

test('an offline GitHub leaves the transition successful and records the failure', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 't', status: 'planning', githubIssueNumber: 24, githubItemId: 'ITEM_24' }).returning();
  setGithubTransport(async () => new Response('offline in tests', { status: 503 }));
  try {
    const result = await transition(task.id, 'in_progress', 'system');
    assert.equal(result.success, true);
    assert.equal((await taskRow(task.id)).status, 'in_progress');
    const events = await eventsOf(task.id);
    assert.ok(events.some((e) => e.kind === 'github' && /GitHub mirror failed/.test(e.message)));
  } finally {
    setGithubTransport(fake.transport);
  }
});

test('publishTask opens a marked issue, adds it to the board in Todo and links the row', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'New thing', description: 'Do it' }).returning();
  fake.on('GET', `repos/${repo}/labels/genie`, () => ({ name: 'genie' }));
  fake.on('POST', `repos/${repo}/issues`, (call) => ({ number: 30, node_id: 'I_30', title: call.body?.title, body: call.body?.body, state: 'open', labels: [{ name: 'genie' }], html_url: `https://github.com/${repo}/issues/30`, updated_at: 't' }));
  fake.onGraphql('projectItems', () => ({ repository: { issue: { id: 'I_30', projectItems: { nodes: [] } } } }));
  fake.onGraphql('addProjectV2ItemById', () => ({ addProjectV2ItemById: { item: { id: 'ITEM_30' } } }));
  moveOk();
  const linked = await publishTask(project, task);
  assert.equal(linked.githubIssueNumber, 30);
  assert.equal(linked.githubItemId, 'ITEM_30');
  const created = fake.calls.find((c) => c.method === 'POST' && c.path === `repos/${repo}/issues`)!;
  assert.equal(created.body?.body, `Do it\n\n<!-- genie-task ${task.id} -->`);
  assert.deepEqual(moves(), [{ projectId: 'PVT_1', itemId: 'ITEM_30', fieldId: 'FIELD_1', optionId: 'todo-id' }]);
  assert.ok((await eventsOf(task.id)).some((e) => e.message.startsWith('Opened issue #30')));
});

test('publishTask with an existing issue links without creating', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'Found' }).returning();
  fake.onGraphql('projectItems', () => ({ repository: { issue: { id: 'I_31', projectItems: { nodes: [{ id: 'ITEM_31', project: { id: 'PVT_1' } }] } } } }));
  moveOk();
  const issue = { number: 31, nodeId: 'I_31', title: 'Found', body: `x\n\n<!-- genie-task ${task.id} -->`, state: 'open' as const, labels: ['genie'], htmlUrl: 'u', updatedAt: 't' };
  const linked = await publishTask(project, task, issue);
  assert.equal(linked.githubIssueNumber, 31);
  assert.equal(linked.githubItemId, 'ITEM_31');
  assert.ok(!fake.calls.some((c) => c.method === 'POST' && c.path === `repos/${repo}/issues`));
  assert.ok((await eventsOf(task.id)).some((e) => e.message.startsWith('Linked to issue #31')));
});

test('requestChanges from genie posts the feedback to the issue, from GitHub it does not', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 't', status: 'ready_for_review', githubIssueNumber: 40, githubItemId: 'ITEM_40' }).returning();
  moveOk();
  commentOk(40);
  const result = await requestChanges(task.id, 'make it dark', 'genie');
  assert.equal(result.success, true);
  const row = await taskRow(task.id);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.feedback, 'make it dark');
  const posted = commentsPosted(40);
  assert.equal(posted.length, 1);
  assert.match(posted[0], /^<!-- genie-feedback -->\nChanges requested in genie:\n\nmake it dark$/);

  fake.reset();
  await db.update(tasks).set({ status: 'ready_for_review' }).where((await import('drizzle-orm')).eq(tasks.id, task.id));
  await requestChanges(task.id, 'from a comment', 'github');
  assert.equal((await taskRow(task.id)).feedback, 'from a comment');
  assert.equal(commentsPosted(40).length, 0);
});

test('approve moves the card to Done and posts the approved comment', async () => {
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 't', status: 'ready_for_review', githubIssueNumber: 41, githubItemId: 'ITEM_41' }).returning();
  moveOk();
  commentOk(41);
  const result = await approve(task.id, 'Approved on GitHub');
  assert.equal(result.success, true);
  assert.equal((await taskRow(task.id)).status, 'done');
  assert.deepEqual(moves().map((m) => m.optionId), ['done-id']);
  assert.deepEqual(commentsPosted(41), ['<!-- genie-done -->\nApproved.']);
  assert.ok((await eventsOf(task.id)).some((e) => e.message === 'Approved on GitHub'));
});
