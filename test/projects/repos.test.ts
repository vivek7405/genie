import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { json } from '../helpers/db.ts';
import { setGithubTransport } from '#modules/github/client.server.ts';
import { readRepo } from '#modules/github/repos.server.ts';
import { validate } from '#modules/projects/actions/connect-project.server.ts';
import { GITHUB_REPO_PATTERN, normalizeRepo } from '#modules/projects/types.ts';

afterEach(() => setGithubTransport(async () => new Response('offline', { status: 503 })));

test('a pasted URL or ssh remote becomes owner/name', () => {
  assert.equal(normalizeRepo(' https://github.com/acme/site.git '), 'acme/site');
  assert.equal(normalizeRepo('git@github.com:acme/site.git'), 'acme/site');
  assert.equal(normalizeRepo('https://github.com/acme/site/'), 'acme/site');
  assert.ok(GITHUB_REPO_PATTERN.test('acme/site.js'));
  assert.ok(!GITHUB_REPO_PATTERN.test('acme'));
  assert.ok(!GITHUB_REPO_PATTERN.test('acme/site/extra'));
  assert.ok(!GITHUB_REPO_PATTERN.test('../../user'));
});

test('the connect validator refuses anything but owner/name', () => {
  const fd = new FormData();
  fd.set('githubRepo', 'nope');
  assert.equal(validate(fd).success, false);
  fd.set('githubRepo', 'https://github.com/acme/site');
  assert.deepEqual(validate(fd), { success: true, data: { githubRepo: 'acme/site' } });
});

function repo(commitsStatus: number) {
  setGithubTransport(async (url) => (url.includes('/commits')
    ? json(commitsStatus === 200 ? [{}] : { message: 'Git Repository is empty.' }, commitsStatus)
    : json({ full_name: 'Acme/Site', default_branch: 'trunk', archived: false, permissions: { push: true } })));
}

test('readRepo takes the name and default branch from GitHub', async () => {
  repo(200);
  assert.deepEqual(await readRepo('acme/site'), { fullName: 'Acme/Site', defaultBranch: 'trunk', canPush: true, archived: false, empty: false });
});

test('readRepo recognises an empty repository', async () => {
  repo(409);
  assert.equal((await readRepo('acme/site')).empty, true);
});

test('readRepo does not read a GitHub outage as an empty repository', async () => {
  repo(500);
  await assert.rejects(readRepo('acme/site'));
});
