// A real PilotsClient over a fake fetch (and a fake WebSocket for the exec
// stream), so tests assert the SDK's actual request shapes: method, path and
// JSON body. Responses come from a queue; an empty queue is a test bug and
// fails loudly with a 599.
import { PilotsClient } from '@pilots/sdk';

export interface FakeCall {
  method: string;
  url: URL;
  path: string;
  body: unknown;
}

interface Canned {
  status: number;
  json: unknown;
}

export interface StreamScript {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
  exitCode?: number;
}

export interface FakePilots {
  client: PilotsClient;
  calls: FakeCall[];
  streams: URL[];
  respond(status: number, json?: unknown): void;
  respondStream(script: StreamScript): void;
}

function frame(id: number, payload: Buffer): ArrayBuffer {
  const bytes = new Uint8Array(payload.length + 1);
  bytes[0] = id;
  bytes.set(payload, 1);
  return bytes.buffer;
}

export function fakePilots(): FakePilots {
  const calls: FakeCall[] = [];
  const streams: URL[] = [];
  const queue: Canned[] = [];
  const streamQueue: StreamScript[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const raw = init?.body;
    const body = typeof raw === 'string' ? JSON.parse(raw) : undefined;
    calls.push({ method: init?.method ?? 'GET', url, path: url.pathname, body });
    const next = queue.shift();
    if (!next) {
      return new Response(JSON.stringify({ error: `no canned response for ${init?.method} ${url.pathname}` }), { status: 599 });
    }
    if (next.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status, headers: { 'content-type': 'application/json' } });
  };

  // Enough of a WebSocket for ExecStream: open, the scripted frames, close.
  class FakeWebSocket extends EventTarget {
    binaryType = 'arraybuffer';
    closed = false;
    constructor(url: string | URL) {
      super();
      streams.push(new URL(url));
      const script = streamQueue.shift() ?? { exitCode: 0 };
      queueMicrotask(() => {
        this.dispatchEvent(new Event('open'));
        const out = script.stdout === undefined ? Buffer.alloc(0) : Buffer.from(script.stdout);
        const err = script.stderr === undefined ? Buffer.alloc(0) : Buffer.from(script.stderr);
        if (out.length) this.dispatchEvent(new MessageEvent('message', { data: frame(1, out) }));
        if (err.length) this.dispatchEvent(new MessageEvent('message', { data: frame(2, err) }));
        this.dispatchEvent(new MessageEvent('message', { data: frame(3, Buffer.from([script.exitCode ?? 0])) }));
        this.close();
      });
    }
    send(): void {}
    close(): void {
      if (this.closed) return;
      this.closed = true;
      this.dispatchEvent(new Event('close'));
    }
  }

  const client = new PilotsClient('test-key', {
    fetch,
    baseURL: 'https://pilots.test',
    WebSocket: FakeWebSocket as unknown as NonNullable<ConstructorParameters<typeof PilotsClient>[1]>['WebSocket'],
  });
  return {
    client,
    calls,
    streams,
    respond: (status, json) => { queue.push({ status, json }); },
    respondStream: (script) => { streamQueue.push(script); },
  };
}

// A canned exec answer, in the guest's own shape.
export function execResponse(stdout = '', exitCode = 0, stderr = ''): { stdout: string; stderr: string; exit_code: number } {
  return { stdout, stderr, exit_code: exitCode };
}
