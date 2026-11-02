// Server-only: the genie-base template. Task machines restore from it, so they
// come up with git, gh and Claude Code installed instead of paying the install
// per task. Suspended or not, a template costs nothing to keep.
import { NotFoundError } from '@pilots/sdk';
import { claudeCommand } from './claude.server.ts';
import { createPlainMachine, destroyMachine, execLong, MACHINE_MEM_MIB, pilots } from './pilots.server.ts';

export const TEMPLATE_NAME = 'genie-base';
const BUILDER_NAME = 'genie-base-builder';
const STEP_TIMEOUT_MS = 600_000;

export const PROVISION_STEPS: readonly string[] = [
  'command -v git >/dev/null && command -v gh >/dev/null || (sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git gh)',
  claudeCommand(['--version']),
  'mkdir -p /home/pilot/.genie',
];

export async function provision(machineId: string): Promise<void> {
  for (const step of PROVISION_STEPS) {
    const res = await execLong(machineId, step, { timeoutMs: STEP_TIMEOUT_MS });
    if (res.exitCode !== 0) {
      const label = step.startsWith('sh -c') ? 'installing Claude Code' : step;
      throw new Error(`Machine setup failed (exit ${res.exitCode}) on ${label}: ${res.stderr.trim().slice(-1000)}`);
    }
  }
}

async function build(): Promise<string> {
  try {
    return (await pilots().templates.get(TEMPLATE_NAME)).name;
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }
  // A builder left by an interrupted build holds a half-done install: start over.
  const stale = (await pilots().machines.list()).find((m) => m.name === BUILDER_NAME && m.state !== 'destroyed');
  if (stale) await destroyMachine(stale.id);
  const builder = await createPlainMachine(BUILDER_NAME, { genie: '1' });
  try {
    await provision(builder.id);
    const template = await pilots().templates.create({ name: TEMPLATE_NAME, from_machine: builder.id, labels: { genie: '1' } });
    if (template.mem_mib < MACHINE_MEM_MIB) console.warn(`[genie] template has ${template.mem_mib} MiB`);
    return template.name;
  } finally {
    await destroyMachine(builder.id).catch(() => undefined);
  }
}

// One build at a time in this process, across dev reloads: two tasks starting
// together must not build two templates.
const g = globalThis as unknown as { __genie_base_build?: Promise<string> | null };

export function ensureTemplate(): Promise<string> {
  g.__genie_base_build ??= build().finally(() => { g.__genie_base_build = null; });
  return g.__genie_base_build;
}
