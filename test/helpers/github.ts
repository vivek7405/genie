// A scripted fake GitHub with the fetch signature, installed through
// setGithubTransport(). REST handlers are keyed "METHOD path" (the path
// without its query string, which lands on the call); GraphQL handlers match
// a substring of the query text. An unmatched request answers 404 with the
// path in the body so a wrong URL fails loudly.
import type { GithubTransport } from '#modules/github/client.server.ts';

export interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  query: string | null;
  headers: Headers;
}

// A handler returns a Response for full control, undefined for a 204, or a
// value that becomes the JSON body of a 200.
export type RestHandler = (call: Call) => unknown;
export type GraphqlHandler = (variables: Record<string, unknown>, call: Call) => unknown;

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function fakeGithub() {
  const calls: Call[] = [];
  const rest = new Map<string, RestHandler>();
  const patterns: { method: string; re: RegExp; handler: (call: Call, match: RegExpMatchArray) => unknown }[] = [];
  const graphql: { match: string; handler: GraphqlHandler }[] = [];

  const transport: GithubTransport = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\//, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const call: Call = { method, path, body, query: u.search ? u.search.slice(1) : null, headers: new Headers(init.headers) };
    calls.push(call);
    if (path === 'graphql' && method === 'POST') {
      const query = String(body?.query ?? '');
      const variables = (body?.variables ?? {}) as Record<string, unknown>;
      const entry = graphql.find((g) => query.includes(g.match));
      if (!entry) return jsonResponse({ errors: [{ message: `fake: no GraphQL handler matches ${query.slice(0, 80)}` }] });
      const out = entry.handler(variables, call);
      return out instanceof Response ? out : jsonResponse({ data: out });
    }
    const handler = rest.get(`${method} ${path}`);
    let out: unknown;
    if (handler) out = handler(call);
    else {
      const entry = patterns.map((p) => ({ p, m: p.method === method ? path.match(p.re) : null })).find((x) => x.m);
      if (!entry) return jsonResponse({ message: `fake: no handler for ${method} ${path}` }, 404);
      out = entry.p.handler(call, entry.m!);
    }
    if (out instanceof Response) return out;
    if (out === undefined) return new Response(null, { status: 204 });
    return jsonResponse(out);
  };

  return {
    transport,
    calls,
    rest,
    graphql,
    on(method: string, path: string, handler: RestHandler) {
      rest.set(`${method.toUpperCase()} ${path.replace(/^\//, '')}`, handler);
      return this;
    },
    // A regex route, consulted after the exact ones. `match` is the path match.
    onMatch(method: string, re: RegExp, handler: (call: Call, match: RegExpMatchArray) => unknown) {
      patterns.push({ method: method.toUpperCase(), re, handler });
      return this;
    },
    onGraphql(match: string, handler: GraphqlHandler) {
      graphql.push({ match, handler });
      return this;
    },
    // The requests so far that hit `path` (any method), for counting.
    hits(path: string) {
      return calls.filter((c) => c.path === path);
    },
    reset() {
      calls.length = 0;
    },
  };
}

export type FakeGithub = ReturnType<typeof fakeGithub>;
