// The image Genie ships: port, /data for the volume, gh for the demo reset,
// the start command, and what .dockerignore keeps out of the build context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDir } from '../helpers/db.ts';

const dockerfile = readFileSync(join(appDir, 'Dockerfile'), 'utf8');
const lines = dockerfile.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

test('serves on 8080 and starts with npm start', () => {
  assert.ok(lines.includes('ENV PORT=8080'));
  assert.ok(lines.includes('EXPOSE 8080'));
  assert.ok(lines.includes('CMD ["npm", "start"]'));
});

test('creates /data so a plain docker run boots without a volume', () => {
  assert.ok(lines.includes('RUN mkdir -p /data'));
});

test('installs github-cli on the apk line', () => {
  const apk = lines.find((l) => /^RUN apk add/.test(l));
  assert.ok(apk, 'an apk add line');
  assert.match(apk!, /\bgithub-cli\b/);
});

test('runs as root (no USER line) so the volume mount is writable', () => {
  assert.ok(!lines.some((l) => /^USER\b/.test(l)));
});

test('127.0.0.1 appears only on the HEALTHCHECK probe', () => {
  const raw = dockerfile.split('\n');
  const hits = raw.map((l, i) => [l, i] as const).filter(([l]) => l.includes('127.0.0.1'));
  assert.equal(hits.length, 1);
  const [, i] = hits[0];
  const previous = raw.slice(0, i + 1).reverse().find((l) => l.trim() !== '' && !l.trim().startsWith('#') && !l.includes('127.0.0.1'));
  assert.match(previous!, /^HEALTHCHECK/);
});

test('.dockerignore keeps .env, the tests and the local database out', () => {
  const ignore = readFileSync(join(appDir, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim());
  for (const entry of ['.env', 'test/', 'db/dev.db']) assert.ok(ignore.includes(entry), `${entry} is ignored`);
});
