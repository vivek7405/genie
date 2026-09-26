// Issues, labels and comments over the scripted fake.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../helpers/db.ts';
import { fakeGithub, jsonResponse } from '../helpers/github.ts';
import { projects } from '#db/schema.server.ts';
import { setGithubTransport } from '#modules/github/client.server.ts';
import { commentMarker, commentOnIssue, createIssue, isGenieComment, listComments, listGenieIssues, readIssue, taskMarker } from '#modules/github/issues.server.ts';

const fake = fakeGithub();
setGithubTransport(fake.transport);
after(() => setGithubTransport(null));
beforeEach(() => fake.reset());

const repo = `harness/issues-${Date.now()}`;
const [project] = await db.insert(projects).values({ name: 'i', githubRepo: repo }).returning();

const restIssue = (number: number, patch: Record<string, unknown> = {}) => ({
  number, node_id: `I_${number}`, title: `Issue ${number}`, body: `Body ${number}`, state: 'open', labels: [{ name: 'genie' }],
  html_url: `https://github.com/${repo}/issues/${number}`, updated_at: '2026-09-26T00:00:00Z', ...patch,
});

test('createIssue creates the label once, then opens the issue with it', async () => {
  fake.on('GET', `repos/${repo}/labels/genie`, () => jsonResponse({ message: 'Not Found' }, 404));
  fake.on('POST', `repos/${repo}/labels`, (call) => ({ name: call.body?.name }));
  fake.on('POST', `repos/${repo}/issues`, (call) => restIssue(12, { title: call.body?.title, body: call.body?.body, labels: (call.body?.labels as string[]).map((name) => ({ name })) }));

  const issue = await createIssue(project, { title: 'First', body: 'hello' });
  assert.equal(issue.number, 12);
  assert.equal(issue.nodeId, 'I_12');
  assert.equal(issue.title, 'First');
  assert.deepEqual(issue.labels, ['genie']);
  const methods = fake.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(methods, [`GET repos/${repo}/labels/genie`, `POST repos/${repo}/labels`, `POST repos/${repo}/issues`]);
  assert.deepEqual(fake.calls[1].body, { name: 'genie', color: '7c3aed', description: 'Automated by genie' });
  assert.deepEqual(fake.calls[2].body?.labels, ['genie']);

  fake.reset();
  await createIssue(project, { title: 'Second', body: '' });
  assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), [`POST repos/${repo}/issues`], 'the label check is cached per repo');
});

test('an error other than 404 on the label check propagates', async () => {
  const [other] = await db.insert(projects).values({ name: 'o', githubRepo: `${repo}-o` }).returning();
  fake.on('GET', `repos/${other.githubRepo}/labels/genie`, () => jsonResponse({ message: 'bad token' }, 401));
  await assert.rejects(createIssue(other, { title: 'x', body: '' }), /401/);
});

test('listGenieIssues sends the label filter and drops pull requests', async () => {
  fake.on('GET', `repos/${repo}/issues`, () => [restIssue(1), restIssue(2, { pull_request: { url: 'x' } }), restIssue(3, { body: null })]);
  const issues = await listGenieIssues(project);
  assert.deepEqual(issues.map((i) => i.number), [1, 3]);
  assert.equal(issues[1].body, '');
  assert.equal(fake.calls[0].query, 'labels=genie&state=open&per_page=100');
});

test('readIssue and commentOnIssue hit the issue routes', async () => {
  fake.on('GET', `repos/${repo}/issues/5`, () => restIssue(5, { state: 'closed' }));
  const issue = await readIssue(project, 5);
  assert.equal(issue.state, 'closed');
  assert.equal(issue.htmlUrl, `https://github.com/${repo}/issues/5`);

  fake.on('POST', `repos/${repo}/issues/5/comments`, (call) => ({ id: 99, body: call.body?.body, user: { login: 'vivek7405' }, created_at: 'now', html_url: 'https://github.com/c/99' }));
  const posted = await commentOnIssue(project, 5, 'hi');
  assert.deepEqual(posted, { id: 99, htmlUrl: 'https://github.com/c/99' });
  assert.deepEqual(fake.calls.at(-1)!.body, { body: 'hi' });
});

test('listComments maps the comment rows in order', async () => {
  fake.on('GET', `repos/${repo}/issues/5/comments`, () => [
    { id: 1, body: 'a', user: { login: 'x' }, created_at: 't1', html_url: 'u1' },
    { id: 2, body: null, user: null, created_at: 't2', html_url: 'u2' },
  ]);
  assert.deepEqual(await listComments(project, 5), [
    { id: 1, body: 'a', author: 'x', createdAt: 't1', htmlUrl: 'u1' },
    { id: 2, body: '', author: '', createdAt: 't2', htmlUrl: 'u2' },
  ]);
  assert.equal(fake.calls[0].query, 'per_page=100');
});

test('isGenieComment recognises both marker spellings and nothing else', () => {
  assert.equal(isGenieComment('<!-- genie-plan -->\nThe plan'), true);
  assert.equal(isGenieComment('<!-- genie:done -->'), true);
  assert.equal(isGenieComment(`${commentMarker('ready_for_review')}\nReady.`), true);
  assert.equal(isGenieComment('  <!--genie-x-->'), true);
  assert.equal(isGenieComment('I think genie should make it dark'), false);
  assert.equal(isGenieComment('Please <!-- genie-plan --> no'), false, 'the marker must open the body');
  assert.equal(taskMarker('abc'), '<!-- genie-task abc -->');
});
