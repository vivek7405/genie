import { html, asset, cspNonce } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import '#components/theme-toggle.ts';

export const metadata = { title: { default: 'genie', template: '%s · genie' }, icons: '/public/favicon.svg' };

// Root layout: the only file that writes the document shell. It owns the
// design tokens, the theme, and the app chrome: one fixed, opaque header.
// Every colour is declared once with light-dark(), and public/input.css maps
// the token names into Tailwind utilities (bg-background, text-muted-foreground).
export default function RootLayout({ children, url }: LayoutProps) {
  const path = new URL(url ?? 'http://localhost/').pathname;
  const nonce = cspNonce();
  const nav = [
    { href: '/', label: 'Projects', on: path === '/' || path.startsWith('/projects') },
    { href: '/pitch-deck', label: 'Pitch deck', on: path.startsWith('/pitch-deck') },
  ];
  return html`
    <script nonce="${nonce}">
      // Apply the saved theme before first paint so a dark page never flashes
      // light. The tokens follow color-scheme, which [data-theme] forces; the
      // .dark class is for the kit's dark: variants. (No backticks in here.)
      (function () {
        try {
          var mq = window.matchMedia('(prefers-color-scheme: dark)');
          function apply() {
            var t = null;
            try { t = localStorage.getItem('genie_theme'); } catch (_) {}
            var el = document.documentElement;
            if (t === 'light' || t === 'dark') el.dataset.theme = t;
            else delete el.dataset.theme;
            el.classList.toggle('dark', t === 'dark' || (t !== 'light' && mq.matches));
          }
          apply();
          mq.addEventListener('change', apply);
        } catch (_) {}
      })();
    </script>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <link rel="stylesheet" href=${asset('/public/tailwind.css')}>
    <style>
      :root {
        --font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
        --font-mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
        --header-h: 56px;
        /* Square-ish surfaces: a panel reads as an instrument, not a consumer app. */
        --radius: 0.375rem;
        color-scheme: light dark;

        /* The palette: ink on cool paper, a violet accent used only for the
           primary action, live state and the focus ring. It never tints a
           panel or a heading. */
        --background:             light-dark(#fafaf8, #101113);
        --card:                   light-dark(#ffffff, #17181c);
        --card-foreground:        light-dark(#1a1b1f, #e8e7e3);
        --popover:                light-dark(#ffffff, #17181c);
        --popover-foreground:     light-dark(#1a1b1f, #e8e7e3);
        --foreground:             light-dark(#1a1b1f, #e8e7e3);
        --muted:                  light-dark(#f0efeb, #1d1f24);
        --muted-foreground:       light-dark(#5d6069, #9a9ea8);
        --secondary:              light-dark(#eeede9, #22242a);
        --secondary-foreground:   light-dark(#1a1b1f, #e8e7e3);
        --accent:                 light-dark(#eeede9, #22242a);
        --accent-foreground:      light-dark(#1a1b1f, #e8e7e3);
        --primary:                light-dark(#5b4dff, #8b80ff);
        --primary-foreground:     light-dark(#ffffff, #0f0e1a);
        --primary-tint:           light-dark(#e9e6ff, #221f3d);
        --destructive:            light-dark(#b8391f, #ff7a5c);
        --destructive-foreground: light-dark(#ffffff, #12141a);
        --success:                light-dark(#3f7d1a, #9be36a);
        --warning:                light-dark(#9a5a04, #fbbf24);
        --border:                 light-dark(#e3e1db, #262930);
        --border-strong:          light-dark(#cbc8bf, #383c46);
        --input:                  light-dark(#cbc8bf, #383c46);
        --ring:                   light-dark(#5b4dff, #8b80ff);
      }
      :root[data-theme='light'] { color-scheme: light; }
      :root[data-theme='dark'] { color-scheme: dark; }
      html, body { margin: 0; }
      html { scrollbar-gutter: stable; }
      body {
        padding-top: var(--header-h);
        background: var(--background);
        color: var(--foreground);
        font: 15px/1.6 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      h1, h2, h3 { letter-spacing: -0.02em; text-wrap: balance; }
      p { text-wrap: pretty; }
      a { color: inherit; text-decoration-color: var(--border-strong); text-underline-offset: 3px; }
      a:hover { text-decoration-color: currentColor; }
      live-refresh { display: inline-flex; }
    </style>
    <header class="fixed inset-x-0 top-0 z-40 border-b border-border bg-background">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href="/" class="flex shrink-0 items-center gap-2 font-mono text-body font-semibold tracking-tight text-foreground no-underline">
          <span class="grid size-6 place-items-center rounded-sm bg-foreground text-background text-label font-bold" aria-hidden="true">g</span>
          genie
        </a>
        <nav class="ml-4 flex items-center gap-0.5" aria-label="Primary">
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
