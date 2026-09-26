// parseTar against an archive GNU tar built: a nested file, an empty file,
// and a path long enough to need a GNU L long-name entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { parseTar } = await import('#modules/pipeline/tar.server.ts');

test('parseTar reads files, long names and skips directories and symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'genie-ustar-'));
  const longDir = 'd'.repeat(120);
  const longFile = 'f'.repeat(80) + '.txt';
  mkdirSync(join(root, 'tree', 'a', 'b'), { recursive: true });
  mkdirSync(join(root, 'tree', longDir), { recursive: true });
  writeFileSync(join(root, 'tree', 'a', 'b', 'nested.txt'), 'nested content');
  writeFileSync(join(root, 'tree', 'empty'), '');
  writeFileSync(join(root, 'tree', longDir, longFile), 'long');
  writeFileSync(join(root, 'tree', 'big.bin'), Buffer.alloc(1500, 7));
  symlinkSync('empty', join(root, 'tree', 'link'));
  const tar = execSync('tar -c --format=gnu -- tree', { cwd: root });
  const files = parseTar(tar);
  assert.deepEqual([...files.keys()].sort(), ['tree/a/b/nested.txt', 'tree/big.bin', `tree/${longDir}/${longFile}`, 'tree/empty'].sort());
  assert.equal(files.get('tree/a/b/nested.txt')!.toString(), 'nested content');
  assert.equal(files.get('tree/empty')!.length, 0);
  assert.equal(files.get(`tree/${longDir}/${longFile}`)!.toString(), 'long');
  assert.equal(files.get('tree/big.bin')!.length, 1500);
  assert.ok(`tree/${longDir}/${longFile}`.length > 100, 'the fixture exercises the long-name path');
});

test('parseTar returns an empty map for an empty or truncated buffer', () => {
  assert.equal(parseTar(Buffer.alloc(0)).size, 0);
  assert.equal(parseTar(Buffer.alloc(1024)).size, 0);
});
