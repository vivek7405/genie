// The board's live channel. The framework registers every socket that
// upgrades here under /ws; the pipeline worker calls broadcast('/ws', ...)
// and never needs the socket itself.
type WSLike = {
  on(event: 'message' | 'close', cb: (data: Buffer) => void): void;
  send(msg: string): void;
};

export function WS(_ws: WSLike) {
  // Nothing to do per connection: the channel is server to client only.
}
