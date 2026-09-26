// The GitHub client: REST and GraphQL over an installed transport, so no
// network and no token. Runs against its own migrated temp database
// (test/helpers/db.ts) like every server test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/db.ts';
import { fakeGithub, jsonResponse } from '../helpers/github.ts';
import { ghApi, ghGraphql, GithubError, setGithubTransport } from '#modules/github/client.server.ts';

const fake = fakeGithub();
setGithubTransport(fake.transport);
after(() => setGithubTransport(null));

test('ghApi prefixes api.github.com, sends the GitHub headers and serializes the body', async () => {
  fake.on('POST', 'repos/o/r/issues', (call) => ({ number: 7, echoed: call.body }));
  const out = await ghApi<{ number: number; echoed: unknown }>('/repos/o/r/issues', { method: 'POST', body: { title: 'x' } });
  assert.equal(out.number, 7);
  assert.deepEqual(out.echoed, { title: 'x' });
  const call = fake.calls.at(-1)!;
  assert.equal(call.method, 'POST');
  assert.equal(call.path, 'repos/o/r/issues');
  assert.equal(call.headers.get('accept'), 'application/vnd.github+json');
  assert.equal(call.headers.get('x-github-api-version'), '2022-11-28');
  assert.equal(call.headers.get('user-agent'), 'genie');
});

test('a 204 resolves to undefined', async () => {
  fake.on('DELETE', 'repos/o/r/git/refs/heads/x', () => undefined);
  assert.equal(await ghApi<undefined>('repos/o/r/git/refs/heads/x', { method: 'DELETE' }), undefined);
});

test('a non-2xx answer throws GithubError with the status and the reset time', async () => {
  fake.on('GET', 'repos/o/r/limited', () => jsonResponse({ message: 'slow down' }, 403, { 'x-ratelimit-reset': '1700000000' }));
  const err = await ghApi('repos/o/r/limited').catch((e: unknown) => e);
  assert.ok(err instanceof GithubError);
  assert.equal(err.status, 403);
  assert.ok(err.resetAt instanceof Date);
  assert.equal(err.resetAt.getTime(), 1700000000 * 1000);
  assert.match(err.message, /GET \/repos\/o\/r\/limited failed with 403/);

  fake.on('GET', 'repos/o/r/missing', () => jsonResponse({ message: 'nope' }, 404));
  const missing = await ghApi('repos/o/r/missing').catch((e: unknown) => e);
  assert.ok(missing instanceof GithubError);
  assert.equal(missing.status, 404);
  assert.equal(missing.resetAt, null);
});

test('ghGraphql posts query and variables and returns data', async () => {
  fake.onGraphql('viewer', (variables) => ({ viewer: { login: 'x', got: variables.n } }));
  const data = await ghGraphql<{ viewer: { login: string; got: number } }>('query($n: Int) { viewer { login } }', { n: 3 });
  assert.equal(data.viewer.login, 'x');
  assert.equal(data.viewer.got, 3);
  assert.equal(fake.calls.at(-1)!.path, 'graphql');
});

test('a 200 with an INSUFFICIENT_SCOPES error is a GithubError with status 403', async () => {
  fake.onGraphql('scoped', () => jsonResponse({ data: null, errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'needs project' }] }));
  const err = await ghGraphql('query { scoped }').catch((e: unknown) => e);
  assert.ok(err instanceof GithubError);
  assert.equal(err.status, 403);
  assert.match(err.message, /needs project/);

  fake.onGraphql('malformed', () => jsonResponse({ errors: [{ message: 'parse error' }] }));
  const bad = await ghGraphql('query { malformed }').catch((e: unknown) => e);
  assert.ok(bad instanceof GithubError);
  assert.equal(bad.status, 400);
});

test('with a transport installed no Authorization header is sent and no token is read', async () => {
  const saved = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    fake.on('GET', 'rate_limit', () => ({ ok: true }));
    await ghApi('rate_limit');
    assert.equal(fake.calls.at(-1)!.headers.get('authorization'), null);
  } finally {
    if (saved.GH_TOKEN !== undefined) process.env.GH_TOKEN = saved.GH_TOKEN;
    if (saved.GITHUB_TOKEN !== undefined) process.env.GITHUB_TOKEN = saved.GITHUB_TOKEN;
  }
});
