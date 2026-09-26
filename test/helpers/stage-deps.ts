// The stage dependency fake shared by the stage and worker tests. Every
// function records its calls, the exec is scripted per command (the most
// recently registered matching rule wins, and a list of answers is consumed
// in order with the last one repeating), and the defaults describe one happy
// path: a live machine, a repository with code, a plan, a PR the agent opened
// and a preview that is ready at once. Every timing is zero except the two
// windows, so a poll loop runs its iterations without waiting.
import type { ClaudeRun, RunClaudeOptions } from '#modules/pipeline/claude.server.ts';
import type { ExecOptions, ExecResult } from '#modules/pipeline/pilots.server.ts';
import type { StageDeps } from '#modules/pipeline/stages.server.ts';

export interface ExecScript {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}
export type ExecAnswer = ExecScript | Error;
export type ExecResponder = (cmd: string, nth: number) => ExecAnswer;

export const PR_URL = 'https://github.com/harness/stages/pull/7';
export const PR_LIST = `[{"number":7,"url":"${PR_URL}"}]`;
export const PREVIEW_URL = 'https://pr-7-demo.pilotrun.app';
export const PLAN_TEXT = ['## Stack', 'existing: WebJs', '', '## Files to touch', '- app/about/page.ts (new)', '', '## Steps', '1. Add the page.', '', '## Acceptance checks', '- [ ] /about renders'].join('\n');

export const okRun = (patch: Partial<ClaudeRun> = {}): ClaudeRun => ({
  exitCode: 0, result: 'DONE', subtype: 'success', isRateLimited: false, resetsAt: null, timedOut: false, durationMs: 1, ...patch,
});

export interface FakeDeps {
  deps: StageDeps;
  execs: { cmd: string; opts: ExecOptions }[];
  claudeRuns: RunClaudeOptions[];
  machines: { id: string; name: string }[];
  clones: { machineId: string; dir: string }[];
  pushes: { machineId: string; dir: string; branch: string }[];
  comments: { issueNumber: number; body: string }[];
  issueReads: number[];
  previews: { prNumber: number; sha: string }[];
  fileReads: string[];
  // Every exec and Claude run in the order they happened: 'exec:<cmd>' or
  // 'claude', for ordering assertions.
  timeline: string[];
  onCommand(match: string | RegExp, answer: ExecAnswer | ExecAnswer[] | ExecResponder): FakeDeps;
  onClaude(fn: (opts: RunClaudeOptions, nth: number) => ClaudeRun | Promise<ClaudeRun>): FakeDeps;
  onReadFile(fn: (path: string) => string | Promise<string>): FakeDeps;
  onPreview(fn: (prNumber: number, sha: string, nth: number) => string | null): FakeDeps;
  // The commands so far whose text includes `needle`.
  commands(needle: string | RegExp): string[];
}

export function fakeDeps(): FakeDeps {
  const rules: { match: string | RegExp; answer: ExecAnswer | ExecAnswer[] | ExecResponder; nth: number }[] = [];
  const state = {
    claude: (() => okRun()) as (opts: RunClaudeOptions, nth: number) => ClaudeRun | Promise<ClaudeRun>,
    readFile: (() => PLAN_TEXT) as (path: string) => string | Promise<string>,
    preview: (() => PREVIEW_URL) as (prNumber: number, sha: string, nth: number) => string | null,
  };
  let claudeCalls = 0;
  let previewCalls = 0;
  let machineCount = 0;

  const answer = (cmd: string): ExecAnswer => {
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i];
      const hit = typeof rule.match === 'string' ? cmd.includes(rule.match) : rule.match.test(cmd);
      if (!hit) continue;
      const nth = rule.nth++;
      if (typeof rule.answer === 'function') return rule.answer(cmd, nth);
      if (Array.isArray(rule.answer)) return rule.answer[Math.min(nth, rule.answer.length - 1)];
      return rule.answer;
    }
    return {};
  };

  const fake: FakeDeps = {
    execs: [], claudeRuns: [], machines: [], clones: [], pushes: [], comments: [], issueReads: [], previews: [], fileReads: [], timeline: [],
    deps: {
      async createTaskMachine(task) {
        const m = { id: `m-${++machineCount}`, name: `genie-stages-${task.id.slice(0, 8)}` };
        fake.machines.push(m);
        return { ...m, url: `https://${m.name}.pilotrun.app` };
      },
      async execLong(_machineId, cmd, opts) {
        fake.execs.push({ cmd, opts });
        fake.timeline.push(`exec:${cmd}`);
        const out = answer(cmd);
        if (out instanceof Error) throw out;
        return { stdout: out.stdout ?? '', stderr: out.stderr ?? '', exitCode: out.exitCode ?? 0, timedOut: false, durationMs: 1 };
      },
      async readFile(_machineId, path) {
        fake.fileReads.push(path);
        return state.readFile(path);
      },
      async runClaude(_machineId, opts) {
        fake.claudeRuns.push(opts);
        fake.timeline.push('claude');
        return state.claude(opts, claudeCalls++);
      },
      async cloneRepo(machineId, _project, opts) {
        fake.clones.push({ machineId, dir: opts.dir });
      },
      async pushBranch(machineId, dir, branch) {
        fake.pushes.push({ machineId, dir, branch });
      },
      async commentOnIssue(_project, issueNumber, body) {
        fake.comments.push({ issueNumber, body });
        return { id: fake.comments.length, htmlUrl: `https://github.com/harness/stages/issues/${issueNumber}#c${fake.comments.length}` };
      },
      async readIssue(_project, issueNumber) {
        fake.issueReads.push(issueNumber);
        return { title: `Issue ${issueNumber} title`, body: `Issue ${issueNumber} body` };
      },
      async findPreviewUrl(_project, prNumber, opts) {
        fake.previews.push({ prNumber, sha: opts.sha });
        return state.preview(prNumber, opts.sha, previewCalls++);
      },
      timing: { logPollMs: 0, previewPollMs: 0, appPollMs: 0, previewTimeoutMs: 60_000, appStartTimeoutMs: 60_000 },
      machineUrl: (name) => `https://${name}.pilotrun.app`,
    },
    onCommand(match, ans) {
      rules.push({ match, answer: ans, nth: 0 });
      return fake;
    },
    onClaude(fn) {
      state.claude = fn;
      return fake;
    },
    onReadFile(fn) {
      state.readFile = fn;
      return fake;
    },
    onPreview(fn) {
      state.preview = fn;
      return fake;
    },
    commands(needle) {
      return fake.execs.map((e) => e.cmd).filter((c) => (typeof needle === 'string' ? c.includes(needle) : needle.test(c)));
    },
  };

  // The happy path.
  fake.onCommand('test -d /home/pilot/app/.git', { stdout: 'ok\n' });
  fake.onCommand('git ls-files | wc -l', { stdout: '1\n120\n' });
  fake.onCommand('gh pr list', [{ stdout: '[]\n' }, { stdout: `${PR_LIST}\n` }]);
  fake.onCommand('git rev-parse origin/', { stdout: 'abc1234\n' });
  return fake;
}
