// POST /api/github/webhook through the real request pipeline: the signature
// gate, the event filter, and what a delivery schedules (observed through
// the setSyncScheduler seam, so no sync runs). requestSync itself is
// exercised at the end against the offline fake transport.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const { db, appDir } = await import('../helpers/db.ts');
const { projects } = await import('#db/schema.server.ts');
const { createRequestHandler } = await import('@webjsdev/server');
const { testRequest } = await import('@webjsdev/server/testing');
const { classify, setSyncScheduler, verifySignature } = await import('#modules/github/webhook.server.ts');
const { requestSync, stopSync, syncStatus } = await import('#modules/github/sync.server.ts');

const SECRET = 'webhook-test-secret';
process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET;

const app = await createRequestHandler({ appDir, dev: true });
const stamp = Date.now();
const repo = `Harness/Webhook-${stamp}`;
const [project] = await db.insert(projects).values({ name: 'w', githubRepo: repo, githubProjectId: `PVT_hook_${stamp}` }).returning();
await db.insert(projects).values({ name: 'other', githubRepo: `harness/other-${stamp}` });

const scheduled: string[] = [];
setSyncScheduler((id) => scheduled.push(id));
beforeEach(() => { scheduled.length = 0; });
after(() => {
  setSyncScheduler(null);
  stopSync();
  delete process.env.GITHUB_APP_WEBHOOK_SECRET;
});

const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

function deliver(event: string, payload: unknown, opts: { signature?: string | null } = {}) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': `d-${Math.random()}` };
  const signature = opts.signature === undefined ? sign(body) : opts.signature;
  if (signature !== null) headers['x-hub-signature-256'] = signature;
  return testRequest(app.handle, '/api/github/webhook', { method: 'POST', headers, body });
}

const labeled = (fullName: string) => ({ action: 'labeled', label: { name: 'genie' }, issue: { number: 7 }, repository: { full_name: fullName } });

test('verifySignature accepts the right HMAC and refuses everything else', () => {
  const body = '{"a":1}';
  assert.equal(verifySignature(body, sign(body), SECRET), true);
  assert.equal(verifySignature(body, sign(body, 'other'), SECRET), false);
  assert.equal(verifySignature(body, sign(body).slice(0, -1), SECRET), false);
  assert.equal(verifySignature(body, null, SECRET), false);
  assert.equal(verifySignature(body, sign(body), undefined), false);
  assert.equal(verifySignature(body, sign(body), ''), false);
});

test('classify keeps the events the sync reads and drops the rest', () => {
  const r = { repository: { full_name: 'o/r' } };
  assert.deepEqual(classify('issues', { action: 'labeled', ...r }), { repo: 'o/r', board: null, reason: 'issues.labeled' });
  for (const action of ['opened', 'reopened', 'edited', 'closed']) assert.equal(classify('issues', { action, ...r })?.reason, `issues.${action}`);
  assert.equal(classify('issues', { action: 'assigned', ...r }), null);
  assert.equal(classify('issue_comment', { action: 'created', ...r })?.reason, 'issue_comment.created');
  assert.equal(classify('issue_comment', { action: 'deleted', ...r }), null);
  assert.equal(classify('pull_request_review', { action: 'submitted', ...r })?.reason, 'pull_request_review.submitted');
  assert.equal(classify('pull_request_review', { action: 'dismissed', ...r }), null);
  assert.equal(classify('pull_request', { action: 'closed', pull_request: { merged: true }, ...r })?.reason, 'pull_request.merged');
  assert.equal(classify('pull_request', { action: 'closed', pull_request: { merged: false }, ...r }), null);
  assert.equal(classify('pull_request', { action: 'synchronize', ...r })?.reason, 'pull_request.synchronize');
  assert.equal(classify('pull_request', { action: 'opened', ...r }), null);
  assert.deepEqual(classify('projects_v2_item', { action: 'edited', projects_v2_item: { project_node_id: 'PVT_1' } }), { repo: null, board: 'PVT_1', reason: 'projects_v2_item.edited' });
  assert.deepEqual(classify('ping', { zen: 'x' }), { repo: null, board: null, reason: 'ping' });
  assert.equal(classify('push', r), null);
  assert.equal(classify('issues', 'not an object'), null);
});

test('a signed issues.labeled on a connected repo schedules one sync for that project', async () => {
  const res = await deliver('issues', labeled(repo.toLowerCase()));
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { scheduled: 1 });
  assert.deepEqual(scheduled, [project.id]);
});

test('a card move on a connected board schedules its project', async () => {
  const res = await deliver('projects_v2_item', { action: 'edited', projects_v2_item: { project_node_id: project.githubProjectId } });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { scheduled: 1 });
  assert.deepEqual(scheduled, [project.id]);
});

test('a bad signature is 401 and schedules nothing', async () => {
  for (const signature of [sign(JSON.stringify(labeled(repo)), 'wrong'), 'sha256=00', null]) {
    const res = await deliver('issues', labeled(repo), { signature });
    assert.equal(res.status, 401);
  }
  assert.deepEqual(scheduled, []);
});

test('ping is 200', async () => {
  const res = await deliver('ping', { zen: 'Keep it logically awesome.', hook_id: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(scheduled, []);
});

test('an event the sync does not read is 204', async () => {
  const res = await deliver('push', { ref: 'refs/heads/main', repository: { full_name: repo } });
  assert.equal(res.status, 204);
  assert.deepEqual(scheduled, []);
});

test('an unknown repo is 202 with nothing scheduled', async () => {
  const res = await deliver('issues', labeled(`nobody/unknown-${stamp}`));
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { scheduled: 0 });
  assert.deepEqual(scheduled, []);
});

test('a body that is not JSON is 400', async () => {
  const body = 'not json';
  const res = await testRequest(app.handle, '/api/github/webhook', { method: 'POST', headers: { 'x-github-event': 'issues', 'x-hub-signature-256': sign(body) }, body });
  assert.equal(res.status, 400);
});

test('GET is 405', async () => {
  const res = await testRequest(app.handle, '/api/github/webhook');
  assert.equal(res.status, 405);
});

test('an unset secret is 503, even with a valid-looking signature', async () => {
  delete process.env.GITHUB_APP_WEBHOOK_SECRET;
  try {
    const res = await deliver('issues', labeled(repo));
    assert.equal(res.status, 503);
    assert.deepEqual(scheduled, []);
  } finally {
    process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
  }
});

test('requestSync runs the project sync once per debounce window', async () => {
  const before = syncStatus().lastRunAt;
  requestSync(project.id, { debounceMs: 0 });
  requestSync(project.id, { debounceMs: 0 });
  await new Promise((r) => setTimeout(r, 50));
  for (let i = 0; i < 100 && syncStatus().running; i++) await new Promise((r) => setTimeout(r, 10));
  const after = syncStatus();
  assert.equal(after.running, false);
  assert.notEqual(after.lastRunAt, before);
  // The transport is offline in tests, so the run records its failure on the project.
  const row = await db.query.projects.findFirst({ where: { id: project.id } });
  assert.match(row?.syncError ?? '', /offline in tests|503/);
});
