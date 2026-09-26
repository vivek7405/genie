// Browser-safe auth types. No runtime import from a `.server.ts` file, so a
// shipping component may import from here.

/** The identity the GitHub provider's `profile` mapping produces. */
export interface GithubIdentity {
  /** GitHub's numeric user id, as a string. Stable across renames. */
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * The session user. Augmenting `AuthUser` types every `auth()` call in the
 * app at once. `id` is GitHub's numeric id as a string, because that is what
 * the provider's `profile` mapping produces and what `users.github_id`
 * stores; `login` rides the JWT through the `jwt` callback.
 */
declare module '@webjsdev/server' {
  interface AuthUser {
    id: string;
    login: string;
    name: string | null;
    email: string | null;
    image: string | null;
  }
}
