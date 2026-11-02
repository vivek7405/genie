// Listens on /ws and reloads the named frame in place when the worker announces
// a change this page shows. It renders nothing: the board changing is the signal.
// With JS off the page is still correct, it just does not update on its own. A
// burst of changes coalesces into one reload.
import { WebComponent, html, connectWS, loadFrame } from '@webjsdev/core';
import { isChangeFor } from '../utils/live.ts';

const COALESCE_MS = 250;

export class LiveRefresh extends WebComponent({ projectId: String, taskId: String, frame: String }) {
  // Nothing on screen says this ships, so say it here.
  static interactive = true;

  #conn: ReturnType<typeof connectWS> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.projectId = '';
    this.taskId = '';
    this.frame = 'board';
  }

  connectedCallback() {
    super.connectedCallback();
    this.#conn = connectWS('/ws', {
      onMessage: (message: unknown) => {
        if (isChangeFor(message, this.projectId, this.taskId)) this.#schedule();
      },
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#conn?.close();
    this.#conn = null;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const el = document.getElementById(this.frame);
      if (el) void loadFrame(el, location.href);
    }, COALESCE_MS);
  }

  render() {
    return html``;
  }
}
LiveRefresh.register('live-refresh');
