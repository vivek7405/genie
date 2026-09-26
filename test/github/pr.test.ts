// What genie reads off a pull request: the pilots preview, the merge, the
// reviews. Over the scripted fake.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../helpers/db.ts';
import { fakeGithub } from '../helpers/github.ts';
import { projects } from '#db/schema.server.ts';
import { setGithubTransport } from '#modules/github/client.server.ts';
import { findPreviewUrl, listPrReviews, listReviewComments, mergePr, PREVIEW_MARKER, readPr } from '#modules/github/pr.server.ts';

const fake = fakeGithub();
setGithubTransport(fake.transport);
after(() => setGithubTransport(null));
beforeEach(() => fake.reset());

const repo = `harness/pr-${Date.now()}`;
const [project] = await db.insert(projects).values({ name: 'pr', githubRepo: repo }).returning();
const URL_A = 'https://pr-4-genie.pilotrun.app';

const pull = (patch: Record<string, unknown> = {}) => ({ number: 4, state: 'open', merged: false, merged_at: null, updated_at: '2026-09-26T10:00:00Z', html_url: `https://github.com/${repo}/pull/4`, head: { sha: 'aaaaaaa1234567', ref: 'genie/task-1' }, ...patch });
const previewComment = (sha: string, url = URL_A) => ({ id: 1, body: `${PREVIEW_MARKER}\nPreview for \`${sha}\`: ${url}`, user: { login: 'pilots[bot]' }, created_at: 't', html_url: 'u' });

let comments: unknown[] = [];
let statuses: Record<string, unknown[]> = {};
fake.on('GET', `repos/${repo}/pulls/4`, () => pull());
fake.on('GET', `repos/${repo}/issues/4/comments`, () => comments);
fake.on('GET', `repos/${repo}/commits/aaaaaaa1234567/status`, () => ({ statuses: statuses.aaaaaaa1234567 ?? [] }));
fake.on('GET', `repos/${repo}/commits/bbbbbbb/status`, () => ({ statuses: statuses.bbbbbbb ?? [] }));

test('the preview URL comes from the marker comment when its sha matches the head', async () => {
  comments = [{ id: 0, body: 'unrelated', user: null, created_at: 't', html_url: 'u' }, previewComment('aaaaaaa')];
  statuses = {};
  assert.equal(await findPreviewUrl(project, 4), URL_A);
  assert.ok(!fake.calls.some((c) => c.path.includes('/status')), 'no status request when the comment matches');
});

test('a stale comment falls back to the combined status, and nothing yields null', async () => {
  comments = [previewComment('0000000', 'https://stale.example')];
  statuses = { aaaaaaa1234567: [{ context: 'ci/test', state: 'success', target_url: 'https://ci' }, { context: 'pilots/deploy', state: 'success', target_url: URL_A }] };
  assert.equal(await findPreviewUrl(project, 4), URL_A);

  statuses = { aaaaaaa1234567: [{ context: 'pilots/deploy', state: 'pending', target_url: null }] };
  assert.equal(await findPreviewUrl(project, 4), null, 'a stale comment is never returned');
});

test('an explicit sha is checked instead of the head', async () => {
  comments = [previewComment('aaaaaaa')];
  statuses = { aaaaaaa1234567: [{ context: 'pilots/deploy', state: 'success', target_url: URL_A }] };
  assert.equal(await findPreviewUrl(project, 4, { sha: 'bbbbbbb' }), null);
  assert.ok(fake.calls.some((c) => c.path === `repos/${repo}/commits/bbbbbbb/status`), 'the status request names the given sha');
  assert.ok(!fake.calls.some((c) => c.path === `repos/${repo}/commits/aaaaaaa1234567/status`));

  comments = [previewComment('aaaaaaa'), previewComment('bbbbbbb')];
  assert.equal(await findPreviewUrl(project, 4, { sha: 'bbbbbbb' }), URL_A);
});

test('mergePr squash-merges, deletes the head branch, and skips an already merged PR', async () => {
  fake.on('PUT', `repos/${repo}/pulls/4/merge`, () => ({ sha: 'merged-sha', merged: true }));
  fake.on('DELETE', `repos/${repo}/git/refs/heads/genie/task-1`, () => undefined);
  assert.deepEqual(await mergePr(project, 4), { sha: 'merged-sha', merged: true });
  const methods = fake.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(methods, [`GET repos/${repo}/pulls/4`, `PUT repos/${repo}/pulls/4/merge`, `DELETE repos/${repo}/git/refs/heads/genie/task-1`]);
  assert.deepEqual(fake.calls[1].body, { merge_method: 'squash' });

  fake.reset();
  fake.on('GET', `repos/${repo}/pulls/5`, () => pull({ number: 5, merged: true, merged_at: 't' }));
  assert.deepEqual(await mergePr(project, 5), { sha: null, merged: true });
  assert.ok(!fake.calls.some((c) => c.method === 'PUT'));
  fake.rest.delete(`GET repos/${repo}/pulls/5`);
});

test('readPr, listPrReviews and listReviewComments map the REST rows', async () => {
  const pr = await readPr(project, 4);
  assert.deepEqual(pr, { number: 4, state: 'open', merged: false, mergedAt: null, updatedAt: '2026-09-26T10:00:00Z', htmlUrl: `https://github.com/${repo}/pull/4`, headSha: 'aaaaaaa1234567', headRef: 'genie/task-1' });

  fake.on('GET', `repos/${repo}/pulls/4/reviews`, () => [
    { id: 1, state: 'COMMENTED', body: 'looking', user: { login: 'v' }, submitted_at: 't1', html_url: 'r1' },
    { id: 2, state: 'PENDING', body: 'draft', user: { login: 'v' }, submitted_at: null, html_url: 'r2' },
    { id: 3, state: 'CHANGES_REQUESTED', body: null, user: null, submitted_at: 't3', html_url: 'r3' },
  ]);
  assert.deepEqual(await listPrReviews(project, 4), [
    { id: 1, state: 'COMMENTED', body: 'looking', author: 'v', submittedAt: 't1', htmlUrl: 'r1' },
    { id: 3, state: 'CHANGES_REQUESTED', body: '', author: '', submittedAt: 't3', htmlUrl: 'r3' },
  ]);

  fake.on('GET', `repos/${repo}/pulls/4/comments`, () => [
    { id: 10, pull_request_review_id: 3, path: 'app/page.ts', line: 12, original_line: 11, body: 'rename this', user: { login: 'v' }, created_at: 't3', html_url: 'c10' },
    { id: 11, pull_request_review_id: null, path: 'lib/x.ts', line: null, original_line: 4, body: 'hm', user: null, created_at: 't4', html_url: 'c11' },
  ]);
  assert.deepEqual(await listReviewComments(project, 4), [
    { id: 10, reviewId: 3, path: 'app/page.ts', line: 12, body: 'rename this', author: 'v', createdAt: 't3', htmlUrl: 'c10' },
    { id: 11, reviewId: null, path: 'lib/x.ts', line: 4, body: 'hm', author: '', createdAt: 't4', htmlUrl: 'c11' },
  ]);
});
