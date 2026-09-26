// Server-only: the pilots layer. One machine per task, forked from the live
// genie-base checkpoint, plus the exec and file helpers every stage uses.
//
// Secrets hygiene, the rule this whole file is built around: a credential
// (CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, the git insteadOf value) reaches a
// machine only as the `env` of ONE buffered exec. Nothing here logs an env,
// writes one to the machine's disk, or puts one on an execStream URL (that
// route carries env in the query string). Every stdout and stderr that comes
// back is passed through redact() before it is returned or thrown.
import { NotFoundError, PilotsClient, QuotaExceededError, type Machine } from '@pilots/sdk';
import { basename, dirname } from 'node:path/posix';
import { randomBytes } from 'node:crypto';
import type { Project, Task } from '#db/schema.server.ts';
import { parseTar } from './tar.server.ts';

// The environment variables whose values must never appear in a recorded line.
const SECRET_ENV_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'PILOT_API_KEY'] as const;

// Replaces every known secret value (the three env secrets plus `extra`, the
// values of an exec's env) with [redacted]. Longest first, so a value that
// embeds another (the insteadOf URL carries the token) is blanked whole before
// the shorter one can leave a fragment behind. Plain string replace, no regex.
export function redact(text: string, extra: readonly string[] = []): string {
  const values = new Set<string>();
  for (const key of SECRET_ENV_KEYS) {
    const v = process.env[key];
    if (v) values.add(v);
  }
  for (const v of extra) if (v) values.add(v);
  if (values.size === 0 || !text) return text;
  let out = text;
  for (const v of [...values].sort((a, b) => b.length - a.length)) out = out.replaceAll(v, '[redacted]');
  return out;
}

// Wraps a string for a POSIX shell. A string made only of characters no shell
// interprets is returned as is, so a command reads naturally in a log; every
// other string is single-quoted with the '\'' escape.
export function shellQuote(s: string): string {
  if (s !== '' && /^[A-Za-z0-9_./:=@%+,-]+$/.test(s)) return s;
  return `'${s.replaceAll("'", "'\\''")}'`;
}

// The client. A lazy singleton from PILOT_API_KEY, or whatever a test injected
// through setPilotsClient(). Dev re-imports modules on reload, so both ride
// globalThis.
interface PilotsState {
  client: PilotsClient | null;
  injected: PilotsClient | null;
}
const g = globalThis as unknown as { __genie_pilots?: PilotsState };
const state: PilotsState = (g.__genie_pilots ??= { client: null, injected: null });

export function pilots(): PilotsClient {
  if (state.injected) return state.injected;
  if (state.client) return state.client;
  const key = process.env.PILOT_API_KEY;
  if (!key) throw new Error('PILOT_API_KEY is not set');
  // A create or a fork can take a while. The SDK reads PILOT_API_URL itself.
  state.client = new PilotsClient(key, { timeoutMs: 60_000 });
  return state.client;
}

// The test seam. null restores the env-built singleton.
export function setPilotsClient(client: PilotsClient | null): void {
  state.injected = client;
  state.client = null;
}

// genie-<slug>-<id8>: a DNS label under 63 characters that never starts with
// a digit-hyphen prefix, because of the fixed genie- prefix.
export function machineNameFor(task: Pick<Task, 'id'>, project: Pick<Project, 'githubRepo'>): string {
  const repoName = project.githubRepo.slice(project.githubRepo.lastIndexOf('/') + 1);
  const trim = (s: string) => s.replace(/^-+|-+$/g, '');
  const slug = trim(trim(repoName.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 40));
  const id8 = task.id.slice(0, 8);
  return `genie-${slug || 'repo'}-${id8}`;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  user?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

// One buffered exec with an explicit timeout. The guest answers 127 when the
// timeout expires, which is also a shell's "command not found", so the elapsed
// time is what tells the two apart. `env` is never logged.
export async function execLong(machineId: string, cmd: string, opts: ExecOptions): Promise<ExecResult> {
  const started = Date.now();
  const res = await pilots().machines.exec(machineId, {
    cmd,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.user ? { user: opts.user } : {}),
    timeout_ms: opts.timeoutMs,
  });
  const durationMs = Date.now() - started;
  const secrets = Object.values(opts.env ?? {});
  return {
    stdout: redact(res.stdout, secrets),
    stderr: redact(res.stderr, secrets),
    exitCode: res.exit_code,
    timedOut: res.exit_code === 127 && durationMs >= opts.timeoutMs,
    durationMs,
  };
}

// The guest caps an exec body at 1 MiB; this leaves room for the command.
const WRITE_FILE_MAX_BYTES = 900 * 1024;

// Writes `content` to `path` through a quoted heredoc with a per-call random
// delimiter, so no byte of the content is interpreted by the shell and no
// content line can end the document early. The file always ends with one
// newline, which is what a heredoc produces.
export async function writeFile(machineId: string, path: string, content: string): Promise<void> {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > WRITE_FILE_MAX_BYTES) {
    throw new Error(`writeFile: ${path} is ${bytes} bytes, over the ${WRITE_FILE_MAX_BYTES} byte limit of one exec body`);
  }
  const delimiter = `GENIE_EOF_${randomBytes(12).toString('hex')}`;
  const body = content.endsWith('\n') ? content.slice(0, -1) : content;
  const cmd = `mkdir -p -- ${shellQuote(dirname(path))} && cat > ${shellQuote(path)} <<'${delimiter}'\n${body}\n${delimiter}\n`;
  const res = await execLong(machineId, cmd, { timeoutMs: 30_000 });
  if (res.exitCode !== 0) throw new Error(`writeFile ${path} failed (exit ${res.exitCode}): ${res.stderr.trim()}`);
}

// Reads a file as UTF-8. base64 on the way out survives any byte.
export async function readFile(machineId: string, path: string): Promise<string> {
  const res = await execLong(machineId, `base64 -w0 -- ${shellQuote(path)}`, { timeoutMs: 60_000 });
  if (res.exitCode !== 0) throw new Error(`readFile ${path} failed (exit ${res.exitCode}): ${res.stderr.trim()}`);
  return Buffer.from(res.stdout.trim(), 'base64').toString('utf8');
}

// Pulls a directory out of the machine as a tar over the exec stream (no env
// ever rides this route) and returns its regular files keyed by their path
// relative to `dir`. Symlinks are skipped, directories are not listed.
export async function pullTree(machineId: string, dir: string): Promise<Map<string, Buffer>> {
  const parent = dirname(dir);
  const base = basename(dir);
  const stream = pilots().machines.execStream(
    machineId,
    ['sh', '-c', `cd ${shellQuote(parent)} && tar -c -- ${shellQuote(base)}`],
    { stdin: false },
  );
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  stream.stdout.on('data', (chunk: Buffer) => out.push(chunk));
  stream.stderr.on('data', (chunk: Buffer) => err.push(chunk));
  const code = await stream.wait();
  if (code !== 0) {
    throw new Error(`pullTree ${dir} failed (tar exited ${code}): ${redact(Buffer.concat(err).toString('utf8')).trim()}`);
  }
  const files = new Map<string, Buffer>();
  for (const [name, data] of parseTar(Buffer.concat(out))) {
    const rel = name === base ? '' : name.startsWith(`${base}/`) ? name.slice(base.length + 1) : name;
    if (rel) files.set(rel, data);
  }
  return files;
}

export async function checkpointMachine(machineId: string, comment: string): Promise<string> {
  const ck = await pilots().machines.checkpoint(machineId, { comment });
  return ck.id;
}

// Already gone is not an error.
export async function destroyMachine(machineId: string): Promise<void> {
  try {
    await pilots().machines.destroy(machineId);
  } catch (err) {
    if (err instanceof NotFoundError) return;
    throw err;
  }
}

export interface TaskMachine {
  id: string;
  name: string;
  url: string;
}

const TASK_MACHINE_MEM_MIB = 2048;

interface ForkResponse {
  forks: Array<{ machine?: Machine; error?: string }>;
}

async function forkCheckpoint(checkpointId: string, name: string): Promise<TaskMachine> {
  const res = await pilots().http.json<ForkResponse>('POST', `/v1/checkpoints/${encodeURIComponent(checkpointId)}/fork`, {
    body: { name },
    timeoutMs: null,
  });
  const entry = res.forks?.[0];
  if (!entry?.machine) throw new Error(`fork of checkpoint ${checkpointId} failed: ${entry?.error ?? 'no machine in the response'}`);
  return pick(entry.machine);
}

function pick(m: Machine): TaskMachine {
  return { id: m.id, name: m.name, url: m.url };
}

function quotaError(err: QuotaExceededError): Error {
  return new Error(`pilots machine quota reached (${err.limit}). Destroy finished task machines and retry.`);
}

// The machine a task runs in. A retry after a crash finds the machine it
// already had by name. Otherwise a fork of the base checkpoint (the machine
// comes up with git, gh, Claude Code and the webjs CLIs already installed),
// rebuilt once when the checkpoint has gone missing. A fork that fails for any
// other reason, or GENIE_PILOTS_FORK=0, falls back to a plain create and one
// launcher run to install Claude Code. A fork carries no knobs and no labels,
// so tasks.machineId and tasks.machineName are the join keys for cleanup.
export async function createTaskMachine(task: Pick<Task, 'id'>, project: Pick<Project, 'githubRepo'>): Promise<TaskMachine> {
  const client = pilots();
  const name = machineNameFor(task, project);
  const existing = (await client.machines.list()).find((m) => m.name === name && m.state !== 'destroyed');
  if (existing) return pick(existing);

  if (process.env.GENIE_PILOTS_FORK !== '0') {
    // Dynamic on purpose: base-image imports the exec helpers from this file.
    const base = await import('./base-image.server.ts');
    try {
      return await forkCheckpoint(await base.ensureBaseCheckpoint(), name);
    } catch (err) {
      if (err instanceof QuotaExceededError) throw quotaError(err);
      if (err instanceof NotFoundError) {
        await base.clearBaseCheckpoint();
        try {
          return await forkCheckpoint(await base.ensureBaseCheckpoint(), name);
        } catch (again) {
          if (again instanceof QuotaExceededError) throw quotaError(again);
          console.warn(`genie: fork of the rebuilt base failed, creating ${name} from scratch: ${again instanceof Error ? again.message : String(again)}`);
        }
      } else {
        console.warn(`genie: fork failed, creating ${name} from scratch: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  let created: Machine;
  try {
    created = await client.machines.create({
      name,
      mem_mib: TASK_MACHINE_MEM_MIB,
      knobs: { idle_timeout: 3600 },
      labels: { genie_task: task.id, genie: '1' },
    });
  } catch (err) {
    if (err instanceof QuotaExceededError) throw quotaError(err);
    throw err;
  }
  // A template create records the size but boots the template's; the resize
  // is what boots the machine at 2048 MiB.
  await client.machines.resize(created.id, { mem_mib: TASK_MACHINE_MEM_MIB });
  const { claudeCommand } = await import('./claude.server.ts');
  const install = await execLong(created.id, claudeCommand(['--version']), { timeoutMs: 600_000 });
  if (install.exitCode !== 0) throw new Error(`Claude Code install on ${name} failed (exit ${install.exitCode}): ${install.stderr.trim()}`);
  return pick(created);
}
