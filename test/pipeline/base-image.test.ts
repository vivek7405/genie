// ensureBaseCheckpoint builds genie-base once, records the checkpoint id in
// settings, and shares one build between concurrent callers.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../helpers/db.ts');
const { settings } = await import('#db/schema.server.ts');
const { fakePilots, execResponse } = await import('../helpers/pilots-fake.ts');
const { setPilotsClient } = await import('#modules/pipeline/pilots.server.ts');
const { ensureBaseCheckpoint, rebuildBaseCheckpoint, BASE_CHECKPOINT_KEY, BASE_PROVISION_STEPS } = await import('#modules/pipeline/base-image.server.ts');

const base = { id: 'm_base', name: 'genie-base', url: 'https://genie-base.pilots.test', state: 'running', vcpus: 1, mem_mib: 512, knobs: {}, host_id: 'h', created_at: 0, last_activity: 0 };

let fake: ReturnType<typeof fakePilots>;
beforeEach(async () => {
  await db.delete(settings);
  fake = fakePilots();
  setPilotsClient(fake.client);
});
afterEach(() => setPilotsClient(null));

function queueBuild(checkpointId: string, existing: unknown[] = []) {
  fake.respond(200, existing);
  if (existing.length) fake.respond(204);
  fake.respond(201, base);
  fake.respond(200, { ...base, mem_mib: 2048 });
  for (let i = 0; i < BASE_PROVISION_STEPS.length; i++) fake.respond(200, execResponse());
  fake.respond(201, { id: checkpointId, machine_id: 'm_base', durable: false });
  fake.respond(200, { id: checkpointId, machine_id: 'm_base', durable: true });
}

test('ensureBaseCheckpoint builds the base once and then only verifies the checkpoint', async () => {
  queueBuild('ck_1');
  assert.equal(await ensureBaseCheckpoint(), 'ck_1');
  const paths = fake.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(paths, [
    'GET /v1/machines',
    'POST /v1/machines',
    'POST /v1/machines/m_base/resize',
    ...Array(5).fill('POST /v1/machines/m_base/exec'),
    'POST /v1/machines/m_base/checkpoints',
    'GET /v1/checkpoints/ck_1',
  ]);
  assert.deepEqual(fake.calls[1].body, { name: 'genie-base', knobs: { idle_timeout: 3600 }, labels: { genie_base: '1' } });
  assert.deepEqual(fake.calls[2].body, { mem_mib: 2048 });
  const execs = fake.calls.slice(3, 8).map((c) => c.body as { cmd: string; env?: unknown; timeout_ms: number });
  assert.ok(execs[0].cmd.includes('apt-get install') && execs[0].cmd.includes('git gh'));
  assert.ok(execs[1].cmd.includes('user.email genie@users.noreply.github.com'));
  assert.ok(execs[2].cmd.endsWith(' genie-claude --version'));
  assert.ok(execs[3].cmd.includes('npm install -g create-webjs webjsdev'));
  assert.equal(execs[4].cmd, 'mkdir -p /home/pilot/.genie');
  for (const e of execs) {
    assert.equal(e.env, undefined, 'no env on a base step');
    assert.equal(e.timeout_ms, 600_000);
  }
  assert.match((fake.calls[8].body as { comment: string }).comment, /^genie base \d{4}-/);
  const stored = await db.query.settings.findFirst({ where: { key: BASE_CHECKPOINT_KEY } });
  assert.equal(stored?.value, 'ck_1');
  assert.equal(paths.includes('DELETE /v1/machines/m_base'), false, 'the base is never destroyed');

  fake.calls.length = 0;
  fake.respond(200, { id: 'ck_1', machine_id: 'm_base', durable: true });
  assert.equal(await ensureBaseCheckpoint(), 'ck_1');
  assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), ['GET /v1/checkpoints/ck_1']);
});

test('two concurrent calls share one build', async () => {
  queueBuild('ck_2');
  const [a, b] = await Promise.all([ensureBaseCheckpoint(), ensureBaseCheckpoint()]);
  assert.equal(a, 'ck_2');
  assert.equal(b, 'ck_2');
  assert.equal(fake.calls.filter((c) => c.method === 'POST' && c.path === '/v1/machines').length, 1);
});

test('a stored checkpoint that no longer exists is cleared and a half-built base is replaced', async () => {
  await db.insert(settings).values({ key: BASE_CHECKPOINT_KEY, value: 'ck_gone' });
  fake.respond(404, { error: 'no such checkpoint', code: 'not_found' });
  queueBuild('ck_3', [base]);
  assert.equal(await ensureBaseCheckpoint(), 'ck_3');
  const paths = fake.calls.map((c) => `${c.method} ${c.path}`);
  assert.equal(paths[0], 'GET /v1/checkpoints/ck_gone');
  assert.equal(paths[2], 'DELETE /v1/machines/m_base');
});

test('a failing provisioning step throws with the step named and leaves no checkpoint recorded', async () => {
  fake.respond(200, []);
  fake.respond(201, base);
  fake.respond(200, base);
  fake.respond(200, execResponse('', 100, 'E: Unable to locate package gh'));
  await assert.rejects(ensureBaseCheckpoint(), /base image step failed \(exit 100\): sudo apt-get update.*\n.*Unable to locate package gh/);
  assert.equal(await db.query.settings.findFirst({ where: { key: BASE_CHECKPOINT_KEY } }), undefined);
});

test('rebuildBaseCheckpoint clears the setting, destroys the base and builds again', async () => {
  await db.insert(settings).values({ key: BASE_CHECKPOINT_KEY, value: 'ck_old' });
  fake.respond(200, [base]);
  fake.respond(204);
  queueBuild('ck_4');
  assert.equal(await rebuildBaseCheckpoint(), 'ck_4');
  const paths = fake.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(paths.slice(0, 3), ['GET /v1/machines', 'DELETE /v1/machines/m_base', 'GET /v1/machines']);
});
