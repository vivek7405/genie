// A fresh, migrated SQLite file per test process, so files never see each
// other's rows. Import this BEFORE anything that opens the connection: the
// connection module reads DATABASE_URL once at import.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'genie-test-'));
process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`;
process.env.GENIE_WORKER = '0';

export const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { db } = await import('#db/connection.server.ts');
const { migrate } = await import('drizzle-orm/node-sqlite/migrator');
// The connection is typed for both runtimes; tests run on Node, so narrow to
// what the Node migrator accepts.
await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: join(appDir, 'db', 'migrations') });

export { db };
