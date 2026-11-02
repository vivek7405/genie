// Server-only: who may sign in. Only the owner of GH_TOKEN, since every repository
// call acts as that person. A person refused here never gets a users row, and the
// session check reads that row, so a signed cookie alone opens nothing.
import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';
import { operatorLogin } from '#modules/github/operator.server.ts';
import type { GithubIdentity } from './types.ts';

export async function allowSignIn(identity: GithubIdentity): Promise<boolean> {
  if (identity.login.toLowerCase() !== (await operatorLogin()).toLowerCase()) return false;
  const fields = { login: identity.login, name: identity.name, avatarUrl: identity.image };
  await db.insert(users).values({ githubId: Number(identity.id), ...fields })
    .onConflictDoUpdate({ target: users.githubId, set: { ...fields, updatedAt: new Date() } });
  return true;
}
