import { afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { aProject, aTask, appDir, db, json, rowOf } from '../helpers/db.ts';
import { users } from '#db/schema.server.ts';
import { createRequestHandler } from '@webjsdev/server';
import { submitForm, testRequest, withSessionCookie } from '@webjsdev/server/testing';
import { allowSignIn } from '#modules/auth/users.server.ts';
import { setGithubTransport } from '#modules/github/client.server.ts';
import { resetOperatorLogin } from '#modules/github/operator.server.ts';

const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');

// The genuine cookie the framework reads: the HS256 JWT it writes on sign-in.
async function cookieFor(githubId: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))}.${b64(enc.encode(JSON.stringify({ sub: String(githubId), iat: now, exp: now + 3600 })))}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(process.env.AUTH_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `webjs.auth=${unsigned}.${b64(await crypto.subtle.sign('HMAC', key, enc.encode(unsigned)))}`;
}

const operatorIs = (login: string) => {
  resetOperatorLogin();
  setGithubTransport(async (url) => (url.endsWith('/user') ? json({ login }) : json([])));
};
const identity = (login: string, id: string) => ({ id, login, name: login, email: null, image: null });

let handle: Awaited<ReturnType<typeof createRequestHandler>>['handle'];
let session: string;

before(async () => {
  handle = (await createRequestHandler({ appDir, dev: true })).handle;
  await db.insert(users).values({ githubId: 77, login: 'owner' });
  session = await cookieFor(77);
});

afterEach(() => {
  resetOperatorLogin();
  setGithubTransport(async () => new Response('offline', { status: 503 }));
});

test('only the owner of the token may sign in', async () => {
  operatorIs('Owner');
  assert.equal(await allowSignIn(identity('stranger', '500')), false);
  assert.equal(await db.query.users.findFirst({ where: { githubId: 500 } }), undefined);
  assert.equal(await allowSignIn(identity('owner', '77')), true);
});

test('a GitHub outage refuses the sign-in rather than letting it through', async () => {
  await assert.rejects(allowSignIn(identity('owner', '77')));
});

test('signed out, product pages go to the landing page', async () => {
  const res = await testRequest(handle, '/projects');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
});

test('a validly signed cookie for anyone but the operator opens nothing', async () => {
  const res = await testRequest(handle, '/projects', withSessionCookie({}, await cookieFor(999)));
  assert.equal(res.status, 302);
});

test('the landing page sends the operator to projects and explains a refusal', async () => {
  const landing = await testRequest(handle, '/', withSessionCookie({}, session));
  assert.equal(landing.status, 302);
  assert.equal(landing.headers.get('location'), '/projects');
  const refused = await testRequest(handle, '/?error=AccessDenied');
  assert.match(await refused.text(), /belongs to someone else/);
});

test('every page renders for the operator, and an unknown id is a 404', async () => {
  const p = await aProject();
  const t = await aTask(p.id, { status: 'review', prNumber: 3, prUrl: 'https://github.com/a/b/pull/3', branch: 'genie/x' });
  const open = withSessionCookie({}, session);
  for (const path of ['/projects', `/projects/${p.id}`, `/projects/${p.id}/tasks/${t.id}`]) {
    assert.equal((await testRequest(handle, path, open)).status, 200, path);
  }
  assert.equal((await testRequest(handle, '/projects/nope', open)).status, 404);
  assert.equal((await testRequest(handle, `/projects/${p.id}/tasks/nope`, open)).status, 404);
  const other = await aProject();
  assert.equal((await testRequest(handle, `/projects/${other.id}/tasks/${t.id}`, open)).status, 404);
});

test('the review form only shows in Review, and Retry only on a failure', async () => {
  const p = await aProject();
  const open = withSessionCookie({}, session);
  const page = async (patch: Parameters<typeof aTask>[1]) => {
    const t = await aTask(p.id, patch);
    return (await testRequest(handle, `/projects/${p.id}/tasks/${t.id}`, open)).text();
  };
  const review = await page({ status: 'review', prNumber: 3 });
  assert.match(review, /Approve and merge/);
  assert.match(review, /the pull request stays on GitHub/);
  const backlog = await page({});
  assert.doesNotMatch(backlog, /Approve and merge/);
  assert.match(backlog, /Delete this task/);
  assert.match(await page({ status: 'in_progress', error: 'It broke' }), /It broke[\s\S]*Retry/);
});

test('a task title is escaped on the board', async () => {
  const p = await aProject();
  await aTask(p.id, { title: '<img src=x onerror=alert(1)>' });
  const html = await (await testRequest(handle, `/projects/${p.id}`, withSessionCookie({}, session))).text();
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
});

test('the composer adds a card with JavaScript off, and refuses an empty title', async () => {
  const p = await aProject();
  const open = { match: 'name="title"', cookies: session };
  const ok = await submitForm(handle, `/projects/${p.id}`, { projectId: p.id, title: 'Add a footer', description: 'Small' }, open);
  assert.equal(ok.status, 303);
  const created = await db.query.tasks.findFirst({ where: { projectId: p.id } });
  assert.equal(created?.title, 'Add a footer');
  assert.equal((await rowOf(created!.id)).status, 'backlog');
  const empty = await submitForm(handle, `/projects/${p.id}`, { projectId: p.id, title: '   ', description: '' }, open);
  assert.equal(empty.status, 422);
  assert.match(await empty.text(), /Say what Genie should do/);
});
