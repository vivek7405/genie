// Browser-safe auth types.
export interface GithubIdentity {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

declare module '@webjsdev/server' {
  interface AuthUser {
    id: string;
    login: string;
    name: string | null;
    email: string | null;
    image: string | null;
  }
}
