// Boot-time hook: runs once at server start. It is genie's only in-framework
// seam for a resident process, so the pipeline worker and the GitHub sync
// loop start here. Set GENIE_WORKER=0 to boot the UI without the worker and
// GENIE_SYNC=0 to boot without the sync (tests do both).
import { setOnError } from '@webjsdev/server';
import { startWorker } from '#modules/pipeline/worker.server.ts';
import { startSync } from '#modules/github/sync.server.ts';

export function register() {
  setOnError((error, ctx) => {
    console.error('[genie] request error:', error, ctx ?? '');
  });
  if (process.env.GENIE_WORKER !== '0') startWorker();
  if (process.env.GENIE_SYNC !== '0') startSync();
}
