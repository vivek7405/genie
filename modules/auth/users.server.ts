// Server-only: the users table write that sign-in performs.
import { and, eq, lt } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';
import type { User } from '#db/schema.server.ts';
import type { GithubIdentity } from './types.ts';

/**
 * Insert or refresh the `users` row for a GitHub identity.
 *
 * Identity is the GitHub user id (`users.github_id`, unique), which GitHub
 * never reuses; the login is display only, since GitHub frees it for reuse
 * the moment an account renames. The access token is the user-to-server
 * token the GitHub App's OAuth hands back on every sign-in; it is stored so
 * the connect flow can list the user's installations, repositories and
 * boards. It is never logged and never leaves the server (see
 * `queries/current-user.server.ts`).
 *
 * A row the seed created offline carries a placeholder id below zero; the
 * first real sign-in with that login adopts it, so the seeded project ends
 * up under the person who signs in rather than beside them.
 */
export async function upsertGithubUser(identity: GithubIdentity, accessToken: string | null): Promise<User> {
  const githubId = Number(identity.id);
  if (!Number.isInteger(githubId)) throw new Error('GitHub profile has no numeric id');
  const fields = {
    login: identity.login,
    name: identity.name,
    avatarUrl: identity.image,
    // A sign-in that somehow carried no token keeps the one already stored.
    ...(accessToken ? { accessToken } : {}),
  };
  await db.update(users).set({ githubId }).where(and(eq(users.login, identity.login), lt(users.githubId, 0)));
  const [row] = await db
    .insert(users)
    .values({ githubId, ...fields })
    .onConflictDoUpdate({ target: users.githubId, set: { ...fields, updatedAt: new Date() } })
    .returning();
  return row;
}
