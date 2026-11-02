import { html } from '@webjsdev/core';
import type { EventKind, TaskEvent } from '../../types.ts';

const KIND_CLASS: Record<EventKind, string> = {
  status: 'text-primary',
  github: 'text-success',
  error: 'text-destructive',
  log: 'text-foreground/80',
};

// Pages never hydrate, so one server render is the only clock involved.
export function clock(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

export function feedLine(event: TaskEvent) {
  return html`
    <li class="flex gap-3 px-4 py-0.5 hover:bg-accent/40">
      <time class="shrink-0 text-muted-foreground/70">${clock(event.createdAt)}</time>
      <span class=${`min-w-0 break-words ${KIND_CLASS[event.kind]}`}>${event.message}</span>
    </li>
  `;
}
