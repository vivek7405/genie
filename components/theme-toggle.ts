// The theme button: follow the system, light, or dark. The root layout's inline
// script applies the saved choice before first paint; this cycles it.
import { WebComponent, html, prop } from '@webjsdev/core';

const ORDER = ['system', 'light', 'dark'] as const;
type Theme = (typeof ORDER)[number];
const KEY = 'genie_theme';

// Whole svg elements: a fragment holding only svg children parses as HTML and
// paints nothing.
const ICONS: Record<Theme, ReturnType<typeof html>> = {
  light: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  dark: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>`,
  system: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`,
};

function apply(theme: Theme): void {
  const el = document.documentElement;
  if (theme === 'system') delete el.dataset.theme;
  else el.dataset.theme = theme;
  el.classList.toggle('dark', theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));
}

export class ThemeToggle extends WebComponent({ theme: prop(String, { state: true }) }) {
  constructor() {
    super();
    this.theme = 'system';
  }

  connectedCallback() {
    super.connectedCallback();
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage blocked: still works for this view */ }
    this.theme = saved === 'light' || saved === 'dark' ? saved : 'system';
  }

  private cycle() {
    const next = ORDER[(ORDER.indexOf(this.theme as Theme) + 1) % ORDER.length];
    this.theme = next;
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch { /* not saved, still applied */ }
    apply(next);
  }

  render() {
    const theme = this.theme as Theme;
    return html`
      <button type="button" @click=${() => this.cycle()} aria-label=${`Theme: ${theme}. Change it.`} title=${`Theme: ${theme}`}
        class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        ${ICONS[theme]}
      </button>
    `;
  }
}
ThemeToggle.register('theme-toggle');
