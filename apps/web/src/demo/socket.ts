import type { ServerToOverlay } from '@hyperion/shared';

// The overlay's connection to the server, as the overlay and the dashboard's live feed use it. The demo's screens
// (tokens starting "demo.", which a real token can't, as those are base64url) have no server: the dashboard tab
// running the demo sends their messages over a BroadcastChannel instead, which reaches its own preview frames and any
// other tab of this site.

export interface OverlaySocket {
  readonly readyState: number;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

export const DEMO_CHANNEL = 'hyperion-demo';
export const isDemoToken = (token: string) => token.startsWith('demo.');

// Socket -> demo: a socket saying it's there, so the demo sends it the state so far. Demo -> sockets: a message, for
// every socket unless it names one socket, one screen, or only the dashboard; or `hello?` when the demo starts, asking
// sockets opened before it to say hello again. `from` is the demo's own id: with the demo open in two tabs, a socket
// keeps to the one that answered it first, rather than showing both streams at once.
export type DemoHello = { type: 'hello'; socket: string; token: string; dashboard: boolean };
export type DemoEnvelope = { from: string } & (
  | { type: 'message'; socket?: string; token?: string; dashboard?: true; message: ServerToOverlay }
  | { type: 'hello?' }
);

export function openOverlaySocket(token: string, dashboard: boolean): OverlaySocket {
  if (!isDemoToken(token)) {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    return new WebSocket(`${protocol}://${location.host}/ws/overlay?token=${encodeURIComponent(token)}${dashboard ? '&dashboard=1' : ''}`);
  }
  const channel = new BroadcastChannel(DEMO_CHANNEL);
  const id = Math.random().toString(36).slice(2);
  let demo: string | undefined;
  const hello = () => channel.postMessage({ type: 'hello', socket: id, token, dashboard } satisfies DemoHello);
  const socket: OverlaySocket = {
    readyState: WebSocket.OPEN,
    onmessage: null,
    onclose: null,
    send: () => {}, // only debug reports, which the demo doesn't keep
    close: () => channel.close(),
  };
  channel.onmessage = (event: MessageEvent<DemoEnvelope | DemoHello>) => {
    const e = event.data;
    if (e.type === 'hello') return;
    if (e.type === 'hello?') return (demo = undefined), hello();
    if (!demo && e.socket === id) demo = e.from; // its answer to our hello
    if (e.from !== demo) return;
    if ((e.socket && e.socket !== id) || (e.token && e.token !== token) || (e.dashboard && !dashboard)) return;
    socket.onmessage?.(new MessageEvent('message', { data: JSON.stringify(e.message) }));
  };
  hello();
  return socket;
}
