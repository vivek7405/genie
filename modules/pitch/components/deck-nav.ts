// <deck-nav total="6">: previous/next buttons and a counter, plus arrow-key
// navigation between the deck's slides (sections with ids slide-1..slide-N).
// The slides themselves are server-rendered HTML; this island only scrolls.
import { WebComponent, html, signal } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';

export class DeckNav extends WebComponent({ total: Number }) {
  private current = signal(1);

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); this.go(this.current.get() + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); this.go(this.current.get() - 1); }
  };

  private onScroll = () => {
    // The slide nearest the top of the viewport is the current one.
    let best = 1;
    let bestDistance = Infinity;
    for (let i = 1; i <= this.total; i++) {
      const el = document.getElementById(`slide-${i}`);
      if (!el) continue;
      const distance = Math.abs(el.getBoundingClientRect().top);
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    this.current.set(best);
  };

  constructor() {
    super();
    this.total = 1;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.onKey);
    window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('scroll', this.onScroll);
  }

  go(n: number) {
    const next = Math.min(Math.max(n, 1), this.total);
    this.current.set(next);
    document.getElementById(`slide-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  render() {
    const n = this.current.get();
    return html`
      <div class="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full border border-border bg-card/90 p-1 shadow-lg backdrop-blur">
        <button type="button" class=${buttonClass({ variant: 'ghost', size: 'icon-sm' })} aria-label="Previous slide" ?disabled=${n <= 1} @click=${() => this.go(n - 1)}>←</button>
        <span class="min-w-12 text-center font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">${n} / ${this.total}</span>
        <button type="button" class=${buttonClass({ variant: 'ghost', size: 'icon-sm' })} aria-label="Next slide" ?disabled=${n >= this.total} @click=${() => this.go(n + 1)}>→</button>
      </div>
    `;
  }
}
DeckNav.register('deck-nav');
