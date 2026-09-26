import { html, asset } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { badgeClass } from '#components/ui/badge.ts';
import { cardClass } from '#components/ui/card.ts';
import { MARK, markArt, markSvg } from '#lib/design/logo.ts';
import { PALETTE } from '#lib/design/palette.ts';
import { fieldLabelClass, ledgerClass, ledgerRowClass, liveDot, pageHeader, proseClass } from '#lib/utils/ui.ts';
import { cn } from '#lib/utils/cn.ts';

export const metadata = {
  title: 'Brand',
  description: 'The Genie mark, the palette, the type and how the name is written, with the rules that keep them legible.',
};

// /brand: the guidelines. Three things this page keeps doing: the mark is
// RENDERED from lib/design/logo.ts, the same function the header uses; the
// swatches PAINT the live tokens and print the values from palette.ts; the
// clear-space and minimum-size rules are drawn, not described.

const SMALL_SIZES = [32, 24, 20, 16];

const FILES = [
  { file: 'genie-mark-ink.svg', name: 'Mark, ink', use: 'The default. Dark ink with no background of its own, for paper, white and any light surface.' },
  { file: 'genie-mark-paper.svg', name: 'Mark, paper', use: 'The same drawing in light ink, for dark surfaces, slides and terminals.' },
  { file: 'genie-mark-glow.svg', name: 'Mark, with the glow', use: 'Ink tail, glow orb. For the favicon, an avatar and the header. Only on a neutral surface.' },
];

const NAME_FORMS = [
  { form: 'Genie', ok: true, note: 'In a sentence, a heading or a title. It is a product name and takes a capital like any other.' },
  { form: 'genie', ok: true, note: 'Only as the wordmark beside the mark, and wherever it is typed: the package, the repository, a label, a command.' },
  { form: 'GENIE', ok: false, note: 'It is a word, never an acronym.' },
  { form: 'the genie', ok: false, note: 'No article. Genie plans, Genie builds, Genie ships.' },
];

const TYPE_STEPS: { cls: string; name: string; use: string }[] = [
  { cls: 'text-title font-bold tracking-tight', name: 'title', use: 'The one h1 a page opens with' },
  { cls: 'text-heading font-semibold tracking-tight', name: 'heading', use: 'A section within a page' },
  { cls: 'text-body', name: 'body', use: 'Prose, rows, controls' },
  { cls: 'text-meta text-muted-foreground', name: 'meta', use: 'The sentence under a heading, a timestamp' },
  { cls: fieldLabelClass(), name: 'label', use: 'A field name, a column header, a badge' },
];

function chapter(opts: { id: string; heading: string; lede?: unknown; body: unknown }) {
  return html`
    <section id=${opts.id} class="scroll-mt-24 border-t border-border py-12">
      <div class="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <div>
          <h2 class="m-0 text-heading font-semibold tracking-tight">${opts.heading}</h2>
          ${opts.lede ? html`<p class=${cn(proseClass(), 'm-0 mt-2 text-meta')}>${opts.lede}</p>` : ''}
        </div>
        <div class="min-w-0">${opts.body}</div>
      </div>
    </section>
  `;
}

function tile(tone: 'dark' | 'light') {
  return html`<div class="lab-${tone} grid aspect-4/3 flex-1 place-items-center">${markSvg(64)}</div>`;
}

function markCard() {
  return html`
    <article class=${cn(cardClass(), 'flex flex-col overflow-hidden')}>
      <div class="flex border-b border-border">${tile('dark')}${tile('light')}</div>
      <div class="flex flex-1 flex-col gap-4 p-5">
        <h3 class="m-0 text-heading font-semibold">${MARK.name}</h3>
        <div class="lab-paper flex items-end gap-5 border-y border-border py-3">
          ${SMALL_SIZES.map((px) => html`
            <span class="flex flex-col items-center gap-1.5">${markSvg(px)}<span class="font-mono text-label leading-none text-muted-foreground">${px}px</span></span>
          `)}
        </div>
        <p class=${cn(proseClass(), 'm-0 text-meta')}>${MARK.idea}</p>
        <p class="m-0 mt-auto pt-1 text-meta text-muted-foreground"><span class="font-semibold text-foreground">What may not change.</span> ${MARK.cost}</p>
      </div>
    </article>
  `;
}

function clearSpace() {
  return html`
    <div class=${cn(cardClass(), 'lab-paper grid place-items-center p-6')}>
      <svg viewBox="0 0 48 48" class="block h-auto w-full max-w-[14rem]" role="img" aria-label="The mark with clear space around it">
        <rect x="0.5" y="0.5" width="47" height="47" fill="none" stroke="var(--rule-strong)" stroke-width="0.5" stroke-dasharray="1.5 1.5" />
        <rect x="8" y="8" width="32" height="32" fill="none" stroke="var(--rule)" stroke-width="0.5" />
        <g transform="translate(8 8)">${markArt()}</g>
      </svg>
    </div>
  `;
}

function headerMock() {
  return html`
    <div class=${cn(cardClass(), 'overflow-hidden')}>
      <div class="flex h-14 items-center gap-3 px-4">
        <span class="mr-2 flex items-center gap-2 text-foreground" style="--logo-accent: var(--glow)">${markSvg(22)}<span class="font-mono text-body font-semibold tracking-tight">genie</span></span>
        <span class="rounded-sm bg-muted px-3 py-1.5 text-body font-medium">Projects</span>
        <span class="ml-auto"><span class=${buttonClass({ size: 'sm' })}>New task</span></span>
      </div>
    </div>
  `;
}

export default function BrandPage() {
  const printed = PALETTE.filter((s) => s.print);
  return html`
    <style>
      /* The two review tiles are fixed colours on purpose: they are the two
         backgrounds a logo file has to be correct on, so they must not follow
         the reader's theme. The values are the palette's deep ink and its
         elevated paper. */
      .lab-dark { background: #0f1013; color: #ebe8e1; }
      .lab-light { background: #fffdf9; color: #17181c; }
      .lab-paper { color: var(--ink); }
      ${PALETTE.map((s) => `.sw-${s.token} { background: var(--${s.token}); }`).join('\n      ')}
    </style>

    <div class="mx-auto max-w-6xl px-4 py-10 sm:px-6">
    ${pageHeader({
      title: 'The mark, the colours and the name',
      lede: 'Everything needed to show Genie somewhere other than this app: the mark as files, the rules that keep it legible, the palette, the type, and how the name is written.',
      actions: html`
        <a class=${cn(buttonClass({ size: 'sm' }), 'no-underline')} href=${asset('/public/brand/genie-mark-glow.svg')} download>Download the mark</a>
        <a class=${cn(buttonClass({ variant: 'outline', size: 'sm' }), 'no-underline')} href="#usage">Usage</a>`,
    })}

    ${chapter({
      id: 'mark',
      heading: 'The mark',
      lede: 'Shown on deep ink and on warm paper, because a drawing tuned against one goes muddy on the other. The strip is the same drawing at favicon and avatar sizes, where most marks fall apart.',
      body: html`
        <div class="grid gap-8 xl:grid-cols-[1fr_1fr] xl:items-start">
          ${markCard()}
          <ul class="m-0 list-none border-t border-border p-0">
            ${FILES.map((f) => html`
              <li class="flex flex-col gap-2 border-b border-border py-5">
                <div class="flex items-baseline justify-between gap-4">
                  <span class="font-semibold">${f.name}</span>
                  <a class="font-mono text-meta" href=${asset('/public/brand/' + f.file)} download>${f.file}</a>
                </div>
                <p class="m-0 max-w-[52ch] text-meta text-muted-foreground">${f.use}</p>
              </li>
            `)}
            <li class="max-w-[52ch] py-5 text-meta text-muted-foreground">Vector files with no background of their own. There is no file for the word, because the word is set in type.</li>
          </ul>
        </div>`,
    })}

    ${chapter({
      id: 'space',
      heading: 'Clear space and the smallest size',
      body: html`
        <div class="grid gap-8 md:grid-cols-[minmax(0,16rem)_1fr] md:items-center">
          ${clearSpace()}
          <div class="flex flex-col gap-6">
            <div><p class="m-0 mb-1.5 font-semibold">Keep a quarter of the mark clear on every side</p><p class=${cn(proseClass(), 'm-0 text-meta')}>The dashed line is the edge nothing else may cross and the inner box is the mark's own. Text, other logos and the edge of a card stay outside the dashed line.</p></div>
            <div><p class="m-0 mb-1.5 font-semibold">Sixteen pixels is the floor</p><p class=${cn(proseClass(), 'm-0 text-meta')}>At that size the gap between the tail and the orb is a single pixel. Any smaller and it closes up into a comma. Where the space is smaller than that, write the name instead.</p></div>
            <div><p class="m-0 mb-1.5 font-semibold">Leave the drawing alone</p><p class=${cn(proseClass(), 'm-0 text-meta')}>No outline, shadow, rotation or stretch. One ink at a time, plus the glow on the orb where the surface is neutral.</p></div>
          </div>
        </div>`,
    })}

    ${chapter({
      id: 'colour',
      heading: 'Colour',
      lede: 'Neutrals carry everything. The glow is rationed to the primary action and to live state, and it never tints a panel, never colours a heading, and never appears as a gradient. Light theme first, dark second.',
      body: html`
        <ul class="m-0 grid list-none gap-px overflow-hidden rounded-md border border-border bg-border p-0 md:grid-cols-2">
          ${printed.map((s) => html`
            <li class="flex items-center gap-4 bg-card p-4">
              <span class="sw-${s.token} block size-12 shrink-0 rounded-sm border border-border-strong"></span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="font-mono text-body font-semibold">${s.token}</span>
                <span class="text-meta text-muted-foreground">${s.role}</span>
                <span class="font-mono text-label text-muted-foreground">${s.light} ${s.dark}</span>
              </span>
            </li>
          `)}
        </ul>`,
    })}

    ${chapter({
      id: 'type',
      heading: 'Type',
      lede: 'Five steps, and only five. The system sans for everything a person reads; the system monospace for the name, labels and anything a machine would print. No font is downloaded.',
      body: html`
        <ul class=${ledgerClass()}>
          ${TYPE_STEPS.map((t) => html`
            <li class=${cn(ledgerRowClass(), 'cursor-default sm:grid-cols-[6rem_1fr_minmax(0,14rem)] hover:bg-transparent')}>
              <span class=${fieldLabelClass()}>${t.name}</span>
              <span class=${t.cls}>Plans it, builds it, ships it for review</span>
              <span class="text-meta text-muted-foreground">${t.use}</span>
            </li>
          `)}
        </ul>`,
    })}

    ${chapter({
      id: 'recipes',
      heading: 'Recipes',
      lede: 'The few shapes the product is built from. A page composes these rather than restating a class string.',
      body: html`
        <div class="grid gap-5 md:grid-cols-2">
          <div class=${cn(cardClass(), 'grid gap-4 p-5')}>
            <span class=${fieldLabelClass()}>Actions</span>
            <div class="flex flex-wrap items-center gap-2">
              <span class=${buttonClass()}>Approve and merge</span>
              <span class=${buttonClass({ variant: 'outline' })}>Send back</span>
              <span class=${buttonClass({ variant: 'ghost' })}>Cancel</span>
            </div>
            <p class="m-0 text-meta text-muted-foreground">One filled button per screen, the strongest action. Everything else is an outline or a ghost.</p>
          </div>
          <div class=${cn(cardClass(), 'grid gap-4 p-5')}>
            <span class=${fieldLabelClass()}>State</span>
            <div class="flex flex-wrap items-center gap-3">
              <span class=${badgeClass({ voice: true })}>Review</span>
              <span class=${badgeClass({ variant: 'secondary', voice: true })}>In progress</span>
              <span class=${badgeClass({ variant: 'outline', voice: true })}>Todo</span>
              <span class="inline-flex items-center gap-1.5 font-mono text-label uppercase tracking-[0.12em] text-muted-foreground">${liveDot(true)} live</span>
            </div>
            <p class="m-0 text-meta text-muted-foreground">A badge speaks in the label voice. The glow fills the one state that needs a person, and pulses where Genie is working.</p>
          </div>
          <div class=${cn(cardClass(), 'grid gap-4 p-5')}>
            <span class=${fieldLabelClass()}>Panel</span>
            <div class=${cn(cardClass(), 'p-4')}><p class="m-0 text-body">A hairline on elevated paper, square-ish corners, no shadow. Padding is set where the panel is used.</p></div>
          </div>
          <div class=${cn(cardClass(), 'grid gap-4 p-5')}>
            <span class=${fieldLabelClass()}>Ledger</span>
            <ul class=${ledgerClass()}>
              <li class=${cn(ledgerRowClass(), 'sm:grid-cols-[1fr_max-content]')}><span class="text-body font-semibold">shop</span><span class="text-meta text-muted-foreground">2 in review</span></li>
              <li class=${cn(ledgerRowClass(), 'sm:grid-cols-[1fr_max-content]')}><span class="text-body font-semibold">docs</span><span class="text-meta text-muted-foreground">no tasks yet</span></li>
            </ul>
            <p class="m-0 text-meta text-muted-foreground">A list of things is a ledger, not a grid of cards. A card promises a picture; a row has a name, a state and a time.</p>
          </div>
        </div>`,
    })}

    ${chapter({
      id: 'name',
      heading: 'Writing the name',
      lede: 'Beside the mark the name is set in the monospace at semibold, lowercase, as in the header below. In a sentence it is Genie, with a capital and in no special type.',
      body: html`
        <div class="flex flex-col gap-8">
          ${headerMock()}
          <dl class="m-0 border-t border-border">
            ${NAME_FORMS.map((n) => html`
              <div class="grid gap-x-6 gap-y-1 border-b border-border py-4 md:grid-cols-[8rem_5rem_1fr] md:items-baseline">
                <dt class=${cn('font-mono font-semibold', n.ok ? 'text-foreground' : 'text-muted-foreground line-through')}>${n.form}</dt>
                <dd class=${cn('m-0', fieldLabelClass())}>${n.ok ? 'use' : 'avoid'}</dd>
                <dd class="m-0 text-meta text-muted-foreground">${n.note}</dd>
              </div>
            `)}
          </dl>
        </div>`,
    })}

    ${chapter({
      id: 'usage',
      heading: 'Using the mark',
      body: html`
        <div class="flex flex-col gap-4">
          <p class=${cn(proseClass(), 'm-0')}>Use the mark and the name freely to refer to Genie: an article, a talk, a comparison, documentation for an integration, a note that something was built with it.</p>
          <p class=${cn(proseClass(), 'm-0')}>Ask first before using the name or the mark as part of another product's name or logo, on merchandise, or in any way that suggests Genie endorses something.</p>
        </div>`,
    })}
    </div>
  `;
}
