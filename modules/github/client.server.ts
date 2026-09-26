// Server-only: the one place genie speaks HTTP to GitHub. REST for everything,
// GraphQL only for Projects v2 (the budget rule in issue #2). A test installs a
// transport with setGithubTransport() and no token is needed or read.
//
// Every call names the credential it acts with (a TokenSource): the GitHub
// App's installation token for a project's repository, the signed-in user's
// own token for the reads GitHub only answers per person (their
// installations, repositories and boards), or the App JWT for the App's own
// endpoints. When no App is configured (GITHUB_APP_ID and
// GITHUB_APP_PRIVATE_KEY unset) every source falls back to the operator's
// GH_TOKEN or `gh auth token`, which keeps the single-operator setup and the
// local demo alive. The App JWT and the installation-token cache live here
// rather than in app.server.ts because the mint is itself an HTTP call
// through this transport; app.server.ts re-exports them.
import { execFile } from 'node:child_process';
import { createSign } from 'node:crypto';
import { promisify } from 'node:util';
import type { Project, User } from '#db/schema.server.ts';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
// An App JWT is good for ten minutes at most. Backdated a minute because
// GitHub rejects an `iat` in its own future and a host clock may run ahead.
const JWT_TTL_S = 600;
const JWT_BACKDATE_S = 60;
// An installation token lives an hour. One with less than this left is
// minted again rather than handed to a stage that may use it for a while.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

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

// Which credential a call acts with. `installation` is the default for
// anything about a project's repository or board; `user` is for what GitHub
// answers per signed-in person; `app` is the App's own endpoints.
export type TokenSource =
  | { token: 'installation'; project: Pick<Project, 'installationId'> }
  | { token: 'user'; user: Pick<User, 'accessToken' | 'login'> }
  | { token: 'app' };

export const viaInstallation = (project: Pick<Project, 'installationId'>): TokenSource => ({ token: 'installation', project });
export const viaUser = (user: Pick<User, 'accessToken' | 'login'>): TokenSource => ({ token: 'user', user });

interface CachedToken { token: string; expiresAt: number }
interface ClientState { transport: GithubTransport | null; token: string | null; installations: Map<number, CachedToken>; ownerLogin?: string | null }
// Dev re-imports modules on reload; the override and the token caches ride
// globalThis so one copy survives, the same trick worker.server.ts uses.
const g = globalThis as unknown as { __genie_github?: ClientState };
const state: ClientState = (g.__genie_github ??= { transport: null, token: null, installations: new Map() });

export function setGithubTransport(transport: GithubTransport | null): void {
  state.transport = transport;
}

// Whether this server has a GitHub App to act as. Without one, every call
// uses the operator token below.
export function githubAppConfigured(): boolean {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
}

// The private key as GitHub hands it out, accepted with literal newlines or
// the `\n` escapes a one-line env file needs.
function privateKey(): string {
  return (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
}

const base64url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

// The App JWT: RS256, `iss` the App id, ten minutes. Signed fresh per call;
// signing is cheap and a cached one would only add an expiry to reason about.
export function appJwt(now = Math.floor(Date.now() / 1000)): string {
  const appId = process.env.GITHUB_APP_ID;
  const key = privateKey();
  if (!appId || !key) throw new GithubError('The GitHub App is not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.', 500);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - JWT_BACKDATE_S, exp: now + JWT_TTL_S, iss: appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(key, 'base64url')}`;
}

// The installation token for one installation, minted with the App JWT and
// cached in memory until five minutes before it expires. Never written
// anywhere: a machine sees it only as the env of one exec.
export async function installationToken(installationId: number): Promise<string> {
  const cached = state.installations.get(installationId);
  if (cached && cached.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS) return cached.token;
  const res = await request(`${API}/app/installations/${installationId}/access_tokens`, { method: 'POST' }, appJwt());
  const body = (await res.json()) as { token?: string; expires_at?: string };
  if (!body.token) throw new GithubError(`GitHub minted no token for installation ${installationId}.`, 502);
  const expiresAt = body.expires_at ? Date.parse(body.expires_at) : Date.now() + 3_600_000;
  state.installations.set(installationId, { token: body.token, expiresAt });
  return body.token;
}

// The installation tokens minted so far and still held, for redact(): a
// line that came back from a machine must not carry one.
export function activeInstallationTokens(): string[] {
  return [...state.installations.values()].map((c) => c.token);
}

// Test seam: drop every cached token.
export function forgetInstallationTokens(): void {
  state.installations.clear();
}

// The operator's own token: GH_TOKEN, else what `gh auth login` stored.
async function operatorToken(): Promise<string> {
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

// The bearer for a call, or null when a test transport stands in for GitHub
// and the call would have used the operator token (no token is read then).
// A project connected before the App existed has no installation and keeps
// using the operator token, so it still works after the App arrives.
async function resolveAuth(source: TokenSource | undefined): Promise<string | null> {
  if (source?.token === 'app') return appJwt();
  if (source && githubAppConfigured()) {
    if (source.token === 'installation' && source.project.installationId != null) return installationToken(source.project.installationId);
    if (source.token === 'user') {
      if (!source.user.accessToken) throw new GithubError('Your GitHub sign-in carries no token. Sign out and in again.', 401);
      return source.user.accessToken;
    }
  }
  if (state.transport) return null;
  return operatorToken();
}

async function request(url: string, init: RequestInit, bearer: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', API_VERSION);
  headers.set('User-Agent', 'genie');
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
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

export interface ApiInit { method?: string; body?: unknown; auth?: TokenSource }

// REST. `path` is relative to api.github.com ("repos/o/r/issues"). A JSON body
// is serialized here so callers pass plain objects. 204 resolves to undefined.
export async function ghApi<T>(path: string, init: ApiInit = {}): Promise<T> {
  const url = path.startsWith('https://') ? path : `${API}/${path.replace(/^\//, '')}`;
  const res = await request(url, { method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.stringify(init.body) }, await resolveAuth(init.auth));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface GraphqlPayload<T> { data?: T; errors?: { type?: string; message: string }[] }

export interface GraphqlInit { auth?: TokenSource }

// GraphQL, for Projects v2 only. GitHub answers 200 with an `errors` array on
// a bad query or a missing scope, so that array is turned into a GithubError.
export async function ghGraphql<T>(query: string, variables: Record<string, unknown> = {}, init: GraphqlInit = {}): Promise<T> {
  const res = await request(`${API}/graphql`, { method: 'POST', body: JSON.stringify({ query, variables }) }, await resolveAuth(init.auth));
  let payload = (await res.json()) as GraphqlPayload<T>;
  if (payload.errors?.length && init.auth?.token === 'user' && payload.errors.every((e) => NOT_FOR_APPS.test(e.message))) {
    // GitHub Apps have no permission that reaches a PERSON's own Projects v2
    // boards (only an organisation's), so a sign-in token is refused there
    // with "Resource not accessible by integration". The deployment's own
    // token (GH_TOKEN) can read them when it belongs to the same GitHub login
    // as the person signed in, and only then: one person, one account.
    const own = await ownTokenFor(init.auth.user.login);
    if (own) {
      const retry = await request(`${API}/graphql`, { method: 'POST', body: JSON.stringify({ query, variables }) }, own);
      payload = (await retry.json()) as GraphqlPayload<T>;
    }
  }
  if (payload.errors?.length) {
    const denied = payload.errors.some((e) => e.type === 'INSUFFICIENT_SCOPES' || e.type === 'FORBIDDEN');
    throw new GithubError(payload.errors.map((e) => e.message).join(', '), denied ? 403 : 400);
  }
  if (!payload.data) throw new GithubError('GraphQL returned no data.', 500);
  return payload.data;
}

const NOT_FOR_APPS = /Resource not accessible by integration/i;

// GH_TOKEN when it is the signed-in person's own token, else null. Only the
// environment counts, never the gh CLI: a server has none, and a test must
// not pick up a developer's login by accident. The token's login is read once.
async function ownTokenFor(login: string): Promise<string | null> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return null;
  if (state.ownerLogin === undefined) {
    try {
      const res = await request(`${API}/user`, { method: 'GET' }, state.transport ? null : token);
      state.ownerLogin = ((await res.json()) as { login?: string }).login ?? null;
    } catch {
      state.ownerLogin = null;
    }
  }
  return state.ownerLogin && state.ownerLogin.toLowerCase() === login.toLowerCase() ? token : null;
}

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
