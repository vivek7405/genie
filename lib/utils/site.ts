// site.ts: the shapes the public site's long pages are built from, the
// counterpart to lib/utils/ui.ts for the product. A site page is a run of
// sections at the site's measure; each section is a heading, one opening
// sentence, and a body slot. The helper owns only what must be identical
// everywhere (the rhythm, the anchor, the heading-to-lede relationship) and
// leaves the body's grid to the caller, so two sections never look like one
// template stamped twice.
import { html } from '@webjsdev/core';
import type { TemplateResult } from '@webjsdev/core';
import { cn } from '#lib/utils/cn.ts';
import { proseClass } from '#lib/utils/ui.ts';

/** The h2 a site section opens with. */
export const siteHeadingClass = (): string => 'm-0 text-title font-bold tracking-tight';

/** Body prose at the site's measure. */
export const siteProseClass = (): string => cn(proseClass(), 'text-body');

/** The instrument-panel voice, as the site uses it: a small uppercase monospace. */
export const siteVoiceClass = (): string => 'font-mono text-label uppercase tracking-[0.12em]';

/**
 * One section of a site page.
 *
 * `stacked` puts the lede under the heading, `split` puts it beside. Alternate
 * them by what a section is doing: a page where every section picks the same
 * one has only moved the template, not removed it. The lede must resolve with
 * nothing above it, because readers arrive mid-page from a link.
 */
export function section(opts: { id: string; heading: string; layout?: 'stacked' | 'split'; lede?: unknown; body: unknown }): TemplateResult {
  const h2 = siteHeadingClass();
  const prose = siteProseClass();
  return html`
    <section id=${opts.id} class="scroll-mt-24 border-t border-border py-16 md:py-24">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        ${opts.layout === 'split' && opts.lede
          ? html`<div class="grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-14"><h2 class=${cn(h2, 'max-w-[20ch]')}>${opts.heading}</h2><p class=${cn(prose, 'm-0 lg:pb-1')}>${opts.lede}</p></div>`
          : html`<h2 class=${h2}>${opts.heading}</h2>${opts.lede ? html`<p class=${cn(prose, 'mt-4 text-heading')}>${opts.lede}</p>` : ''}`}
        <div class="mt-10">${opts.body}</div>
      </div>
    </section>
  `;
}
