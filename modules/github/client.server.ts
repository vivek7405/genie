// Server-only: the one place genie speaks HTTP to GitHub. REST for everything,
// GraphQL only for Projects v2 (the budget rule in issue #2). A test installs a
// transport with setGithubTransport() and no token is needed or read.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export type GithubTransport = (url: string, init: RequestInit) => Promise<Response>;

export class GithubError extends Error {
  status: number;
  resetAt: Date | null;
  constructor(message: string, status: number, resetAt: Date | null = null) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
    this.resetAt = resetAt;
  }
}

interface ClientState { transport: GithubTransport | null; token: string | null }
// Dev re-imports modules on reload; the override and the token cache ride
// globalThis so one copy survives, the same trick worker.server.ts uses.
const g = globalThis as unknown as { __genie_github?: ClientState };
const state: ClientState = (g.__genie_github ??= { transport: null, token: null });

export function setGithubTransport(transport: GithubTransport | null): void {
  state.transport = transport;
}

async function resolveToken(): Promise<string> {
  if (state.token) return state.token;
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv) return (state.token = fromEnv);
  try {
    // A gh wrapper on PATH may print a banner first, so take the last line.
    const { stdout } = await promisify(execFile)('gh', ['auth', 'token']);
    const last = stdout.trim().split('\n').pop() ?? '';
    if (last) return (state.token = last);
  } catch {
    // gh missing or logged out: fall through to the error below.
  }
  throw new GithubError('No GitHub token. Set GH_TOKEN or run `gh auth login`.', 401);
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', API_VERSION);
  headers.set('User-Agent', 'genie');
  if (!state.transport) headers.set('Authorization', `Bearer ${await resolveToken()}`);
  const res = await (state.transport ?? fetch)(url, { ...init, headers });
  if (res.ok) return res;
  const reset = res.headers.get('x-ratelimit-reset');
  const text = await res.text().catch(() => '');
  throw new GithubError(
    `GitHub ${init.method ?? 'GET'} ${url.replace(API, '')} failed with ${res.status}: ${text.slice(0, 300)}`,
    res.status,
    reset ? new Date(Number(reset) * 1000) : null,
  );
}

export interface ApiInit { method?: string; body?: unknown }

// REST. `path` is relative to api.github.com ("repos/o/r/issues"). A JSON body
// is serialized here so callers pass plain objects. 204 resolves to undefined.
export async function ghApi<T>(path: string, init: ApiInit = {}): Promise<T> {
  const url = path.startsWith('https://') ? path : `${API}/${path.replace(/^\//, '')}`;
  const res = await request(url, { method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface GraphqlPayload<T> { data?: T; errors?: { type?: string; message: string }[] }

// GraphQL, for Projects v2 only. GitHub answers 200 with an `errors` array on
// a bad query or a missing scope, so that array is turned into a GithubError.
export async function ghGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await request(`${API}/graphql`, { method: 'POST', body: JSON.stringify({ query, variables }) });
  const payload = (await res.json()) as GraphqlPayload<T>;
  if (payload.errors?.length) {
    const denied = payload.errors.some((e) => e.type === 'INSUFFICIENT_SCOPES' || e.type === 'FORBIDDEN');
    throw new GithubError(payload.errors.map((e) => e.message).join(', '), denied ? 403 : 400);
  }
  if (!payload.data) throw new GithubError('GraphQL returned no data.', 500);
  return payload.data;
}

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
