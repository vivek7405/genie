import { html } from '@webjsdev/core';
import { badgeClass } from '#components/ui/badge.ts';
import { cn } from '#lib/utils/cn.ts';
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

const VOICE = 'font-mono text-label uppercase tracking-[0.12em]';

// A failed stage wins over everything; a deferral still ahead of now (a
// Claude rate limit) shows as Waiting rather than the stage's own label.
export function statusBadge(status: TaskStatus, error?: string | null, deferredUntil?: Date | null) {
  if (error) return html`<span class=${cn(badgeClass({ variant: 'destructive' }), VOICE)}>Failed</span>`;
  if (isDeferred({ deferredUntil: deferredUntil ?? null })) return html`<span class=${cn(badgeClass({ variant: 'secondary' }), VOICE)}>Waiting</span>`;
  return html`<span class=${cn(badgeClass({ variant: VARIANT[status] }), VOICE)}>${labelOf(status)}</span>`;
}
