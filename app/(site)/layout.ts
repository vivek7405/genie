import { html, asset, cspNonce } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { brandMark } from '#lib/design/logo.ts';
import { shellStyles, themeScript } from '#lib/design/shell.ts';
import { cn } from '#lib/utils/cn.ts';
import '#components/theme-toggle.ts';

const TITLE = 'Genie - write the task, review the pull request';
const DESCRIPTION =
  'An async project manager that ships. Connect a GitHub repository, write a task, and Genie plans it, builds it on a branch in its own sandbox, and opens a pull request with a live preview for you to approve.';

export function generateMetadata(ctx: { url: string }) {
  const { origin, pathname } = new URL(ctx.url);
  const canonical = origin + (pathname === '/' ? '' : pathname.replace(/\/+$/, ''));
  return {
    alternates: { canonical },
    title: { default: TITLE, template: '%s · genie' },
    description: DESCRIPTION,
    icons: '/public/favicon.svg',
    openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, url: origin, site_name: 'genie' },
  };
}

const NAV = [
  { href: '/#loop', label: 'How it works' },
  { href: '/#sandbox', label: 'Sandboxes' },
];

const navLink = 'whitespace-nowrap rounded-sm px-3 py-1.5 text-body text-muted-foreground no-underline transition-colors hover:bg-muted hover:text-foreground';

// The public site's root layout: the same tokens and theme as the product,
// with its own chrome. The dashboard link is a full page load (data-no-router)
// because the product is a different shell.
export default function SiteLayout({ children }: LayoutProps) {
  return html`
    ${themeScript(cspNonce())}
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <link rel="stylesheet" href=${asset('/public/tailwind.css')}>
    ${shellStyles()}
    <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2">Skip to content</a>
    <header class="fixed inset-x-0 top-0 z-40 border-b border-border bg-background">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href="/" class="mr-2 flex shrink-0 items-center gap-2 font-mono text-body font-semibold tracking-tight text-foreground no-underline" style="--logo-accent: var(--glow)">
          ${brandMark(22)}
          genie
        </a>
        <nav class="hidden items-center gap-0.5 md:flex" aria-label="Main">
          ${NAV.map((n) => html`<a class=${navLink} href=${n.href}>${n.label}</a>`)}
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <a href="https://github.com/vivek7405/genie" target="_blank" rel="noopener" class="hidden text-meta text-muted-foreground no-underline hover:text-foreground sm:inline">GitHub</a>
          <theme-toggle></theme-toggle>
          <a class=${cn(buttonClass({ size: 'sm' }), 'no-underline')} href="/dashboard" data-no-router>Dashboard</a>
        </div>
      </div>
    </header>
    <main id="main">${children}</main>
    <footer class="border-t border-border">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-meta text-muted-foreground sm:px-6">
        <span class="inline-flex items-center gap-2 font-mono" style="--logo-accent: var(--glow)">${brandMark(16)} genie</span>
        <nav class="flex flex-wrap items-center gap-4" aria-label="Footer">
          <a href="/pitch-deck" class="no-underline hover:text-foreground">Pitch Deck</a>
          <a href="/brand" class="no-underline hover:text-foreground">Brand</a>
          <a href="https://github.com/vivek7405/genie" target="_blank" rel="noopener" class="no-underline hover:text-foreground">GitHub</a>
          <a href="https://webjs.dev" target="_blank" rel="noopener" class="no-underline hover:text-foreground">Built with WebJs</a>
          <a href="https://pilots.run" target="_blank" rel="noopener" class="no-underline hover:text-foreground">Runs on Pilots</a>
        </nav>
      </div>
    </footer>
  `;
}
