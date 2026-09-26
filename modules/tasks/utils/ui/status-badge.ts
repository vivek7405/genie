import { html } from '@webjsdev/core';
import { badgeClass } from '#components/ui/badge.ts';
import type { TaskStatus } from '../../types.ts';
import { labelOf } from '../state-machine.ts';

const VARIANT: Record<TaskStatus, 'outline' | 'secondary' | 'default'> = {
  todo: 'outline',
  planning: 'secondary',
  in_progress: 'secondary',
  ready_for_review: 'default',
  done: 'outline',
};

export function statusBadge(status: TaskStatus, error?: string | null) {
  if (error) return html`<span class=${badgeClass({ variant: 'destructive' })}>Failed</span>`;
  return html`<span class=${badgeClass({ variant: VARIANT[status] })}>${labelOf(status)}</span>`;
}
