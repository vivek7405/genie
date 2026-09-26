import { html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { cn } from '#lib/utils/cn.ts';
import { liveDot } from '#lib/utils/ui.ts';
import type { Task } from '../../types.ts';
import { isSystemOwned } from '../state-machine.ts';

// One card on the board. The whole card is the link to its detail page.
export function taskCard(task: Task) {
  const busy = isSystemOwned(task) && task.status !== 'todo';
  const meta: unknown[] = [];
  if (task.error) meta.push(html`<span class="text-destructive">failed on attempt ${task.attempt}</span>`);
  else if (busy) meta.push(html`<span>working</span>`);
  if (task.prNumber) meta.push(html`<span>PR #${task.prNumber}</span>`);
  if (task.previewUrl) meta.push(html`<span>preview ready</span>`);
  if (task.feedback && task.status === 'in_progress') meta.push(html`<span>revising</span>`);
  return html`
    <a href="/dashboard/projects/${task.projectId}/tasks/${task.id}"
       class=${cn(cardClass(), 'block px-3.5 py-3 no-underline transition-colors hover:border-border-strong', task.error && 'border-destructive/50')}>
      <span class="flex items-start gap-2">
        <span class="min-w-0 flex-1 text-body font-medium leading-snug text-foreground">${task.title}</span>
        ${busy && !task.error ? liveDot(true, 'Genie is working') : ''}
      </span>
      ${meta.length ? html`<span class="mt-1.5 flex flex-wrap gap-x-3 font-mono text-label uppercase tracking-[0.12em] text-muted-foreground">${meta}</span>` : ''}
    </a>
  `;
}
