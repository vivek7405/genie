// The three real stages against the dependency fake: no machine, no Claude,
// no GitHub. Each test inserts its own task row and calls runStage directly.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../helpers/db.ts');
const { fakeDeps, okRun, PLAN_TEXT, PR_LIST, PR_URL, PREVIEW_URL } = await import('../helpers/stage-deps.ts');
const { projects, tasks, taskEvents } = await import('#db/schema.server.ts');
const stages = await import('#modules/pipeline/stages.server.ts');
const { runStage, setStageDeps, APP_DIR, SCAFFOLD_CMD } = stages;
const { listEvents } = await import('#modules/tasks/queries/list-events.server.ts');

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
  return (await listEvents(id)).filter((e) => !kind || e.kind === kind).map((e) => e.message);
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
  assert.equal(fake.claudeRuns.length, 1);
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
  assert.equal(fake.pushes.length, 0, 'the agent pushed, not the backstop');
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
  assert.equal(fake.claudeRuns.length, 0);
  assert.equal((await reload(task.id)).prNumber, 7);
});

test('the backstop pushes the branch and opens the PR when the run ended before its PR step', async () => {
  fake.onCommand('gh pr list', (_cmd, nth) => ({ stdout: nth < 2 ? '[]\n' : `${PR_LIST}\n` }));
  const task = await inProgress();
  assert.equal(await runStage(task), 'ready_for_review');
  assert.deepEqual(fake.pushes, [{ machineId: 'm1', dir: APP_DIR, branch: 'genie/4-add-an-about-page' }]);
  const [create] = fake.commands('gh pr create');
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
  assert.ok((await messages(task.id, 'log')).some((m) => m.includes('pilot repo connect')));
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

test('runStage returns null for a status the system does not own', async () => {
  const task = await insertTask({ status: 'ready_for_review' });
  assert.equal(await runStage(task), null);
  assert.equal(fake.execs.length, 0);
});
