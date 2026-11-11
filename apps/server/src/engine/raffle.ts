import { decide, matchComment } from './common.js';
import type { Engine, EngineContext } from './types.js';

// Raffle: the first command typed opens a draw; when it closes, one entrant is picked at random and only their command
// fires. Suits big commands (spawning something) where every comment firing would be too much. One entry per viewer
// per draw (a new command replaces the old); with gift boosts on, each gift adds an extra entry.
export function createRaffle(ctx: EngineContext): Engine {
  let draw: { endsAt: number; entries: Map<string, string>; boosts: Map<string, number> } | null = null;
  // The command that won the last draw, and when, so the overlay can show it fresh each time.
  let last: { command: string; at: number } | null = null;

  return {
    handle(event) {
      if (event.kind === 'comment') {
        const command = matchComment(ctx, event);
        if (!command) return [];
        draw ??= { endsAt: ctx.now() + ctx.config.raffleMs, entries: new Map(), boosts: new Map() };
        draw.entries.set(event.viewerId, command.keyword);
      } else if (event.kind === 'gift' && ctx.config.giftBoosts && draw?.entries.has(event.viewerId)) {
        draw.boosts.set(event.viewerId, (draw.boosts.get(event.viewerId) ?? 0) + event.count);
      }
      return [];
    },

    tick() {
      if (!draw || ctx.now() < draw.endsAt) return [];
      const tickets = [...draw.entries].map(([viewer, keyword]) => ({ viewer, keyword, weight: 1 + (draw!.boosts.get(viewer) ?? 0) }));
      draw = null;
      let roll = (ctx.random ?? Math.random)() * tickets.reduce((sum, t) => sum + t.weight, 0);
      const winner = tickets.find((t) => (roll -= t.weight) < 0) ?? tickets[tickets.length - 1];
      const command = ctx.config.commands.find((c) => c.enabled && c.keyword === winner?.keyword);
      if (!winner || !command) return [];
      last = { command: command.keyword, at: ctx.now() };
      return [decide(ctx, command, winner.viewer, [winner.viewer])];
    },

    state: () => ({ mode: 'raffle', entrants: draw?.entries.size ?? 0, endsAt: draw?.endsAt ?? null, lastCommand: last?.command ?? null, lastDrawAt: last?.at ?? null }),
  };
}
