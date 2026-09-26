// Boot-time hook: runs once at server start. It is genie's only in-framework
// seam for a resident process, so the pipeline worker starts here. Set
// GENIE_WORKER=0 to boot the UI without it (tests do).
import { setOnError } from '@webjsdev/server';
import { startWorker } from '#modules/pipeline/worker.server.ts';

export function register() {
  setOnError((error, ctx) => {
    console.error('[genie] request error:', error, ctx ?? '');
  });
  if (process.env.GENIE_WORKER !== '0') startWorker();
}
