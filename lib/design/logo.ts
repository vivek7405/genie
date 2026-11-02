import { html } from '@webjsdev/core';

// The lamp mark, drawn in the current text colour so a token colours it.
export function lampMark(size = 24) {
  return html`<svg viewBox="0 0 32 32" width=${size} height=${size} fill="currentColor" aria-hidden="true">
    <path d="M6 18.5h15.2c3 0 4.8-1.6 4.8-3.7 0-1.3-1-2.3-2.2-2.3-1 0-1.8.6-2.2 1.5l-.6 1.3c-.5 1.1-1.5 1.7-2.7 1.7H11c-2.2 0-3.9-.6-5-1.8Z"/>
    <path d="M9.5 18.5c.4 2.6 2.4 4.5 5 4.5s4.6-1.9 5-4.5Z"/>
    <path d="M11 24.5h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M13 6.5c-1.2 1.6 1.2 2.5 0 4.2M17 5c-1.2 1.6 1.2 2.5 0 4.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  </svg>`;
}
