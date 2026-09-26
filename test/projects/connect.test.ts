// The connect page with a GitHub App: the sign-in and install prompts, the
// repository and board pickers, creating a board, the checks on what is
// posted, and the operator form when no App is configured. Drives the real
// request pipeline over the scripted GitHub fake; no network, invented
// tokens only.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { appDir, db } from '../helpers/db.ts';
import { fakeGithub } from '../helpers/github.ts';
import { createRequestHandler } from '@webjsdev/server';
import { testRequest, submitForm } from '@webjsdev/server/testing';
import { projects, users } from '#db/schema.server.ts';
import { forgetInstallationTokens, setGithubTransport } from '#modules/github/client.server.ts';

const app = await createRequestHandler({ appDir, dev: true });
const PAGE = '/dashboard/projects/new';
const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;

const fake = fakeGithub();
setGithubTransport(fake.transport);
after(() => {
  setGithubTransport(null);
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  delete process.env.GITHUB_APP_SLUG;
  delete process.env.GENIE_DEV_USER_LOGIN;
});

await db.insert(users).values({ githubId: 2002, login: 'octo', accessToken: 'gho_fake_octo' });

// The scripted GitHub: one installation on acme with two repositories, two
// boards under acme (one linked to acme/shop), and the mutations a board
// create and resolve need.
let installations: { id: number; account: { login: string; type: string }; suspended_at: null }[] = [];
const allOptions = ['Todo', 'Plan', 'In progress', 'Review', 'Done'].map((name, i) => ({ id: `o${i}`, name, color: 'GREEN', description: '' }));
const created: { title: string; ownerId: string }[] = [];
const linked: { projectId: string; repositoryId: string }[] = [];
const bearers: string[] = [];

beforeEach(() => {
  process.env.GITHUB_APP_ID = '4242';
  process.env.GITHUB_APP_PRIVATE_KEY = PEM;
  process.env.GITHUB_APP_SLUG = 'genie-dev';
  process.env.GENIE_DEV_USER_LOGIN = 'octo';
  forgetInstallationTokens();
  fake.reset();
  fake.rest.clear();
  fake.graphql.length = 0;
  created.length = 0;
  linked.length = 0;
  bearers.length = 0;
  installations = [{ id: 77, account: { login: 'acme', type: 'Organization' }, suspended_at: null }];
  fake.on('GET', 'user/installations', () => ({ installations }));
  fake.on('GET', 'user/installations/77/repositories', () => ({ repositories: [
    { full_name: 'acme/shop', private: true, default_branch: 'trunk' },
    { full_name: 'acme/docs', private: false, default_branch: 'main' },
  ] }));
  fake.on('POST', 'app/installations/77/access_tokens', () => ({ token: 'ghs_fake_77', expires_at: new Date(Date.now() + 3_600_000).toISOString() }));
  fake.onGraphql('projectsV2(first: 50', () => ({ repositoryOwner: { projectsV2: { nodes: [
    { id: 'PVT_3', number: 3, title: 'Ops', url: 'u3', closed: false, repositories: { nodes: [] } },
    { id: 'PVT_1', number: 1, title: 'Roadmap', url: 'u1', closed: false, repositories: { nodes: [{ nameWithOwner: 'acme/shop' }] } },
  ] } } }));
  fake.onGraphql('{ ... on ProjectV2Owner { projectV2(number: $number)', (v, call) => {
    bearers.push(call.headers.get('authorization') ?? '');
    return { repositoryOwner: { projectV2: { id: `PVT_${v.number}`, field: { id: 'F_1', options: allOptions } } } };
  });
  fake.onGraphql('repository(owner: $owner, name: $name) { id owner { id } }', () => ({ repository: { id: 'R_docs', owner: { id: 'O_acme' } } }));
  fake.onGraphql('createProjectV2', (v) => { created.push({ title: String(v.title), ownerId: String(v.ownerId) }); return { createProjectV2: { projectV2: { id: 'PVT_9', number: 9, url: 'u9' } } }; });
  fake.onGraphql('linkProjectV2ToRepository', (v) => { linked.push({ projectId: String(v.projectId), repositoryId: String(v.repositoryId) }); return { linkProjectV2ToRepository: { repository: { id: 'R_docs' } } }; });
});

const page = async (path = PAGE) => {
  const res = await testRequest(app.handle, path);
  return { status: res.status, html: await res.text() };
};

test('without an App the operator form renders: owner/name and a board number', async () => {
  delete process.env.GITHUB_APP_ID;
  const { status, html } = await page();
  assert.equal(status, 200);
  assert.match(html, /name="githubRepo"/);
  assert.match(html, /name="githubProjectNumber" inputmode="numeric"/);
  assert.doesNotMatch(html, /Install Genie/);
  assert.equal(fake.calls.length, 0, 'no GitHub call');
});

test('signed out, the page asks for a sign-in and posts nothing', async () => {
  delete process.env.GENIE_DEV_USER_LOGIN;
  const { html } = await page();
  assert.match(html, /Sign in with GitHub to connect a repository/);
  assert.match(html, /href="\/login"/);
  assert.doesNotMatch(html, /__webjs_action/);
  assert.equal(fake.calls.length, 0);
});

test('with no installation the page offers to install the App', async () => {
  installations = [];
  const { html } = await page();
  assert.match(html, /Install Genie on GitHub/);
  assert.match(html, /href="https:\/\/github\.com\/apps\/genie-dev\/installations\/new"/);
  assert.doesNotMatch(html, /__webjs_action/);
});

test('with an installation the page lists its repositories in a plain GET form, grouped by account', async () => {
  const { html } = await page();
  assert.match(html, /<form method="get" action="\/dashboard\/projects\/new"/);
  assert.match(html, /<select id="repo" name="repo" required/);
  assert.match(html, /<optgroup label="acme">/);
  assert.match(html, /<option value="acme\/shop" ?>acme\/shop \(private\)<\/option>/);
  assert.match(html, /<option value="acme\/docs" ?>acme\/docs<\/option>/);
  assert.doesNotMatch(html, /__webjs_action/, 'no bound form until a repository is picked');
  assert.equal(fake.calls.at(-1)!.headers.get('authorization'), 'Bearer gho_fake_octo', 'read as the user');
});

test('a picked repository shows the boards under its owner, linked first, with a create option and the bound form', async () => {
  const { html } = await page(`${PAGE}?repo=acme/shop&installation_id=77`);
  assert.match(html, /Genie is installed on <strong>acme<\/strong>/);
  assert.match(html, /<option value="acme\/shop" selected(="")?>/);
  assert.match(html, /name="__webjs_action"/);
  assert.match(html, /<input type="hidden" name="githubRepo" value="acme\/shop">/);
  assert.match(html, /<input type="hidden" name="installationId" value="77">/);
  const boards = html.slice(html.indexOf('<select id="githubProjectNumber"'), html.indexOf('</select>', html.indexOf('<select id="githubProjectNumber"')));
  assert.match(boards, /<option value="1" selected(="")?>Roadmap \(#1, linked\)<\/option>/);
  assert.match(boards, /<option value="3" ?>Ops \(#3\)<\/option>/);
  assert.match(boards, /<option value="new" ?>Create a board for this repo<\/option>/);
  assert.match(boards, /<option value="" ?>No board/);
  assert.ok(boards.indexOf('Roadmap') < boards.indexOf('Ops'), 'the linked board comes first');
  assert.match(html, /Connect acme\/shop/);
});

test('a repository Genie was not granted is refused on the page', async () => {
  const { html } = await page(`${PAGE}?repo=acme/secret`);
  assert.match(html, /acme\/secret is not one Genie was granted/);
  assert.doesNotMatch(html, /__webjs_action/);
});

test('connecting stores the owner, the installation and the board, resolved as the installation', async () => {
  const res = await submitForm(app.handle, `${PAGE}?repo=acme/shop`, { githubRepo: 'acme/shop', installationId: '77', githubProjectNumber: '1', name: 'Shop' }, { match: 'githubProjectNumber' });
  assert.equal(res.status, 303);
  const location = res.headers.get('location')!;
  assert.match(location, /^\/dashboard\/projects\//);
  const row = (await db.query.projects.findFirst({ where: { githubRepo: 'acme/shop' } }))!;
  assert.equal(location, `/dashboard/projects/${row.id}`);
  const user = (await db.query.users.findFirst({ where: { login: 'octo' } }))!;
  assert.equal(row.userId, user.id);
  assert.equal(row.installationId, 77);
  assert.equal(row.githubProjectNumber, 1);
  assert.equal(row.githubProjectId, 'PVT_1');
  assert.equal(row.defaultBranch, 'trunk');
  assert.equal(row.syncError, null);
  assert.deepEqual(bearers, ['Bearer ghs_fake_77']);

  const again = await submitForm(app.handle, `${PAGE}?repo=acme/shop`, { githubRepo: 'acme/shop', installationId: '77', githubProjectNumber: '3' }, { match: 'githubProjectNumber' });
  assert.equal(again.headers.get('location'), location, 'connecting the same repository again lands on the existing project');
});

test('"Create a board for this repo" creates and links one as the user, then resolves it', async () => {
  const res = await submitForm(app.handle, `${PAGE}?repo=acme/docs`, { githubRepo: 'acme/docs', installationId: '77', githubProjectNumber: 'new' }, { match: 'githubProjectNumber' });
  assert.equal(res.status, 303);
  const row = (await db.query.projects.findFirst({ where: { githubRepo: 'acme/docs' } }))!;
  assert.deepEqual(created, [{ title: 'docs', ownerId: 'O_acme' }]);
  assert.deepEqual(linked, [{ projectId: 'PVT_9', repositoryId: 'R_docs' }]);
  assert.equal(row.githubProjectNumber, 9);
  assert.equal(row.githubProjectId, 'PVT_9');
  assert.equal(row.syncError, null);
});

test('a repository outside the installation, or no installation, is a 422 that names the field', async () => {
  const outside = await submitForm(app.handle, `${PAGE}?repo=acme/shop`, { githubRepo: 'acme/secret', installationId: '77' }, { match: 'githubProjectNumber' });
  assert.equal(outside.status, 422);
  assert.match(await outside.text(), /acme\/secret is not in that installation/);
  const none = await submitForm(app.handle, `${PAGE}?repo=acme/shop`, { githubRepo: 'acme/shop' }, { match: 'githubProjectNumber' });
  assert.equal(none.status, 422);
  assert.match(await none.text(), /Pick a repository from one of your installations/);
  assert.equal(await db.query.projects.findFirst({ where: { githubRepo: 'acme/secret' } }), undefined);
});

test('a board that fails to resolve still lands the project with the error stored', async () => {
  fake.graphql.length = 0;
  fake.onGraphql('projectsV2(first: 50', () => ({ repositoryOwner: { projectsV2: { nodes: [] } } }));
  fake.onGraphql('{ ... on ProjectV2Owner { projectV2(number: $number)', () => ({ repositoryOwner: { projectV2: null } }));
  await db.delete(projects);
  const res = await submitForm(app.handle, `${PAGE}?repo=acme/shop`, { githubRepo: 'acme/shop', installationId: '77', githubProjectNumber: '5' }, { match: 'githubProjectNumber' });
  assert.equal(res.status, 303);
  const row = (await db.query.projects.findFirst({ where: { githubRepo: 'acme/shop' } }))!;
  assert.equal(row.githubProjectNumber, 5);
  assert.match(row.syncError ?? '', /Project #5 was not found under acme/);
});
