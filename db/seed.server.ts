// `npm run db:seed`: a user, a project and a few tasks so the board renders
// real rows while building. Idempotent on the login and the repo name.
//
// The seed user is whoever will sign in on this machine (GENIE_DEV_USER_LOGIN,
// vivek7405 by default). Sign-in upserts by GitHub id, so the seed asks the
// public users endpoint for that id; offline it stores a placeholder that the
// first real sign-in with the same login adopts (modules/auth/users.server.ts).
import { eq } from 'drizzle-orm';
import { db } from './connection.server.ts';
import { projects, tasks, users } from './schema.server.ts';

const login = process.env.GENIE_DEV_USER_LOGIN || 'vivek7405';
const repo = 'vivek7405/genie';

async function githubIdOf(name: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(name)}`, { headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const id = body && typeof body === 'object' && 'id' in body ? Number((body as { id: unknown }).id) : NaN;
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

let user = await db.query.users.findFirst({ where: { login } });
if (!user) {
  const githubId = await githubIdOf(login);
  if (githubId === null) console.log(`could not resolve ${login} on GitHub, seeding a placeholder id`);
  [user] = await db.insert(users).values({ githubId: githubId ?? -1, login, name: login }).returning();
}

const existing = await db.query.projects.findFirst({ where: { githubRepo: repo, userId: user.id } });
// A project seeded before users existed has no owner yet; hand it to the seed user.
const orphan = existing ? null : await db.query.projects.findFirst({ where: { githubRepo: repo, userId: { isNull: true } } });
const project = existing
  ?? (orphan ? (await db.update(projects).set({ userId: user.id }).where(eq(projects.id, orphan.id)).returning())[0] : null)
  ?? (await db.insert(projects).values({ userId: user.id, name: 'genie', githubRepo: repo, githubProjectNumber: 11, productionUrl: 'https://genie-demo.pilotrun.app' }).returning())[0];

if (!existing && !orphan) {
  await db.insert(tasks).values([
    { projectId: project.id, title: 'Add a /about page', description: 'A short page describing what genie does, linked from the header.' },
    { projectId: project.id, title: 'Show task counts in the header', description: 'A small badge per column.', status: 'ready_for_review', previewUrl: 'https://pr-2-genie.pilotrun.app' },
    { projectId: project.id, title: 'Dark mode toggle', status: 'done', prNumber: 3, prUrl: 'https://github.com/vivek7405/genie/pull/3' },
    { projectId: project.id, title: 'Rename the header', status: 'in_progress', error: 'npm test exited 1: 2 failing', attempt: 2, branch: 'genie/4-rename-the-header' },
  ]);
}
console.log(`seeded user ${user.login} and project ${project.id}`);
