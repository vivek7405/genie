import { html } from '@webjsdev/core';
import { SLIDES } from '#modules/pitch/utils/slides.ts';
import '#modules/pitch/components/deck-nav.ts';

export const metadata = { title: 'Pitch deck' };

// Five full-height slides for the 10 minute judging slot, in the order the
// brief asks for them. Arrow keys and the corner buttons move between them.
export default function PitchDeck() {
  return html`
    <style>
      html { scroll-snap-type: y proximity; }
    </style>
    <div class="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:px-6">
      ${SLIDES.map((slide, i) => html`
        <section id="slide-${i + 1}" class="grid min-h-[calc(100dvh-var(--header-h)-4rem)] snap-start content-center gap-6 scroll-mt-[calc(var(--header-h)+2rem)]" aria-label=${slide.title}>
          <p class="m-0 font-mono text-xs uppercase tracking-[0.2em] text-primary">${slide.kicker}</p>
          <h2 class="m-0 max-w-4xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">${slide.title}</h2>
          ${slide.lead ? html`<p class="m-0 max-w-3xl text-lg text-muted-foreground sm:text-xl">${slide.lead}</p>` : ''}
          <ul class="m-0 grid max-w-4xl list-none gap-3 p-0 text-base sm:text-lg">
            ${slide.points.map((p) => html`
              <li class="flex gap-3"><span class="mt-2.5 size-2 shrink-0 rounded-full bg-primary"></span><span>${p}</span></li>
            `)}
          </ul>
          ${slide.footnote ? html`<p class="m-0 text-sm text-muted-foreground">${slide.footnote} <a href="/" class="text-primary">Open the projects</a>.</p>` : ''}
        </section>
      `)}
    </div>
    <deck-nav total=${SLIDES.length}></deck-nav>
  `;
}
