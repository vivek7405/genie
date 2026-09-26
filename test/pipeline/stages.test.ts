// The three real stages against the dependency fake: no machine, no Claude,
// no GitHub. Each test inserts its own task row and calls runStage directly.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { db, eventsOf } = await import('../helpers/db.ts');
const { fakeDeps, okRun, PLAN_TEXT, PR_LIST, PR_URL, PREVIEW_URL } = await import('../helpers/stage-deps.ts');
const { projects, tasks, taskEvents } = await import('#db/schema.server.ts');
const stages = await import('#modules/pipeline/stages.server.ts');
const { runStage, setStageDeps, APP_DIR, SCAFFOLD_CMD } = stages;

type Fake = ReturnType<typeof fakeDeps>;
type TaskRow = typeof tasks.$inferSelect;
type TaskInsert = typeof tasks.$inferInsert;

const [project] = await db.insert(projects).values({ name: 'stages', githubRepo: 'harness/stages', defaultBranch: 'main' }).returning();

let fake: Fake;
let restore: () => void;
beforeEach(async () => {
  // Issue numbers are unique per project, so each test starts from no rows.
  await db.delete(taskEvents);
  await db.delete(tasks);
  fake = fakeDeps();
  restore = setStageDeps(fake.deps);
});
afterEach(() => {
  restore();
  delete process.env.GENIE_SELF_REVIEW;
});

async function insertTask(patch: Partial<TaskInsert> = {}): Promise<TaskRow> {
  const [row] = await db.insert(tasks).values({ projectId: project.id, title: 'Add an about page', ...patch }).returning();
  return row;
}

async function reload(id: string): Promise<TaskRow> {
  return (await db.query.tasks.findFirst({ where: { id } }))!;
}

async function messages(id: string, kind?: string): Promise<string[]> {
  return (await eventsOf(id)).filter((e) => !kind || e.kind === kind).map((e) => e.message);
}

// Stage 1: todo to planning.

test('todo creates a machine, clones the repository and stores the machine on the row', async () => {
  const task = await insertTask();
  assert.equal(await runStage(task), 'planning');
  assert.equal(fake.machines.length, 1);
  assert.deepEqual(fake.clones, [{ machineId: 'm-1', dir: APP_DIR }]);
  const row = await reload(task.id);
  assert.equal(row.machineId, 'm-1');
  assert.equal(row.machineName, `genie-stages-${task.id.slice(0, 8)}`);
  const logs = await messages(task.id, 'log');
  assert.ok(logs.some((m) => m.startsWith('Machine genie-stages-')));
  assert.ok(logs.some((m) => m === `Cloned harness/stages into ${APP_DIR}`));
});

test('todo reuses a live machine that already holds the clone', async () => {
  const task = await insertTask({ machineId: 'm1', machineName: 'genie-stages-m1' });
  assert.equal(await runStage(task), 'planning');
  assert.equal(fake.machines.length, 0, 'no new machine');
  assert.equal(fake.clones.length, 0, 'no clone');
  assert.equal(fake.commands('test -d /home/pilot/app/.git').length, 1, 'one probe');
});

test('todo clones again into a live machine that lost the clone', async () => {
  fake.onCommand('test -d /home/pilot/app/.git', { stdout: '', exitCode: 1 });
  const task = await insertTask({ machineId: 'm1', machineName: 'genie-stages-m1' });
  assert.equal(await runStage(task), 'planning');
  assert.equal(fake.machines.length, 0);
  assert.deepEqual(fake.clones, [{ machineId: 'm1', dir: APP_DIR }]);
});

test('todo creates a new machine when the probe throws', async () => {
  fake.onCommand('test -d /home/pilot/app/.git', new Error('machine not found'));
  const task = await insertTask({ machineId: 'm-gone', machineName: 'genie-stages-gone' });
  assert.equal(await runStage(task), 'planning');
  assert.equal(fake.machines.length, 1);
  assert.deepEqual(fake.clones, [{ machineId: 'm-1', dir: APP_DIR }]);
  assert.equal((await reload(task.id)).machineId, 'm-1');
});

// Stage 2: planning to in_progress.

test('planning runs one timeboxed Claude run, stores the plan and comments on the issue', async () => {
  const task = await insertTask({ status: 'planning', machineId: 'm1', machineName: 'genie-stages-m1', githubIssueNumber: 4 });
  assert.equal(await runStage(task), 'in_progress');
  assert.equal(fake.claudeRuns.length, 1);
  const run = fake.claudeRuns[0];
  assert.equal(run.maxTurns, 12);
  assert.equal(run.timeoutMs, 180_000);
  assert.equal(run.logPath, '/home/pilot/agent.log');
  assert.equal(run.cwd, APP_DIR);
  assert.ok(run.prompt.includes('Issue #4: Issue 4 title'), 'the issue text is the task text');
  assert.ok(run.prompt.includes('Issue 4 body'));
  assert.ok(run.prompt.includes('Write the plan to `/home/pilot/PLAN.md`'));
  assert.ok(!run.prompt.includes('{{'));
  assert.deepEqual(fake.issueReads, [4]);
  assert.deepEqual(fake.fileReads, ['/home/pilot/PLAN.md']);
  assert.equal((await reload(task.id)).plan, PLAN_TEXT);
  assert.equal(fake.comments.length, 1);
  assert.equal(fake.comments[0].issueNumber, 4);
  assert.ok(fake.comments[0].body.startsWith('<!-- genie-plan -->\n'));
  assert.ok(fake.comments[0].body.includes(PLAN_TEXT));
  assert.ok((await messages(task.id, 'github')).includes('Plan posted on issue #4'));
});

test('planning without an issue uses the task text and posts no comment', async () => {
  const task = await insertTask({ status: 'planning', machineId: 'm1', description: 'Team list at /about.' });
  assert.equal(await runStage(task), 'in_progress');
  assert.equal(fake.issueReads.length, 0);
  assert.equal(fake.comments.length, 0);
  assert.ok(fake.claudeRuns[0].prompt.includes('Task: Add an about page'));
  assert.ok(fake.claudeRuns[0].prompt.includes('Team list at /about.'));
});

test('planning tells the prompt when the repository is empty, and only then', async () => {
  for (const [probe, expected] of [['0\n3\n', 'The Stack line is therefore `empty-repo-webjs`'], ['1\n3\n', 'already has code'], ['0\n40\n', 'already has code'], ['garbage\n', 'already has code']] as const) {
    fake = fakeDeps().onCommand('git ls-files | wc -l', { stdout: probe });
    restore();
    restore = setStageDeps(fake.deps);
    const task = await insertTask({ status: 'planning', machineId: 'm1' });
    await runStage(task);
    assert.ok(fake.claudeRuns[0].prompt.includes(expected), `probe ${JSON.stringify(probe)} yields ${expected}`);
  }
});

test('stackFromPlan parses the three branches and defaults to existing', () => {
  assert.deepEqual(stages.stackFromPlan('## Stack\nempty-repo-webjs\n\n## Files to touch'), { kind: 'empty-repo-webjs' });
  assert.deepEqual(stages.stackFromPlan('# Plan\n\n## Stack\n\nnew-app-webjs: ./apps/web/\n'), { kind: 'new-app-webjs', dir: 'apps/web' });
  assert.deepEqual(stages.stackFromPlan('## Stack\n`existing: Go, chi`'), { kind: 'existing', stack: 'Go, chi' });
  assert.deepEqual(stages.stackFromPlan('## Files to touch\n- x'), { kind: 'existing', stack: 'unknown' });
  assert.deepEqual(stages.stackFromPlan(null), { kind: 'existing', stack: 'unknown' });
  assert.equal(stages.appDirOf({ plan: '## Stack\nnew-app-webjs: apps/web' }), `${APP_DIR}/apps/web`);
  assert.equal(stages.appDirOf({ plan: '## Stack\nexisting: Rails' }), APP_DIR);
});

test('planning accepts a non-zero exit when PLAN.md exists', async () => {
  fake.onClaude(() => okRun({ exitCode: 1, subtype: 'error_max_turns', result: '' }));
  const task = await insertTask({ status: 'planning', machineId: 'm1' });
  assert.equal(await runStage(task), 'in_progress');
  assert.equal((await reload(task.id)).plan, PLAN_TEXT);
});

test('planning fails when no PLAN.md was written', async () => {
  fake.onReadFile(() => { throw new Error('readFile /home/pilot/PLAN.md failed (exit 1): no such file'); });
  const task = await insertTask({ status: 'planning', machineId: 'm1', githubIssueNumber: 5 });
  await assert.rejects(runStage(task), /Planning produced no PLAN.md/);
  assert.equal((await reload(task.id)).plan, null);
  assert.equal(fake.comments.length, 0);
});

test('a rate-limited run throws RateLimitedError before the plan is read', async () => {
  const resetsAt = new Date('2026-09-26T12:00:00Z');
  fake.onClaude(() => okRun({ exitCode: 1, result: '', isRateLimited: true, resetsAt }));
  const task = await insertTask({ status: 'planning', machineId: 'm1' });
  await assert.rejects(runStage(task), (err: unknown) => {
    assert.ok(err instanceof stages.RateLimitedError);
    assert.equal(err.resetsAt, resetsAt);
    assert.match(err.message, /rate limited until 2026-09-26T12:00:00/);
    return true;
  });
  assert.equal(fake.fileReads.length, 0);
});

test('a re-run of planning overwrites the plan and does not repost the comment', async () => {
  const task = await insertTask({ status: 'planning', machineId: 'm1', githubIssueNumber: 6, plan: '## Stack\nexisting: old' });
  assert.equal(await runStage(task), 'in_progress');
  assert.equal(fake.claudeRuns.length, 1);
  assert.equal((await reload(task.id)).plan, PLAN_TEXT);
  assert.equal(fake.comments.length, 0);
});

test('planning without a machine fails with a pointer to Retry from Todo', async () => {
  const task = await insertTask({ status: 'planning' });
  await assert.rejects(runStage(task), /Task has no machine/);
});

// Stage 3: in_progress to ready_for_review.

const inProgress = (patch: Partial<TaskInsert> = {}) =>
  insertTask({ status: 'in_progress', machineId: 'm1', machineName: 'genie-stages-m1', githubIssueNumber: 4, plan: PLAN_TEXT, ...patch });

test('in_progress builds on the task branch, stores the PR and the preview, and ends in ready_for_review', async () => {
  fake.onPreview((_pr, _sha, nth) => (nth === 0 ? null : PREVIEW_URL));
  const task = await inProgress();
  assert.equal(await runStage(task), 'ready_for_review');
  const row = await reload(task.id);
  assert.equal(row.branch, 'genie/4-add-an-about-page');
  assert.equal(row.prNumber, 7);
  assert.equal(row.prUrl, PR_URL);
  assert.equal(row.previewUrl, PREVIEW_URL);
  assert.equal(fake.claudeRuns.length, 2, 'the build run and the self-review');
  const run = fake.claudeRuns[0];
  assert.equal(run.timeoutMs, 2_700_000);
  assert.equal(run.maxTurns, 200);
  assert.equal(run.logPath, '/home/pilot/agent.log');
  assert.ok(run.prompt.includes('Issue #4: Issue 4 title'));
  assert.ok(run.prompt.includes(PLAN_TEXT));
  assert.ok(run.prompt.includes('Work on the branch `genie/4-add-an-about-page`'));
  assert.ok(run.prompt.includes('Its first line is `Closes #4`.'));
  assert.ok(run.prompt.includes('already has code'));
  assert.equal(fake.commands('gh pr list --head genie/4-add-an-about-page').length, 2, 'looked up before and after the run');
  assert.equal(fake.commands('gh pr create').length, 0, 'the agent opened the PR, not the backstop');
  assert.deepEqual(fake.previews, [{ prNumber: 7, sha: 'abc1234' }, { prNumber: 7, sha: 'abc1234' }]);
  assert.equal(fake.comments.length, 0, 'the mirror posts the review comment, not the stage');
  const github = await messages(task.id, 'github');
  assert.ok(github.includes(`Pull request #7 ${PR_URL}`));
  assert.ok((await messages(task.id, 'log')).includes('Waiting for the Pilots preview of abc1234 on the pull request'));
});

test('in_progress on an empty repository scaffolds a WebJs app before Claude runs', async () => {
  fake.onCommand('git ls-files | wc -l', { stdout: '0\n2\n' });
  const task = await inProgress({ plan: '## Stack\nempty-repo-webjs' });
  assert.equal(await runStage(task), 'ready_for_review');
  const [scaffold] = fake.commands(SCAFFOLD_CMD);
  assert.ok(scaffold, 'the scaffold command ran');
  const at = (s: string) => scaffold.indexOf(s);
  assert.ok(at(SCAFFOLD_CMD) < at('npm run gallery:clear') && at('npm run gallery:clear') < at('git checkout -b genie/4-add-an-about-page') && at('git checkout -b') < at('git commit -m "Scaffold a webjs app"'));
  assert.ok(scaffold.includes(`cp -a scaffold/. ${APP_DIR}/`));
  assert.ok(fake.timeline.indexOf(`exec:${scaffold}`) < fake.timeline.indexOf('claude'), 'scaffold before the build run');
  assert.ok(fake.claudeRuns[0].prompt.includes('commits it as the first commit on `genie/4-add-an-about-page`'));
  assert.ok(fake.claudeRuns[0].prompt.includes('The Stack line is therefore `empty-repo-webjs`'));
  const logs = await messages(task.id, 'log');
  assert.ok(logs.includes('Empty repository: scaffolding a WebJs app (sqlite, node) at the root'));
  assert.ok(logs.includes('Scaffold committed on genie/4-add-an-about-page'));
});

test('a failed scaffold fails the stage before Claude runs', async () => {
  fake.onCommand('git ls-files | wc -l', { stdout: '0\n2\n' });
  fake.onCommand(SCAFFOLD_CMD, { exitCode: 1, stderr: 'npm ERR! create-webjs exploded' });
  const task = await inProgress();
  await assert.rejects(runStage(task), /Scaffolding failed: npm ERR! create-webjs exploded/);
  assert.equal(fake.claudeRuns.length, 0);
});

test('in_progress on a repository with code never scaffolds from the stage', async () => {
  const task = await inProgress({ plan: '## Stack\nexisting: Go, chi\n\n## Steps\n1. Add the handler.' });
  assert.equal(await runStage(task), 'ready_for_review');
  assert.equal(fake.commands('npm create').length, 0);
  assert.ok(fake.claudeRuns[0].prompt.includes('already has code'));
  assert.ok(fake.claudeRuns[0].prompt.includes('existing: Go, chi'));
});

test('in_progress for a new app in a monorepo leaves the scaffold to the prompt and serves the new app in the fallback', async () => {
  fake.onPreview(() => null);
  fake.onCommand('127.0.0.1:8080', { exitCode: 0 });
  setStageDeps({ timing: { ...fake.deps.timing, previewTimeoutMs: 0 } });
  const task = await inProgress({ plan: '## Stack\nnew-app-webjs: apps/web' });
  assert.equal(await runStage(task), 'ready_for_review');
  assert.equal(fake.commands('npm create').length, 0);
  assert.ok(fake.claudeRuns[0].prompt.includes('new-app-webjs: apps/web'));
  const [start] = fake.commands('setsid nohup');
  assert.ok(start.startsWith(`cd ${APP_DIR}/apps/web && `), start);
  assert.equal((await reload(task.id)).previewUrl, 'https://genie-stages-m1.pilotrun.app');
});

test('in_progress without an issue builds on genie/<id8>-<slug> with no Closes line', async () => {
  const task = await inProgress({ githubIssueNumber: null });
  assert.equal(await runStage(task), 'ready_for_review');
  assert.equal((await reload(task.id)).branch, `genie/${task.id.slice(0, 8)}-add-an-about-page`);
  const { prompt } = fake.claudeRuns[0];
  assert.ok(!prompt.includes('Closes #'));
  assert.ok(prompt.includes('Its first line is `Task: Add an about page`.'));
  assert.ok(prompt.includes('Task: Add an about page'));
  assert.equal(fake.issueReads.length, 0);
});

test('a re-claimed task with a PR never runs Claude and goes straight to the preview', async () => {
  const task = await inProgress({ branch: 'genie/4-add-an-about-page', prNumber: 7, prUrl: PR_URL });
  assert.equal(await runStage(task), 'ready_for_review');
  assert.equal(fake.claudeRuns.length, 0);
  assert.equal(fake.commands('gh pr list').length, 0);
  assert.deepEqual(fake.previews, [{ prNumber: 7, sha: 'abc1234' }]);
  assert.equal((await reload(task.id)).previewUrl, PREVIEW_URL);
});

test('a re-claimed task whose PR exists on GitHub is found by gh before Claude runs', async () => {
  fake.onCommand('gh pr list', { stdout: `${PR_LIST}\n` });
  const task = await inProgress({ branch: 'genie/4-add-an-about-page' });
  assert.equal(await runStage(task), 'ready_for_review');
  assert.equal(fake.claudeRuns.length, 1, 'no build run; the self-review still runs once for this PR');
  assert.ok(fake.claudeRuns[0].prompt.startsWith('/code-review'));
  assert.equal((await reload(task.id)).prNumber, 7);
});

test('the backstop pushes the branch and opens the PR when the run ended before its PR step', async () => {
  fake.onCommand('gh pr list', (_cmd, nth) => ({ stdout: nth < 2 ? '[]\n' : `${PR_LIST}\n` }));
  const task = await inProgress();
  assert.equal(await runStage(task), 'ready_for_review');
  const [create] = fake.commands('gh pr create');
  assert.deepEqual(fake.pushes[0], { machineId: 'm1', dir: APP_DIR, branch: 'genie/4-add-an-about-page' });
  assert.ok(fake.timeline.indexOf('push') < fake.timeline.indexOf(`exec:${create}`), 'pushed before the PR was opened');
  assert.ok(create.includes('--base main --head genie/4-add-an-about-page'));
  assert.ok(create.includes('Closes #4'));
  assert.ok(create.includes('--body-file /home/pilot/pr-body.md'));
  assert.equal(fake.commands('gh pr list').length, 3);
  assert.ok(fake.timeline.indexOf('claude') < fake.timeline.indexOf(`exec:${create}`));
  assert.equal((await reload(task.id)).prNumber, 7);
  assert.ok((await messages(task.id, 'log')).includes("Opened the pull request on the agent's behalf"));
});

test('the backstop fails when the run left no branch, and when gh pr create fails', async () => {
  fake.onCommand('gh pr list', { stdout: '[]\n' });
  fake.onCommand('git rev-parse --verify', { exitCode: 128 });
  await assert.rejects(runStage(await inProgress()), /The build produced no branch genie\/4-add-an-about-page/);
  assert.equal(fake.pushes.length, 0);

  fake.onCommand('git rev-parse --verify', { exitCode: 0 });
  fake.onCommand('gh pr create', { exitCode: 1, stderr: 'GraphQL: A pull request already exists' });
  await assert.rejects(runStage(await inProgress({ githubIssueNumber: 5 })), /gh pr create failed: GraphQL: A pull request already exists/);
});

test('the fallback serves the branch from the task machine when no preview appears', async () => {
  fake.onPreview(() => null);
  fake.onCommand('127.0.0.1:8080', [{ exitCode: 1 }, { exitCode: 0 }]);
  setStageDeps({ timing: { ...fake.deps.timing, previewTimeoutMs: 0 } });
  const task = await inProgress();
  assert.equal(await runStage(task), 'ready_for_review');
  assert.equal((await reload(task.id)).previewUrl, 'https://genie-stages-m1.pilotrun.app');
  assert.equal(fake.previews.length, 1, 'one poll before the window closed');
  const [start] = fake.commands('setsid nohup');
  assert.ok(start.startsWith(`cd ${APP_DIR} && `));
  assert.ok(start.includes('PORT=8080 npm run start'));
  assert.equal(fake.commands('127.0.0.1:8080').length, 2);
  assert.ok((await messages(task.id, 'log')).some((m) => m.includes('No Pilots preview after')));
});

test('a repo nobody connected to Pilots gets its preview from the task machine without waiting', async () => {
  fake.onRepoConnected(false);
  fake.onCommand('127.0.0.1:8080', { exitCode: 0 });
  const task = await inProgress();
  assert.equal(await runStage(task), 'ready_for_review');
  assert.equal((await reload(task.id)).previewUrl, 'https://genie-stages-m1.pilotrun.app');
  assert.equal(fake.previews.length, 0, 'the pull request is never polled for a preview');
  assert.equal(fake.commands('setsid nohup').length, 1);
  const [stop] = fake.commands('fuser -k');
  assert.ok(stop.includes('8080/tcp'), 'whatever already serves the port is stopped before the restart');
  const order = fake.timeline.length;
  assert.ok(order > 0);
  const logs = await messages(task.id, 'log');
  assert.ok(logs.some((m) => m.includes('Starting a live preview')));
  assert.ok(!logs.some((m) => m.includes('Pilots')), 'the user is never told about Pilots');
});

test('the fallback fails when the app never answers on port 8080', async () => {
  fake.onPreview(() => null);
  fake.onCommand('127.0.0.1:8080', { exitCode: 1 });
  setStageDeps({ timing: { ...fake.deps.timing, previewTimeoutMs: 0, appStartTimeoutMs: 0 } });
  const task = await inProgress();
  await assert.rejects(runStage(task), /did not start on port 8080/);
  assert.equal((await reload(task.id)).prNumber, 7, 'the PR is stored before the preview wait');
});

test('a build whose branch never reached the remote fails after the PR is stored', async () => {
  fake.onCommand('git rev-parse origin/', { exitCode: 128, stdout: '' });
  const task = await inProgress();
  await assert.rejects(runStage(task), /Branch genie\/4-add-an-about-page is not on the remote/);
});

// The self-review between the PR and the preview.

test('the self-review runs on the PR after it is resolved and before the preview poll', async () => {
  fake.onClaude((opts) => (opts.prompt.startsWith('/code-review') ? okRun({ result: 'Reviewed PR #7: fixed 2 findings and left 3 comments.' }) : okRun()));
  fake.onCommand('git diff --quiet HEAD', { stdout: 'committed\n' });
  const task = await inProgress();
  assert.equal(await runStage(task), 'ready_for_review');
  const review = fake.claudeRuns[1];
  assert.equal(review.prompt, '/code-review --fix --comment 7');
  assert.equal(review.timeoutMs, 600_000);
  assert.equal(review.maxTurns, 60);
  assert.equal(review.cwd, APP_DIR);
  assert.equal(review.logPath, '/home/pilot/agent.log');
  const t = fake.timeline;
  const prList = t.findIndex((e, i) => e.startsWith('exec:gh pr list') && i > t.indexOf('claude'));
  assert.ok(t.indexOf('claude') < prList && prList < t.lastIndexOf('claude') && t.lastIndexOf('claude') < t.indexOf('push') && t.indexOf('push') < t.indexOf('preview'), t.join(' | '));
  assert.deepEqual(fake.pushes, [{ machineId: 'm1', dir: APP_DIR, branch: 'genie/4-add-an-about-page' }]);
  const logs = await messages(task.id, 'log');
  assert.ok(logs.includes('Self-review: 2 findings fixed, 3 comments left'));
  assert.ok(logs.includes('Committed the self-review fixes the run left in the working tree'));
  assert.ok(fake.commands('git diff --quiet HEAD')[0].includes('git commit -q -m "Apply the self-review findings"'));
});

test('GENIE_SELF_REVIEW=0 skips the self-review', async () => {
  process.env.GENIE_SELF_REVIEW = '0';
  const task = await inProgress();
  assert.equal(await runStage(task), 'ready_for_review');
  assert.equal(fake.claudeRuns.length, 1);
  assert.equal(fake.pushes.length, 0);
  assert.ok(!(await messages(task.id, 'log')).some((m) => m.startsWith('Self-review')));
});

test('a failing, rate-limited or throwing self-review does not fail the stage', async () => {
  fake.onClaude((opts) => (opts.prompt.startsWith('/code-review') ? okRun({ exitCode: 1, result: 'Error: gh: HTTP 403' }) : okRun()));
  const a = await inProgress();
  assert.equal(await runStage(a), 'ready_for_review');
  assert.ok((await messages(a.id, 'log')).includes('Self-review: 0 findings fixed, 0 comments left (the run ended with exit 1)'));

  fake.onClaude((opts) => (opts.prompt.startsWith('/code-review') ? okRun({ exitCode: 1, result: '', isRateLimited: true }) : okRun()));
  const b = await inProgress({ githubIssueNumber: 5 });
  assert.equal(await runStage(b), 'ready_for_review');
  assert.ok((await messages(b.id, 'log')).includes('Self-review skipped: Claude is rate limited'));
  assert.equal((await reload(b.id)).previewUrl, PREVIEW_URL);

  fake.onClaude((opts) => { if (opts.prompt.startsWith('/code-review')) throw new Error('exec timed out'); return okRun(); });
  const c = await inProgress({ githubIssueNumber: 6 });
  assert.equal(await runStage(c), 'ready_for_review');
  assert.ok((await messages(c.id, 'log')).includes('Self-review skipped: exec timed out'));
});

test('parseSelfReview reads the counts out of a free-form summary', () => {
  assert.deepEqual(stages.parseSelfReview('Fixed 2 findings and left 3 comments on PR #7.'), { fixed: 2, comments: 3 });
  assert.deepEqual(stages.parseSelfReview('4 findings were fixed in the working tree. Posted 1 inline comment.'), { fixed: 4, comments: 1 });
  assert.deepEqual(stages.parseSelfReview('No findings. Nothing to fix.'), { fixed: 0, comments: 0 });
  assert.deepEqual(stages.parseSelfReview(''), { fixed: 0, comments: 0 });
});

// The revise round after Request changes.

const withFeedback = (patch: Partial<TaskInsert> = {}) =>
  inProgress({ branch: 'genie/4-add-an-about-page', prNumber: 7, prUrl: PR_URL, previewUrl: PREVIEW_URL, feedback: 'make it dark mode', ...patch });

test('in_progress with feedback revises on the same branch, waits for the new sha, clears the feedback and returns to review', async () => {
  fake.onCommand('git rev-parse origin/', { stdout: 'def5678\n' });
  fake.onPreview((_pr, sha, nth) => (nth === 0 || sha !== 'def5678' ? null : 'https://pr-7-demo.pilotrun.app'));
  fake.onReviewComments(() => [
    { id: 501, reviewId: 9, path: 'app/page.ts', line: 12, body: 'rename this\nand that', author: 'vivek7405', createdAt: 't', htmlUrl: 'u' },
    { id: 502, reviewId: 9, path: 'README.md', line: null, body: 'typo', author: '', createdAt: 't', htmlUrl: 'u' },
  ]);
  fake.onCommand('git diff --quiet HEAD', { stdout: 'committed\n' });
  const task = await withFeedback();
  assert.equal(await runStage(task), 'ready_for_review');
  assert.equal(fake.claudeRuns.length, 1, 'one revise run, no build, no self-review');
  const run = fake.claudeRuns[0];
  assert.equal(run.timeoutMs, 1_800_000);
  assert.equal(run.maxTurns, 120);
  assert.equal(run.cwd, APP_DIR);
  assert.equal(run.logPath, '/home/pilot/agent.log');
  assert.ok(run.prompt.includes('make it dark mode'));
  assert.ok(run.prompt.includes('Pull request\n#7'));
  assert.ok(run.prompt.includes('Branch `genie/4-add-an-about-page` (base `main`)'));
  assert.ok(run.prompt.includes('- thread 501 by vivek7405 on app/page.ts:12: rename this'));
  assert.ok(run.prompt.includes('- thread 502 by unknown on README.md: typo'));
  assert.ok(run.prompt.includes(PLAN_TEXT));
  assert.ok(run.prompt.includes('Issue #4'));
  assert.ok(!run.prompt.includes('{{'));
  assert.deepEqual(fake.threadReads, [7]);
  assert.equal(fake.commands('gh pr list').length, 0, 'the PR is known');
  assert.equal(fake.commands('gh pr create').length, 0);
  assert.deepEqual(fake.pushes, [{ machineId: 'm1', dir: APP_DIR, branch: 'genie/4-add-an-about-page' }]);
  assert.deepEqual(fake.previews, [{ prNumber: 7, sha: 'def5678' }, { prNumber: 7, sha: 'def5678' }]);
  const t = fake.timeline;
  assert.ok(t.indexOf('claude') < t.indexOf('push') && t.indexOf('push') < t.indexOf('preview'), t.join(' | '));
  const row = await reload(task.id);
  assert.equal(row.feedback, null, 'the feedback was applied');
  assert.equal(row.previewUrl, 'https://pr-7-demo.pilotrun.app');
  assert.equal(row.prNumber, 7);
  assert.equal(row.branch, 'genie/4-add-an-about-page');
  assert.equal(fake.comments.length, 1);
  assert.equal(fake.comments[0].issueNumber, 4);
  assert.ok(fake.comments[0].body.startsWith('<!-- genie-revised -->\n'));
  assert.ok(fake.comments[0].body.includes('Revised in def5678. Preview: https://pr-7-demo.pilotrun.app'));
  const status = await messages(task.id, 'status');
  assert.ok(status.includes('Revising on genie/4-add-an-about-page: make it dark mode'));
  assert.ok(status.includes('Feedback applied in def5678: make it dark mode'), 'the feedback moved into the feed');
  const logs = await messages(task.id, 'log');
  assert.ok(logs.includes('Committed the changes the run left in the working tree'));
  assert.ok(logs.includes('Pushed def5678 to genie/4-add-an-about-page; Pilots is rebuilding the preview'));
  assert.ok(logs.includes('Waiting for the Pilots preview of def5678 on the pull request'));
});

test('a revise whose preview never appears keeps the feedback so Retry reruns it', async () => {
  fake.onPreview(() => null);
  fake.onCommand('127.0.0.1:8080', { exitCode: 1 });
  setStageDeps({ timing: { ...fake.deps.timing, previewTimeoutMs: 0, appStartTimeoutMs: 0 } });
  const task = await withFeedback();
  await assert.rejects(runStage(task), /did not start on port 8080/);
  assert.equal(fake.claudeRuns.length, 1);
  const row = await reload(task.id);
  assert.equal(row.feedback, 'make it dark mode');
  assert.equal(row.previewUrl, PREVIEW_URL, 'the old preview is untouched');
  assert.equal(fake.comments.length, 0);
});

test('a revise with no PR, branch or machine throws before Claude runs', async () => {
  await assert.rejects(runStage(await withFeedback({ prNumber: null, prUrl: null })), /Cannot revise/);
  await assert.rejects(runStage(await withFeedback({ branch: null, githubIssueNumber: 5 })), /Cannot revise/);
  await assert.rejects(runStage(await withFeedback({ machineId: null, githubIssueNumber: 6 })), /Cannot revise/);
  assert.equal(fake.claudeRuns.length, 0);
  assert.equal(fake.pushes.length, 0);
});

test('a revise that cannot read the review threads still runs, with none listed', async () => {
  fake.onReviewComments(() => { throw new Error('offline in tests'); });
  const task = await withFeedback({ githubIssueNumber: null });
  assert.equal(await runStage(task), 'ready_for_review');
  assert.ok(fake.claudeRuns[0].prompt.includes('## Review threads on the pull request\n\n(none)'));
  assert.equal(fake.comments.length, 0, 'no issue, no comment');
  assert.equal((await reload(task.id)).feedback, null);
});

test('buildOrRevise picks the prompt from the feedback column', () => {
  assert.equal(stages.buildOrRevise({ feedback: null }, fake.deps), 'build');
  assert.equal(stages.buildOrRevise({ feedback: 'x' }, fake.deps), 'revise');
});

// The log feed.

const assistant = (blocks: unknown[]) => JSON.stringify({ type: 'assistant', message: { content: blocks } });

test('feedLines keeps the agent prose and the tool it reached for, capped, and drops everything else', () => {
  const line = assistant([
    { type: 'text', text: 'Reading the repo layout.\nThen the manifest.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'ls -la\ncat package.json', description: 'List the repo root' } },
    { type: 'tool_use', name: 'Read', input: { file_path: '/home/pilot/app/AGENTS.md' } },
    { type: 'tool_use', name: 'Grep', input: { pattern: 'routes' } },
    { type: 'text', text: '   ' },
  ]);
  assert.deepEqual(stages.feedLines(line), ['Reading the repo layout.', 'Bash: List the repo root', 'Read: /home/pilot/app/AGENTS.md', 'Grep: routes']);
  assert.deepEqual(stages.feedLines(JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'x' }] } })), []);
  assert.deepEqual(stages.feedLines(JSON.stringify({ type: 'system', subtype: 'init' })), []);
  assert.deepEqual(stages.feedLines(JSON.stringify({ type: 'result', result: 'DONE' })), []);
  assert.deepEqual(stages.feedLines('{"type":"assist'), []);
  assert.deepEqual(stages.feedLines('null'), []);
  const [long] = stages.feedLines(assistant([{ type: 'text', text: 'x'.repeat(500) }]));
  assert.equal(long.length, 240);
  assert.ok(long.endsWith('\u2026'));
});

test('the feed tails only the new bytes, completes a partial line on the next poll, and flushes at the end', async () => {
  const l1 = assistant([{ type: 'text', text: 'First' }]);
  const l2 = assistant([{ type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }]);
  const l3 = assistant([{ type: 'text', text: 'Third' }]);
  const chunk1 = `${l1}\n${l2}\n${l3.slice(0, 20)}`;
  const chunk2 = `${l3.slice(20)}\n`;
  fake.onCommand('tail -c +', (_cmd, nth) => ({ stdout: nth === 0 ? chunk1 : nth === 1 ? chunk2 : '' }));
  let seenDuringRun = 0;
  fake.onClaude(async () => {
    await new Promise((r) => setTimeout(r, 60));
    seenDuringRun = (await messages(task.id, 'log')).filter((m) => ['First', 'Read: README.md', 'Third'].includes(m)).length;
    return okRun();
  });
  const task = await insertTask({ status: 'planning', machineId: 'm1' });
  assert.equal(await runStage(task), 'in_progress');
  const feed = (await messages(task.id, 'log')).filter((m) => ['First', 'Read: README.md', 'Third'].includes(m));
  assert.deepEqual(feed, ['First', 'Read: README.md', 'Third']);
  assert.equal(seenDuringRun, 3, 'the lines reached the feed while the run was in flight');
  const offsets = fake.commands('tail -c +').map((c) => Number(/tail -c \+(\d+)/.exec(c)![1]));
  assert.equal(offsets[0], 1);
  assert.equal(offsets[1], Buffer.byteLength(chunk1) + 1);
  assert.equal(offsets[2], Buffer.byteLength(chunk1) + Buffer.byteLength(chunk2) + 1);
  assert.ok(offsets.every((o, i) => i === 0 || o >= offsets[i - 1]), 'offsets never go back');
  assert.equal(fake.commands(': > /home/pilot/agent.log').length, 1, 'the log is emptied before the run');
  assert.ok(fake.timeline.indexOf('exec:: > /home/pilot/agent.log') < fake.timeline.indexOf('claude'));
});

test('a poll that throws is a missed poll, not a failed stage', async () => {
  fake.onCommand('tail -c +', new Error('exec failed'));
  const task = await insertTask({ status: 'planning', machineId: 'm1' });
  assert.equal(await runStage(task), 'in_progress');
});

test('runStage returns null for a status the system does not own', async () => {
  const task = await insertTask({ status: 'ready_for_review' });
  assert.equal(await runStage(task), null);
  assert.equal(fake.execs.length, 0);
});

// The token a machine acts with: the project's, resolved through deps per
// exec, riding only as env.

test('every clone, push, gh exec and Claude run acts with the project token, and no command text carries it', async () => {
  const TOKEN = 'ghs_fake_stage_token';
  fake.onRepoToken(() => TOKEN);
  fake.onCommand('git diff --quiet HEAD', { stdout: 'committed\n' });

  const todo = await insertTask();
  assert.equal(await runStage(todo), 'planning');
  assert.deepEqual(fake.cloneTokens, [TOKEN]);

  const planning = await insertTask({ status: 'planning', machineId: 'm1', githubIssueNumber: 5 });
  assert.equal(await runStage(planning), 'in_progress');
  assert.equal(fake.claudeRuns.at(-1)!.githubToken, TOKEN);

  const building = await inProgress();
  assert.equal(await runStage(building), 'ready_for_review');
  const ghExecs = fake.execs.filter((e) => e.cmd.startsWith('gh pr list'));
  assert.equal(ghExecs.length, 2);
  for (const e of ghExecs) {
    assert.equal(e.opts.env?.GH_TOKEN, TOKEN);
    assert.ok(e.opts.env?.GIT_CONFIG_KEY_0?.includes(`x-access-token:${TOKEN}@github.com`));
  }
  assert.deepEqual(fake.claudeRuns.slice(1).map((r) => r.githubToken), [TOKEN, TOKEN], 'the build run and the self-review');
  assert.deepEqual(fake.pushTokens, [TOKEN], 'the self-review push');
  assert.ok(fake.execs.every((e) => !e.cmd.includes(TOKEN)), 'no command text carries the token');
});

test('a revise and the PR backstop act with the project token too', async () => {
  const TOKEN = 'ghs_fake_revise_token';
  fake.onRepoToken(() => TOKEN);
  fake.onCommand('git rev-parse origin/', { stdout: 'def5678\n' });
  const revising = await withFeedback();
  assert.equal(await runStage(revising), 'ready_for_review');
  assert.equal(fake.claudeRuns[0].githubToken, TOKEN);
  assert.deepEqual(fake.pushTokens, [TOKEN]);

  fake.onCommand('gh pr list', (_cmd, nth) => ({ stdout: nth < 2 ? '[]\n' : `${PR_LIST}\n` }));
  process.env.GENIE_SELF_REVIEW = '0';
  const building = await inProgress({ githubIssueNumber: 6 });
  assert.equal(await runStage(building), 'ready_for_review');
  const [create] = fake.execs.filter((e) => e.cmd.includes('gh pr create'));
  assert.equal(create.opts.env?.GH_TOKEN, TOKEN);
  assert.deepEqual(fake.pushTokens, [TOKEN, TOKEN], 'the backstop push');
});

test('with no token at all the gh execs carry no env and the Claude runs are told so', async () => {
  const task = await inProgress();
  assert.equal(await runStage(task), 'ready_for_review');
  for (const e of fake.execs.filter((x) => x.cmd.startsWith('gh pr list'))) assert.deepEqual(e.opts.env, {});
  assert.deepEqual(fake.claudeRuns.map((r) => r.githubToken), [null, null]);
  assert.deepEqual(fake.pushTokens, [null]);
});
