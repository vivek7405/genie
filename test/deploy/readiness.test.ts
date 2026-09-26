// readiness.ts answers true against the migrated database and rejects against
// an unmigrated file. The second case runs in a subprocess because the
// connection is cached on globalThis per process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { appDir } from '../helpers/db.ts';
import { createRequestHandler } from '@webjsdev/server';
import { testRequest } from '@webjsdev/server/testing';
import ready from '../../readiness.ts';

test('resolves true once the migration has run', async () => {
  assert.equal(await ready(), true);
});

test('rejects against an unmigrated database (the settings table is missing)', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'genie-unmigrated-')), 'empty.db');
  const script = `import('${join(appDir, 'readiness.ts')}').then((m) => m.default()).then(
    () => { console.log('ready'); process.exit(0); },
    (e) => { console.log('unready: ' + e.message); process.exit(3); });`;
  const run = promisify(execFile);
  await assert.rejects(
    run(process.execPath, ['--input-type=module', '-e', script], {
      cwd: appDir,
      env: { ...process.env, DATABASE_URL: `file:${file}`, GENIE_WORKER: '0' },
    }),
    (e: { code?: number; stdout?: string }) => e.code === 3 && /unready: .*settings/.test(e.stdout ?? ''),
  );
});

test('/__webjs/ready answers 200 through the handler once the app is warm', async () => {
  const app = await createRequestHandler({ appDir, dev: true });
  let last = 0;
  for (let i = 0; i < 80 && last !== 200; i++) {
    last = (await testRequest(app.handle, '/__webjs/ready')).status;
    if (last !== 200) await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(last, 200);
});
