// Runs once at server start: the worker is the app's one resident process.
// GENIE_WORKER=0 boots the UI without it (tests do).
import { setOnError } from '@webjsdev/server';
import { startWorker } from '#modules/pipeline/worker.server.ts';

export function register() {
  setOnError((error, ctx) => {
    console.error('[genie] request error:', error, ctx ?? '');
  });
  if (process.env.GENIE_WORKER !== '0') startWorker();
}
