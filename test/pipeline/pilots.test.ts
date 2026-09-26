// The pilots layer against the SDK's real request shapes over a fake fetch.
// No real machine is ever touched. Tests that reach settings import the db
// helper first.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

await import('../helpers/db.ts');
const { fakePilots, execResponse } = await import('../helpers/pilots-fake.ts');
const pilotsModule = await import('#modules/pipeline/pilots.server.ts');
const { machineNameFor, execLong, redact, readFile, writeFile, pullTree, destroyMachine, setPilotsClient, pilots, shellQuote } = pilotsModule;

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

let fake: ReturnType<typeof fakePilots>;
beforeEach(() => {
  fake = fakePilots();
  setPilotsClient(fake.client);
});
afterEach(() => {
  setPilotsClient(null);
  delete process.env.GH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.PILOT_API_KEY;
});

test('machineNameFor builds genie-<slug>-<id8> within the DNS label rules', () => {
  const id = '2f7c9d3e-1111-4222-8333-444444444444';
  assert.equal(machineNameFor({ id }, { githubRepo: 'vivek7405/genie' }), 'genie-genie-2f7c9d3e');
  assert.equal(machineNameFor({ id }, { githubRepo: 'Owner/My.Repo_Name' }), 'genie-my-repo-name-2f7c9d3e');
  const long = machineNameFor({ id }, { githubRepo: `o/${'x'.repeat(70)}` });
  assert.ok(long.length <= 63, `${long} is ${long.length} chars`);
  assert.match(long, LABEL);
  const edge = machineNameFor({ id }, { githubRepo: 'o/-Weird--Name-' });
  assert.equal(edge, 'genie-weird-name-2f7c9d3e');
  assert.match(edge, LABEL);
});

test('shellQuote leaves safe strings alone and single-quotes the rest', () => {
  assert.equal(shellQuote('/home/pilot/app'), '/home/pilot/app');
  assert.equal(shellQuote('--max-turns'), '--max-turns');
  assert.equal(shellQuote("it's $HOME"), "'it'\\''s $HOME'");
  assert.equal(shellQuote(''), "''");
});

test('execLong posts cmd, cwd, env and timeout_ms, and redacts env values from the output', async () => {
  fake.respond(200, execResponse('token is sekrit-1 and url https://x-access-token:sekrit-1@github.com/', 0, 'sekrit-1 again'));
  const res = await execLong('m1', 'echo hi', { cwd: '/home/pilot/app', env: { GH_TOKEN: 'sekrit-1' }, timeoutMs: 12_345 });
  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.path, '/v1/machines/m1/exec');
  assert.deepEqual(call.body, { cmd: 'echo hi', cwd: '/home/pilot/app', env: { GH_TOKEN: 'sekrit-1' }, timeout_ms: 12_345 });
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, 'token is [redacted] and url https://x-access-token:[redacted]@github.com/');
  assert.equal(res.stderr, '[redacted] again');
  assert.equal(res.timedOut, false);
});

test('execLong flags exit 127 after the timeout as timedOut', async () => {
  fake.respond(200, execResponse('', 127));
  const res = await execLong('m1', 'sleep 5', { timeoutMs: 0 });
  assert.equal(res.exitCode, 127);
  assert.equal(res.timedOut, true);
  fake.respond(200, execResponse('', 127, 'bash: nope: command not found'));
  const quick = await execLong('m1', 'nope', { timeoutMs: 60_000 });
  assert.equal(quick.timedOut, false);
});

test('redact replaces every occurrence of each secret, longest first, and is a no-op with none set', () => {
  assert.equal(redact('nothing to hide abc'), 'nothing to hide abc');
  process.env.GH_TOKEN = 'abc';
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'abcdef';
  process.env.PILOT_API_KEY = 'pk_1';
  assert.equal(redact('abcdef abc pk_1 abc'), '[redacted] [redacted] [redacted] [redacted]');
  assert.equal(redact('x-y', ['x']), '[redacted]-y');
  assert.equal(redact('', ['x']), '');
});

test('readFile decodes the base64 the machine printed', async () => {
  fake.respond(200, execResponse(Buffer.from('hello\n').toString('base64')));
  assert.equal(await readFile('m1', '/home/pilot/app/HELLO.md'), 'hello\n');
  assert.equal(fake.calls[0].body && (fake.calls[0].body as { cmd: string }).cmd, 'base64 -w0 -- /home/pilot/app/HELLO.md');
  fake.respond(200, execResponse('', 1, 'base64: /nope: No such file or directory'));
  await assert.rejects(readFile('m1', '/nope'), /No such file/);
});

test('writeFile sends a quoted heredoc with a random delimiter and refuses an oversized body', async () => {
  fake.respond(200, execResponse());
  await writeFile('m1', '/home/pilot/.genie/prompt.md', "Say 'hi' to $USER\n");
  const cmd = (fake.calls[0].body as { cmd: string }).cmd;
  assert.match(cmd, /^mkdir -p -- \/home\/pilot\/\.genie && cat > \/home\/pilot\/\.genie\/prompt\.md <<'GENIE_EOF_[0-9a-f]{24}'\nSay 'hi' to \$USER\nGENIE_EOF_[0-9a-f]{24}\n$/);
  assert.equal((fake.calls[0].body as { timeout_ms: number }).timeout_ms, 30_000);
  await assert.rejects(writeFile('m1', '/big', 'x'.repeat(950 * 1024)), /over the/);
  assert.equal(fake.calls.length, 1, 'the oversized write made no request');
});

test('pullTree streams a tar with no env on the URL and maps files relative to the directory', async () => {
  const { execSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'genie-tar-'));
  mkdirSync(join(root, '.genie', 'nested'), { recursive: true });
  writeFileSync(join(root, '.genie', 'claude.log'), '{"type":"result"}\n');
  writeFileSync(join(root, '.genie', 'nested', 'deep.txt'), 'deep');
  const tar = execSync('tar -c --format=gnu -- .genie', { cwd: root });
  fake.respondStream({ stdout: tar, exitCode: 0 });
  const files = await pullTree('m1', '/home/pilot/.genie');
  assert.deepEqual([...files.keys()].sort(), ['claude.log', 'nested/deep.txt']);
  assert.equal(files.get('nested/deep.txt')!.toString(), 'deep');
  assert.equal(fake.streams.length, 1);
  const url = fake.streams[0];
  assert.equal(url.pathname, '/v1/machines/m1/exec/stream');
  assert.deepEqual(url.searchParams.getAll('cmd'), ['sh', '-c', 'cd /home/pilot && tar -c -- .genie']);
  assert.equal(url.searchParams.get('stdin'), 'false');
  assert.equal(url.searchParams.has('env'), false);
  fake.respondStream({ stderr: 'tar: nope: Cannot stat', exitCode: 2 });
  await assert.rejects(pullTree('m1', '/nope'), /tar exited 2.*Cannot stat/);
});

test('destroyMachine swallows an already-gone machine', async () => {
  fake.respond(204);
  await destroyMachine('m1');
  assert.equal(fake.calls[0].method, 'DELETE');
  assert.equal(fake.calls[0].path, '/v1/machines/m1');
  fake.respond(404, { error: 'no such machine', code: 'not_found' });
  await destroyMachine('m1');
  fake.respond(500, { error: 'internal error' });
  await assert.rejects(destroyMachine('m1'), /internal error/);
});

test('pilots() without an injected client and no PILOT_API_KEY throws the named error', () => {
  setPilotsClient(null);
  assert.throws(() => pilots(), /PILOT_API_KEY is not set/);
});

// createTaskMachine: reuse by name, fork of the stored base checkpoint,
// a rebuild when the checkpoint is gone, the quota message.
const { createTaskMachine } = pilotsModule;
const { db } = await import('../helpers/db.ts');
const { settings } = await import('#db/schema.server.ts');
const { BASE_CHECKPOINT_KEY } = await import('#modules/pipeline/base-image.server.ts');

const task = { id: '2f7c9d3e-1111-4222-8333-444444444444' };
const project = { githubRepo: 'vivek7405/genie' };
const machine = (id: string, name: string) => ({ id, name, url: `https://${name}.pilots.test`, state: 'running', vcpus: 1, mem_mib: 2048, knobs: {}, host_id: 'h', created_at: 0, last_activity: 0 });

async function storeCheckpoint(id: string) {
  await db.delete(settings);
  await db.insert(settings).values({ key: BASE_CHECKPOINT_KEY, value: id });
}

test('createTaskMachine forks the stored base checkpoint by name', async () => {
  await storeCheckpoint('ck_base');
  fake.respond(200, []);
  fake.respond(200, { id: 'ck_base', machine_id: 'm_base', durable: true });
  fake.respond(201, { forks: [{ machine: machine('m_fork', 'genie-genie-2f7c9d3e') }] });
  const m = await createTaskMachine(task, project);
  assert.deepEqual(m, { id: 'm_fork', name: 'genie-genie-2f7c9d3e', url: 'https://genie-genie-2f7c9d3e.pilots.test' });
  assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), ['GET /v1/machines', 'GET /v1/checkpoints/ck_base', 'POST /v1/checkpoints/ck_base/fork']);
  assert.deepEqual(fake.calls[2].body, { name: 'genie-genie-2f7c9d3e' });
});

test('createTaskMachine returns an existing machine of that name without forking', async () => {
  await storeCheckpoint('ck_base');
  fake.respond(200, [machine('m_old', 'genie-genie-2f7c9d3e'), machine('m_other', 'genie-other-2f7c9d3e')]);
  const m = await createTaskMachine(task, project);
  assert.equal(m.id, 'm_old');
  assert.equal(fake.calls.length, 1);
});

test('createTaskMachine rebuilds the base once when the fork answers not found', async () => {
  await storeCheckpoint('ck_gone');
  fake.respond(200, []);
  fake.respond(200, { id: 'ck_gone', machine_id: 'm_base', durable: true });
  fake.respond(404, { error: 'no such checkpoint', code: 'not_found' });
  // The rebuild: no base machine, create, resize, five steps, checkpoint, durable.
  fake.respond(200, []);
  fake.respond(201, machine('m_base2', 'genie-base'));
  fake.respond(200, machine('m_base2', 'genie-base'));
  for (let i = 0; i < 5; i++) fake.respond(200, execResponse());
  fake.respond(201, { id: 'ck_new', machine_id: 'm_base2', durable: false });
  fake.respond(200, { id: 'ck_new', machine_id: 'm_base2', durable: true });
  fake.respond(201, { forks: [{ machine: machine('m_fork2', 'genie-genie-2f7c9d3e') }] });
  const m = await createTaskMachine(task, project);
  assert.equal(m.id, 'm_fork2');
  const paths = fake.calls.map((c) => `${c.method} ${c.path}`);
  assert.equal(paths.filter((p) => p === 'POST /v1/machines').length, 1);
  assert.equal(paths.at(-1), 'POST /v1/checkpoints/ck_new/fork');
  const stored = await db.query.settings.findFirst({ where: { key: BASE_CHECKPOINT_KEY } });
  assert.equal(stored?.value, 'ck_new');
});

test('createTaskMachine turns a quota refusal into the named error', async () => {
  await storeCheckpoint('ck_base');
  fake.respond(200, []);
  fake.respond(200, { id: 'ck_base', machine_id: 'm_base', durable: true });
  fake.respond(429, { error: 'too many machines', code: 'quota_exceeded', quota: 'machines', limit: 20, used: 20 });
  await assert.rejects(createTaskMachine(task, project), /^Error: pilots machine quota reached \(20\)\. Destroy finished task machines and retry\.$/);
});

test('createTaskMachine with GENIE_PILOTS_FORK=0 creates, resizes and installs Claude Code', async () => {
  process.env.GENIE_PILOTS_FORK = '0';
  try {
    fake.respond(200, []);
    fake.respond(201, machine('m_plain', 'genie-genie-2f7c9d3e'));
    fake.respond(200, machine('m_plain', 'genie-genie-2f7c9d3e'));
    fake.respond(200, execResponse('2.1.283 (Claude Code)'));
    const m = await createTaskMachine(task, project);
    assert.equal(m.id, 'm_plain');
    assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), ['GET /v1/machines', 'POST /v1/machines', 'POST /v1/machines/m_plain/resize', 'POST /v1/machines/m_plain/exec']);
    assert.deepEqual(fake.calls[1].body, { name: 'genie-genie-2f7c9d3e', mem_mib: 2048, knobs: { idle_timeout: 3600 }, labels: { genie_task: task.id, genie: '1' } });
    assert.deepEqual(fake.calls[2].body, { mem_mib: 2048 });
    const install = fake.calls[3].body as { cmd: string; env?: unknown };
    assert.ok(install.cmd.endsWith(' genie-claude --version'));
    assert.equal(install.env, undefined);
  } finally {
    delete process.env.GENIE_PILOTS_FORK;
  }
});
