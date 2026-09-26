// GET /health: the worker, the sync and the task counts as JSON. 503 when
// the worker is enabled but has stopped ticking, so a probe sees a wedged
// loop. Read-only, no secrets, so it needs no auth.
import { getHealth } from '#modules/pipeline/health.server.ts';

export async function GET() {
  const { status, body } = await getHealth();
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
