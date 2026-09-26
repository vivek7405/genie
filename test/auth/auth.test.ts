// Sign-in and tenancy through the real request pipeline: the login page, the
// dashboard gate, the account menu, and one user's rows being a 404 to
// another. Sessions are minted by test/helpers/auth.ts with the framework's
// own JWT shape, so no test talks to GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, appDir } from '../helpers/db.ts';
import { signInAs } from '../helpers/auth.ts';
import { projects, tasks, users } from '#db/schema.server.ts';
import { createRequestHandler } from '@webjsdev/server';
import { testRequest, submitForm, withSessionCookie } from '@webjsdev/server/testing';

const app = await createRequestHandler({ appDir, dev: true });
const alice = await signInAs('alice');
const bob = await signInAs('bob');
const asAlice = withSessionCookie({}, alice.cookies);
const asBob = withSessionCookie({}, bob.cookies);

test('/login renders the mark, one sentence and one GitHub button that posts with scripting off', async () => {
  const res = await testRequest(app.handle, '/login');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Sign in to Genie/);
  assert.match(body, /<form method="POST" action="\/api\/auth\/signin\/github" data-no-router>/);
  assert.match(body, /name="redirectTo" value="\/dashboard"/);
  assert.equal(body.match(/Sign in with GitHub/g)?.length, 1, 'exactly one button');
  assert.match(body, /aria-label="Main"/, 'under the site shell');
});

test('/login carries a same-origin ?next into the form and drops anything else', async () => {
  const deep = await (await testRequest(app.handle, '/login?next=%2Fdashboard%2Fprojects%2Fabc')).text();
  assert.match(deep, /name="redirectTo" value="\/dashboard\/projects\/abc"/);
  const evil = await (await testRequest(app.handle, '/login?next=https%3A%2F%2Fevil.example')).text();
  assert.match(evil, /name="redirectTo" value="\/dashboard"/);
});

test('/login reads ?error and explains the refusal', async () => {
  const body = await (await testRequest(app.handle, '/login?error=AccessDenied')).text();
  assert.match(body, /GitHub declined that sign-in/);
});

test('the sign-in form is answered with the redirect to GitHub and a cookie remembering where to land', async () => {
  const res = await testRequest(app.handle, '/api/auth/signin/github', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
    body: 'redirectTo=%2Fdashboard%2Fprojects%2Fabc',
  });
  assert.equal(res.status, 302);
  const location = res.headers.get('location') ?? '';
  assert.ok(location.startsWith('https://github.com/login/oauth/authorize?'), location);
  assert.match(location, /redirect_uri=http%3A%2F%2Fwebjs.test%2Fapi%2Fauth%2Fcallback%2Fgithub/);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('webjs.auth.state=')), 'the OAuth state cookie');
  assert.ok(cookies.some((c) => c.startsWith('genie_next=%2Fdashboard%2Fprojects%2Fabc;')), 'the landing cookie');
});

test('signed out, /dashboard redirects to /login and a deep link is carried as ?next', async () => {
  const res = await testRequest(app.handle, '/dashboard');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  const deep = await testRequest(app.handle, '/dashboard/projects/abc');
  assert.equal(deep.headers.get('location'), '/login?next=%2Fdashboard%2Fprojects%2Fabc');
});

test('signed out, a write under the dashboard is an ActionResult failure, not a redirect', async () => {
  const res = await testRequest(app.handle, '/dashboard/projects/new', { method: 'POST', headers: { origin: 'http://localhost' } });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { success: false, error: 'Sign in to continue.', status: 401 });
});

test('signed in, /login sends the visitor on to the dashboard', async () => {
  const res = await testRequest(app.handle, '/login', asAlice);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/dashboard');
});

test('signed in, the dashboard renders with the account menu, the nav, and a sign-out form', async () => {
  const res = await testRequest(app.handle, '/dashboard', asAlice);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<details class="relative" data-account-menu>/);
  assert.match(body, /aria-label="Account: alice"/);
  assert.match(body, />\s*AL\s*<\/summary>/, 'initials stand in for a missing avatar');
  assert.match(body, /<button type="submit" form="signout"[^>]*>Sign out</);
  assert.match(body, /<form id="signout" method="POST" action="\/api\/auth\/signout" data-no-router hidden>/);
  assert.ok(body.indexOf('<form id="signout"') > body.indexOf('</main>'), 'the sign-out form comes after the page content');
  assert.match(body, /aria-label="Primary"/);
  assert.doesNotMatch(body, /href="\/login"/);
});

test('the sign-out form clears the session', async () => {
  const res = await testRequest(app.handle, '/api/auth/signout', { ...asAlice, method: 'POST', headers: { ...(asAlice.headers as Record<string, string>), origin: 'http://localhost' } });
  assert.equal(res.status, 302);
  assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('webjs.auth=;')), 'the auth cookie is cleared');
});

test('signed out, the product shell shows no nav and offers to sign in', async () => {
  const body = await (await testRequest(app.handle, '/dashboard/projects/nope', asAlice)).text();
  assert.match(body, /aria-label="Primary"/);
  const gone = await testRequest(app.handle, '/dashboard/projects/nope');
  assert.equal(gone.status, 302, 'the gate runs before a 404 under the segment');
});

test('each user sees only their own projects, and connecting the same repo twice is two projects', async () => {
  const repo = `harness/tenant-${Date.now()}`;
  const a = await submitForm(app.handle, '/dashboard/projects/new', { githubRepo: repo }, { cookies: alice.cookies });
  assert.equal(a.status, 303);
  const b = await submitForm(app.handle, '/dashboard/projects/new', { githubRepo: repo }, { cookies: bob.cookies });
  assert.equal(b.status, 303);
  assert.notEqual(a.headers.get('location'), b.headers.get('location'));

  const rows = await db.query.projects.findMany({ where: { githubRepo: repo } });
  assert.deepEqual(new Set(rows.map((r) => r.userId)), new Set([alice.user.id, bob.user.id]));

  const aliceHome = await (await testRequest(app.handle, '/dashboard', asAlice)).text();
  assert.match(aliceHome, new RegExp(a.headers.get('location')!));
  assert.doesNotMatch(aliceHome, new RegExp(b.headers.get('location')!));
});

test("another user's board, card, new-task page and actions are a 404", async () => {
  const [project] = await db.insert(projects).values({ userId: alice.user.id, name: 'mine', githubRepo: `harness/mine-${Date.now()}` }).returning();
  const [task] = await db.insert(tasks).values({ projectId: project.id, title: 'Private', status: 'ready_for_review' }).returning();
  const board = `/dashboard/projects/${project.id}`;
  const card = `${board}/tasks/${task.id}`;

  assert.equal((await testRequest(app.handle, board, asAlice)).status, 200);
  assert.equal((await testRequest(app.handle, card, asAlice)).status, 200);
  for (const path of [board, card, `${board}/tasks/new`]) {
    assert.equal((await testRequest(app.handle, path, asBob)).status, 404, path);
  }

  // The form-bound action, posted with the ids in hand: Bob cannot render
  // the card, so the form identity is read off Alice's render and the post
  // carries Bob's cookie.
  const identity = (await (await testRequest(app.handle, card, asAlice)).text()).match(/name="__webjs_action"\s+value="([^"]*)"/)![1];
  const approved = await testRequest(app.handle, card, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: bob.cookies, origin: 'http://webjs.test' },
    body: new URLSearchParams({ __webjs_action: identity, taskId: task.id }).toString(),
  });
  assert.equal(approved.status, 404);
  assert.equal((await db.query.tasks.findFirst({ where: { id: task.id } }))?.status, 'ready_for_review', 'the verdict did not land');
});

test('a signed-out RPC read returns nothing, never another user\'s row', async () => {
  const { getProject } = await import('#modules/projects/queries/get-project.server.ts');
  const { listProjectSummaries } = await import('#modules/projects/queries/list-project-summaries.server.ts');
  const [project] = await db.insert(projects).values({ userId: alice.user.id, name: 'quiet', githubRepo: `harness/quiet-${Date.now()}` }).returning();
  assert.equal(await getProject(project.id), undefined);
  assert.deepEqual(await listProjectSummaries(), []);
});

test('a placeholder seed user is adopted by the first real sign-in with that login', async () => {
  const { upsertGithubUser } = await import('#modules/auth/users.server.ts');
  const [seeded] = await db.insert(users).values({ githubId: -1, login: 'seeded', name: 'seeded' }).returning();
  const real = await upsertGithubUser({ id: '424242', login: 'seeded', name: 'Seeded Person', email: null, image: 'https://avatars.example/1' }, 'gho_test');
  assert.equal(real.id, seeded.id, 'the same row');
  assert.equal(real.githubId, 424242);
  assert.equal(real.accessToken, 'gho_test');
  const again = await upsertGithubUser({ id: '424242', login: 'renamed', name: null, email: null, image: null }, null);
  assert.equal(again.id, seeded.id);
  assert.equal(again.login, 'renamed');
  assert.equal(again.accessToken, 'gho_test', 'a sign-in with no token keeps the stored one');
});
