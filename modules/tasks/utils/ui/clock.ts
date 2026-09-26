// The wall-clock a deferral line shows ("retrying at 14:35 UTC"), shared by
// the feed line the worker writes and the badge and card copy. Browser-safe.
export const clock = (d: Date): string =>
  d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

// A deferral that is still ahead of now, so the UI shows "Waiting".
export function isDeferred(task: { deferredUntil: Date | null }, now = Date.now()): boolean {
  return task.deferredUntil != null && task.deferredUntil.getTime() > now;
}
