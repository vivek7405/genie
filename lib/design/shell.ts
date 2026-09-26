// The pieces both root layouts share: the pre-paint theme script, the token
// block and the base styles. Two route groups, (site) and (product), each
// write their own document shell with their own chrome; the tokens and the
// theme are one set, declared here once.
import { html } from '@webjsdev/core';
import { paletteCss } from './palette.ts';

export const THEME_STORAGE_KEY = 'genie_theme';

/** Applies the saved theme before first paint. No backticks inside. */
export function themeScript(nonce: string) {
  return html`
    <script nonce="${nonce}">
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
  `;
}

/** The design tokens and the base styles no utility can reach. */
export function shellStyles() {
  return html`
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
      live-refresh { display: inline-flex; }
    </style>
  `;
}
