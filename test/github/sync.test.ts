// The GitHub-to-genie direction and the reconciliation pass, one fake board
// per scenario, syncProject() called directly. The loop itself (syncAll,
// startSync, stopSync, syncStatus) is exercised at the end of the file, since
// its state rides the module.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from '../helpers/db.ts';
import { fakeGithub, jsonResponse } from '../helpers/github.ts';
import { projects, tasks } from '#db/schema.server.ts';
import { setGithubTransport } from '#modules/github/client.server.ts';
import { NO_COMMENT_FEEDBACK, NO_REVIEW_FEEDBACK, startSync, stopSync, syncAll, syncProject, syncStatus } from '#modules/github/sync.server.ts';
import { STATUS_OPTION_NAMES } from '#modules/github/projects-v2.server.ts';
import { listEvents } from '#modules/tasks/queries/list-events.server.ts';
import type { TaskStatus } from '#modules/tasks/types.ts';

const fake = fakeGithub();
setGithubTransport(fake.transport);
after(() => {
  stopSync();
  setGithubTransport(null);
});

test('syncStatus is idle before any tick', () => {
  assert.deepEqual(syncStatus(), { running: false, lastRunAt: null, lastError: null });
});

const optionIds = { todo: 'todo-id', planning: 'plan-id', in_progress: 'ip-id', ready_for_review: 'review-id', done: 'done-id' };
type BoardColumn = TaskStatus | 'ready' | null;
const optionFor = (column: BoardColumn) => (column === null ? null : column === 'ready' ? 'ready-id' : optionIds[column]);

interface IssueSpec { number: number; title?: string; body?: string; pull_request?: boolean }
interface CommentSpec { body: string; login?: string; at?: string }
interface ReviewSpec { id: number; state: string; body?: string; at: string; inline?: { path: string; line: number | null; body: string }[] }
interface PrSpec { merged_at?: string | null; updated_at?: string; reviews?: ReviewSpec[]; comments?: CommentSpec[] }
interface Scenario {
  issues?: IssueSpec[];
  board?: { issue: number; column: BoardColumn; itemId?: string }[];
  comments?: Record<number, CommentSpec[]>;
  prs?: Record<number, PrSpec>;
  noBoard?: boolean;
}

const stamp = Date.now();
let n = 0;
const boards = new Map<string, NonNullable<Scenario['board']>>();
const PAST = '2026-09-26T00:00:00Z';
const before = new Date(Date.now() - 86_400_000).toISOString();
const later = (s: number) => new Date(Date.now() + s * 1000).toISOString();

fake.onGraphql('items(first: 100)', (v) => ({ node: { items: { pageInfo: { hasNextPage: false }, nodes: (boards.get(String(v.projectId)) ?? []).map((b) => ({
  id: b.itemId ?? `ITEM_${b.issue}`, fieldValueByName: optionFor(b.column) ? { optionId: optionFor(b.column) } : null, content: { number: b.issue, state: 'OPEN' },
})) } } }));
fake.onGraphql('updateProjectV2ItemFieldValue', () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: 'x' } } }));
fake.onGraphql('projectItems', (v) => {
  const board = [...boards.entries()].find(([, items]) => items.some((b) => b.issue === v.number));
  const item = board?.[1].find((b) => b.issue === v.number);
  return { repository: { issue: { id: `I_${v.number}`, projectItems: { nodes: item ? [{ id: item.itemId ?? `ITEM_${v.number}`, project: { id: board![0] } }] : [] } } } };
});
fake.onGraphql('addProjectV2ItemById', (v) => ({ addProjectV2ItemById: { item: { id: `ITEM_added_${String(v.contentId).replace('I_', '')}` } } }));

async function scenario(spec: Scenario) {
  n++;
  const repo = `harness/sync-${stamp}-${n}`;
  const projectId = `PVT_${n}`;
  const [project] = await db.insert(projects).values({
    name: `s${n}`, githubRepo: repo, githubProjectNumber: spec.noBoard ? null : 11,
    githubProjectId: spec.noBoard ? null : projectId, statusFieldId: spec.noBoard ? null : 'FIELD_1', statusOptionIds: spec.noBoard ? null : optionIds,
  }).returning();
  boards.set(projectId, spec.board ?? []);
  const restIssue = (i: IssueSpec) => ({ number: i.number, node_id: `I_${i.number}`, title: i.title ?? `Issue ${i.number}`, body: i.body ?? `Body ${i.number}`, state: 'open', labels: [{ name: 'genie' }], html_url: `https://github.com/${repo}/issues/${i.number}`, updated_at: PAST, ...(i.pull_request ? { pull_request: {} } : {}) });
  const restComment = (c: CommentSpec, id: number) => ({ id, body: c.body, user: { login: c.login ?? 'vivek7405' }, created_at: c.at ?? PAST, html_url: `https://github.com/${repo}/c/${id}` });
  fake.on('GET', `repos/${repo}/issues`, () => (spec.issues ?? []).map(restIssue));
  fake.on('GET', `repos/${repo}/labels/genie`, () => ({ name: 'genie' }));
  let nextIssue = 900 + n * 10;
  fake.on('POST', `repos/${repo}/issues`, (call) => restIssue({ number: nextIssue++, title: String(call.body?.title), body: String(call.body?.body) }));
  fake.onMatch('GET', new RegExp(`^repos/${repo}/issues/(\\d+)/comments$`), (_call, m) => {
    const number = Number(m[1]);
    const list = spec.comments?.[number] ?? spec.prs?.[number]?.comments ?? [];
    return list.map(restComment);
  });
  fake.onMatch('POST', new RegExp(`^repos/${repo}/issues/(\\d+)/comments$`), (call) => ({ id: 1, body: call.body?.body, user: null, created_at: 't', html_url: 'u' }));
  fake.onMatch('GET', new RegExp(`^repos/${repo}/issues/(\\d+)$`), (_call, m) => restIssue({ number: Number(m[1]) }));
  fake.onMatch('GET', new RegExp(`^repos/${repo}/pulls/(\\d+)$`), (_call, m) => {
    const pr = spec.prs?.[Number(m[1])] ?? {};
    return { number: Number(m[1]), state: pr.merged_at ? 'closed' : 'open', merged: !!pr.merged_at, merged_at: pr.merged_at ?? null, updated_at: pr.updated_at ?? PAST, html_url: `https://github.com/${repo}/pull/${m[1]}`, head: { sha: 'abc', ref: 'genie/x' } };
  });
  // Approve merges through the real mergePr: the squash call and the branch delete.
  fake.onMatch('PUT', new RegExp(`^repos/${repo}/pulls/(\\d+)/merge$`), () => ({ sha: 'merged-sha', merged: true }));
  fake.onMatch('DELETE', new RegExp(`^repos/${repo}/git/refs/heads/.+$`), () => undefined);
  fake.onMatch('GET', new RegExp(`^repos/${repo}/pulls/(\\d+)/reviews$`), (_call, m) => (spec.prs?.[Number(m[1])]?.reviews ?? []).map((r) => ({ id: r.id, state: r.state, body: r.body ?? null, user: { login: 'vivek7405' }, submitted_at: r.at, html_url: `https://github.com/${repo}/r/${r.id}` })));
  fake.onMatch('GET', new RegExp(`^repos/${repo}/pulls/(\\d+)/comments$`), (_call, m) => (spec.prs?.[Number(m[1])]?.reviews ?? []).flatMap((r) => (r.inline ?? []).map((c, i) => ({ id: r.id * 100 + i, pull_request_review_id: r.id, path: c.path, line: c.line, original_line: c.line, body: c.body, user: { login: 'vivek7405' }, created_at: r.at, html_url: 'u' }))));

  const calls = () => fake.calls.filter((c) => c.path.startsWith(`repos/${repo}/`) || (c.path === 'graphql' && JSON.stringify(c.body?.variables).includes(projectId)) || (c.path === 'graphql' && String(c.body?.query).includes('projectItems')));
  return {
    project,
    repo,
    calls,
    moves: () => fake.calls.filter((c) => String(c.body?.query).includes('updateProjectV2ItemFieldValue') && (c.body?.variables as { projectId: string }).projectId === projectId).map((c) => (c.body?.variables as { optionId: string }).optionId),
    posted: (issue: number) => fake.calls.filter((c) => c.method === 'POST' && c.path === `repos/${repo}/issues/${issue}/comments`).map((c) => String(c.body?.body)),
    created: () => fake.calls.filter((c) => c.method === 'POST' && c.path === `repos/${repo}/issues`),
    task: (patch: Partial<typeof tasks.$inferInsert>) => db.insert(tasks).values({ projectId: project.id, title: 't', ...patch }).returning().then((r) => r[0]),
    reload: (id: string) => db.query.tasks.findFirst({ where: { id } }).then((t) => t!),
    tasks: () => db.select().from(tasks).where(eq(tasks.projectId, project.id)),
  };
}

test('import: a genie issue in Todo becomes a task, an unlabeled or in-flight issue does not', async () => {
  const s = await scenario({
    issues: [{ number: 1, title: 'Add about', body: 'A page' }, { number: 3 }],
    board: [{ issue: 1, column: 'todo' }, { issue: 2, column: 'todo' }, { issue: 3, column: 'in_progress' }],
  });
  const summary = await syncProject(s.project);
  assert.equal(summary.imported, 1);
  const rows = await s.tasks();
  assert.equal(rows.length, 1);
  const [task] = rows;
  assert.equal(task.status, 'todo');
  assert.equal(task.githubIssueNumber, 1);
  assert.equal(task.githubItemId, 'ITEM_1');
  assert.equal(task.title, 'Add about');
  assert.equal(task.description, 'A page');
  assert.ok(task.syncedAt instanceof Date);
  assert.ok((await listEvents(task.id)).some((e) => e.kind === 'github' && e.message.startsWith('Imported from issue #1 ')));
  assert.equal((await syncProject(s.project)).imported, 0, 'a second tick imports nothing new');
  const after = await db.query.projects.findFirst({ where: { id: s.project.id } });
  assert.equal(after?.syncError, null);
  assert.ok(after?.syncedAt instanceof Date);
});

test('import: without a board every genie issue is imported', async () => {
  const s = await scenario({ noBoard: true, issues: [{ number: 1 }, { number: 2, pull_request: true }] });
  assert.equal((await syncProject(s.project)).imported, 1);
  assert.deepEqual((await s.tasks()).map((t) => [t.githubIssueNumber, t.githubItemId]), [[1, null]]);
});

test('approve on GitHub: a review task whose card is in Done ends done with the approved comment', async () => {
  const s = await scenario({ issues: [{ number: 5 }], board: [{ issue: 5, column: 'done' }] });
  const task = await s.task({ status: 'ready_for_review', githubIssueNumber: 5, githubItemId: 'ITEM_5' });
  assert.equal((await syncProject(s.project)).verdicts, 1);
  assert.equal((await s.reload(task.id)).status, 'done');
  assert.ok((await listEvents(task.id)).some((e) => e.message === 'Approved on GitHub'));
  assert.deepEqual(s.posted(5), ['<!-- genie-done -->\nApproved.']);
});

const ready = '<!-- genie-ready_for_review -->\nReady for review.';

for (const [name, comments, expected] of [
  ['the human comment after the ready comment', [{ body: ready }, { body: 'make it dark' }], 'make it dark'],
  ['the fixed text when there is no comment', [{ body: ready }], NO_COMMENT_FEEDBACK],
  ['the newest comment after the newest genie comment', [{ body: 'old' }, { body: ready }, { body: 'new' }], 'new'],
  ['a human comment under the same login as genie', [{ body: ready }, { body: '<!-- genie-plan -->\nPlan...' }, { body: 'tweak' }], 'tweak'],
] as const) {
  test(`request changes on GitHub: feedback is ${name}`, async () => {
    const s = await scenario({ issues: [{ number: 6 }], board: [{ issue: 6, column: 'in_progress' }], comments: { 6: [...comments] } });
    const task = await s.task({ status: 'ready_for_review', githubIssueNumber: 6, githubItemId: 'ITEM_6' });
    assert.equal((await syncProject(s.project)).verdicts, 1);
    const row = await s.reload(task.id);
    assert.equal(row.status, 'in_progress');
    assert.equal(row.feedback, expected);
    assert.equal(s.posted(6).length, 0, 'a verdict from GitHub posts no feedback comment');
  });
}

test('ownership: a planning card moved to Done is moved back, todo and unmapped columns are left alone', async () => {
  const s = await scenario({
    issues: [{ number: 7 }, { number: 8 }, { number: 9 }],
    board: [{ issue: 7, column: 'done' }, { issue: 8, column: 'in_progress' }, { issue: 9, column: 'ready' }],
  });
  const planning = await s.task({ status: 'planning', githubIssueNumber: 7, githubItemId: 'ITEM_7' });
  await s.task({ status: 'todo', githubIssueNumber: 8, githubItemId: 'ITEM_8' });
  await s.task({ status: 'in_progress', githubIssueNumber: 9, githubItemId: 'ITEM_9' });
  const summary = await syncProject(s.project);
  assert.equal(summary.reasserted, 1);
  assert.equal(summary.verdicts, 0);
  assert.equal((await s.reload(planning.id)).status, 'planning');
  assert.deepEqual(s.moves(), ['plan-id']);
  assert.ok((await listEvents(planning.id)).some((e) => /moved back: genie owns this stage/.test(e.message)));
  assert.equal(s.calls().filter((c) => c.method === 'POST' && c.path !== 'graphql').length, 0, 'no REST write');
});

test('retry publish: a task with a marker match is linked, one without is created and added', async () => {
  const s = await scenario({ issues: [] });
  const matched = await s.task({ title: 'Matched' });
  const fresh = await s.task({ title: 'Fresh', description: 'Body' });
  fake.rest.set(`GET repos/${s.repo}/issues`, () => [{ number: 50, node_id: 'I_50', title: 'Matched', body: `x\n\n<!-- genie-task ${matched.id} -->`, state: 'open', labels: [{ name: 'genie' }], html_url: 'u', updated_at: PAST }]);
  boards.set(s.project.githubProjectId!, [{ issue: 50, column: 'todo', itemId: 'ITEM_50' }]);
  const summary = await syncProject(s.project);
  assert.equal(summary.published, 2);
  assert.equal(summary.imported, 0, 'the matched issue is linked, not imported twice');
  const m = await s.reload(matched.id);
  assert.equal(m.githubIssueNumber, 50);
  assert.equal(m.githubItemId, 'ITEM_50');
  const f = await s.reload(fresh.id);
  assert.equal(s.created().length, 1);
  assert.equal(s.created()[0].body?.body, `Body\n\n<!-- genie-task ${fresh.id} -->`);
  assert.equal(f.githubIssueNumber, 900 + n * 10);
  assert.equal(f.githubItemId, `ITEM_added_${f.githubIssueNumber}`);
  assert.deepEqual(s.moves(), ['todo-id', 'todo-id']);
});

test('budget: an idle tick is one GraphQL request and one REST GET', async () => {
  const s = await scenario({ issues: [{ number: 10 }], board: [{ issue: 10, column: 'in_progress' }] });
  await s.task({ status: 'in_progress', githubIssueNumber: 10, githubItemId: 'ITEM_10' });
  fake.reset();
  await syncProject(s.project);
  assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), ['GET repos/' + s.repo + '/issues', 'POST graphql']);
});

test('an unresolved board is resolved on the tick', async () => {
  const s = await scenario({ issues: [] });
  const [unresolved] = await db.update(projects).set({ githubProjectId: null, statusFieldId: null, statusOptionIds: null, syncError: 'stale' }).where(eq(projects.id, s.project.id)).returning();
  fake.onGraphql('repositoryOwner', (v) => (v.owner === 'harness' && v.number === 11
    ? { repositoryOwner: { projectV2: { id: s.project.githubProjectId, field: { id: 'FIELD_1', options: Object.entries(optionIds).map(([k, id]) => ({ id, name: STATUS_OPTION_NAMES[k as TaskStatus], color: 'GRAY', description: '' })) } } } }
    : { repositoryOwner: null }));
  await syncProject(unresolved);
  const row = await db.query.projects.findFirst({ where: { id: s.project.id } });
  assert.equal(row?.githubProjectId, s.project.githubProjectId);
  assert.equal(row?.syncError, null);
});

test('pr: a merged pull request approves the task without a second merge', async () => {
  const s = await scenario({ issues: [{ number: 11 }], board: [{ issue: 11, column: 'ready_for_review' }], prs: { 4: { merged_at: PAST } } });
  const task = await s.task({ status: 'ready_for_review', githubIssueNumber: 11, githubItemId: 'ITEM_11', prNumber: 4 });
  assert.equal((await syncProject(s.project)).verdicts, 1);
  assert.equal((await s.reload(task.id)).status, 'done');
  assert.ok((await listEvents(task.id)).some((e) => e.message === `Merged on GitHub: https://github.com/${s.repo}/pull/4`));
  assert.ok(!fake.calls.some((c) => c.method === 'PUT'), 'no merge call');
});

test('pr: a review requesting changes sends the task back with its body and inline comments', async () => {
  const s = await scenario({ issues: [{ number: 12 }], board: [{ issue: 12, column: 'ready_for_review' }], prs: { 4: { reviews: [
    { id: 1, state: 'COMMENTED', body: 'looking', at: later(1), inline: [{ path: 'lib/x.ts', line: 3, body: 'hm' }] },
    { id: 2, state: 'CHANGES_REQUESTED', body: 'Tighten the copy', at: later(2), inline: [{ path: 'app/page.ts', line: 12, body: 'rename this' }, { path: 'README.md', line: null, body: 'typo' }] },
  ] } } });
  const task = await s.task({ status: 'ready_for_review', githubIssueNumber: 12, githubItemId: 'ITEM_12', prNumber: 4 });
  assert.equal((await syncProject(s.project)).verdicts, 1);
  const row = await s.reload(task.id);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.feedback, 'Tighten the copy\n\n- app/page.ts:12: rename this\n\n- README.md: typo');
  assert.deepEqual(s.moves(), ['ip-id']);
});

test('pr: an approving review approves, and the newest signal wins', async () => {
  const s = await scenario({ issues: [{ number: 13 }], board: [{ issue: 13, column: 'ready_for_review' }], prs: { 4: { reviews: [
    { id: 1, state: 'CHANGES_REQUESTED', body: 'no', at: later(1) },
    { id: 2, state: 'APPROVED', body: '', at: later(2) },
  ] } } });
  const task = await s.task({ status: 'ready_for_review', githubIssueNumber: 13, githubItemId: 'ITEM_13', prNumber: 4 });
  await syncProject(s.project);
  assert.equal((await s.reload(task.id)).status, 'done');
  assert.ok((await listEvents(task.id)).some((e) => e.message === `Approved on GitHub: https://github.com/${s.repo}/r/2`));
});

test('pr: a COMMENTED review, a lone inline thread, an old review and a plain comment are not verdicts, and a quiet PR costs one request', async () => {
  const s = await scenario({ issues: [{ number: 14 }], board: [{ issue: 14, column: 'ready_for_review' }], prs: { 4: {
    reviews: [{ id: 1, state: 'COMMENTED', body: 'reading', at: later(1), inline: [{ path: 'a.ts', line: 1, body: 'hm' }] }, { id: 2, state: 'CHANGES_REQUESTED', body: 'from last round', at: before }],
    comments: [{ body: 'nice work', at: later(1) }, { body: '<!-- genie-ready_for_review -->\nGENIE: not me', at: later(1) }],
  } } });
  const task = await s.task({ status: 'ready_for_review', githubIssueNumber: 14, githubItemId: 'ITEM_14', prNumber: 4 });
  assert.equal((await syncProject(s.project)).verdicts, 0);
  const row = await s.reload(task.id);
  assert.equal(row.status, 'ready_for_review');
  assert.ok(row.syncedAt instanceof Date, 'the look is remembered');
  fake.reset();
  await syncProject(s.project);
  const prCalls = fake.calls.filter((c) => c.path.includes('/pulls/'));
  assert.deepEqual(prCalls.map((c) => c.path), [`repos/${s.repo}/pulls/4`], 'one request for the quiet PR');
});

test('pr: a GENIE: comment is a request for changes with the rest as feedback', async () => {
  const s = await scenario({ issues: [{ number: 15 }], board: [{ issue: 15, column: 'ready_for_review' }], prs: { 4: {
    comments: [{ body: 'looks good' , at: later(1) }, { body: 'GENIE: make it blue', at: later(2) }],
  } } });
  const task = await s.task({ status: 'ready_for_review', githubIssueNumber: 15, githubItemId: 'ITEM_15', prNumber: 4 });
  assert.equal((await syncProject(s.project)).verdicts, 1);
  const row = await s.reload(task.id);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.feedback, 'make it blue');
  assert.equal(s.posted(15).length, 0);

  const empty = await scenario({ issues: [{ number: 16 }], board: [{ issue: 16, column: 'ready_for_review' }], prs: { 4: { reviews: [{ id: 1, state: 'CHANGES_REQUESTED', at: later(1) }] } } });
  const bare = await empty.task({ status: 'ready_for_review', githubIssueNumber: 16, githubItemId: 'ITEM_16', prNumber: 4 });
  await syncProject(empty.project);
  assert.equal((await empty.reload(bare.id)).feedback, NO_REVIEW_FEEDBACK);
});

test('pr: the card verdict wins over the pull request when both moved', async () => {
  const s = await scenario({ issues: [{ number: 17 }], board: [{ issue: 17, column: 'done' }], prs: { 4: { reviews: [{ id: 1, state: 'CHANGES_REQUESTED', body: 'no', at: later(1) }] } } });
  const task = await s.task({ status: 'ready_for_review', githubIssueNumber: 17, githubItemId: 'ITEM_17', prNumber: 4 });
  assert.equal((await syncProject(s.project)).verdicts, 1);
  assert.equal((await s.reload(task.id)).status, 'done');
  assert.ok(!fake.calls.some((c) => c.path === `repos/${s.repo}/pulls/4/reviews`), 'the PR is not polled once the card decided');
});

test('failure: an offline tick stores syncError and the next good tick clears it', async () => {
  const s = await scenario({ issues: [] });
  setGithubTransport(async () => new Response('offline in tests', { status: 503 }));
  try {
    await syncProject(s.project);
  } finally {
    setGithubTransport(fake.transport);
  }
  const failed = await db.query.projects.findFirst({ where: { id: s.project.id } });
  assert.match(failed?.syncError ?? '', /503/);
  assert.match(syncStatus().lastError ?? '', new RegExp(s.repo));
  await syncProject(s.project);
  assert.equal((await db.query.projects.findFirst({ where: { id: s.project.id } }))?.syncError, null);
});

test('syncAll reports running while a tick awaits GitHub, then the last run and no error', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  setGithubTransport(async (url, init) => { await gate; return fake.transport(url, init); });
  try {
    const run = syncAll();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(syncStatus().running, true);
    release();
    await run;
  } finally {
    setGithubTransport(fake.transport);
  }
  const status = syncStatus();
  assert.equal(status.running, false);
  assert.ok(status.lastRunAt instanceof Date);
  assert.equal(status.lastError, null);

  setGithubTransport(async () => new Response('offline in tests', { status: 503 }));
  try {
    await syncAll();
  } finally {
    setGithubTransport(fake.transport);
  }
  assert.match(syncStatus().lastError ?? '', /harness\/sync-/);
});

test('startSync ticks on the interval and stopSync stops it', async () => {
  fake.reset();
  startSync({ intervalMs: 10 });
  await new Promise((r) => setTimeout(r, 60));
  stopSync();
  assert.ok(fake.calls.length > 0, 'the loop called GitHub');
  await new Promise((r) => setTimeout(r, 30));
  fake.reset();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(fake.calls.length, 0, 'nothing after stopSync');
});

test('a rate limit with a reset time pauses the loop until then', async () => {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  setGithubTransport(async () => jsonResponse({ message: 'rate limited' }, 403, { 'x-ratelimit-reset': String(reset) }));
  try {
    await syncAll();
  } finally {
    setGithubTransport(fake.transport);
  }
  fake.reset();
  await syncAll();
  assert.equal(fake.calls.length, 0, 'paused: the transport is not called');
});
