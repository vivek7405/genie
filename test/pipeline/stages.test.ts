import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { aProject, aTask, db, feedOf, rowOf } from '../helpers/db.ts';
import { eq } from 'drizzle-orm';
import { tasks } from '#db/schema.server.ts';
import { branchFor, feedLines, runStage, setStageDeps } from '#modules/pipeline/stages.server.ts';
import { renderPrompt, slugify } from '#modules/pipeline/prompts.server.ts';
import { MAX_CI_FIXES } from '#modules/pipeline/stages.server.ts';
import { findPilotsPreview, summarizeChecks, type CheckSummary } from '#modules/github/checks.server.ts';
import { setGithubTransport } from '#modules/github/client.server.ts';
import type { ClaudeRun } from '#modules/pipeline/claude.server.ts';
import type { ExecOptions } from '#modules/pipeline/pilots.server.ts';

const ok: ClaudeRun = { exitCode: 0, result: 'done', subtype: 'success', isRateLimited: false, resetsAt: null, timedOut: false, durationMs: 1 };

interface Script {
  // What CI reports for each successive commit, then the last one forever.
  ci?: CheckSummary['state'][];
  hasService?: boolean;
  pilotsPreview?: string | null;
  nodeApp?: boolean;
  appStarts?: boolean;
  fixPushes?: boolean;
  run?: Partial<ClaudeRun>;
  prAfterRun?: boolean;
  ahead?: string;
  probe?: 'ok' | 'empty' | 'gone';
  heads?: string[];
}

function fake(script: Script = {}) {
  const log = { prompts: [] as string[], created: 0, cloned: 0, pushed: [] as string[], opened: [] as string[], cmds: [] as string[], checksRead: 0 };
  let ran = false;
  let commit = 0;
  const ci = script.ci ?? ['passing'];
  const heads = [...(script.heads ?? ['aaa1111', 'bbb2222'])];
  const restore = setStageDeps({
    logPollMs: 5,
    timing: { pollMs: 1, checksAppearMs: 5, checksFinishMs: 5, pilotsPreviewMs: 5, appStartMs: 5 },
    readHeadSha: async () => `sha${commit}`,
    readChecks: async () => {
      log.checksRead++;
      const state = ci[Math.min(commit, ci.length - 1)];
      return { state, failed: state === 'failing' ? [{ name: 'CI (npm run ci)', url: 'https://github.com/a/b/actions/runs/1' }] : [] };
    },
    repoHasService: async () => script.hasService ?? false,
    findPilotsPreview: async () => script.pilotsPreview ?? null,
    machineUrl: async () => 'https://genie-x.pilotrun.app',
    createTaskMachine: async () => { log.created++; return { id: 'm-new', name: 'genie-x' }; },
    cloneRepo: async () => { log.cloned++; },
    pushBranch: async (_m, branch) => { log.pushed.push(branch); },
    findOpenPr: async () => (script.prAfterRun && ran ? { number: 7, url: 'https://github.com/a/b/pull/7' } : null),
    openPr: async (_r, input) => { log.opened.push(input.head); return { number: 8, url: 'https://github.com/a/b/pull/8' }; },
    runClaude: async (_m, opts) => {
      ran = true;
      log.prompts.push(opts.prompt);
      if (opts.prompt.includes('has failing CI') && script.fixPushes !== false) commit++;
      return { ...ok, ...script.run };
    },
    execLong: async (_m: string, cmd: string, _o: ExecOptions) => {
      log.cmds.push(cmd);
      const result = (stdout: string, exitCode = 0) => ({ stdout, stderr: '', exitCode, timedOut: false, durationMs: 1 });
      if (cmd.startsWith('test -d')) {
        if (script.probe === 'gone') throw new Error('machine not found');
        return result(script.probe === 'empty' ? '' : 'ok\n');
      }
      if (cmd.startsWith('test -f package.json')) return result(script.nodeApp === false ? '' : 'yes\n');
      if (cmd.startsWith('node -e')) return result('', script.appStarts === false ? 1 : 0);
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

test('a card stopped during the run opens no pull request', async () => {
  const log = fake({ ahead: '2' });
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1' });
  setStageDeps({ runClaude: async () => {
    await db.update(tasks).set({ error: 'Stopped.' }).where(eq(tasks.id, t.id));
    return ok;
  } });
  await assert.rejects(runStage(t), /Stopped/);
  assert.deepEqual(log.pushed, []);
  assert.deepEqual(log.opened, []);
});

test('a card stopped before the run never starts Claude', async () => {
  const log = fake();
  const p = await aProject();
  const t = await aTask(p.id, { status: 'in_progress', machineId: 'm1', error: 'Stopped.' });
  await assert.rejects(runStage(t), /Stopped/);
  assert.equal(log.prompts.length, 0);
});

test('green CI reaches Review without another run', async () => {
  const log = fake({ prAfterRun: true, ci: ['passing'] });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  assert.equal(await runStage(t), 'review');
  assert.equal(log.prompts.length, 1);
  assert.equal((await rowOf(t.id)).ciStatus, 'passing');
});

test('red CI gets a fix run on the same branch, and green lands in Review', async () => {
  const log = fake({ prAfterRun: true, ci: ['failing', 'passing'] });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  assert.equal(await runStage(t), 'review');
  assert.equal(log.prompts.length, 2);
  assert.ok(log.prompts[1].includes('CI (npm run ci): https://github.com/a/b/actions/runs/1'));
  assert.ok(log.prompts[1].includes('whether or not this branch introduced it'));
  assert.ok(log.prompts[1].includes('Never get to green by skipping'));
  assert.deepEqual(log.pushed, [branchFor(t)]);
  assert.equal((await rowOf(t.id)).ciStatus, 'passing');
});

test('CI still red after the last try reaches a person, marked failing', async () => {
  const log = fake({ prAfterRun: true, ci: ['failing'] });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  assert.equal(await runStage(t), 'review');
  assert.equal(log.prompts.length, 1 + MAX_CI_FIXES);
  assert.equal((await rowOf(t.id)).ciStatus, 'failing');
  assert.ok((await feedOf(t.id)).some((m) => m.includes('still failing')));
});

test('a fix that pushes nothing ends the loop instead of burning every try', async () => {
  const log = fake({ prAfterRun: true, ci: ['failing'], fixPushes: false, run: { result: 'The secret is missing' } });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  assert.equal(await runStage(t), 'review');
  assert.equal(log.prompts.length, 2);
  assert.ok((await feedOf(t.id)).some((m) => m.includes('pushed nothing new') && m.includes('secret is missing')));
});

test('a repository with no checks is not held up', async () => {
  fake({ prAfterRun: true, ci: ['none'] });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  assert.equal(await runStage(t), 'review');
  assert.equal((await rowOf(t.id)).ciStatus, 'none');
});

test('checks that outlast the wait read as pending, not as green', async () => {
  fake({ prAfterRun: true, ci: ['pending'] });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  assert.equal(await runStage(t), 'review');
  assert.equal((await rowOf(t.id)).ciStatus, 'pending');
});

test('Stop during the CI wait ends the stage', async () => {
  fake({ prAfterRun: true, ci: ['pending'] });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  setStageDeps({
    timing: { pollMs: 1, checksAppearMs: 100_000, checksFinishMs: 100_000, pilotsPreviewMs: 5, appStartMs: 5 },
    readChecks: async () => {
      await db.update(tasks).set({ error: 'Stopped.' }).where(eq(tasks.id, t.id));
      return { state: 'pending', failed: [] };
    },
  });
  await assert.rejects(runStage(t), /Stopped/);
});

test('a repo on Pilots uses the Pilots preview', async () => {
  const log = fake({ prAfterRun: true, hasService: true, pilotsPreview: 'https://pr-7-app.pilotrun.app' });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  await runStage(t);
  assert.equal((await rowOf(t.id)).previewUrl, 'https://pr-7-app.pilotrun.app');
  assert.ok(!log.cmds.some((c) => c.includes('setsid')));
});

test('a repo not on Pilots gets a preview from its machine', async () => {
  const log = fake({ prAfterRun: true });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  await runStage(t);
  assert.equal((await rowOf(t.id)).previewUrl, 'https://genie-x.pilotrun.app');
  const stop = log.cmds.findIndex((c) => c.includes('fuser -k'));
  const start = log.cmds.findIndex((c) => c.includes('setsid'));
  assert.ok(stop >= 0 && stop < start);
});

test('a Pilots preview that never comes falls back to the machine', async () => {
  fake({ prAfterRun: true, hasService: true, pilotsPreview: null });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  await runStage(t);
  assert.equal((await rowOf(t.id)).previewUrl, 'https://genie-x.pilotrun.app');
});

test('no preview never fails the stage', async () => {
  for (const script of [{ nodeApp: false }, { appStarts: false }]) {
    fake({ prAfterRun: true, ...script });
    const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
    assert.equal(await runStage(t), 'review');
    assert.equal((await rowOf(t.id)).previewUrl, null);
  }
  fake({ prAfterRun: true });
  setStageDeps({ repoHasService: async () => { throw new Error('Pilots is down'); } });
  const t = await aTask((await aProject()).id, { status: 'in_progress', machineId: 'm1' });
  assert.equal(await runStage(t), 'review');
  assert.ok((await feedOf(t.id)).some((m) => m.includes('Pilots is down')));
});

test('summarizeChecks reads GitHub check runs and statuses', () => {
  const run = (status: string, conclusion: string | null) => ({ name: 'ci', status, conclusion, html_url: 'u' });
  const st = (context: string, state: string) => ({ context, state, target_url: 'u' });
  assert.equal(summarizeChecks([], []).state, 'none');
  assert.equal(summarizeChecks([run('in_progress', null)], []).state, 'pending');
  assert.equal(summarizeChecks([run('completed', 'success'), run('completed', 'skipped'), run('completed', 'neutral')], []).state, 'passing');
  assert.equal(summarizeChecks([run('completed', 'failure'), run('in_progress', null)], []).state, 'failing');
  assert.equal(summarizeChecks([run('completed', 'cancelled')], []).state, 'failing');
  assert.equal(summarizeChecks([], [st('lint', 'error')]).state, 'failing');
  assert.equal(summarizeChecks([], [st('lint', 'pending')]).state, 'pending');
});

test('a Pilots preview building is not a CI result', () => {
  const pilots = (state: string) => ({ context: 'pilots/deploy', state, target_url: null });
  assert.equal(summarizeChecks([], [pilots('pending')]).state, 'none');
  assert.equal(summarizeChecks([], [pilots('failure')]).state, 'none');
  assert.equal(summarizeChecks([{ name: 'ci', status: 'completed', conclusion: 'success', html_url: null }], [pilots('pending')]).state, 'passing');
});

test('only a preview of this exact commit counts', async () => {
  const comment = { body: '<!-- pilots-preview -->\nPreview for `2988f50`: https://pr-5-app.pilotrun.app\n\nIt suspends when idle.' };
  setGithubTransport(async (url) => new Response(JSON.stringify(url.includes('/comments') ? [comment] : { statuses: [] }), { status: 200 }));
  assert.equal(await findPilotsPreview('a/b', 5, '2988f50aaaa'), 'https://pr-5-app.pilotrun.app');
  assert.equal(await findPilotsPreview('a/b', 5, 'fffffff0000'), null);
  setGithubTransport(async () => new Response('offline', { status: 503 }));
});

test('feedLines keeps prose and tool names and drops the rest', () => {
  const assistant = JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'text', text: 'Plan:\nsecond line' },
    { type: 'tool_use', name: 'Bash', input: { command: 'npm test\nmore' } },
    { type: 'tool_use', name: 'Glob' },
  ] } });
  assert.deepEqual(feedLines(assistant), ['Plan:', 'Bash: npm test', 'Glob']);
  assert.deepEqual(feedLines(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'server_tool_use', name: 'advisor' }, { type: 'advisor_tool_result' }] } })), ['Asked the advisor']);
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
