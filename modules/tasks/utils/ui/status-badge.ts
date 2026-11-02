import { html } from '@webjsdev/core';
import { badgeClass } from '#components/ui/badge.ts';
import { labelOf, isWorking } from '../state-machine.ts';
import type { Task } from '../../types.ts';

export function statusBadge(task: Task) {
  if (task.error) return html`<span class=${badgeClass({ variant: 'destructive' })}>Failed</span>`;
  if (isWorking(task)) return html`<span class=${badgeClass()}>Working</span>`;
  if (task.status === 'done') return html`<span class=${badgeClass({ variant: 'secondary' })}>Merged</span>`;
  if (task.status === 'review') return html`<span class=${badgeClass({ variant: 'outline' })}>Needs review</span>`;
  return html`<span class=${badgeClass({ variant: 'secondary' })}>${task.status === 'backlog' ? 'Queued' : labelOf(task.status)}</span>`;
}
