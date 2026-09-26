// <live-refresh project-id="..." frame="board">: listens on /ws and, when the
// worker announces a change to this project, reloads the named <webjs-frame>
// in place. With JS off the page is still correct, it just does not update on
// its own. The socket opens in connectedCallback (browser only) and closes in
// disconnectedCallback.
import { WebComponent, html, signal, connectWS, loadFrame } from '@webjsdev/core';
import { isBoardChangeFor } from '../utils/live.ts';

export class LiveRefresh extends WebComponent({ projectId: String, frame: String }) {
  private connected = signal(false);
  #conn: ReturnType<typeof connectWS> | null = null;

  constructor() {
    super();
    this.projectId = '';
    this.frame = 'board';
  }

  connectedCallback() {
    super.connectedCallback();
    this.#conn = connectWS('/ws', {
      onOpen: () => this.connected.set(true),
      onClose: () => this.connected.set(false),
      onMessage: (message: unknown) => {
        if (!isBoardChangeFor(message, this.projectId)) return;
        const frameEl = document.getElementById(this.frame);
        if (frameEl) void loadFrame(frameEl, location.href);
      },
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#conn?.close();
    this.#conn = null;
  }

  render() {
    const on = this.connected.get();
    return html`
      <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span class="size-2 rounded-full ${on ? 'bg-primary' : 'bg-muted-foreground/40'}"></span>
        ${on ? 'live' : 'connecting'}
      </span>
    `;
  }
}
LiveRefresh.register('live-refresh');
