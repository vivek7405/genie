// ui.ts: the repeated MARKUP chunks, the counterpart to components/ui/.
// A repeated primitive with variants (button, input, badge) is a class helper
// under components/ui/; a repeated chunk of markup (a page masthead, an empty
// state, a labelled field, a ledger row) is an html fragment here. Both
// render at SSR time and ship no JavaScript.
//
// The shapes: a heading is bold and tight, prose runs one measure, a label
// beside a value is a small monospace, and a list of things is a hairline
// ledger rather than a grid of cards.
import { html } from '@webjsdev/core';
import type { TemplateResult } from '@webjsdev/core';
import { cn } from '#lib/utils/cn.ts';
import { cardClass } from '#components/ui/card.ts';

/** The instrument-panel voice: a small monospace uppercase label beside or under a value. */
export const fieldLabelClass = (): string => 'font-mono text-label uppercase tracking-[0.14em] text-muted-foreground';

/** Body copy under a heading. One measure, never full width. */
export const proseClass = (): string => 'max-w-[62ch] leading-[1.7] text-muted-foreground';

/** The interior padding every card body carries. */
export const cardBody = (): string => 'p-5';

/** The vertical rhythm between a page's sections. */
export const sectionGap = (): string => 'grid gap-10';

export function pageHeading(title: unknown): TemplateResult {
  return html`<h1 class="m-0 text-title font-bold tracking-tight">${title}</h1>`;
}

/**
 * The masthead of a page: the heading, the one sentence under it, and the
 * page's action on the right.
 */
export function pageHeader(opts: { title: unknown; lede?: unknown; actions?: unknown; above?: unknown }): TemplateResult {
  return html`
    <div class="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div class="min-w-0">
        ${opts.above ?? ''}
        ${pageHeading(opts.title)}
        ${opts.lede ? html`<p class=${cn(proseClass(), 'm-0 mt-2 text-body')}>${opts.lede}</p>` : ''}
      </div>
      ${opts.actions ? html`<div class="flex shrink-0 flex-wrap items-center gap-2 pt-1">${opts.actions}</div>` : ''}
    </div>
  `;
}

/** The h2 that opens a section, and the one sentence saying what it is for. */
export function sectionHeading(title: unknown, explanation: unknown): TemplateResult {
  return html`
    <div class="mb-4">
      <h2 class="m-0 text-heading font-semibold tracking-tight">${title}</h2>
      <p class="m-0 mt-1 max-w-[62ch] text-meta text-muted-foreground">${explanation}</p>
    </div>
  `;
}

/** What a section renders instead of itself when it has nothing in it. */
export function sectionEmpty(headline: unknown, fix: { text: unknown; href: string }): TemplateResult {
  return html`
    <div class="rounded-md border border-dashed border-border-strong px-6 py-12 text-center">
      <p class="m-0 text-body font-semibold">${headline}</p>
      <p class="m-0 mt-1 text-meta text-muted-foreground"><a href=${fix.href}>${fix.text}</a></p>
    </div>
  `;
}

/** A slim back link above a page heading. */
export function backLink(href: string, label: unknown): TemplateResult {
  return html`<a href=${href} class="mb-3 inline-flex items-center gap-1 text-meta text-muted-foreground no-underline transition-colors hover:text-foreground">&larr; ${label}</a>`;
}

/** The banner an action's error renders into. */
export function errorAlert(message: unknown): TemplateResult {
  return html`<div role="alert" class="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-body text-destructive">${message}</div>`;
}

/** The small print under a table or a form. */
export function footnote(content: unknown): TemplateResult {
  return html`<p class="m-0 mt-3 max-w-[62ch] text-meta text-muted-foreground">${content}</p>`;
}

/** A labelled control. id is required so no control lacks an accessible name. */
export function field(opts: { id: string; label: unknown; control: unknown; hint?: unknown; error?: unknown }): TemplateResult {
  return html`
    <div class="grid gap-1.5">
      <label class=${cn(fieldLabelClass(), 'leading-none')} for=${opts.id}>${opts.label}</label>
      ${opts.control}
      ${opts.hint ? html`<p class="m-0 text-meta text-muted-foreground">${opts.hint}</p>` : ''}
      ${opts.error ? html`<p class="m-0 text-meta text-destructive">${opts.error}</p>` : ''}
    </div>
  `;
}

/** A list of facts about one thing: a label in the panel voice and the value beside it. */
export function facts(rows: { label: unknown; value: unknown }[]): TemplateResult {
  return html`
    <dl class="m-0 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2.5 text-body">
      ${rows.map((r) => html`
        <dt class=${cn(fieldLabelClass(), 'pt-0.5')}>${r.label}</dt>
        <dd class="m-0 min-w-0 break-words">${r.value}</dd>
      `)}
    </dl>
  `;
}

/** A panel with the standard body padding. */
export function panel(content: unknown, extra?: string): TemplateResult {
  return html`<section class=${cn(cardClass(), cardBody(), extra)}>${content}</section>`;
}

/** The list a ledger's rows sit in. */
export const ledgerClass = (): string => '-mx-2 m-0 list-none border-t border-border p-0';

/** One row of a ledger: a hairline under each entry. Pass the column template as an extra class. */
export const ledgerRowClass = (): string =>
  'grid items-center gap-x-6 gap-y-1 border-b border-border px-2 py-3.5 transition-colors hover:bg-muted/40';

/** The live status dot: filled in the accent while something is happening. */
export function liveDot(on: boolean, title?: string): TemplateResult {
  return html`<span class=${cn('inline-block size-2 shrink-0 rounded-full', on ? 'animate-pulse bg-primary' : 'bg-muted-foreground/40')} title=${title ?? ''}></span>`;
}
