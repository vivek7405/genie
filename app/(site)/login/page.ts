/**
 * The sign-in page, and where a failed sign-in lands.
 *
 * `createAuth` is configured with `pages.error: '/login'`, so a refusal
 * arrives here as `?error=<code>` rather than at the home page, where it
 * would have looked like a successful sign-out.
 *
 * The button is a plain form POST to the auth route (no JavaScript needed):
 * the handler answers with the redirect to GitHub, and the hidden redirectTo
 * is where the round trip lands: the dashboard, or the `?next=` path the
 * gate sent along (same-origin only, else dropped). `data-no-router` keeps
 * the client router from fetching a same-origin path whose answer is a 302
 * off origin.
 *
 * No card around it: a card promises more than a mark, a sentence and a
 * button, and the page has exactly those.
 */
import { html } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { brandMark } from '#lib/design/logo.ts';
import { errorAlert } from '#lib/utils/ui.ts';
import { cn } from '#lib/utils/cn.ts';
import { localPath } from '#lib/utils/local-path.ts';

export const metadata = { title: 'Sign in' };

const MESSAGES: Record<string, string> = {
  AccessDenied: 'GitHub declined that sign-in.',
  Configuration: 'This Genie has no GitHub App configured.',
};

export default function Login({ searchParams }: PageProps) {
  const error = typeof searchParams.error === 'string' ? searchParams.error : '';
  const next = localPath(searchParams.next, '/dashboard');
  return html`
    <div class="mx-auto flex max-w-md flex-col items-center gap-5 px-4 py-24 text-center">
      ${error ? html`<div class="w-full text-left">${errorAlert(MESSAGES[error] ?? 'That sign-in did not complete.')}</div>` : ''}
      <span style="--logo-accent: var(--glow)">${brandMark(40)}</span>
      <h1 class="m-0 text-title font-bold tracking-tight">Sign in to Genie</h1>
      <p class="m-0 max-w-[40ch] leading-[1.7] text-muted-foreground">A Genie account is a GitHub account: sign in, and Genie builds on the repositories you give it.</p>
      <form method="POST" action="/api/auth/signin/github" data-no-router>
        <input type="hidden" name="redirectTo" value=${next}>
        <button type="submit" class=${cn(buttonClass({ size: 'lg' }))}>
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          Sign in with GitHub
        </button>
      </form>
    </div>
  `;
}
