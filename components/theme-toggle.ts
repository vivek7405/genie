// <theme-toggle>: system, light, dark. The choice is saved in localStorage and
// applied before first paint by the root layout's inline script; this button
// only reads what that script applied and cycles it.
import { WebComponent, html, prop } from '@webjsdev/core';

const ORDER = ['system', 'light', 'dark'] as const;
type Theme = (typeof ORDER)[number];
const STORAGE_KEY = 'genie_theme';
const WORD: Record<Theme, string> = { system: 'AUTO', light: 'LIGHT', dark: 'DARK' };

export function applyTheme(theme: Theme): void {
  const el = document.documentElement;
  if (theme === 'system') delete el.dataset.theme;
  else el.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  el.classList.toggle('dark', dark);
}

export class ThemeToggle extends WebComponent({ theme: prop(String, { state: true }) }) {
  constructor() {
    super();
    this.theme = 'system';
  }

  connectedCallback() {
    super.connectedCallback();
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage blocked: the toggle still works for this view */ }
    this.theme = saved === 'light' || saved === 'dark' ? saved : 'system';
  }

  private cycle() {
    const next = ORDER[(ORDER.indexOf(this.theme as Theme) + 1) % ORDER.length];
    this.theme = next;
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch { /* not persisted, still applied */ }
    applyTheme(next);
  }

  render() {
    const theme = this.theme as Theme;
    const label = theme === 'system' ? 'follows your system' : theme;
    return html`
      <button type="button"
        class="inline-flex h-8 cursor-pointer items-center rounded-sm border border-border bg-transparent px-2.5 font-mono text-label tracking-[0.12em] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
        @click=${() => this.cycle()}
        aria-label=${`Theme: ${label}. Change it.`}
        title=${`Theme: ${label}`}>${WORD[theme]}</button>
    `;
  }
}
ThemeToggle.register('theme-toggle');
