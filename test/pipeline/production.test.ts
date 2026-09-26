// The production URL rule against a scripted services list: the newest
// autodeploy service on the repository whose tracked branch matches, custom
// domain first. No Pilots call is ever made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Service } from '@pilots/sdk';

await import('../helpers/db.ts');
const { findProductionUrl } = await import('#modules/pipeline/production.server.ts');

const project = { githubRepo: 'harness/prod', defaultBranch: 'main' };

function service(patch: Partial<Service>): Service {
  return {
    id: 'svc', name: 'prod', replicas: 1, size: { vcpus: 1, mem_mib: 512 },
    knobs: { auto_stop: 'suspend', auto_start: true, min_machines_running: 0, soft_limit: 1 } as Service['knobs'],
    repo: project.githubRepo, autodeploy: true, created_at: 1, url: 'https://prod.pilotrun.app', ...patch,
  };
}

test('picks the newest autodeploy service on the repo and prefers the custom domain', async () => {
  const services = [
    service({ id: 'old', created_at: 10, url: 'https://old.pilotrun.app' }),
    service({ id: 'new', created_at: 20, url: 'https://new.pilotrun.app', custom_domain: 'app.example.com' }),
    service({ id: 'main', created_at: 15, branch: 'main', url: 'https://main.pilotrun.app' }),
  ];
  assert.equal(await findProductionUrl(project, async () => services), 'https://app.example.com');
  assert.equal(await findProductionUrl(project, async () => [services[0], services[2]]), 'https://main.pilotrun.app');
});

test('ignores another repo, a service without autodeploy, and one tracking another branch', async () => {
  const services = [
    service({ id: 'other', repo: 'harness/other', created_at: 50 }),
    service({ id: 'manual', autodeploy: false, created_at: 40 }),
    service({ id: 'staging', branch: 'staging', created_at: 30 }),
  ];
  assert.equal(await findProductionUrl(project, async () => services), null);
  assert.equal(await findProductionUrl(project, async () => [...services, service({ id: 'ok', created_at: 1 })]), 'https://prod.pilotrun.app');
});

test('returns null without a url, with an empty list, and with no PILOT_API_KEY through the default lister', async () => {
  assert.equal(await findProductionUrl(project, async () => [service({ url: undefined })]), null);
  assert.equal(await findProductionUrl(project, async () => []), null);
  const had = process.env.PILOT_API_KEY;
  delete process.env.PILOT_API_KEY;
  try {
    assert.equal(await findProductionUrl(project), null);
  } finally {
    if (had !== undefined) process.env.PILOT_API_KEY = had;
  }
});
