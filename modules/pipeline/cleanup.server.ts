// Server-only: the machine sweep. Every task gets a 2048 MiB machine and the
// org quota is 20 by default, so machines that are done or long failed have
// to go. The decision (planCleanup) is pure and unit-tested with no client;
// the side effects (runCleanup) are the destroy calls, the task columns and
// the feed lines.
//
// The join from a machine to its task is tasks.machineId, then
// tasks.machineName. Never a label: task machines are forks of the base
// checkpoint and a fork carries no labels. genie-base is kept by label or by
// name, because destroying it deletes the checkpoint every task forks from.
import { NotFoundError, type Machine } from '@pilots/sdk';
import { eq, isNotNull, or } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import type { Task } from '#modules/tasks/types.ts';
import { BASE_MACHINE_NAME } from './base-image.server.ts';
import { recordEvent } from './events.server.ts';

export const DEFAULT_CLEANUP_DAYS = 3;
export const DEFAULT_MACHINE_QUOTA = 20;
const DAY_MS = 24 * 60 * 60_000;

export interface CleanupDecision {
  machine: Machine;
  task: Task | null;
  action: 'destroy' | 'keep';
  reason: string;
}

// The part of the SDK client the sweep uses. A test passes a plain object.
export interface CleanupClient {
  machines: {
    list(): Promise<Machine[]>;
    destroy(id: string): Promise<void>;
  };
}

// pilots timestamps are unix seconds; a millisecond value is tolerated so a
// fixture or a future API change cannot make every machine look ancient.
function epochMs(value: number): number {
  return value < 1e12 ? value * 1000 : value;
}

function isBase(machine: Machine): boolean {
  return machine.labels?.genie_base === '1' || machine.name === BASE_MACHINE_NAME;
}

// One decision per live machine, in the order the rules are documented.
// Destroyed tombstones are dropped before anything is counted.
export function planCleanup(machines: Machine[], rows: Task[], opts: { now: number; olderThanDays: number }): CleanupDecision[] {
  const cutoff = opts.now - opts.olderThanDays * DAY_MS;
  const days = (ms: number) => Math.floor((opts.now - ms) / DAY_MS);
  const out: CleanupDecision[] = [];
  for (const machine of machines) {
    if (machine.state === 'destroyed') continue;
    const decide = (task: Task | null, action: CleanupDecision['action'], reason: string) => out.push({ machine, task, action, reason });
    if (isBase(machine)) {
      decide(null, 'keep', 'base checkpoint source');
      continue;
    }
    const task = rows.find((t) => t.machineId === machine.id) ?? rows.find((t) => t.machineName === machine.name) ?? null;
    if (!task) {
      if (!machine.name.startsWith('genie-')) decide(null, 'keep', 'not a genie machine');
      else if (epochMs(machine.created_at) < cutoff) decide(null, 'destroy', `orphan, created ${days(epochMs(machine.created_at))} days ago`);
      else decide(null, 'keep', 'orphan, too young');
      continue;
    }
    if (task.status === 'done') decide(task, 'destroy', 'task done');
    else if (task.error && task.updatedAt.getTime() < cutoff) decide(task, 'destroy', `failed ${days(task.updatedAt.getTime())} days ago`);
    else if (task.error) decide(task, 'keep', 'failed recently, may be retried');
    else decide(task, 'keep', 'in flight');
  }
  return out;
}

export interface CleanupOptions {
  client: CleanupClient;
  dryRun: boolean;
  olderThanDays: number;
  log: (line: string) => void;
  now?: number;
  quota?: number;
}

// Lists the fleet, decides, prints one line per machine, and (unless dryRun)
// destroys, clears the task's machine columns and writes the feed line. Ends
// with the summary and the quota headroom.
export async function runCleanup(opts: CleanupOptions): Promise<CleanupDecision[]> {
  const now = opts.now ?? Date.now();
  const quota = opts.quota ?? DEFAULT_MACHINE_QUOTA;
  const machines = await opts.client.machines.list();
  const rows = await db.select().from(tasks).where(or(isNotNull(tasks.machineId), isNotNull(tasks.machineName)));
  const decisions = planCleanup(machines, rows, { now, olderThanDays: opts.olderThanDays });
  const verb = opts.dryRun ? 'would destroy' : 'destroy';
  for (const d of decisions) {
    const who = d.task ? ` (task ${d.task.id.slice(0, 8)} ${d.task.status})` : '';
    opts.log(`${d.action === 'destroy' ? verb : 'keep'}  ${d.machine.name.padEnd(48)} ${d.reason}${who}`);
  }
  let destroyed = 0;
  if (!opts.dryRun) {
    for (const d of decisions) {
      if (d.action !== 'destroy') continue;
      try {
        await opts.client.machines.destroy(d.machine.id);
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
      destroyed++;
      if (d.task) {
        await db.update(tasks).set({ machineId: null, machineName: null }).where(eq(tasks.id, d.task.id));
        await recordEvent(d.task.id, 'log', `Machine ${d.machine.name} destroyed by cleanup (${d.reason})`);
      }
    }
  }
  const planned = decisions.filter((d) => d.action === 'destroy').length;
  const remaining = decisions.length - destroyed;
  opts.log(
    `${decisions.length} machine(s) seen, ${decisions.length - planned} kept, ${destroyed} destroyed` +
      (opts.dryRun && planned ? ` (${planned} would be, pass --yes)` : '') +
      `, ${Math.max(quota - remaining, 0)} of ${quota} quota slots free`,
  );
  return decisions;
}
