// Worker status, handy while watching a run locally. Ids only, no task content.
import { workerStatus } from '#modules/pipeline/worker.server.ts';

export function GET() {
  return Response.json(workerStatus());
}
