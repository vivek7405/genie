import { test } from 'node:test';
import assert from 'node:assert/strict';
import './../helpers/db.ts';
import type { PilotsClient } from '@pilots/sdk';
import { execLong, machineNameFor, redact, setPilotsClient, shellQuote, writeFile } from '#modules/pipeline/pilots.server.ts';
import { claudeCommand, runClaude } from '#modules/pipeline/claude.server.ts';
import { gitEnv } from '#modules/pipeline/git.server.ts';

interface Req { cmd: string; env?: Record<string, string>; timeout_ms?: number }

function fakeClient(answer: (req: Req) => { stdout?: string; stderr?: string; exit_code?: number }) {
  const calls: Req[] = [];
  const client = { machines: { exec: async (_id: string, req: Req) => {
    calls.push(req);
    const a = answer(req);
    return { stdout: a.stdout ?? '', stderr: a.stderr ?? '', exit_code: a.exit_code ?? 0 };
  } } };
  setPilotsClient(client as unknown as PilotsClient);
  return calls;
}

test('redact blanks every known secret, the longest first', () => {
  assert.equal(redact('a test-github-token b'), 'a [redacted] b');
  assert.equal(redact('x', []), 'x');
  const url = 'url.https://x-access-token:test-github-token@github.com/';
  assert.equal(redact(`git said ${url}`, [url]), 'git said [redacted]');
});

test('shellQuote leaves safe strings and quotes the rest', () => {
  assert.equal(shellQuote('genie/ab12-add-page'), 'genie/ab12-add-page');
  assert.equal(shellQuote("it's; rm -rf /"), `'it'\\''s; rm -rf /'`);
  assert.equal(shellQuote(''), "''");
});

test('a machine name is a DNS label that stays under the limit', () => {
  const name = machineNameFor({ id: 'abcdef12-3456' }, { githubRepo: `acme/${'Very_Long.Repo-'.repeat(8)}` });
  assert.match(name, /^genie-[a-z0-9-]+-abcdef12$/);
  assert.ok(name.length <= 63);
  assert.equal(machineNameFor({ id: 'abcdef12' }, { githubRepo: 'acme/___' }), 'genie-repo-abcdef12');
});

test('execLong redacts what comes back, including the exec env', async () => {
  fakeClient(() => ({ stdout: 'token test-github-token', stderr: 'custom-secret' }));
  const r = await execLong('m', 'x', { timeoutMs: 1000, env: { A: 'custom-secret' } });
  assert.equal(r.stdout, 'token [redacted]');
  assert.equal(r.stderr, '[redacted]');
  assert.equal(r.timedOut, false);
});

test('writeFile uses a quoted heredoc, so content is never interpreted', async () => {
  const calls = fakeClient(() => ({}));
  await writeFile('m', '/home/pilot/p.md', 'hello $(rm -rf /) `x`\nGENIE_EOF\n');
  assert.match(calls[0].cmd, /<<'GENIE_EOF_[0-9a-f]{24}'\n/);
  assert.ok(calls[0].cmd.includes('hello $(rm -rf /) `x`'));
});

test('writeFile refuses what one exec body cannot carry', async () => {
  fakeClient(() => ({}));
  await assert.rejects(writeFile('m', '/x', 'a'.repeat(1024 * 1024)), /over the limit/);
});

test('the git env carries the token only as exec env', () => {
  const env = gitEnv('tok');
  assert.equal(env.GH_TOKEN, 'tok');
  assert.equal(env.GIT_CONFIG_KEY_0, 'url.https://x-access-token:tok@github.com/.insteadOf');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
});

test('claudeCommand keeps every argument one word', () => {
  assert.match(claudeCommand(['-p', 'two words']), /genie-claude -p 'two words'$/);
  assert.match(claudeCommand([{ raw: '"$(cat f)"' }]), /genie-claude "\$\(cat f\)"$/);
});

test('runClaude stops a leftover run first and reads the result line back', async () => {
  const result = JSON.stringify({ type: 'result', subtype: 'success', result: 'https://github.com/a/b/pull/1', num_turns: 3 });
  const calls = fakeClient((req) => (req.cmd.startsWith('tail -n 1') ? { stdout: `${result}\n` } : {}));
  const run = await runClaude('m', { prompt: 'do it', cwd: '/app', timeoutMs: 1000, maxTurns: 5, logPath: '/log' });
  const stop = calls.findIndex((c) => c.cmd.includes('pkill'));
  const start = calls.findIndex((c) => c.cmd.includes('--dangerously-skip-permissions'));
  assert.ok(stop >= 0 && stop < start);
  assert.equal(calls[start].env?.CLAUDE_CODE_OAUTH_TOKEN, 'test-claude-token');
  assert.equal(calls[start].env?.GH_TOKEN, 'test-github-token');
  assert.ok(!calls[start].cmd.includes('test-claude-token'));
  assert.equal(run.result, 'https://github.com/a/b/pull/1');
  assert.equal(run.isRateLimited, false);
});

test('runClaude reports a rate limit and when it resets', async () => {
  const limit = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resets_at: 1893456000 } });
  fakeClient((req) => (req.cmd.startsWith('tail -n 1') ? { stdout: `${limit}\n` } : {}));
  const run = await runClaude('m', { prompt: 'x', cwd: '/app', timeoutMs: 1000, maxTurns: 5, logPath: '/log' });
  assert.equal(run.isRateLimited, true);
  assert.equal(run.resetsAt?.getTime(), 1893456000 * 1000);
  setPilotsClient(null);
});
