// Server-only: the genie-base machine and its checkpoint. Task machines are
// forks of that checkpoint, so they come up with git, gh, Claude Code and the
// webjs CLIs already installed instead of paying the install per task.
//
// The base machine is NEVER destroyed: destroying a machine deletes its
// checkpoints, and a fork needs the checkpoint's machine alive. Suspended, it
// costs nothing.
import { NotFoundError } from '@pilots/sdk';
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { settings } from '#db/schema.server.ts';
import { claudeCommand } from './claude.server.ts';
import { checkpointMachine, destroyMachine, execLong, pilots } from './pilots.server.ts';

export const BASE_MACHINE_NAME = 'genie-base';
export const BASE_CHECKPOINT_KEY = 'base_checkpoint_id';
const BASE_MEM_MIB = 2048;
const STEP_TIMEOUT_MS = 600_000;
const DURABLE_POLL_MS = 5_000;
const DURABLE_CAP_MS = 5 * 60_000;

// The provisioning steps, in order. Each runs as the pilot user with no env.
export const BASE_PROVISION_STEPS: readonly string[] = [
  'sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git gh',
  'git config --global user.name genie && git config --global user.email genie@users.noreply.github.com',
  claudeCommand(['--version']),
  'export PATH="$HOME/.npm-global/bin:$PATH" && npm install -g create-webjs webjsdev',
  'mkdir -p /home/pilot/.genie',
];

async function readSetting(key: string): Promise<string | null> {
  const row = await db.query.settings.findFirst({ where: { key } });
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function clearBaseCheckpoint(): Promise<void> {
  await db.delete(settings).where(eq(settings.key, BASE_CHECKPOINT_KEY));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// One in-flight build at a time, across every caller in this process: two
// tasks starting together must not build two bases. Rides globalThis so a
// dev reload does not start a second one.
const g = globalThis as unknown as { __genie_base_build?: Promise<string> | null };

export function ensureBaseCheckpoint(): Promise<string> {
  if (g.__genie_base_build) return g.__genie_base_build;
  const build = ensure().finally(() => { g.__genie_base_build = null; });
  g.__genie_base_build = build;
  return build;
}

async function ensure(): Promise<string> {
  const client = pilots();
  const stored = await readSetting(BASE_CHECKPOINT_KEY);
  if (stored) {
    try {
      await client.checkpoints.get(stored);
      return stored;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      await clearBaseCheckpoint();
    }
  }

  // A base with no recorded checkpoint is half-built: start over.
  const stale = (await client.machines.list()).find((m) => m.name === BASE_MACHINE_NAME && m.state !== 'destroyed');
  if (stale) await destroyMachine(stale.id);

  const machine = await client.machines.create({
    name: BASE_MACHINE_NAME,
    knobs: { idle_timeout: 3600 },
    labels: { genie_base: '1' },
  });
  // Created at the template's size and then resized: a template create
  // records the size but boots the template's, and the resize is the boot
  // that gives the guest the memory.
  await client.machines.resize(machine.id, { mem_mib: BASE_MEM_MIB });

  for (const step of BASE_PROVISION_STEPS) {
    const res = await execLong(machine.id, step, { timeoutMs: STEP_TIMEOUT_MS });
    if (res.exitCode !== 0) {
      const label = step.startsWith('sh -c') ? 'claude --version (install)' : step;
      throw new Error(`base image step failed (exit ${res.exitCode}): ${label}\n${res.stderr.trim().slice(-2000)}`);
    }
  }

  const checkpointId = await checkpointMachine(machine.id, `genie base ${new Date().toISOString()}`);
  const started = Date.now();
  for (;;) {
    const ck = await client.checkpoints.get(checkpointId);
    if (ck.durable) break;
    if (Date.now() - started >= DURABLE_CAP_MS) {
      console.warn(`genie: checkpoint ${checkpointId} is not durable yet after 5 minutes; a same-host fork works before the upload lands`);
      break;
    }
    await sleep(DURABLE_POLL_MS);
  }
  await writeSetting(BASE_CHECKPOINT_KEY, checkpointId);
  return checkpointId;
}

// Throws the stored checkpoint away, destroys genie-base and builds it again.
// The smoke script's --rebuild-base and, later, an admin command.
export async function rebuildBaseCheckpoint(): Promise<string> {
  await clearBaseCheckpoint();
  const base = (await pilots().machines.list()).find((m) => m.name === BASE_MACHINE_NAME && m.state !== 'destroyed');
  if (base) await destroyMachine(base.id);
  return ensureBaseCheckpoint();
}
