import { html, asset } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';

export const metadata = { title: 'genie', icons: '/public/favicon.svg' };

// Root layout: the only file that writes the document shell. Tokens are
// declared once with light-dark() so the OS colour scheme picks the side;
// public/input.css maps them into Tailwind (bg-background, text-foreground).
export default function RootLayout({ children }: LayoutProps) {
  return html`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <link rel="stylesheet" href=${asset('/public/tailwind.css')}>
    <style>
      :root {
        --font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
        --radius: 0.625rem;
        --header-h: 57px;
        color-scheme: light dark;
        --background:           light-dark(oklch(0.985 0.004 260), oklch(0.13 0.012 260));
        --foreground:           light-dark(oklch(0.21 0.02 260), oklch(0.95 0.008 260));
        --card:                 light-dark(oklch(1 0 0), oklch(0.18 0.014 260));
        --card-foreground:      light-dark(oklch(0.21 0.02 260), oklch(0.95 0.008 260));
        --popover:              light-dark(oklch(1 0 0), oklch(0.18 0.014 260));
        --popover-foreground:   light-dark(oklch(0.21 0.02 260), oklch(0.95 0.008 260));
        --primary:              light-dark(oklch(0.52 0.19 275), oklch(0.78 0.14 275));
        --primary-foreground:   light-dark(oklch(1 0 0), oklch(0.13 0.012 260));
        --secondary:            light-dark(oklch(0.95 0.008 260), oklch(0.24 0.016 260));
        --secondary-foreground: light-dark(oklch(0.21 0.02 260), oklch(0.95 0.008 260));
        --muted:                light-dark(oklch(0.955 0.006 260), oklch(0.22 0.014 260));
        --muted-foreground:     light-dark(oklch(0.48 0.02 260), oklch(0.72 0.014 260));
        --accent:               light-dark(oklch(0.95 0.008 260), oklch(0.24 0.016 260));
        --accent-foreground:    light-dark(oklch(0.21 0.02 260), oklch(0.95 0.008 260));
        --destructive:          light-dark(oklch(0.58 0.22 27), oklch(0.70 0.19 22));
        --destructive-foreground: light-dark(oklch(1 0 0), oklch(0.13 0.012 260));
        --border:               light-dark(oklch(0.90 0.008 260), oklch(0.28 0.016 260));
        --input:                light-dark(oklch(0.90 0.008 260), oklch(0.28 0.016 260));
        --ring:                 light-dark(oklch(0.62 0.17 275), oklch(0.78 0.14 275));
        --primary-tint: color-mix(in oklch, var(--ring) 22%, transparent);
      }
      html, body { margin: 0; }
      body {
        padding-top: var(--header-h);
        background: var(--background);
        color: var(--foreground);
        font: 15px/1.55 var(--font-sans);
        -webkit-font-smoothing: antialiased;
      }
      :focus-visible { outline: 2px solid color-mix(in oklab, var(--ring) 50%, transparent); outline-offset: 2px; }
    </style>
    <header class="fixed inset-x-0 top-0 z-20 h-14 border-b border-border bg-background/80 backdrop-blur-md">
      <div class="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="/" class="inline-flex items-center gap-2 text-foreground no-underline">
          <span class="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">g</span>
          <span class="font-semibold tracking-tight">genie</span>
        </a>
        <nav class="flex items-center gap-4 text-sm" aria-label="Primary">
          <a href="/" class="text-muted-foreground no-underline transition-colors hover:text-foreground">Projects</a>
          <a href="https://github.com/vivek7405/genie" target="_blank" rel="noopener" class="text-muted-foreground no-underline transition-colors hover:text-foreground">GitHub</a>
        </nav>
      </div>
    </header>
    <main class="mx-auto min-h-[calc(100dvh-var(--header-h))] max-w-7xl px-4 py-8 sm:px-6">
      ${children}
    </main>
  `;
}
