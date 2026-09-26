// The two verdicts over fake GitHub and Pilots deps: approve merges once and
// then moves the card, and every way that must not happen. Runs against its
// own migrated temp database (test/helpers/db.ts); the offline transport it
// installs means the mirror's own comment fails and is reported, never fatal.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../helpers/db.ts');
const { projects, tasks, taskEvents } = await import('#db/schema.server.ts');
const { approve, requestChanges, setVerdictDeps } = await import('#modules/pipeline/verdicts.server.ts');
const { listEvents } = await import('#modules/tasks/queries/list-events.server.ts');

type TaskInsert = typeof tasks.$inferInsert;

const PRODUCTION = 'https://demo.pilotrun.app';
const PREVIEW = 'https://pr-7-demo.pilotrun.app';
const [project] = await db.insert(projects).values({ name: 'verdicts', githubRepo: 'harness/verdicts', defaultBranch: 'main' }).returning();

interface Calls { merges: number[]; comments: { issueNumber: number; body: string }[]; lookups: number }
let calls: Calls;
let restore: () => void;
let mergeAnswer: () => Promise<{ sha: string | null; merged: boolean }>;
beforeEach(async () => {
  await db.delete(taskEvents);
  await db.delete(tasks);
  await db.update(projects).set({ productionUrl: null });
  calls = { merges: [], comments: [], lookups: 0 };
  mergeAnswer = async () => ({ sha: 'merged-sha', merged: true });
  restore = setVerdictDeps({
    async mergePr(p, prNumber) {
      assert.equal(p.id, project.id);
      calls.merges.push(prNumber);
      return mergeAnswer();
    },
    async commentOnIssue(_p, issueNumber, body) {
      calls.comments.push({ issueNumber, body });
    },
    async findProductionUrl() {
      calls.lookups++;
      return PRODUCTION;
    },
  });
});
afterEach(() => restore());

const inReview = (patch: Partial<TaskInsert> = {}) =>
  db.insert(tasks).values({ projectId: project.id, title: 'Add an about page', status: 'ready_for_review', prNumber: 7, prUrl: 'https://github.com/harness/verdicts/pull/7', githubIssueNumber: 3, machineId: 'm1', machineName: 'genie-verdicts-m1', previewUrl: PREVIEW, ...patch }).returning().then((r) => r[0]);
const reload = (id: string) => db.query.tasks.findFirst({ where: { id } }).then((t) => t!);
const messages = async (id: string, kind?: string) => (await listEvents(id)).filter((e) => !kind || e.kind === kind).map((e) => e.message);

test('approve merges the PR once, moves the card to done, comments, and fills the production URL', async () => {
  const task = await inReview();
  const result = await approve(task.id);
  assert.ok(result.success, JSON.stringify(result));
  assert.deepEqual(calls.merges, [7]);
  const row = await reload(task.id);
  assert.equal(row.status, 'done');
  assert.equal(row.previewUrl, null, 'the preview dies with the PR');
  assert.equal(row.claimedAt, null, 'the lock is released');
  assert.equal(row.machineId, 'm1', 'the machine is left for the cleanup sweep');
  assert.equal(row.machineName, 'genie-verdicts-m1');
  assert.equal(calls.lookups, 1);
  assert.equal((await db.query.projects.findFirst({ where: { id: project.id } }))?.productionUrl, PRODUCTION);
  assert.equal(calls.comments.length, 1);
  assert.equal(calls.comments[0].issueNumber, 3);
  assert.ok(calls.comments[0].body.startsWith('<!-- genie-merged -->\n'), 'the sync must never read it back as feedback');
  assert.ok(calls.comments[0].body.includes('#7') && calls.comments[0].body.includes(PRODUCTION), calls.comments[0].body);
  const github = await messages(task.id, 'github');
  assert.ok(github.includes('Merged PR #7 into main (squash, branch deleted)'), github.join('|'));
  const status = await messages(task.id, 'status');
  assert.ok(status.includes('Approved in genie, PR #7 merged'), status.join('|'));
  assert.ok(status.includes(`Pilots is deploying main to ${PRODUCTION}`));
});

test('approve keeps a note from the sync and reports an already merged PR without a second merge', async () => {
  mergeAnswer = async () => ({ sha: null, merged: true });
  const task = await inReview();
  const result = await approve(task.id, 'Merged on GitHub: https://github.com/harness/verdicts/pull/7');
  assert.ok(result.success);
  assert.deepEqual(calls.merges, [7], 'mergePr decides itself that nothing is left to merge');
  const status = await messages(task.id, 'status');
  assert.ok(status.includes('Merged on GitHub: https://github.com/harness/verdicts/pull/7'));
  assert.ok((await messages(task.id, 'github')).includes('PR #7 was already merged'));
});

test('a merge that rejects leaves the task in review with the error in the feed and nothing else touched', async () => {
  mergeAnswer = async () => { throw new Error('405 Pull Request is not mergeable'); };
  const task = await inReview();
  const result = await approve(task.id);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.status, 502);
  assert.match(result.error ?? '', /Could not merge PR #7: 405 Pull Request is not mergeable/);
  const row = await reload(task.id);
  assert.equal(row.status, 'ready_for_review');
  assert.equal(row.error, null, 'no Failed badge on a human-owned column');
  assert.equal(row.claimedAt, null, 'the lock is released so the human can try again');
  assert.equal(row.previewUrl, PREVIEW);
  assert.ok((await messages(task.id, 'error')).some((m) => m.includes('PR #7')));
  assert.equal(calls.comments.length, 0);
  assert.equal(calls.lookups, 0);
  assert.equal((await db.query.projects.findFirst({ where: { id: project.id } }))?.productionUrl, null);
  // The second try works.
  mergeAnswer = async () => ({ sha: 'merged-sha', merged: true });
  assert.ok((await approve(task.id)).success);
  assert.equal((await reload(task.id)).status, 'done');
});

test('two concurrent approves merge once; the loser sees 409', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  mergeAnswer = async () => { await gate; return { sha: 'merged-sha', merged: true }; };
  const task = await inReview();
  const first = approve(task.id);
  await new Promise((r) => setTimeout(r, 20));
  const second = await approve(task.id);
  assert.equal(second.success, false);
  if (!second.success) {
    assert.equal(second.status, 409);
    assert.match(second.error ?? '', /already being merged/);
  }
  release();
  assert.ok((await first).success);
  assert.deepEqual(calls.merges, [7]);
  assert.equal((await reload(task.id)).status, 'done');
});

test('a task without a PR approves with no merge call and says so', async () => {
  const task = await inReview({ prNumber: null, prUrl: null, previewUrl: null });
  const result = await approve(task.id);
  assert.ok(result.success);
  assert.deepEqual(calls.merges, []);
  assert.equal(calls.comments.length, 0, 'no merge comment without a PR');
  assert.equal((await reload(task.id)).status, 'done');
  assert.ok((await messages(task.id, 'status')).includes('Approved in genie (no PR to merge)'));
  assert.equal((await db.query.projects.findFirst({ where: { id: project.id } }))?.productionUrl, PRODUCTION, 'the production URL is still looked up');
});

test('approve on a task that is not in review, or unknown, calls nothing', async () => {
  const task = await inReview({ status: 'in_progress' });
  const result = await approve(task.id);
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.status, 409);
  assert.deepEqual(calls.merges, []);
  assert.equal((await reload(task.id)).status, 'in_progress');
  const missing = await approve('nope');
  assert.equal(missing.success, false);
  if (!missing.success) assert.equal(missing.status, 404);
});

test('a services list that cannot be read is a feed line, not a failed approve', async () => {
  restore();
  restore = setVerdictDeps({
    async mergePr() { return { sha: 'x', merged: true }; },
    async commentOnIssue() {},
    async findProductionUrl() { throw new Error('PILOT_API_KEY is not set'); },
  });
  const task = await inReview();
  assert.ok((await approve(task.id)).success);
  assert.equal((await reload(task.id)).status, 'done');
  assert.ok((await messages(task.id, 'log')).some((m) => m.startsWith('Could not read the Pilots services list')));
  assert.ok((await messages(task.id, 'status')).some((m) => m.startsWith('No Pilots service tracks harness/verdicts')));
});

test('requestChanges stores the trimmed feedback, moves the card back and names the source', async () => {
  const task = await inReview();
  const result = await requestChanges(task.id, '  make it dark mode \n', 'github');
  assert.ok(result.success);
  const row = await reload(task.id);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.feedback, 'make it dark mode');
  assert.ok((await messages(task.id, 'status')).includes('Changes requested on GitHub: make it dark mode'));
  assert.equal(calls.comments.length, 0, 'feedback from GitHub is already on GitHub');

  const other = await inReview({ githubIssueNumber: 4 });
  assert.ok((await requestChanges(other.id, 'shorter copy', 'genie')).success);
  assert.ok((await messages(other.id, 'status')).includes('Changes requested in genie: shorter copy'));
  assert.deepEqual(calls.comments.map((c) => c.issueNumber), [4]);
  assert.ok(calls.comments[0].body.startsWith('<!-- genie-feedback -->\n'));
});

test('requestChanges refuses empty feedback and a task outside review, leaving feedback untouched', async () => {
  const task = await inReview();
  const empty = await requestChanges(task.id, '   ', 'genie');
  assert.equal(empty.success, false);
  if (!empty.success) assert.equal(empty.fieldErrors?.feedback, 'Say what should change.');
  assert.equal((await reload(task.id)).feedback, null);

  const building = await inReview({ status: 'in_progress', githubIssueNumber: 5, feedback: 'earlier note' });
  const wrong = await requestChanges(building.id, 'new note', 'genie');
  assert.equal(wrong.success, false);
  if (!wrong.success) assert.equal(wrong.status, 409);
  assert.equal((await reload(building.id)).feedback, 'earlier note');
});
