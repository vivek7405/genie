// Drives the real request pipeline: connect a project through the form, add a
// task, read the board and the card. Runs against its own migrated temp
// database (test/helpers/db.ts) and the offline GitHub transport it installs,
// so the board resolve and the issue publish fail and are reported, never
// fatal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appDir } from '../helpers/db.ts';
import { createRequestHandler } from '@webjsdev/server';
import { testRequest, submitForm } from '@webjsdev/server/testing';

const app = await createRequestHandler({ appDir, dev: true });
const repo = `harness/board-${Date.now()}`;

test('the home page lists projects and links to the connect page, which validates', async () => {
  const home = await testRequest(app.handle, '/dashboard');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /href="\/dashboard\/projects\/new"/);

  const page = await testRequest(app.handle, '/dashboard/projects/new');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Connect a repository/);

  const bad = await submitForm(app.handle, '/dashboard/projects/new', { githubRepo: 'not a repo' });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /owner\/name form/);
});

test('connect a project, add a task, see it in Todo, open its card', async () => {
  const connected = await submitForm(app.handle, '/dashboard/projects/new', { githubRepo: repo, githubProjectNumber: '11' });
  assert.equal(connected.status, 303);
  const boardPath = connected.headers.get('location');
  assert.ok(boardPath?.startsWith('/dashboard/projects/'), `redirects to the board, got ${boardPath}`);

  const board = await testRequest(app.handle, boardPath!);
  assert.equal(board.status, 200);
  const boardHtml = await board.text();
  assert.match(boardHtml, /Review/);
  assert.match(boardHtml, /<webjs-frame id="board"/);
  assert.match(boardHtml, /GitHub sync: /, 'the board resolve failed offline and the page says so');
  assert.match(boardHtml, /503/);

  // submitForm posts only the fields it is given (plus the action identity), so
  // the hidden projectId a browser would carry is passed explicitly.
  const projectId = boardPath!.split('/').pop()!;
  const added = await submitForm(app.handle, `${boardPath}/tasks/new`, { projectId, title: 'Add an about page', description: 'Short and sweet' });
  assert.equal(added.status, 303);
  assert.equal(added.headers.get('location'), boardPath);

  const after = await (await testRequest(app.handle, boardPath!)).text();
  assert.match(after, /Add an about page/);
  const home = await (await testRequest(app.handle, '/dashboard')).text();
  assert.match(home, /1 todo/);
  // The masthead's "New task" link also matches /tasks/, so pick a card link.
  const cardHref = [...after.matchAll(/href="(\/dashboard\/projects\/[^"]+\/tasks\/[^"]+)"/g)].map((m) => m[1]).find((h) => !h.endsWith('/tasks/new'));
  assert.ok(cardHref, 'the card links to its detail page');

  const card = await testRequest(app.handle, cardHref!);
  assert.equal(card.status, 200);
  const cardHtml = await card.text();
  assert.match(cardHtml, /Created in Todo/);
  assert.match(cardHtml, /Could not open the GitHub issue/);
  assert.match(cardHtml, /<live-refresh/);
});

test('an empty title re-renders the board at 422', async () => {
  const connected = await submitForm(app.handle, '/dashboard/projects/new', { githubRepo: `${repo}-b` });
  const boardPath = connected.headers.get('location')!;
  const bad = await submitForm(app.handle, `${boardPath}/tasks/new`, { projectId: boardPath.split('/').pop()!, title: '' });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /Give the task a title/);
});

test('a project without a board shows no sync message', async () => {
  const connected = await submitForm(app.handle, '/dashboard/projects/new', { githubRepo: `${repo}-c` });
  const boardHtml = await (await testRequest(app.handle, connected.headers.get('location')!)).text();
  assert.doesNotMatch(boardHtml, /GitHub sync: /);
});

test('a missing project is a 404', async () => {
  const res = await testRequest(app.handle, '/dashboard/projects/nope');
  assert.equal(res.status, 404);
});

// The review loop on the board and the card: merged, failed, and the two
// verdict forms. Rows are inserted straight into the database.

const { db } = await import('../helpers/db.ts');
const { projects, tasks } = await import('#db/schema.server.ts');

async function reviewProject() {
  const [project] = await db.insert(projects).values({ name: 'loop', githubRepo: `harness/loop-${Date.now()}`, productionUrl: 'https://loop.pilotrun.app' }).returning();
  return project;
}

test('a done card reads Merged, and its page says where production deploys', async () => {
  const project = await reviewProject();
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'Ship it', status: 'done', prNumber: 7, prUrl: 'https://github.com/harness/loop/pull/7', branch: 'genie/7-ship-it' }).returning();
  const board = await (await testRequest(app.handle, `/dashboard/projects/${project.id}`)).text();
  assert.match(board, /href="https:\/\/loop\.pilotrun\.app"[^>]*>production</);
  assert.match(board, /title="Pilots deploys main here"/);
  assert.match(board, /Merged</);
  const card = await (await testRequest(app.handle, `/dashboard/projects/${project.id}/tasks/${task.id}`)).text();
  assert.match(card, /Merged, production deploying/);
  assert.match(card, /pull\/7"[^>]*>#7</);
  assert.match(card, /https:\/\/loop\.pilotrun\.app/);
  assert.match(card, /removed on merge/);
  assert.doesNotMatch(card, /Approve and merge/);
});

test('a failed card names the attempt on the board and the card, and Retry clears it', async () => {
  const project = await reviewProject();
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'Broken build', status: 'in_progress', error: 'boom', attempt: 2, feedback: 'make it dark mode' }).returning();
  const board = await (await testRequest(app.handle, `/dashboard/projects/${project.id}`)).text();
  assert.match(board, /Failed on attempt 2, open to retry/);
  const path = `/dashboard/projects/${project.id}/tasks/${task.id}`;
  const card = await (await testRequest(app.handle, path)).text();
  assert.match(card, /Attempt 2 failed in In progress/);
  assert.match(card, /Retry In progress/);
  assert.match(card, /applying the same feedback/);
  assert.match(card, /Feedback being applied/);
  const retried = await submitForm(app.handle, path, { taskId: task.id }, { match: 'Retry' });
  assert.equal(retried.status, 303);
  const after = await (await testRequest(app.handle, path)).text();
  assert.doesNotMatch(after, /Attempt 2 failed/);
  assert.doesNotMatch(after, />Failed</);
  assert.match(after, /attempt 0/);
  const boardAfter = await (await testRequest(app.handle, `/dashboard/projects/${project.id}`)).text();
  assert.doesNotMatch(boardAfter, /Failed on attempt/);
  assert.match(boardAfter, /Revising after feedback/, 'an in_progress task with feedback is a revise');
});

test('an in_progress card with feedback shows Revising after feedback on the board', async () => {
  const project = await reviewProject();
  await db.insert(tasks).values({ projectId: project.id, title: 'Second round', status: 'in_progress', feedback: 'shorter copy' });
  const board = await (await testRequest(app.handle, `/dashboard/projects/${project.id}`)).text();
  assert.match(board, /Revising after feedback/);
});

test('the review forms approve without a PR, refuse empty feedback, and send the card back', async () => {
  const project = await reviewProject();
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'Review me', status: 'ready_for_review' }).returning();
  const path = `/dashboard/projects/${project.id}/tasks/${task.id}`;
  const empty = await submitForm(app.handle, path, { taskId: task.id, feedback: '' }, { match: 'Send back' });
  assert.equal(empty.status, 422);
  assert.match(await empty.text(), /Say what should change\./);

  const back = await submitForm(app.handle, path, { taskId: task.id, feedback: 'make it dark mode' }, { match: 'Send back' });
  assert.equal(back.status, 303);
  const revising = await (await testRequest(app.handle, path)).text();
  assert.match(revising, /Feedback being applied/);
  assert.match(revising, /make it dark mode/);
  assert.doesNotMatch(revising, /Approve and merge/);

  const [again] = await db.insert(tasks).values({ projectId: project.id, title: 'Approve me', status: 'ready_for_review' }).returning();
  const path2 = `/dashboard/projects/${project.id}/tasks/${again.id}`;
  const approved = await submitForm(app.handle, path2, { taskId: again.id }, { match: 'Approve' });
  assert.equal(approved.status, 303);
  const done = await (await testRequest(app.handle, path2)).text();
  assert.match(done, /Approved without a pull request/);
  assert.match(done, /Merged, production deploying/);
  assert.equal((await db.query.tasks.findFirst({ where: { id: again.id } }))?.status, 'done');
});

test('a review task under a claim hides the forms and says Merging', async () => {
  const project = await reviewProject();
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'Mid merge', status: 'ready_for_review', prNumber: 9, claimedAt: new Date() }).returning();
  const card = await (await testRequest(app.handle, `/dashboard/projects/${project.id}/tasks/${task.id}`)).text();
  assert.match(card, /Merging PR #9/);
  assert.doesNotMatch(card, /Approve and merge/);
  assert.doesNotMatch(card, /name="feedback"/);
});
