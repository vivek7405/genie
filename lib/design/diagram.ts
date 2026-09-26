// The drawing kit for the architecture pages: a box, a frame, an arrow, a
// note, and the figure shell they sit in. Hand-authored inline SVG, laid out
// on an explicit coordinate grid, because an auto-layout engine draws the
// graph it was given rather than the mechanism a reader needs to see.
//
// Every stroke and fill is a palette token (lib/design/palette.ts) read at
// paint time through var(), so one drawing is correct in both themes and
// costs no request and no script. The glow marks ONE thing per figure, the
// path or the boundary the figure exists to show, and only ever as a stroke:
// it never fills a box or sits behind type.
//
// Marker ids are document-global, so arrowDefs() is rendered once per page
// and every arrow on that page references it.
import { html } from '@webjsdev/core';
import type { TemplateResult } from '@webjsdev/core';

const MONO = 'var(--font-mono)';

export type Tone =
  /** The ordinary case: a component drawn on the page. */
  | 'plain'
  /** A component the figure's claim is about. Heavier rule, no accent. */
  | 'strong'
  /** The one element the figure exists to point at. Glow hairline. */
  | 'signal'
  /** Context that is present but not the subject: a remote system, storage. */
  | 'sunken'
  /** Something gone, dead or refused. */
  | 'dead';

const TONE: Record<Tone, { fill: string; stroke: string; dash?: string }> = {
  plain: { fill: 'var(--paper-elev)', stroke: 'var(--rule)' },
  strong: { fill: 'var(--paper-elev)', stroke: 'var(--rule-strong)' },
  signal: { fill: 'var(--paper-elev)', stroke: 'var(--glow)' },
  sunken: { fill: 'var(--paper-sunken)', stroke: 'var(--rule)' },
  dead: { fill: 'var(--paper-sunken)', stroke: 'var(--rule)', dash: '3 3' },
};

function text(x: number, y: number, content: string, opts: { size: number; fill: string; anchor?: string; weight?: number }): TemplateResult {
  return html`<text x=${x} y=${y} text-anchor=${opts.anchor ?? 'middle'} font-family=${MONO} font-size=${opts.size} font-weight=${opts.weight ?? 400} fill=${opts.fill}>${content}</text>`;
}

/** A labelled box. `sub` is a second, smaller line for the detail that makes the label mean something. */
export function box(o: { x: number; y: number; w: number; h: number; label: string; sub?: string; tone?: Tone; small?: boolean }): TemplateResult {
  const t = TONE[o.tone ?? 'plain'];
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const size = o.small ? 10.5 : 12;
  return html`
    <g>
      <rect x=${o.x} y=${o.y} width=${o.w} height=${o.h} rx="3" fill=${t.fill} stroke=${t.stroke} stroke-width=${o.tone === 'signal' ? 1.5 : 1} stroke-dasharray=${t.dash ?? 'none'} />
      ${o.sub
        ? html`${text(cx, cy - 3, o.label, { size, fill: 'var(--ink)', weight: 500 })}${text(cx, cy + 11, o.sub, { size: 9.5, fill: 'var(--ink-subtle)' })}`
        : text(cx, cy + 4, o.label, { size, fill: 'var(--ink)', weight: 500 })}
    </g>
  `;
}

/** A grouping frame, captioned at its top-left so the caption cannot be mistaken for a component. */
export function frame(o: { x: number; y: number; w: number; h: number; label: string; tone?: Tone; children?: unknown }): TemplateResult {
  const t = TONE[o.tone ?? 'sunken'];
  return html`
    <g>
      <rect x=${o.x} y=${o.y} width=${o.w} height=${o.h} rx="4" fill=${t.fill} stroke=${t.stroke} stroke-width="1" stroke-dasharray=${t.dash ?? 'none'} />
      ${text(o.x + 10, o.y + 16, o.label, { size: 10.5, fill: 'var(--ink-muted)', anchor: 'start' })}
      ${o.children ?? ''}
    </g>
  `;
}

export type ArrowKind =
  /** An ordinary call or data movement. */
  | 'solid'
  /** Something continuous and in the background: a poll, a heartbeat. */
  | 'dashed'
  /** The path the figure is about. */
  | 'signal';

const ARROW: Record<ArrowKind, { stroke: string; dash?: string; head: string }> = {
  solid: { stroke: 'var(--ink-muted)', head: 'url(#dg-head)' },
  dashed: { stroke: 'var(--ink-subtle)', dash: '4 4', head: 'url(#dg-head)' },
  signal: { stroke: 'var(--glow)', head: 'url(#dg-head-signal)' },
};

/** A labelled arrow along a path. An unlabelled arrow says only "related somehow", so pass a label or an empty string on purpose. */
export function arrow(o: { d: string; label: string; lx?: number; ly?: number; kind?: ArrowKind; anchor?: 'start' | 'middle' | 'end'; both?: boolean }): TemplateResult {
  const a = ARROW[o.kind ?? 'solid'];
  return html`
    <g>
      <path d=${o.d} fill="none" stroke=${a.stroke} stroke-width="1.25" stroke-dasharray=${a.dash ?? 'none'} marker-end=${a.head} marker-start=${o.both ? a.head : 'none'} />
      ${o.label ? text(o.lx ?? 0, o.ly ?? 0, o.label, { size: 9.5, fill: 'var(--ink-subtle)', anchor: o.anchor ?? 'middle' }) : ''}
    </g>
  `;
}

/** Free-standing text for a note that belongs to no box. */
export function note(o: { x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end'; strong?: boolean }): TemplateResult {
  return text(o.x, o.y, o.text, { size: o.strong ? 10.5 : 9.5, fill: o.strong ? 'var(--ink-muted)' : 'var(--ink-subtle)', anchor: o.anchor ?? 'start' });
}

/** The arrowheads a page's figures reference. Render once, near the top of the page. */
export function arrowDefs(): TemplateResult {
  return html`
    <svg width="0" height="0" aria-hidden="true" class="absolute overflow-hidden" focusable="false">
      <defs>
        <marker id="dg-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--ink-muted)" />
        </marker>
        <marker id="dg-head-signal" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--glow)" />
        </marker>
      </defs>
    </svg>
  `;
}

/**
 * The figure shell: a panel holding the drawing, and a caption stating the one
 * claim the picture makes. The svg carries that claim as its aria-label, so a
 * reader who cannot see the drawing gets the sentence. Below `minW` the figure
 * scrolls rather than shrinking, because a wide drawing squeezed into a phone
 * viewport becomes unreadable type rather than a smaller picture.
 */
export function figure(o: { label: string; caption?: unknown; viewBox: string; minW: string; body: unknown }): TemplateResult {
  return html`
    <figure class="m-0">
      <div class="overflow-x-auto rounded-md border border-border bg-card px-4 py-5 md:px-6">
        <svg role="img" aria-label=${o.label} viewBox=${o.viewBox} class=${'h-auto w-full ' + o.minW} xmlns="http://www.w3.org/2000/svg">${o.body}</svg>
      </div>
      <figcaption class="mt-3 max-w-[74ch] text-meta text-muted-foreground">${o.caption ?? o.label}</figcaption>
    </figure>
  `;
}
