// Listens on /ws and reloads the named frame in place when the worker announces
// a change this page shows. With JS off the page is still correct, it just does
// not update on its own. A burst of changes coalesces into one reload.
import { WebComponent, html, signal, connectWS, loadFrame } from '@webjsdev/core';
import { isChangeFor } from '../utils/live.ts';

const COALESCE_MS = 250;

export class LiveRefresh extends WebComponent({ projectId: String, taskId: String, frame: String }) {
  private connected = signal(false);
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
      onOpen: () => this.connected.set(true),
      onClose: () => this.connected.set(false),
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
    const on = this.connected.get();
    return html`
      <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title=${on ? 'Updates arrive without a reload' : 'Reconnecting'}>
        <span class=${on ? 'genie-dot size-2 rounded-full bg-success' : 'size-2 rounded-full bg-muted-foreground/40'}></span>
        ${on ? 'Live' : 'Connecting'}
      </span>
    `;
  }
}
LiveRefresh.register('live-refresh');
