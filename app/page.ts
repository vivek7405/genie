import { html, redirect } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { cn } from '#lib/utils/cn.ts';
import { lampMark } from '#lib/design/logo.ts';
import { account } from '#modules/auth/queries/account.server.ts';

export const metadata = { title: 'Make a wish, get a pull request' };

const PREVIEW = [
  { label: 'Backlog', cards: [{ title: 'Add dark mode to settings' }, { title: 'Export invoices as CSV' }] },
  { label: 'In progress', cards: [{ title: 'Add an about page with the team', working: true }] },
  { label: 'Review', cards: [{ title: 'Fix the pricing table on mobile', meta: 'PR #42' }] },
  { label: 'Done', cards: [{ title: 'Rate limit the signup form', meta: 'Merged' }] },
];

export default async function Home({ searchParams }: PageProps) {
  if (await account()) redirect('/projects');
  const denied = searchParams.error === 'AccessDenied';
  return html`
    <div class="mx-auto flex max-w-5xl flex-col items-center px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-24">
      <span class="genie-rise text-primary">${lampMark(56)}</span>
      <h1 class="genie-rise m-0 mt-5 text-display font-bold" style="font-family: var(--font-display)">Make a wish.<br>Get a pull request.</h1>
      <p class="genie-rise m-0 mt-5 max-w-[46ch] text-lede text-muted-foreground">Connect a GitHub repo and drop a task in the backlog. Genie plans it, builds it, and opens the PR. You just review.</p>
      ${denied ? html`<p role="alert" class="m-0 mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">This Genie belongs to someone else, so that account cannot sign in.</p>` : ''}
      <form method="POST" action="/api/auth/signin/github" data-no-router class="genie-rise m-0 mt-8">
        <input type="hidden" name="redirectTo" value="/projects">
        <button type="submit" class=${cn(buttonClass({ size: 'lg' }), 'h-11 px-6 text-base shadow-[0_10px_40px_-12px_var(--primary)]')}>
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
          Sign in with GitHub
        </button>
      </form>
      <div aria-hidden="true" class="genie-rise mt-16 grid w-full grid-cols-2 gap-3 text-left md:grid-cols-4">
        ${PREVIEW.map((col) => html`
          <div class="flex flex-col gap-2 rounded-xl border border-border bg-muted/60 p-2.5">
            <span class="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">${col.label}</span>
            ${col.cards.map((card: { title: string; working?: boolean; meta?: string }) => html`
              <div class=${cn('rounded-lg border border-border bg-card p-3 text-sm font-medium leading-snug', card.working && 'genie-working')}>
                ${card.title}
                ${card.working ? html`<span class="genie-dot mt-1.5 block text-xs font-normal text-primary">Genie is working</span>` : ''}
                ${card.meta ? html`<span class="mt-1.5 block text-xs font-normal text-muted-foreground">${card.meta}</span>` : ''}
              </div>`)}
          </div>`)}
      </div>
    </div>
  `;
}
