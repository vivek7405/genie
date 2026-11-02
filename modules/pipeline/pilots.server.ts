// Server-only: the Pilots layer. One machine per task, plus the exec and file
// helpers every stage uses.
//
// The rule this file is built around: a credential reaches a machine only as the
// env of ONE buffered exec, never on disk and never on a stream URL. Everything
// that comes back passes through redact().
import { NotFoundError, PilotsClient, type Machine } from '@pilots/sdk';
import { dirname } from 'node:path/posix';
import { randomBytes } from 'node:crypto';
import type { Project, Task } from '#db/schema.server.ts';

const SECRET_ENV_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'PILOT_API_KEY'] as const;

// Blanks every known secret. Longest first, so a value embedding another (the
// insteadOf URL carries the token) never leaves a fragment behind.
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

// Wraps a string for a POSIX shell.
export function shellQuote(s: string): string {
  if (s !== '' && /^[A-Za-z0-9_./:=@%+,-]+$/.test(s)) return s;
  return `'${s.replaceAll("'", "'\\''")}'`;
}

interface PilotsState {
  client: PilotsClient | null;
  injected: PilotsClient | null;
}
// Dev re-imports modules on reload, so the client rides globalThis.
const g = globalThis as unknown as { __genie_pilots?: PilotsState };
const state: PilotsState = (g.__genie_pilots ??= { client: null, injected: null });

export function pilots(): PilotsClient {
  if (state.injected) return state.injected;
  if (state.client) return state.client;
  const key = process.env.PILOT_API_KEY;
  if (!key) throw new Error('PILOT_API_KEY is not set');
  state.client = new PilotsClient(key, { timeoutMs: 60_000 });
  return state.client;
}

// Test seam. null restores the env-built client.
export function setPilotsClient(client: PilotsClient | null): void {
  state.injected = client;
  state.client = null;
}

// genie-<repo>-<id8>, a DNS label under 63 characters.
export function machineNameFor(task: Pick<Task, 'id'>, project: Pick<Project, 'githubRepo'>): string {
  const repoName = project.githubRepo.slice(project.githubRepo.lastIndexOf('/') + 1);
  const trim = (s: string) => s.replace(/^-+|-+$/g, '');
  const slug = trim(trim(repoName.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 40));
  return `genie-${slug || 'repo'}-${task.id.slice(0, 8)}`;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

// One buffered exec. The guest answers 127 when the timeout expires, which is
// also a shell's "command not found", so the elapsed time tells them apart.
export async function execLong(machineId: string, cmd: string, opts: ExecOptions): Promise<ExecResult> {
  const started = Date.now();
  const res = await pilots().machines.exec(machineId, {
    cmd,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: opts.env } : {}),
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

// Writes through a quoted heredoc with a random delimiter, so no byte of the
// content is interpreted and no content line can end the document early.
export async function writeFile(machineId: string, path: string, content: string): Promise<void> {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > WRITE_FILE_MAX_BYTES) throw new Error(`${path} is ${bytes} bytes, over the limit of one exec body`);
  const delimiter = `GENIE_EOF_${randomBytes(12).toString('hex')}`;
  const body = content.endsWith('\n') ? content.slice(0, -1) : content;
  const cmd = `mkdir -p -- ${shellQuote(dirname(path))} && cat > ${shellQuote(path)} <<'${delimiter}'\n${body}\n${delimiter}\n`;
  const res = await execLong(machineId, cmd, { timeoutMs: 30_000 });
  if (res.exitCode !== 0) throw new Error(`Writing ${path} failed (exit ${res.exitCode}): ${res.stderr.trim()}`);
}

// Whether a Pilots service builds from this repository. Only then does the Pilots
// GitHub App ever post a preview, so otherwise there is nothing to wait for.
export async function repoHasService(repo: string): Promise<boolean> {
  return (await pilots().services.list()).some((s) => s.repo === repo);
}

export async function machineUrl(machineId: string): Promise<string> {
  return (await pilots().machines.get(machineId)).url;
}

// Already gone is not an error.
export async function destroyMachine(machineId: string): Promise<void> {
  try {
    await pilots().machines.destroy(machineId);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }
}

export interface TaskMachine {
  id: string;
  name: string;
}

export const MACHINE_MEM_MIB = 2048;
const IDLE_TIMEOUT_S = 3600;

const pick = (m: Machine): TaskMachine => ({ id: m.id, name: m.name });

// A plain machine at the working size. Create records the size; the resize is
// what boots the guest with that memory.
export async function createPlainMachine(name: string, labels: Record<string, string>): Promise<TaskMachine> {
  const created = await pilots().machines.create({ name, mem_mib: MACHINE_MEM_MIB, knobs: { idle_timeout: IDLE_TIMEOUT_S }, labels });
  await pilots().machines.resize(created.id, { mem_mib: MACHINE_MEM_MIB });
  return pick(created);
}

// The machine a task runs in. A retry after a crash finds the one it already had
// by name. Otherwise a restore of the base template, or a plain machine that
// installs its own tools when the template cannot be had. If Pilots is refusing
// machines outright (a quota, say), the plain create throws its message for the card.
export async function createTaskMachine(task: Pick<Task, 'id'>, project: Pick<Project, 'githubRepo'>): Promise<TaskMachine> {
  const name = machineNameFor(task, project);
  const existing = (await pilots().machines.list()).find((m) => m.name === name && m.state !== 'destroyed');
  if (existing) return pick(existing);
  const labels = { genie: '1', genie_task: task.id };
  // Dynamic on purpose: base-image imports the exec helpers from this file.
  const base = await import('./base-image.server.ts');
  let template: string | null = null;
  try {
    template = await base.ensureTemplate();
  } catch (err) {
    console.warn(`[genie] no base template, building ${name} from scratch: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (template) {
    try {
      return pick(await pilots().machines.create({ name, template, labels }));
    } catch (err) {
      console.warn(`[genie] template create failed, building ${name} from scratch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const machine = await createPlainMachine(name, labels);
  await base.provision(machine.id);
  return machine;
}
