import { html, cspNonce, asset } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import { lampMark } from '#lib/design/logo.ts';
import { account } from '#modules/auth/queries/account.server.ts';
import '#components/theme-toggle.ts';

export const metadata = { title: { default: 'Genie', template: '%s · Genie' }, description: 'Connect a GitHub repo, add a task, and let AI take care of the rest.' };

// The document shell: tokens (each written once with light-dark()), fonts, the
// no-flash theme script, and the fixed header.
export default async function RootLayout({ children }: LayoutProps) {
  const nonce = cspNonce();
  const me = await account();
  return html`
    <script nonce="${nonce}">
      (function(){
        try {
          var mq = window.matchMedia('(prefers-color-scheme: dark)');
          function apply(){
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
      (function(){
        function measure(){
          try {
            var hdr = document.querySelector('header');
            if (!hdr || getComputedStyle(hdr).position !== 'fixed') return;
            var set = function(){ document.documentElement.style.setProperty('--header-h', hdr.offsetHeight + 'px'); };
            set();
            if (window.ResizeObserver) new ResizeObserver(set).observe(hdr);
          } catch (_) {}
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', measure);
        else measure();
      })();
    </script>
    <meta name="color-scheme" content="light dark">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Inter:wght@400..700&family=JetBrains+Mono:wght@400;500&display=swap">
    <link rel="stylesheet" href=${asset('/public/tailwind.css')}>
    <style>
      :root {
        --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
        --font-serif: ui-serif, Georgia, serif;
        --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        --font-display: 'Bricolage Grotesque', 'Inter', ui-sans-serif, system-ui, sans-serif;
        --header-h: 3.5rem;
        --radius: 0.75rem;
        color-scheme: light dark;
        --background: light-dark(#faf8f3, #0b0d12);
        --foreground: light-dark(#1b1a17, #eceae4);
        --card: light-dark(#ffffff, #14171f);
        --card-foreground: light-dark(#1b1a17, #eceae4);
        --popover: light-dark(#ffffff, #14171f);
        --popover-foreground: light-dark(#1b1a17, #eceae4);
        --primary: light-dark(#b45309, #f5b400);
        --primary-foreground: light-dark(#ffffff, #171204);
        --secondary: light-dark(#f0ece2, #1d212b);
        --secondary-foreground: light-dark(#1b1a17, #eceae4);
        --muted: light-dark(#f0ece2, #171a22);
        --muted-foreground: light-dark(#6a665c, #979aa5);
        --accent: light-dark(#ece7da, #222632);
        --accent-foreground: light-dark(#1b1a17, #f4f2ec);
        --destructive: light-dark(#c62f25, #ff6b5e);
        --destructive-foreground: light-dark(#ffffff, #1f0705);
        --success: light-dark(#1a7f4b, #4cd08a);
        --border: light-dark(#e4dfd2, #252934);
        --border-strong: light-dark(#cfc8b6, #3a3f4d);
        --input: light-dark(#ddd7c8, #2c303c);
        --ring: light-dark(#b45309, #f5b400);
        --primary-tint: color-mix(in srgb, var(--primary) 18%, transparent);
        --glow: color-mix(in srgb, var(--primary) 14%, transparent);
        --grid: color-mix(in srgb, var(--foreground) 4%, transparent);
      }
      :root[data-theme='light'] { color-scheme: light; }
      :root[data-theme='dark'] { color-scheme: dark; }
      html, body { margin: 0; }
      body {
        padding-top: var(--header-h);
        background: var(--background);
        color: var(--foreground);
        font: 15px/1.6 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
    </style>
    <header class="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/75 backdrop-blur-md" style="border-right: var(--wj-scrollbar-compensation, 0px) solid transparent">
      <div class="mx-auto flex h-14 max-w-[88rem] items-center justify-between gap-4 px-4 sm:px-6">
        <a href=${me ? '/projects' : '/'} class="inline-flex items-center gap-2 text-lg font-bold tracking-tight text-foreground no-underline" style="font-family: var(--font-display)">
          <span class="text-primary">${lampMark(26)}</span>Genie
        </a>
        <nav class="flex items-center gap-2 text-sm" aria-label="Primary">
          ${me ? html`<a href="/projects" class="rounded-md px-2.5 py-1 text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground">Projects</a>` : ''}
          <theme-toggle></theme-toggle>
          ${me ? html`
            <form method="POST" action="/api/auth/signout" data-no-router class="m-0 flex items-center gap-2">
              ${me.avatarUrl ? html`<img src=${me.avatarUrl} alt="" width="26" height="26" class="rounded-full">` : ''}
              <span class="hidden text-muted-foreground sm:inline">${me.login}</span>
              <button type="submit" class="cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">Sign out</button>
            </form>` : ''}
        </nav>
      </div>
    </header>
    <main class="genie-backdrop min-h-[calc(100dvh-var(--header-h))]">
      ${children}
    </main>
  `;
}
