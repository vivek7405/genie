/**
 * The auth configuration. A server-only utility (a `.server.ts` with NO
 * `'use server'`), so its browser import is a throw-at-load stub and nothing
 * here can reach a client bundle.
 *
 * GitHub is the ONLY provider: a Genie account is a GitHub account, because
 * the same GitHub App that signs a person in also grants Genie access to
 * their repositories. AUTH_GITHUB_ID / AUTH_GITHUB_SECRET are that App's
 * OAuth client id and secret. Sessions are JWT (the framework default), so a
 * redeploy on Pilots loses no session store.
 *
 * How the access token is captured: the framework's OAuth callback runs
 * `callbacks.signIn({ user, account })` after the code exchange and BEFORE
 * the session cookie is written, and `account.accessToken` is the token it
 * exchanged the code for. That hook upserts the `users` row and stores the
 * token, so the row exists by the time the first authenticated request
 * arrives. No callback is implemented by hand.
 */
import { createAuth, GitHub } from '@webjsdev/server';
import { upsertGithubUser } from './users.server.ts';
import type { GithubIdentity } from './types.ts';
import './types.ts';

// Fail fast in EVERY environment, dev included: a guessable signing secret
// means forgeable sessions, and a session reaches another person's repositories.
const secret = process.env.AUTH_SECRET?.trim();
if (!secret) throw new Error('AUTH_SECRET must be set (32+ random characters)');

/** The shape GitHub's /user endpoint returns, as far as the app reads it. */
interface GithubProfile {
  id: number | string;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

export const { auth, signIn, signOut, handlers } = createAuth({
  providers: [
    {
      // Spread the preset and override two fields. `profile`: the built-in
      // mapping drops `login`, and `login` is what the account menu and the
      // seed are keyed on. `scope`: a GitHub App's OAuth grants the App's own
      // permissions and ignores requested scopes, so none are requested.
      ...GitHub(),
      scope: [],
      profile: (p: GithubProfile): GithubIdentity => ({
        id: String(p.id),
        login: p.login,
        name: p.name || p.login,
        email: p.email ?? null,
        image: p.avatar_url ?? null,
      }),
    },
  ],
  secret,
  // A failed sign-in 302s to `${pages.error}?error=<code>`; the login page
  // reads it. Without this the framework sends the failure to `/`, which
  // would look like a successful sign-out.
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    signIn: async ({ user, account }: { user: GithubIdentity; account: { provider: string; accessToken?: string } }) => {
      await upsertGithubUser(user, account.accessToken ?? null);
      return true;
    },
    // `writeSession` seeds the token then calls this with `user` set; every
    // later `readSession` calls it with `user: undefined`. Without the
    // pass-through a read would strip `login` back off the token.
    jwt: async ({ token, user }: { token: Record<string, unknown>; user?: GithubIdentity }) =>
      user ? { ...token, login: user.login } : token,
  },
});
