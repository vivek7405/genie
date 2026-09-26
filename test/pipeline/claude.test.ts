// runClaude over a fake exec sequence: the prompt write, the run, the tail.
// The credentials must appear in the run's env and nowhere else.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

await import('../helpers/db.ts');
const { fakePilots, execResponse } = await import('../helpers/pilots-fake.ts');
const { setPilotsClient } = await import('#modules/pipeline/pilots.server.ts');
const { CLAUDE_LAUNCHER, claudeCommand, runClaude } = await import('#modules/pipeline/claude.server.ts');

type ExecBody = { cmd: string; cwd?: string; env?: Record<string, string>; timeout_ms: number };
const SECRET_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
const RESULT = '{"type":"result","subtype":"success","is_error":false,"result":"Done.","total_cost_usd":0.0421,"num_turns":2,"duration_ms":9000,"session_id":"s-1"}';

let fake: ReturnType<typeof fakePilots>;
beforeEach(() => {
  fake = fakePilots();
  setPilotsClient(fake.client);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-test-token';
  delete process.env.GH_TOKEN;
});
afterEach(() => {
  setPilotsClient(null);
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.GH_TOKEN;
});

function bodies(): ExecBody[] {
  return fake.calls.map((c) => c.body as ExecBody);
}

test('CLAUDE_LAUNCHER is the pilot launcher and carries no credential', () => {
  for (const needle of ['hasCompletedOnboarding', 'npm config set prefix', '@anthropic-ai/claude-code', 'exec claude "$@"', 'genie: installing Claude Code']) {
    assert.ok(CLAUDE_LAUNCHER.includes(needle), `launcher includes ${needle}`);
  }
  for (const banned of ['CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant', 'ANTHROPIC_API_KEY', 'pilot:']) {
    assert.ok(!CLAUDE_LAUNCHER.includes(banned), `launcher does not include ${banned}`);
  }
});

test('claudeCommand wraps the launcher in sh -c with genie-claude as $0', () => {
  const cmd = claudeCommand(['-p', 'x']);
  assert.ok(cmd.startsWith("sh -c '"), cmd.slice(0, 20));
  assert.ok(cmd.endsWith("' genie-claude -p x"), cmd.slice(-30));
  assert.ok(cmd.includes("'\\''$3 == u"), 'the launcher single quotes are escaped');
  assert.ok(claudeCommand(['-p', { raw: '"$(cat f)"' }]).endsWith(` genie-claude -p "$(cat f)"`));
  assert.ok(claudeCommand(['a b']).endsWith(" genie-claude 'a b'"));
});

test('runClaude writes the prompt, runs with the secrets in one env, and parses the result line', async () => {
  process.env.GH_TOKEN = 'ghp_sekrit';
  fake.respond(200, execResponse());
  fake.respond(200, execResponse());
  fake.respond(200, execResponse(`${RESULT}\n`));
  const run = await runClaude('m1', { prompt: 'Create HELLO.md', cwd: '/home/pilot/app', timeoutMs: 300_000, maxTurns: 3 });
  const [write, exec, tail] = bodies();
  assert.equal(fake.calls.length, 3);
  assert.ok(write.cmd.includes('/home/pilot/.genie/prompt.md') && write.cmd.includes('Create HELLO.md'));
  assert.equal(write.env, undefined);
  assert.equal(exec.cwd, '/home/pilot/app');
  assert.equal(exec.timeout_ms, 300_000);
  assert.deepEqual(Object.keys(exec.env ?? {}).sort(), [...SECRET_KEYS, 'GIT_TERMINAL_PROMPT'].sort());
  assert.equal(exec.env?.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat-test-token');
  assert.equal(exec.env?.GH_TOKEN, 'ghp_sekrit');
  for (const b of [write, exec, tail]) {
    assert.ok(!b.cmd.includes('sk-ant-oat-test-token') && !b.cmd.includes('ghp_sekrit'), 'no secret in any cmd');
  }
  assert.equal(tail.env, undefined);
  assert.ok(exec.cmd.includes('--max-turns 3'));
  assert.ok(exec.cmd.includes('--output-format stream-json'));
  assert.ok(exec.cmd.includes('--verbose') && exec.cmd.includes('--dangerously-skip-permissions'));
  assert.ok(exec.cmd.includes('-p "$(cat /home/pilot/.genie/prompt.md)"'));
  assert.ok(exec.cmd.includes('> /home/pilot/.genie/claude.log 2> /home/pilot/.genie/claude.log.err'));
  assert.ok(tail.cmd.startsWith('tail -n 1 -- /home/pilot/.genie/claude.log; grep -F'));
  assert.equal(run.exitCode, 0);
  assert.equal(run.subtype, 'success');
  assert.equal(run.result, 'Done.');
  assert.equal(run.costUsd, 0.0421);
  assert.equal(run.numTurns, 2);
  assert.equal(run.sessionId, 's-1');
  assert.equal(run.isRateLimited, false);
  assert.equal(run.resetsAt, null);
  assert.equal(run.timedOut, false);
});

test('runClaude leaves the git keys out when GH_TOKEN is unset and honours model, logPath and extra env', async () => {
  fake.respond(200, execResponse());
  fake.respond(200, execResponse());
  fake.respond(200, execResponse(`${RESULT}\n`));
  await runClaude('m1', { prompt: 'p', cwd: '/x', timeoutMs: 1000, maxTurns: 1, model: 'claude-sonnet-5', logPath: '/tmp/run.log', env: { GENIE_STAGE: 'plan' } });
  const [, exec] = bodies();
  assert.deepEqual(Object.keys(exec.env ?? {}).sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'GENIE_STAGE']);
  assert.ok(exec.cmd.includes('--model claude-sonnet-5'));
  assert.ok(exec.cmd.includes('> /tmp/run.log 2> /tmp/run.log.err'));
});

async function runWithTail(tailStdout: string, exitCode = 0): Promise<Awaited<ReturnType<typeof runClaude>>> {
  fake.respond(200, execResponse());
  fake.respond(200, execResponse('', exitCode));
  fake.respond(200, execResponse(tailStdout));
  return runClaude('m1', { prompt: 'p', cwd: '/x', timeoutMs: 1000, maxTurns: 1 });
}

test('runClaude reads a rejected rate-limit event under either payload key', async () => {
  const errorResult = '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"stopped"}';
  const info = '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resets_at":1790000000,"rate_limit_type":"five_hour"}}';
  const a = await runWithTail(`${errorResult}\n${info}\n`, 1);
  assert.equal(a.isRateLimited, true);
  assert.deepEqual(a.resetsAt, new Date(1790000000000));
  assert.equal(a.exitCode, 1);
  const limits = '{"type":"rate_limit_event","rate_limits":{"status":"rejected","resets_at":1790000000}}';
  const b = await runWithTail(`${errorResult}\n${limits}\n`, 1);
  assert.equal(b.isRateLimited, true);
  assert.deepEqual(b.resetsAt, new Date(1790000000000));
});

test('runClaude reads the limit from the result text, and a plain success is not limited', async () => {
  const hit = '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"You\'ve hit your limit. Try again later."}';
  const a = await runWithTail(`${hit}\n`, 1);
  assert.equal(a.isRateLimited, true);
  assert.equal(a.resetsAt, null);
  const b = await runWithTail(`${RESULT}\n`);
  assert.equal(b.isRateLimited, false);
  assert.equal(b.resetsAt, null);
});

test('runClaude falls back to the stderr tail when the run left no result line', async () => {
  fake.respond(200, execResponse());
  fake.respond(200, execResponse('', 127));
  fake.respond(200, execResponse('{"type":"assistant","message":{}}\n'));
  fake.respond(200, execResponse('Error: something broke\n'));
  const run = await runClaude('m1', { prompt: 'p', cwd: '/x', timeoutMs: 0, maxTurns: 1 });
  assert.equal(fake.calls.length, 4);
  assert.ok((fake.calls[3].body as ExecBody).cmd.startsWith('tail -c 2000 -- /home/pilot/.genie/claude.log.err'));
  assert.equal(run.subtype, null);
  assert.equal(run.result, 'Error: something broke\n');
  assert.equal(run.timedOut, true);
});

test('runClaude rejects before any request without CLAUDE_CODE_OAUTH_TOKEN', async () => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  await assert.rejects(runClaude('m1', { prompt: 'p', cwd: '/x', timeoutMs: 1000, maxTurns: 1 }), /CLAUDE_CODE_OAUTH_TOKEN is not set/);
  assert.equal(fake.calls.length, 0);
});
