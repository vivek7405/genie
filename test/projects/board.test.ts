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

test('the home page renders and validates the connect form', async () => {
  const home = await testRequest(app.handle, '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Connect a repo/);

  const bad = await submitForm(app.handle, '/', { githubRepo: 'not a repo' });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /owner\/name form/);
});

test('connect a project, add a task, see it in Todo, open its card', async () => {
  const connected = await submitForm(app.handle, '/', { githubRepo: repo, githubProjectNumber: '11' });
  assert.equal(connected.status, 303);
  const boardPath = connected.headers.get('location');
  assert.ok(boardPath?.startsWith('/projects/'), `redirects to the board, got ${boardPath}`);

  const board = await testRequest(app.handle, boardPath!);
  assert.equal(board.status, 200);
  const boardHtml = await board.text();
  assert.match(boardHtml, /Ready for review/);
  assert.match(boardHtml, /<webjs-frame id="board"/);

  // submitForm posts only the fields it is given (plus the action identity), so
  // the hidden projectId a browser would carry is passed explicitly.
  const projectId = boardPath!.split('/').pop()!;
  const added = await submitForm(app.handle, boardPath!, { projectId, title: 'Add an about page', description: 'Short and sweet' }, { match: 'name="title"' });
  assert.equal(added.status, 303);
  assert.equal(added.headers.get('location'), boardPath);

  const after = await (await testRequest(app.handle, boardPath!)).text();
  assert.match(after, /Add an about page/);
  const cardHref = after.match(/href="(\/projects\/[^"]+\/tasks\/[^"]+)"/)?.[1];
  assert.ok(cardHref, 'the card links to its detail page');

  const card = await testRequest(app.handle, cardHref!);
  assert.equal(card.status, 200);
  const cardHtml = await card.text();
  assert.match(cardHtml, /Created in Todo/);
  assert.match(cardHtml, /<live-refresh/);
});

test('an empty title re-renders the board at 422', async () => {
  const connected = await submitForm(app.handle, '/', { githubRepo: `${repo}-b` });
  const boardPath = connected.headers.get('location')!;
  const bad = await submitForm(app.handle, boardPath, { projectId: boardPath.split('/').pop()!, title: '' }, { match: 'name="title"' });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /Give the task a title/);
});

test('a missing project is a 404', async () => {
  const res = await testRequest(app.handle, '/projects/nope');
  assert.equal(res.status, 404);
});
