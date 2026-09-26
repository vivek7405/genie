// Drives the real request pipeline: connect a project through the form, add a
// task, read the board and the card. Runs against its own migrated temp
// database (test/helpers/db.ts).
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
  assert.match(boardHtml, /Ready for review/);
  assert.match(boardHtml, /<webjs-frame id="board"/);

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
  assert.match(cardHtml, /<live-refresh/);
});

test('an empty title re-renders the board at 422', async () => {
  const connected = await submitForm(app.handle, '/dashboard/projects/new', { githubRepo: `${repo}-b` });
  const boardPath = connected.headers.get('location')!;
  const bad = await submitForm(app.handle, `${boardPath}/tasks/new`, { projectId: boardPath.split('/').pop()!, title: '' });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /Give the task a title/);
});

test('a missing project is a 404', async () => {
  const res = await testRequest(app.handle, '/dashboard/projects/nope');
  assert.equal(res.status, 404);
});
