import { html } from '@webjsdev/core';
import { badgeClass } from '#components/ui/badge.ts';
import { cn } from '#lib/utils/cn.ts';
import type { TaskStatus } from '../../types.ts';
import { labelOf } from '../state-machine.ts';

const VARIANT: Record<TaskStatus, 'outline' | 'secondary' | 'default'> = {
  todo: 'outline',
  planning: 'secondary',
  in_progress: 'secondary',
  ready_for_review: 'default',
  done: 'outline',
};

const VOICE = 'font-mono text-label uppercase tracking-[0.12em]';

export function statusBadge(status: TaskStatus, error?: string | null) {
  if (error) return html`<span class=${cn(badgeClass({ variant: 'destructive' }), VOICE)}>Failed</span>`;
  return html`<span class=${cn(badgeClass({ variant: VARIANT[status] }), VOICE)}>${labelOf(status)}</span>`;
}
