import type { WebSocket } from 'ws';
import type { RunningGame, ServerToCompanion, ServerToOverlay } from '@hyperion/shared';

const WINDOWS_TIMEOUT_MS = 2500;

// Tracks open sockets per host. In-memory: one server process owns its hosts' sockets.
export class Hub {
  private companions = new Map<string, Map<string, WebSocket>>(); // hostId -> companionId -> socket
  private macros = new Map<string, string[]>(); // companionId -> names of the macros on that PC, while connected
  private gameActions = new Map<string, string[]>(); // companionId -> names of its game actions, while connected
  private windowWaiters = new Map<string, Set<(windows: RunningGame[]) => void>>(); // companionId -> asked for its windows
  // hostId -> socket -> its screen, and whether it's the dashboard watching rather than a real overlay
  private overlays = new Map<string, Map<WebSocket, { screenId: string; dashboard: boolean }>>();

  addCompanion(hostId: string, companionId: string, socket: WebSocket) {
    let sockets = this.companions.get(hostId);
    if (!sockets) this.companions.set(hostId, (sockets = new Map()));
    sockets.get(companionId)?.close(4002, 'Replaced by a newer connection');
    sockets.set(companionId, socket);
    socket.on('close', () => {
      if (sockets.get(companionId) === socket) {
        sockets.delete(companionId);
        this.macros.delete(companionId);
        this.gameActions.delete(companionId);
        this.setWindows(companionId, []);
        this.windowWaiters.delete(companionId);
      }
    });
  }

  setMacros(companionId: string, names: string[]) {
    this.macros.set(companionId, names);
  }

  macrosOf(hostId: string) {
    const ids = [...(this.companions.get(hostId)?.keys() ?? [])];
    return [...new Set(ids.flatMap((id) => this.macros.get(id) ?? []))].sort();
  }

  setGameActions(companionId: string, names: string[]) {
    this.gameActions.set(companionId, names);
  }

  gameActionsOf(hostId: string) {
    const ids = [...(this.companions.get(hostId)?.keys() ?? [])];
    return [...new Set(ids.flatMap((id) => this.gameActions.get(id) ?? []))].sort();
  }

  // Asks each of the host's companions which programs have a window open. A companion from before it could answer
  // never does, so each gets a moment and then counts as not answering.
  async runningGames(hostId: string): Promise<{ companions: number; answered: number; games: RunningGame[] }> {
    const sockets = [...(this.companions.get(hostId) ?? [])];
    const lists = await Promise.all(
      sockets.map(
        ([companionId, socket]) =>
          new Promise<RunningGame[] | null>((resolve) => {
            let waiters = this.windowWaiters.get(companionId);
            if (!waiters) this.windowWaiters.set(companionId, (waiters = new Set()));
            const done = (windows: RunningGame[] | null) => {
              clearTimeout(timer);
              waiters.delete(answer);
              resolve(windows);
            };
            const answer = (windows: RunningGame[]) => done(windows);
            const timer = setTimeout(() => done(null), WINDOWS_TIMEOUT_MS);
            waiters.add(answer);
            socket.send(JSON.stringify({ type: 'listWindows' } satisfies ServerToCompanion));
          }),
      ),
    );
    const answered = lists.filter((l) => l !== null);
    // The same program on two PCs shows once.
    const games = new Map<string, RunningGame>();
    for (const game of answered.flat()) if (!games.has(game.process)) games.set(game.process, game);
    return { companions: sockets.length, answered: answered.length, games: [...games.values()] };
  }

  setWindows(companionId: string, windows: RunningGame[]) {
    for (const answer of [...(this.windowWaiters.get(companionId) ?? [])]) answer(windows);
  }

  addOverlay(hostId: string, screenId: string, socket: WebSocket, dashboard = false) {
    let sockets = this.overlays.get(hostId);
    if (!sockets) this.overlays.set(hostId, (sockets = new Map()));
    sockets.set(socket, { screenId, dashboard });
    socket.on('close', () => sockets.delete(socket));
  }

  // Real overlays (not the dashboard) open on any of these screens.
  overlayCount(hostId: string, screenIds: string[]) {
    return [...(this.overlays.get(hostId)?.values() ?? [])].filter((o) => !o.dashboard && screenIds.includes(o.screenId)).length;
  }

  companionCount(hostId: string) {
    return this.companions.get(hostId)?.size ?? 0;
  }

  disconnectCompanion(companionId: string) {
    for (const sockets of this.companions.values()) {
      sockets.get(companionId)?.close(4003, 'Companion revoked');
    }
  }

  // The account was deleted: every companion and overlay of the host goes at once.
  disconnectHost(hostId: string) {
    for (const socket of this.companions.get(hostId)?.values() ?? []) socket.close(4003, 'Account deleted');
    for (const socket of this.overlays.get(hostId)?.keys() ?? []) socket.close(4001, 'Account deleted');
  }

  sendToCompanions(hostId: string, message: ServerToCompanion) {
    send(this.companions.get(hostId)?.values(), message);
  }

  sendToOverlays(hostId: string, message: ServerToOverlay) {
    send(this.overlays.get(hostId)?.keys(), message);
  }

  // Only the overlays open on one screen; `close` disconnects them (the screen was deleted).
  sendToScreen(hostId: string, screenId: string, message: ServerToOverlay | null) {
    const sockets = [...(this.overlays.get(hostId) ?? [])].filter(([, o]) => o.screenId === screenId).map(([socket]) => socket);
    if (message) send(sockets, message);
    else for (const socket of sockets) socket.close(4001, 'Screen deleted or link replaced');
  }
}

function send(sockets: Iterable<WebSocket> | undefined, message: unknown) {
  if (!sockets) return;
  const data = JSON.stringify(message);
  for (const socket of sockets) socket.send(data);
}
