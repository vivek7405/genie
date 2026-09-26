import { html, asset, cspNonce } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { brandMark } from '#lib/design/logo.ts';
import { shellStyles, themeScript } from '#lib/design/shell.ts';
import { cn } from '#lib/utils/cn.ts';
import { currentUser } from '#modules/auth/queries/current-user.server.ts';
import '#components/theme-toggle.ts';

export const metadata = { title: { default: 'genie', template: '%s · genie' }, icons: '/public/favicon.svg' };

// The product's root layout: one fixed, opaque header over the tracker.
// The public site has its own shell under app/(site); the tokens and the
// theme are shared through lib/design/shell.ts.
//
// The account menu is a <details>, so it opens with scripting off, and its
// Sign out button submits the form at the foot of the page through the
// native form= attribute, so that works too. The form sits AFTER <main> so a
// page's own form stays the first one in the document (a test's submitForm
// and a screen reader both read forms in order). The nav is only there for
// someone signed in; a signed-out visitor (a gate redirect in flight, a 404
// under /dashboard) gets the mark and a way to sign in.
export default async function ProductLayout({ children, url }: LayoutProps) {
  const me = await currentUser();
  const path = new URL(url ?? 'http://localhost/').pathname;
  const nav = me
    ? [{ href: '/dashboard', label: 'Projects', on: path === '/dashboard' || path.startsWith('/dashboard/projects') }]
    : [];
  return html`
    ${themeScript(cspNonce())}
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <link rel="stylesheet" href=${asset('/public/tailwind.css')}>
    ${shellStyles()}
    <header class="fixed inset-x-0 top-0 z-40 border-b border-border bg-background">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href="/dashboard" class="flex shrink-0 items-center gap-2 font-mono text-body font-semibold tracking-tight text-foreground no-underline" style="--logo-accent: var(--glow)">
          ${brandMark(22)}
          genie
        </a>
        ${nav.length > 0 ? html`
          <span class="select-none text-border-strong" aria-hidden="true">/</span>
          <nav class="flex items-center gap-0.5" aria-label="Primary">
            ${nav.map((n) => html`<a href=${n.href} aria-current=${n.on ? 'page' : 'false'}
              class="whitespace-nowrap rounded-sm px-3 py-1.5 text-body no-underline transition-colors ${n.on ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}">${n.label}</a>`)}
          </nav>` : ''}
        <div class="ml-auto flex items-center gap-2">
          <a href="https://github.com/vivek7405/genie" target="_blank" rel="noopener" class="hidden text-meta text-muted-foreground no-underline hover:text-foreground sm:inline">GitHub</a>
          <theme-toggle></theme-toggle>
          ${me ? accountMenu(me) : html`<a href="/login" class=${cn(buttonClass({ size: 'sm' }), 'no-underline')}>Sign in</a>`}
        </div>
      </div>
    </header>
    <main class="mx-auto min-h-[calc(100dvh-var(--header-h))] max-w-6xl px-4 py-8 sm:px-6">
      ${children}
    </main>
    ${me ? html`<form id="signout" method="POST" action="/api/auth/signout" data-no-router hidden></form>` : ''}
  `;
}

/** The signed-in person: avatar or initials as the trigger, login and sign out inside. */
function accountMenu(me: { login: string; name: string | null; avatarUrl: string | null }) {
  return html`
    <details class="relative" data-account-menu>
      <summary class="flex size-8 cursor-pointer list-none items-center justify-center overflow-hidden rounded-full border border-border bg-muted font-mono text-label uppercase text-foreground [&::-webkit-details-marker]:hidden" aria-label=${`Account: ${me.login}`}>
        ${me.avatarUrl
          ? html`<img src=${me.avatarUrl} alt="" width="32" height="32" class="size-full object-cover">`
          : initials(me.name || me.login)}
      </summary>
      <div class="absolute right-0 top-10 z-50 min-w-48 rounded-md border border-border bg-card p-1 shadow-md">
        <p class="m-0 truncate px-2 py-1.5 font-mono text-meta text-muted-foreground">${me.login}</p>
        <button type="submit" form="signout" class="w-full cursor-pointer rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-body text-foreground hover:bg-muted">Sign out</button>
      </div>
    </details>
  `;
}

/** Up to two letters from a name, for an avatar that has no picture. */
function initials(name: string): string {
  const parts = name.trim().split(/[\s-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.trim().slice(0, 2);
  return letters.toUpperCase();
}
