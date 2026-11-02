import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { aProject, aTask, feedOf, rowOf } from '../helpers/db.ts';
import { branchFor, feedLines, runStage, setStageDeps } from '#modules/pipeline/stages.server.ts';
import { renderPrompt, slugify } from '#modules/pipeline/prompts.server.ts';
import type { ClaudeRun } from '#modules/pipeline/claude.server.ts';
import type { ExecOptions } from '#modules/pipeline/pilots.server.ts';

const ok: ClaudeRun = { exitCode: 0, result: 'done', subtype: 'success', isRateLimited: false, resetsAt: null, timedOut: false, durationMs: 1 };

interface Script {
  run?: Partial<ClaudeRun>;
  prAfterRun?: boolean;
  ahead?: string;
  probe?: 'ok' | 'empty' | 'gone';
  heads?: string[];
}

function fake(script: Script = {}) {
  const log = { prompts: [] as string[], created: 0, cloned: 0, pushed: [] as string[], opened: [] as string[], cmds: [] as string[] };
  let ran = false;
  const heads = [...(script.heads ?? ['aaa1111', 'bbb2222'])];
  const restore = setStageDeps({
    logPollMs: 5,
    createTaskMachine: async () => { log.created++; return { id: 'm-new', name: 'genie-x' }; },
    cloneRepo: async () => { log.cloned++; },
    pushBranch: async (_m, branch) => { log.pushed.push(branch); },
    findOpenPr: async () => (script.prAfterRun && ran ? { number: 7, url: 'https://github.com/a/b/pull/7' } : null),
    openPr: async (_r, input) => { log.opened.push(input.head); return { number: 8, url: 'https://github.com/a/b/pull/8' }; },
    runClaude: async (_m, opts) => { ran = true; log.prompts.push(opts.prompt); return { ...ok, ...script.run }; },
    execLong: async (_m: string, cmd: string, _o: ExecOptions) => {
      log.cmds.push(cmd);
      const result = (stdout: string, exitCode = 0) => ({ stdout, stderr: '', exitCode, timedOut: false, durationMs: 1 });
      if (cmd.startsWith('test -d')) {
        if (script.probe === 'gone') throw new Error('machine not found');
        return result(script.probe === 'empty' ? '' : 'ok\n');
      }
      if (cmd.startsWith('git rev-list')) return result(`${script.ahead ?? '0'}\n`);
      if (cmd.startsWith('git rev-parse')) return result(`${heads.shift() ?? 'zzz'}\n`);
      return result('');
    },
  });
  cleanup = restore;
  return log;
}

let cleanup: () => void = () => {};
afterEach(() => cleanup());

test('the backlog stage makes a machine and clones the repo', async () => {
  const log = fake();
  const p = await aProject();
  const t = await aTask(p.id);
  assert.equal(await runStage(t), 'in_progress');
  assert.equal(log.created, 1);
  assert.equal(log.cloned, 1);
  assert.equal((await rowOf(t.id)).machineId, 'm-new');
});

test('a machine that still holds the clone is reused', async () => {
  const log = fake();
  const p = await aProject();
  const t = await aTask(p.id, { machineId: 'm1' });
  await runStage(t);
  assert.equal(log.created, 0);
  assert.equal(log.cloned, 0);
});

test('a machine that stopped answering is replaced and cloned again', async () => {
  const log = fake({ probe: 'gone' });
  const p = await aProject();
  const t = await aTask(p.id, { machineId: 'dead' });
  await runStage(t);
  assert.equal(log.created, 1);
  assert.equal(log.cloned, 1);
  assert.equal((await rowOf(t.id)).machineId, 'm-new');
});

test('a build whose run opened the PR moves to review with that PR', async () => {
  const log = fake({ prAfterRun: true });
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1', title: 'Add "quotes" & $(things)', description: 'Why {{not}}' });
  assert.equal(await runStage(t), 'review');
  const row = await rowOf(t.id);
  assert.equal(row.prNumber, 7);
  assert.equal(row.branch, branchFor(t));
  assert.ok(log.prompts[0].includes('Add "quotes" & $(things)'));
  assert.ok(log.prompts[0].includes('Why {{not}}'));
  assert.equal(log.opened.length, 0);
});

test('a run that committed but opened no PR gets one opened for it', async () => {
  const log = fake({ ahead: '2', run: { timedOut: true, exitCode: 127 } });
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1' });
  assert.equal(await runStage(t), 'review');
  assert.deepEqual(log.pushed, [branchFor(t)]);
  assert.equal((await rowOf(t.id)).prNumber, 8);
  assert.ok((await feedOf(t.id)).some((m) => m.includes('time limit')));
});

test('a run that committed nothing fails and says what Claude said', async () => {
  fake({ ahead: '0', run: { result: 'I could not find the repo' } });
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1' });
  await assert.rejects(runStage(t), /without committing any change.*could not find the repo/);
});

test('a rate limit fails the stage with the reset time', async () => {
  fake({ run: { isRateLimited: true, resetsAt: new Date('2030-01-01T10:00:00Z') } });
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1' });
  await assert.rejects(runStage(t), /usage limit reached.*Retry/);
});

test('an open PR found before the run skips Claude, so a rerun opens no second PR', async () => {
  const log = fake();
  setStageDeps({ findOpenPr: async () => ({ number: 3, url: 'u' }) });
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1' });
  assert.equal(await runStage(t), 'review');
  assert.equal(log.prompts.length, 0);
  assert.equal((await rowOf(t.id)).prNumber, 3);
});

test('feedback makes the stage revise on the same branch and then clears', async () => {
  const log = fake();
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1', branch: 'genie/x', prNumber: 5, feedback: 'Make it blue' });
  assert.equal(await runStage(t), 'review');
  assert.ok(log.prompts[0].includes('Make it blue'));
  assert.ok(log.prompts[0].includes('#5'));
  assert.deepEqual(log.pushed, ['genie/x']);
  assert.equal(log.opened.length, 0);
  assert.equal((await rowOf(t.id)).feedback, null);
});

test('a revise that changes nothing goes back to review and says so', async () => {
  fake({ heads: ['same', 'same'], run: { result: 'Already blue' } });
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1', branch: 'genie/x', prNumber: 5, feedback: 'Make it blue' });
  assert.equal(await runStage(t), 'review');
  assert.ok((await feedOf(t.id)).some((m) => m.includes('pushed nothing new') && m.includes('Already blue')));
});

test('a failed revise keeps its feedback for Retry', async () => {
  fake({ run: { isRateLimited: true } });
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1', branch: 'genie/x', prNumber: 5, feedback: 'Make it blue' });
  await assert.rejects(runStage(t));
  assert.equal((await rowOf(t.id)).feedback, 'Make it blue');
});

test('feedLines keeps prose and tool names and drops the rest', () => {
  const assistant = JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'text', text: 'Plan:\nsecond line' },
    { type: 'tool_use', name: 'Bash', input: { command: 'npm test\nmore' } },
    { type: 'tool_use', name: 'Glob' },
  ] } });
  assert.deepEqual(feedLines(assistant), ['Plan:', 'Bash: npm test', 'Glob']);
  assert.deepEqual(feedLines(JSON.stringify({ type: 'user' })), []);
  assert.deepEqual(feedLines('{"truncated'), []);
  assert.deepEqual(feedLines('null'), []);
  const long = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(500) }] } });
  assert.equal(feedLines(long)[0].length, 240);
});

test('slugify and branch names stay git safe', () => {
  assert.equal(slugify('Add a /about page!'), 'add-a-about-page');
  assert.equal(slugify('日本語'), 'task');
  assert.ok(slugify('a'.repeat(99)).length <= 30);
  assert.equal(branchFor({ id: 'abcdef12-xx', title: 'Fix: it' }), 'genie/abcdef12-fix-it');
});

test('a prompt refuses a missing value and never rescans an inserted one', () => {
  assert.throws(() => renderPrompt('build', { repo: 'a/b' }), /no value for/);
  const out = renderPrompt('revise', { repo: 'a/b', appDir: '/a', prNumber: '1', branch: 'b', defaultBranch: 'main', title: 't', description: 'd', feedback: '{{repo}}' });
  assert.ok(out.includes('{{repo}}'));
});
