// A fresh, migrated SQLite file per test process, so files never see each other's
// rows. Import this BEFORE anything that opens the connection.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'genie-test-'));
process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`;
process.env.GENIE_WORKER = '0';
process.env.AUTH_SECRET ||= 'genie-test-secret-at-least-32-characters-long';
process.env.GH_TOKEN = 'test-github-token';
process.env.PILOT_API_KEY = 'test-pilot-key';
process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-claude-token';

export const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { db } = await import('#db/connection.server.ts');
const migrationsFolder = join(appDir, 'db', 'migrations');
if ((globalThis as { Bun?: boolean }).Bun) {
  const { migrate } = await import('drizzle-orm/bun-sqlite/migrator');
  await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
} else {
  const { migrate } = await import('drizzle-orm/node-sqlite/migrator');
  await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
}

// No test talks to GitHub unless it installs its own script.
const { setGithubTransport } = await import('#modules/github/client.server.ts');
setGithubTransport(async () => new Response('offline in tests', { status: 503 }));

const { projects, tasks } = await import('#db/schema.server.ts');
let seq = 0;

export async function aProject() {
  const [p] = await db.insert(projects).values({ githubRepo: `acme/repo-${seq++}` }).returning();
  return p;
}

export async function aTask(projectId: string, patch: Partial<typeof tasks.$inferInsert> = {}) {
  const [t] = await db.insert(tasks).values({ projectId, title: 'Add a page', ...patch }).returning();
  return t;
}

export async function rowOf(id: string) {
  const row = await db.query.tasks.findFirst({ where: { id } });
  if (!row) throw new Error(`no task ${id}`);
  return row;
}

export async function feedOf(taskId: string) {
  const rows = await db.query.taskEvents.findMany({ where: { taskId } });
  return rows.map((e) => e.message);
}

export function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export { db };
