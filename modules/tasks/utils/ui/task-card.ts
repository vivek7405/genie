import { html } from '@webjsdev/core';
import { cn } from '#lib/utils/cn.ts';
import { isWorking, STOPPED } from '../state-machine.ts';
import type { Task } from '../../types.ts';

// One card. The card sits inside the board's frame, so _top is what makes the
// click a page navigation instead of a swap the detail response has no frame for.
export function taskCard(task: Task) {
  const working = isWorking(task);
  return html`
    <a href="/projects/${task.projectId}/tasks/${task.id}" data-webjs-frame="_top"
       class=${cn('block rounded-lg border border-border bg-card p-3 text-card-foreground no-underline shadow-xs transition-colors hover:border-border-strong', working && 'genie-working', task.error && task.error !== STOPPED && 'border-destructive/50')}>
      <span class="block text-sm font-medium leading-snug">${task.title}</span>
      ${task.error ? html`<span class=${cn('mt-1.5 block text-xs', task.error === STOPPED ? 'text-muted-foreground' : 'text-destructive')}>${task.error === STOPPED ? 'Stopped' : 'Failed, open to retry'}</span>` : ''}
      ${working ? html`<span class="genie-dot mt-1.5 block text-xs text-primary">${task.feedback ? 'Applying your feedback' : 'Genie is working'}</span>` : ''}
      ${!working && !task.error && task.status === 'in_progress' ? html`<span class="mt-1.5 block text-xs text-muted-foreground">Up next</span>` : ''}
      ${task.prNumber && task.status === 'review' ? html`<span class="mt-1.5 block text-xs text-muted-foreground">PR #${task.prNumber} is ready for you</span>` : ''}
      ${task.status === 'done' ? html`<span class="mt-1.5 block text-xs text-success">Merged${task.prNumber ? ` in #${task.prNumber}` : ''}</span>` : ''}
    </a>
  `;
}
