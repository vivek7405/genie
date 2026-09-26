// The GitHub App: the JWT's shape and claims, installation tokens minted and
// cached through the scripted transport, the per-call token source, and the
// operator-token fallback when no App is configured. No network, and every
// token value here is invented.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { db } from '../helpers/db.ts';
import { fakeGithub, jsonResponse } from '../helpers/github.ts';
import { projects, users } from '#db/schema.server.ts';
import { forgetInstallationTokens, ghApi, ghGraphql, GithubError, setGithubTransport, viaInstallation, viaUser } from '#modules/github/client.server.ts';
import { appJwt, createBoard, githubAppConfigured, installUrl, installationRepos, installationToken, repoToken, userBoards, userInstallations } from '#modules/github/app.server.ts';
import { redact } from '#modules/pipeline/pilots.server.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const PUBLIC = publicKey.export({ type: 'spki', format: 'pem' }) as string;

const fake = fakeGithub();
setGithubTransport(fake.transport);
after(() => setGithubTransport(null));

const configure = () => {
  process.env.GITHUB_APP_ID = '4242';
  process.env.GITHUB_APP_PRIVATE_KEY = PEM;
  process.env.GITHUB_APP_SLUG = 'genie-dev';
};
const unconfigure = () => {
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  delete process.env.GITHUB_APP_SLUG;
};

beforeEach(() => {
  fake.reset();
  fake.rest.clear();
  fake.graphql.length = 0;
  forgetInstallationTokens();
  configure();
  delete process.env.GH_TOKEN;
});
after(unconfigure);

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
const bearer = (i = -1) => fake.calls.at(i)!.headers.get('authorization');
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const mint = (id: number, token: string, expiresAt = inAnHour()) => fake.on('POST', `app/installations/${id}/access_tokens`, () => ({ token, expires_at: expiresAt }));

const [user] = await db.insert(users).values({ githubId: 1001, login: 'octo', accessToken: 'gho_fake_user' }).returning();
let n = 0;
const newProject = async (patch: Partial<typeof projects.$inferInsert> = {}) =>
  (await db.insert(projects).values({ name: 'p', githubRepo: `acme/app-${n++}`, userId: user.id, ...patch }).returning())[0];

// The JWT.

test('githubAppConfigured needs both the id and the key', () => {
  assert.equal(githubAppConfigured(), true);
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  assert.equal(githubAppConfigured(), false);
  process.env.GITHUB_APP_PRIVATE_KEY = PEM;
  delete process.env.GITHUB_APP_ID;
  assert.equal(githubAppConfigured(), false);
});

test('appJwt is RS256 with iss, a backdated iat and a ten minute exp, verifiable with the public key', () => {
  const now = 1_800_000_000;
  const jwt = appJwt(now);
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(decode(header), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(decode(payload), { iat: now - 60, exp: now + 600, iss: '4242' });
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.equal(verifier.verify(PUBLIC, signature, 'base64url'), true);
});

test('appJwt accepts the key with escaped newlines and refuses to sign without the App', () => {
  process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n/g, '\\n');
  assert.equal(appJwt().split('.').length, 3);
  unconfigure();
  assert.throws(() => appJwt(), (err: unknown) => err instanceof GithubError && err.status === 500 && /not configured/.test(err.message));
});

// Installation tokens.

test('installationToken mints with the App JWT and caches until five minutes before expiry', async () => {
  mint(7, 'ghs_fake_7');
  assert.equal(await installationToken(7), 'ghs_fake_7');
  const call = fake.calls.at(-1)!;
  assert.equal(call.method, 'POST');
  assert.equal(call.path, 'app/installations/7/access_tokens');
  assert.match(bearer()!, /^Bearer ey/);
  const [, payload] = bearer()!.slice('Bearer '.length).split('.');
  assert.equal(decode(payload).iss, '4242');

  assert.equal(await installationToken(7), 'ghs_fake_7');
  assert.equal(fake.hits('app/installations/7/access_tokens').length, 1, 'the second call is served from the cache');

  // A token with four minutes left is minted again.
  mint(8, 'ghs_fake_8a', new Date(Date.now() + 4 * 60_000).toISOString());
  assert.equal(await installationToken(8), 'ghs_fake_8a');
  mint(8, 'ghs_fake_8b');
  assert.equal(await installationToken(8), 'ghs_fake_8b');
  assert.equal(fake.hits('app/installations/8/access_tokens').length, 2);
});

test('a mint that returns no token is a 502, and a GitHub error keeps its status', async () => {
  fake.on('POST', 'app/installations/9/access_tokens', () => ({}));
  await assert.rejects(installationToken(9), (err: GithubError) => err.status === 502);
  fake.on('POST', 'app/installations/10/access_tokens', () => jsonResponse({ message: 'gone' }, 404));
  await assert.rejects(installationToken(10), (err: GithubError) => err.status === 404);
});

test('a minted token is redacted from anything recorded', async () => {
  mint(11, 'ghs_fake_11_very_secret');
  await installationToken(11);
  assert.equal(redact('remote: https://x-access-token:ghs_fake_11_very_secret@github.com/a/b'), 'remote: https://x-access-token:[redacted]@github.com/a/b');
});

// The token source of a call.

test('a call for a project acts with its installation token', async () => {
  mint(12, 'ghs_fake_12');
  fake.on('GET', 'repos/acme/app/issues/1', () => ({ number: 1 }));
  const project = await newProject({ installationId: 12 });
  await ghApi('repos/acme/app/issues/1', { auth: viaInstallation(project) });
  assert.equal(bearer(), 'Bearer ghs_fake_12');
  fake.onGraphql('viewer', () => ({ viewer: { login: 'genie[bot]' } }));
  await ghGraphql('query { viewer { login } }', {}, { auth: viaInstallation(project) });
  assert.equal(bearer(), 'Bearer ghs_fake_12');
  assert.equal(fake.hits('app/installations/12/access_tokens').length, 1);
});

test('a call for the user acts with the user token, and refuses a user without one', async () => {
  fake.on('GET', 'user/installations', () => ({ installations: [] }));
  await ghApi('user/installations', { auth: viaUser(user) });
  assert.equal(bearer(), 'Bearer gho_fake_user');
  await assert.rejects(ghApi('user/installations', { auth: viaUser({ accessToken: null }) }), (err: GithubError) => err.status === 401 && /Sign out and in again/.test(err.message));
});

test('a project without an installation keeps the operator path (no token read behind a test transport)', async () => {
  fake.on('GET', 'repos/acme/app/issues/2', () => ({ number: 2 }));
  const project = await newProject({ installationId: null });
  await ghApi('repos/acme/app/issues/2', { auth: viaInstallation(project) });
  assert.equal(bearer(), null);
  assert.equal(fake.calls.length, 1, 'no mint');
});

test('with no App configured every source falls back to the operator path', async () => {
  unconfigure();
  fake.on('GET', 'repos/acme/app/issues/3', () => ({ number: 3 }));
  fake.on('GET', 'user/installations', () => ({ installations: [] }));
  const project = await newProject({ installationId: 12 });
  await ghApi('repos/acme/app/issues/3', { auth: viaInstallation(project) });
  assert.equal(bearer(), null);
  await ghApi('user/installations', { auth: viaUser(user) });
  assert.equal(bearer(), null);
  assert.equal(fake.calls.length, 2, 'no mint');
});

test('the App source signs with the JWT', async () => {
  fake.on('GET', 'app', () => ({ slug: 'genie-dev' }));
  await ghApi('app', { auth: { token: 'app' } });
  assert.match(bearer()!, /^Bearer ey/);
});

// What a task machine acts with.

test('repoToken is the installation token for an installed project, else GH_TOKEN, else null', async () => {
  mint(13, 'ghs_fake_13');
  assert.equal(await repoToken({ installationId: 13 }), 'ghs_fake_13');
  assert.equal(await repoToken({ installationId: null }), null);
  process.env.GH_TOKEN = 'ghp_fake_operator';
  assert.equal(await repoToken({ installationId: null }), 'ghp_fake_operator');
  unconfigure();
  assert.equal(await repoToken({ installationId: 13 }), 'ghp_fake_operator', 'no App: the operator token even for an installed project');
  assert.equal(fake.hits('app/installations/13/access_tokens').length, 1);
});

// The install link and the per-user reads.

test('installUrl points at the App slug and needs it', () => {
  assert.equal(installUrl(), 'https://github.com/apps/genie-dev/installations/new');
  delete process.env.GITHUB_APP_SLUG;
  assert.throws(() => installUrl(), /GITHUB_APP_SLUG/);
});

test('userInstallations lists the user installations with account and type', async () => {
  fake.on('GET', 'user/installations', () => ({ installations: [
    { id: 1, account: { login: 'octo', type: 'User' }, suspended_at: null },
    { id: 2, account: { login: 'acme', type: 'Organization' }, suspended_at: '2026-01-01T00:00:00Z' },
  ] }));
  assert.deepEqual(await userInstallations(user), [
    { id: 1, account: 'octo', accountType: 'User', suspended: false },
    { id: 2, account: 'acme', accountType: 'Organization', suspended: true },
  ]);
  assert.equal(bearer(), 'Bearer gho_fake_user');
});

test('installationRepos pages through the installation repositories with the user token', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ full_name: `acme/r${i}`, private: i % 2 === 0, default_branch: 'main' }));
  fake.on('GET', 'user/installations/2/repositories', (call) => (call.query?.includes('page=2') ? { repositories: [{ full_name: 'acme/last', private: false, default_branch: 'trunk' }] } : { repositories: page1 }));
  const repos = await installationRepos(2, user);
  assert.equal(repos.length, 101);
  assert.deepEqual(repos.at(-1), { fullName: 'acme/last', private: false, defaultBranch: 'trunk' });
  assert.equal(fake.hits('user/installations/2/repositories').length, 2);
  assert.equal(bearer(), 'Bearer gho_fake_user');
});

test('userBoards lists the open boards under the owner with their linked repositories', async () => {
  fake.onGraphql('projectsV2(first: 50', (v) => ({ repositoryOwner: { projectsV2: { nodes: [
    { id: 'PVT_1', number: 1, title: 'Roadmap', url: `https://github.com/orgs/${v.owner}/projects/1`, closed: false, repositories: { nodes: [{ nameWithOwner: 'acme/shop' }] } },
    { id: 'PVT_2', number: 2, title: 'Old', url: 'x', closed: true, repositories: { nodes: [] } },
    { id: 'PVT_3', number: 3, title: 'Ops', url: 'y', closed: false, repositories: { nodes: [] } },
  ] } } }));
  const boards = await userBoards(user, 'acme');
  assert.deepEqual(boards.map((b) => b.number), [1, 3]);
  assert.deepEqual(boards[0], { id: 'PVT_1', number: 1, title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/1', repos: ['acme/shop'] });
  assert.equal(bearer(), 'Bearer gho_fake_user');
  fake.graphql.length = 0;
  fake.onGraphql('projectsV2(first: 50', () => ({ repositoryOwner: null }));
  assert.deepEqual(await userBoards(user, 'nobody'), []);
});

test('createBoard creates the board as the user, links the repository, stores the number and resolves it as the installation', async () => {
  mint(14, 'ghs_fake_14');
  const project = await newProject({ githubRepo: 'acme/shop', installationId: 14 });
  const bearers: Record<string, string | null> = {};
  fake.onGraphql('repository(owner: $owner, name: $name) { id owner { id } }', (_v, call) => { bearers.ids = call.headers.get('authorization'); return { repository: { id: 'R_1', owner: { id: 'O_1' } } }; });
  fake.onGraphql('createProjectV2', (v, call) => { bearers.create = call.headers.get('authorization'); assert.deepEqual(v, { ownerId: 'O_1', title: 'Shop' }); return { createProjectV2: { projectV2: { id: 'PVT_9', number: 9, url: 'u' } } }; });
  fake.onGraphql('linkProjectV2ToRepository', (v, call) => { bearers.link = call.headers.get('authorization'); assert.deepEqual(v, { projectId: 'PVT_9', repositoryId: 'R_1' }); return { linkProjectV2ToRepository: { repository: { id: 'R_1' } } }; });
  fake.onGraphql('repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2', (v, call) => {
    bearers.resolve = call.headers.get('authorization');
    assert.deepEqual(v, { owner: 'acme', number: 9 });
    return { repositoryOwner: { projectV2: { id: 'PVT_9', field: { id: 'F_1', options: [
      { id: 'o1', name: 'Todo', color: 'GREEN', description: '' }, { id: 'o2', name: 'Plan', color: 'BLUE', description: '' }, { id: 'o3', name: 'In progress', color: 'YELLOW', description: '' },
      { id: 'o4', name: 'Review', color: 'ORANGE', description: '' }, { id: 'o5', name: 'Done', color: 'PURPLE', description: '' },
    ] } } } };
  });
  const row = await createBoard(user, project, 'Shop');
  assert.equal(row.githubProjectNumber, 9);
  assert.equal(row.githubProjectId, 'PVT_9');
  assert.equal(row.statusFieldId, 'F_1');
  assert.deepEqual(bearers, { ids: 'Bearer gho_fake_user', create: 'Bearer gho_fake_user', link: 'Bearer gho_fake_user', resolve: 'Bearer ghs_fake_14' });
});

test('createBoard on a repository GitHub cannot find is a 404', async () => {
  const project = await newProject({ githubRepo: 'acme/missing', installationId: 14 });
  fake.onGraphql('repository(owner: $owner, name: $name) { id owner { id } }', () => ({ repository: null }));
  await assert.rejects(createBoard(user, project, 'x'), (err: GithubError) => err.status === 404);
});
