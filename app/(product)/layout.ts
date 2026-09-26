import { html, asset, cspNonce } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import { brandMark } from '#lib/design/logo.ts';
import { shellStyles, themeScript } from '#lib/design/shell.ts';
import '#components/theme-toggle.ts';

export const metadata = { title: { default: 'genie', template: '%s · genie' }, icons: '/public/favicon.svg' };

// The product's root layout: one fixed, opaque header over the tracker.
// The public site has its own shell under app/(site); the tokens and the
// theme are shared through lib/design/shell.ts.
export default function ProductLayout({ children, url }: LayoutProps) {
  const path = new URL(url ?? 'http://localhost/').pathname;
  const nav = [
    { href: '/dashboard', label: 'Projects', on: path === '/dashboard' || path.startsWith('/dashboard/projects') },
  ];
  return html`
    ${themeScript(cspNonce())}
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <link rel="stylesheet" href=${asset('/public/tailwind.css')}>
    ${shellStyles()}
    <header class="fixed inset-x-0 top-0 z-40 border-b border-border bg-background">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href="/" data-no-router class="flex shrink-0 items-center gap-2 font-mono text-body font-semibold tracking-tight text-foreground no-underline" style="--logo-accent: var(--glow)">
          ${brandMark(22)}
          genie
        </a>
        <span class="select-none text-border-strong" aria-hidden="true">/</span>
        <nav class="flex items-center gap-0.5" aria-label="Primary">
          ${nav.map((n) => html`<a href=${n.href} aria-current=${n.on ? 'page' : 'false'}
            class="whitespace-nowrap rounded-sm px-3 py-1.5 text-body no-underline transition-colors ${n.on ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}">${n.label}</a>`)}
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <a href="https://github.com/vivek7405/genie" target="_blank" rel="noopener" class="hidden text-meta text-muted-foreground no-underline hover:text-foreground sm:inline">GitHub</a>
          <theme-toggle></theme-toggle>
        </div>
      </div>
    </header>
    <main class="mx-auto min-h-[calc(100dvh-var(--header-h))] max-w-6xl px-4 py-8 sm:px-6">
      ${children}
    </main>
  `;
}
