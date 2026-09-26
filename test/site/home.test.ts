// The public site and the product are two shells in one app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appDir } from '../helpers/db.ts';
import { createRequestHandler } from '@webjsdev/server';
import { testRequest } from '@webjsdev/server/testing';

const app = await createRequestHandler({ appDir, dev: true });

test('/ is the marketing home: the loop, the sandbox, the stack, and a way into the dashboard', async () => {
  const res = await testRequest(app.handle, '/');
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const step of ['Write the task', 'Plan', 'Build', 'Review']) assert.match(body, new RegExp(`>${step}<`), step);
  assert.match(body, /href="\/dashboard" data-no-router/);
  assert.match(body, /id="sandbox"/);
  assert.match(body, /id="stack"/);
  assert.match(body, /<footer[\s\S]*href="\/brand"/, 'brand is linked from the footer');
  const mainNav = body.match(/<nav[^>]*aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  assert.ok(mainNav.length > 0, 'the header nav renders');
  assert.doesNotMatch(mainNav, /href="\/brand"/, 'and does not carry Brand');
  const footer = body.slice(body.indexOf('<footer'));
  assert.match(footer, /href="\/pitch-deck"/, 'the deck is linked from the footer');
  assert.doesNotMatch(body.slice(0, body.indexOf('<footer')), /Pitch deck/, 'and only from the footer');
});

test('/dashboard is the product shell, with its own header', async () => {
  const res = await testRequest(app.handle, '/dashboard');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /aria-current="page"[^>]*>Projects</);
  assert.match(body, /Connect a repo/);
  const header = body.slice(body.indexOf('<header'), body.indexOf('</header>'));
  assert.match(header, /<a href="\/dashboard"[^>]*>[\s\S]*?genie[\s\S]*?<\/a>/, 'the wordmark returns to the dashboard, not the site');
});

test('/brand renders under the site shell', async () => {
  const body = await (await testRequest(app.handle, '/brand')).text();
  assert.match(body, /aria-label="Main"/);
  assert.match(body, /Skip to content/);
});
