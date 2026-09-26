// The Pilots compose file, checked line by line with regexes (no YAML
// dependency): the shape `pilot deploy` ships, the secret references, the
// volume, the resident replica, the readiness probe, and the keys the Pilots
// planner refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDir } from '../helpers/db.ts';

const source = readFileSync(join(appDir, 'compose.pilots.yaml'), 'utf8');
const lines = source.split('\n');
const code = lines.filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
const codeText = code.join('\n');

// The lines nested under a top-level block.
function block(name: string): string[] {
  const start = code.findIndex((l) => new RegExp(`^${name}:\\s*$`).test(l));
  assert.ok(start >= 0, `top-level ${name} block`);
  const out: string[] = [];
  for (const l of code.slice(start + 1)) {
    if (!/^\s/.test(l)) break;
    out.push(l);
  }
  return out;
}

// The lines nested under the service's `environment:` block.
function environmentLines(): string[] {
  const start = code.findIndex((l) => /^\s+environment:\s*$/.test(l));
  assert.ok(start >= 0, 'the service has an environment block');
  const indent = code[start].match(/^\s*/)![0].length;
  const out: string[] = [];
  for (const l of code.slice(start + 1)) {
    if (l.match(/^\s*/)![0].length <= indent) break;
    out.push(l);
  }
  return out;
}

test('the first non-comment line names the app genie (pilot secret set keys on it)', () => {
  assert.equal(code[0], 'name: genie');
});

test('one service, genie, built from the repo Dockerfile', () => {
  const i = code.findIndex((l) => /^  genie:\s*$/.test(l));
  assert.ok(i >= 0, 'services.genie exists');
  assert.match(code[i + 1], /^\s+build: \.\s*$/);
  const services = block('services').filter((l) => /^  [a-z][\w-]*:\s*$/.test(l));
  assert.deepEqual(services, ['  genie:'], 'exactly one service');
});

test('exactly six secret:// references: the two Pilots and Claude credentials, the GitHub App and the token fallback', () => {
  const refs = [...codeText.matchAll(/^\s+([A-Z_]+): secret:\/\/([a-z_]+)\s*$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(refs, [
    ['PILOT_API_KEY', 'pilot_api_key'],
    ['CLAUDE_CODE_OAUTH_TOKEN', 'claude_code_oauth_token'],
    ['GITHUB_APP_ID', 'github_app_id'],
    ['GITHUB_APP_SLUG', 'github_app_slug'],
    ['GITHUB_APP_PRIVATE_KEY', 'github_app_private_key'],
    ['GH_TOKEN', 'github_token'],
  ]);
  assert.equal((codeText.match(/secret:\/\//g) ?? []).length, 6);
});

test('no environment line carries a literal token or key value', () => {
  for (const l of environmentLines()) {
    if (/TOKEN|KEY|GITHUB_APP/.test(l)) assert.match(l, /: secret:\/\/[a-z_]+\s*$/, `pasted secret on: ${l.trim()}`);
  }
});

test('the SQLite file lives on the genie-data volume at /data', () => {
  assert.ok(environmentLines().some((l) => /^\s+DATABASE_URL: file:\/data\/genie\.db\s*$/.test(l)));
  assert.ok(code.some((l) => /^\s+- genie-data:\/data\s*$/.test(l)), 'the service mounts genie-data at /data');
  assert.deepEqual(block('volumes'), ['  genie-data:']);
});

test('the replica stays resident for the worker', () => {
  const x = code.findIndex((l) => /^\s+x-pilots:\s*$/.test(l));
  assert.ok(x >= 0, 'x-pilots block');
  assert.ok(code.slice(x + 1, x + 3).some((l) => /^\s+min_machines_running: 1\s*$/.test(l)));
});

test('the healthcheck probes /__webjs/ready with a 40 s start period', () => {
  const probe = code.find((l) => /^\s+test: \[/.test(l));
  assert.ok(probe, 'healthcheck test line');
  assert.match(probe!, /\/__webjs\/ready/);
  assert.ok(code.some((l) => /^\s+start_period: 40s\s*$/.test(l)));
});

test('nothing the Pilots planner refuses, and no ${} interpolation', () => {
  for (const key of ['ports', 'env_file', 'labels', 'container_name', 'stop_grace_period', 'stop_signal']) {
    assert.ok(!code.some((l) => new RegExp(`^\\s*${key}:`).test(l)), `${key}: must not appear`);
  }
  assert.ok(!codeText.includes('${'), 'no ${VAR} interpolation (the planner would read the local .env)');
});
