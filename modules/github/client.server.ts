// Server-only: GitHub REST with the operator's GH_TOKEN. The one place a GitHub
// request is made from this server, and a test seam for the rest of the app.
export class GithubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
  }
}

export interface GhOptions {
  method?: string;
  body?: Record<string, string | number | boolean>;
}

type GhFetch = (url: string, init: RequestInit) => Promise<Response>;
let transport: GhFetch = (url, init) => fetch(url, init);

// Test seam: null restores the real fetch.
export function setGithubTransport(fn: GhFetch | null): void {
  transport = fn ?? ((url, init) => fetch(url, init));
}

export async function ghApi<T>(path: string, opts: GhOptions = {}): Promise<T> {
  const token = process.env.GH_TOKEN;
  if (!token) throw new GithubError('GH_TOKEN is not set.', 500);
  const res = await transport(`https://api.github.com/${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = await res.json().then((b: { message?: string }) => b.message ?? '').catch(() => '');
    throw new GithubError(detail || `GitHub answered ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
