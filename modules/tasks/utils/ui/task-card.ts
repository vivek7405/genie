import { html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { cn } from '#lib/utils/cn.ts';
import type { Task } from '../../types.ts';
import { isSystemOwned } from '../state-machine.ts';

// One card on the board. The whole card is the link to its detail page.
export function taskCard(task: Task) {
  const busy = isSystemOwned(task) && task.status !== 'todo';
  return html`
    <a href="/projects/${task.projectId}/tasks/${task.id}"
       class=${cn(cardClass({ size: 'sm' }), 'block gap-1 no-underline text-card-foreground transition-colors hover:border-ring', task.error && 'border-destructive/60')}>
      <span class="flex items-start justify-between gap-2">
        <span class="font-medium leading-snug">${task.title}</span>
        ${busy ? html`<span class="mt-1 size-2 shrink-0 animate-pulse rounded-full bg-primary" title="genie is working"></span>` : ''}
      </span>
      ${task.error ? html`<span class="text-xs text-destructive">Failed, open to retry</span>` : ''}
      ${task.previewUrl ? html`<span class="text-xs text-muted-foreground">Preview ready</span>` : ''}
    </a>
  `;
}
