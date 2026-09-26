// git inside a machine: the token rides the exec env and never the command.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

await import('../helpers/db.ts');
const { fakePilots, execResponse } = await import('../helpers/pilots-fake.ts');
const { setPilotsClient } = await import('#modules/pipeline/pilots.server.ts');
const { gitEnv, cloneRepo, pushBranch } = await import('#modules/pipeline/git.server.ts');

let fake: ReturnType<typeof fakePilots>;
beforeEach(() => {
  fake = fakePilots();
  setPilotsClient(fake.client);
  process.env.GH_TOKEN = 'ghp_sekrit';
});
afterEach(() => {
  setPilotsClient(null);
  delete process.env.GH_TOKEN;
});

type ExecBody = { cmd: string; env?: Record<string, string>; timeout_ms: number };

test('gitEnv carries the token as GH_TOKEN and as an insteadOf rewrite', () => {
  const env = gitEnv('tok');
  assert.deepEqual(Object.keys(env).sort(), ['GH_TOKEN', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_TERMINAL_PROMPT']);
  assert.equal(env.GH_TOKEN, 'tok');
  assert.ok(env.GIT_CONFIG_KEY_0.includes('x-access-token:tok@github.com'));
  assert.equal(env.GIT_CONFIG_VALUE_0, 'https://github.com/');
});

test('cloneRepo clones or refreshes the default branch with the token in env only', async () => {
  fake.respond(200, execResponse());
  await cloneRepo('m1', { githubRepo: 'vivek7405/genie', defaultBranch: 'main' });
  const body = fake.calls[0].body as ExecBody;
  assert.equal(fake.calls[0].path, '/v1/machines/m1/exec');
  assert.deepEqual(body.env, gitEnv('ghp_sekrit'));
  assert.equal(body.timeout_ms, 600_000);
  assert.ok(!body.cmd.includes('ghp_sekrit'), 'the token is not in the command');
  assert.ok(body.cmd.includes('--branch main'));
  assert.ok(body.cmd.includes('https://github.com/vivek7405/genie.git'));
  assert.ok(body.cmd.includes('if [ -d /home/pilot/app/.git ]'));
  assert.ok(body.cmd.includes('reset --hard origin/main'));
});

test('cloneRepo defaults the branch, throws with the token redacted, and refuses to run without GH_TOKEN', async () => {
  fake.respond(200, execResponse('', 128, 'fatal: could not read from https://x-access-token:ghp_sekrit@github.com/x/y.git'));
  await assert.rejects(cloneRepo('m1', { githubRepo: 'x/y' }), (err: Error) => {
    assert.match(err.message, /^git clone failed: /);
    assert.ok(!err.message.includes('ghp_sekrit'));
    assert.ok(err.message.includes('[redacted]'));
    return true;
  });
  assert.ok((fake.calls[0].body as ExecBody).cmd.includes('--branch main'));
  delete process.env.GH_TOKEN;
  await assert.rejects(cloneRepo('m1', { githubRepo: 'x/y' }), /GH_TOKEN is not set/);
  assert.equal(fake.calls.length, 1, 'no request without a token');
});

test('pushBranch pushes with the same env', async () => {
  fake.respond(200, execResponse());
  await pushBranch('m1', '/home/pilot/app', 'genie/smoke-1');
  const body = fake.calls[0].body as ExecBody;
  assert.equal(body.cmd, 'git -C /home/pilot/app push -u origin genie/smoke-1');
  assert.deepEqual(body.env, gitEnv('ghp_sekrit'));
  assert.equal(body.timeout_ms, 300_000);
});
