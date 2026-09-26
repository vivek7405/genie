import { html } from '@webjsdev/core';

/**
 * The mark: a wisp.
 *
 * A rising tail and the orb it becomes, the moment a wish turns into a thing.
 * Authored on a 32-unit grid (the favicon grid) so nothing in it exists only
 * above 64 pixels. Ink is currentColor; a container that sets --logo-accent
 * gets the orb in the glow and everything else in ink.
 *
 * What may not change: the tail's curve and the gap between the tail's tip
 * and the orb. Close the gap and it is a comma; straighten the tail and it is
 * a lollipop.
 */
export const MARK = {
  name: 'Wisp',
  idea: 'Smoke rising from a lamp, ending in the orb it becomes. The gap between the two is the moment the task turns into a deliverable, and it is the one feature no other dot-and-tail mark has.',
  cost: 'A round orb with a tail sits close to a comma and to a comet. The gap and the curve of the tail are the only things holding those apart, so neither may be dropped at small sizes.',
};

const ACCENT_INK = 'var(--logo-accent, currentColor)';

export function markArt() {
  return html`
    <path d="M5.5 29.5 C4.5 22, 8.5 17.5, 15.5 17.5 C18.5 17.5, 19.6 16.6, 19.6 14.6" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" />
    <circle cx="22.5" cy="8.5" r="5.5" fill=${ACCENT_INK} />
  `;
}

/** The mark at a given pixel size, in the ink of its container. */
export function markSvg(px: number) {
  return html`<svg viewBox="0 0 32 32" width=${px} height=${px} class="block shrink-0" aria-hidden="true" focusable="false">${markArt()}</svg>`;
}

/** The mark as the app ships it, in the header. */
export function brandMark(px: number) {
  return markSvg(px);
}

/** The standalone SVG file, for download and the favicon. */
export function markFile(ink: string, accent: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <path d="M5.5 29.5 C4.5 22, 8.5 17.5, 15.5 17.5 C18.5 17.5, 19.6 16.6, 19.6 14.6" fill="none" stroke="${ink}" stroke-width="3.6" stroke-linecap="round"/>
  <circle cx="22.5" cy="8.5" r="5.5" fill="${accent}"/>
</svg>
`;
}
