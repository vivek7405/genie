// Server-only: what GET /health reports. The worker loop, the GitHub sync
// and three task counts, so an operator (or a probe) can see what genie is
// doing without reading SQLite. Ids and timestamps only, never a secret.
import { isNotNull, or } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { tasks } from '#db/schema.server.ts';
import { syncStatus } from '#modules/github/sync.server.ts';
import { isDeferred } from '#modules/tasks/utils/ui/clock.ts';
import { workerStatus } from './worker.server.ts';

// A worker that has not ticked in this many intervals is wedged.
const WEDGED_AFTER_TICKS = 5;

export interface Health {
  ok: boolean;
  uptimeSec: number;
  worker: {
    enabled: boolean;
    stopping: boolean;
    concurrency: number;
    lastTickAt: string | null;
    lastTickError: string | null;
    running: Array<{ taskId: string; projectId: string; status: string; since: string }>;
  };
  sync: { running: boolean; lastRunAt: string | null; lastError: string | null };
  tasks: { claimed: number; deferred: number; failed: number };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// `now` is a seam for the wedged check; the route passes nothing.
export async function getHealth(now = Date.now()): Promise<{ status: 200 | 503; body: Health }> {
  const worker = workerStatus();
  const sync = syncStatus();
  const rows = await db
    .select()
    .from(tasks)
    .where(or(isNotNull(tasks.claimedAt), isNotNull(tasks.deferredUntil), isNotNull(tasks.error)));
  const counts = {
    claimed: rows.filter((r) => r.claimedAt != null).length,
    deferred: rows.filter((r) => isDeferred(r, now)).length,
    failed: rows.filter((r) => r.error != null).length,
  };
  // Before the first tick lands, the start instant is the reference.
  const last = worker.lastTickAt ?? worker.startedAt;
  const wedged = worker.enabled && last != null && now - last.getTime() > WEDGED_AFTER_TICKS * worker.intervalMs;
  const body: Health = {
    ok: !wedged,
    uptimeSec: Math.round(process.uptime()),
    worker: {
      enabled: worker.enabled,
      stopping: worker.stopping,
      concurrency: worker.concurrency,
      lastTickAt: iso(worker.lastTickAt),
      lastTickError: worker.lastTickError,
      running: worker.running.map((r) => ({ taskId: r.taskId, projectId: r.projectId, status: r.status, since: r.since.toISOString() })),
    },
    sync: { running: sync.running, lastRunAt: iso(sync.lastRunAt), lastError: sync.lastError },
    tasks: counts,
  };
  return { status: wedged ? 503 : 200, body };
}
