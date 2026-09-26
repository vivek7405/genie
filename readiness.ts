// Extra readiness gate beyond "analysis warm": one read against the settings
// table proves the boot-time migration ran against /data and the file is
// readable. webjs runs this on every /__webjs/ready probe; a throw answers 503
// and holds traffic off the replica. It does not gate on the worker: a worker
// that cannot reach Pilots or GitHub is a task failure to show on the board,
// not a reason to keep traffic off the UI.
import { db } from '#db/connection.server.ts';

export default async function ready(): Promise<boolean> {
  await db.query.settings.findFirst({ columns: { key: true } });
  return true;
}
