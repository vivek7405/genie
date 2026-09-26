import { html } from '@webjsdev/core';
import { badgeClass } from '#components/ui/badge.ts';
import type { TaskStatus } from '../../types.ts';
import { labelOf } from '../state-machine.ts';
import { isDeferred } from './clock.ts';

const VARIANT: Record<TaskStatus, 'outline' | 'secondary' | 'default'> = {
  todo: 'outline',
  planning: 'secondary',
  in_progress: 'secondary',
  ready_for_review: 'default',
  done: 'outline',
};

// A failed stage wins over everything; a deferral still ahead of now (a
// Claude rate limit) shows as Waiting rather than the stage's own label.
export function statusBadge(status: TaskStatus, error?: string | null, deferredUntil?: Date | null) {
  if (error) return html`<span class=${badgeClass({ variant: 'destructive', voice: true })}>Failed</span>`;
  if (isDeferred({ deferredUntil: deferredUntil ?? null })) return html`<span class=${badgeClass({ variant: 'secondary', voice: true })}>Waiting</span>`;
  return html`<span class=${badgeClass({ variant: VARIANT[status], voice: true })}>${labelOf(status)}</span>`;
}
