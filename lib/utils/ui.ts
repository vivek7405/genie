// App-wide html fragments: repeated markup chunks, rendered at SSR time.
import { html } from '@webjsdev/core';

export function pageHeading(title: unknown) {
  return html`<h1 class="m-0 text-2xl font-bold tracking-tight">${title}</h1>`;
}

export function lede(content: unknown) {
  return html`<p class="mt-1 mb-6 text-muted-foreground">${content}</p>`;
}

export function fieldError(message: string | undefined) {
  return message ? html`<p class="mt-1 text-sm text-destructive">${message}</p>` : '';
}

export function formLabel(text: unknown, forId: string) {
  return html`<label for=${forId} class="mb-1 block text-sm font-medium">${text}</label>`;
}
