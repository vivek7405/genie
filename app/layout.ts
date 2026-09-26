import { html, asset, cspNonce } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import { paletteCss } from '#lib/design/palette.ts';
import { brandMark } from '#lib/design/logo.ts';
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
    { href: '/brand', label: 'Brand', on: path.startsWith('/brand') },
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

        /* The brand palette (lib/design/palette.ts): ink on warm paper, a
           glow accent rationed to the primary action, live state and focus. */
        ${paletteCss()}

        /* The kit's names, each an alias of a brand token. */
        --background:             var(--paper);
        --foreground:             var(--ink);
        --card:                   var(--paper-elev);
        --card-foreground:        var(--ink);
        --popover:                var(--paper-elev);
        --popover-foreground:     var(--ink);
        --primary:                var(--glow);
        --primary-foreground:     var(--glow-ink);
        --primary-tint:           var(--glow-tint);
        --secondary:              var(--paper-subtle);
        --secondary-foreground:   var(--ink);
        --muted:                  var(--paper-subtle);
        --muted-foreground:       var(--ink-muted);
        --accent:                 var(--paper-subtle);
        --accent-foreground:      var(--ink);
        --destructive:            var(--alert);
        --destructive-foreground: light-dark(#ffffff, #12141a);
        --border:                 var(--rule);
        --border-strong:          var(--rule-strong);
        --input:                  var(--rule-strong);
        --ring:                   var(--glow);
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
        <a href="/" class="flex shrink-0 items-center gap-2 font-mono text-body font-semibold tracking-tight text-foreground no-underline" style="--logo-accent: var(--glow)">
          ${brandMark(22)}
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
