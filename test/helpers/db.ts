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
process.env.GENIE_SYNC = '0';
// The auth module refuses to boot without a signing secret; tests mint their
// own session cookies with this one (test/helpers/auth.ts).
process.env.AUTH_SECRET ||= 'genie-test-secret-at-least-32-characters-long';

export const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { db } = await import('#db/connection.server.ts');
const { migrate } = await import('drizzle-orm/node-sqlite/migrator');
// The connection is typed for both runtimes; tests run on Node, so narrow to
// what the Node migrator accepts.
await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: join(appDir, 'db', 'migrations') });

// No test talks to GitHub: every request fails fast and deterministically
// unless a test installs its own scripted fake (test/helpers/github.ts).
const { setGithubTransport } = await import('#modules/github/client.server.ts');
setGithubTransport(async () => new Response('offline in tests', { status: 503 }));

export { db };
