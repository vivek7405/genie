// The auth configuration. GitHub is the only provider, through the GitHub App's
// OAuth client. A GitHub App grants its own permissions, so no scope is asked.
import { createAuth, GitHub } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';
import { operatorLogin } from '#modules/github/operator.server.ts';
import type { GithubIdentity } from './types.ts';
import './types.ts';

const secret = process.env.AUTH_SECRET?.trim();
if (!secret) throw new Error('AUTH_SECRET must be set (32+ random characters)');

interface GithubProfile {
  id: number | string;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

export const { auth, signIn, signOut, handlers } = createAuth({
  providers: [{
    ...GitHub(),
    scope: [],
    profile: (p: GithubProfile): GithubIdentity => ({
      id: String(p.id),
      login: p.login,
      name: p.name || p.login,
      email: p.email ?? null,
      image: p.avatar_url ?? null,
    }),
  }],
  secret,
  pages: { signIn: '/', error: '/?error=AccessDenied' },
  callbacks: {
    signIn: async ({ user }: { user: GithubIdentity }) => {
      if (user.login.toLowerCase() !== (await operatorLogin()).toLowerCase()) return false;
      const fields = { login: user.login, name: user.name, avatarUrl: user.image };
      await db.insert(users).values({ githubId: Number(user.id), ...fields })
        .onConflictDoUpdate({ target: users.githubId, set: { ...fields, updatedAt: new Date() } });
      return true;
    },
    jwt: async ({ token, user }: { token: Record<string, string>; user?: GithubIdentity }) =>
      user ? { ...token, login: user.login } : token,
  },
});
