import type { KeyAction, ViewerEvent } from '@hyperion/shared';
import type { Decision, EngineCommand, EngineContext } from './types.js';

// The enabled command a comment names, if any, and if the viewer's level and points allow it.
// The whole comment must be the keyword.
export function matchComment(ctx: EngineContext, event: Extract<ViewerEvent, { kind: 'comment' }>): EngineCommand | undefined {
  const keyword = event.text.trim().toLowerCase();
  const command = ctx.config.commands.find((c) => c.enabled && c.keyword === keyword);
  if (command && ctx.config.levelGating && ctx.levelOf(event.viewerId) < command.minLevel) {
    ctx.note?.('refused', event.viewerId, { keyword, reason: 'level' });
    return undefined;
  }
  // Only checked here; the points are spent when the command fires, so a losing vote costs nothing.
  if (command && ctx.config.points && command.cost > 0 && ctx.pointsOf(event.viewerId) < command.cost) {
    ctx.note?.('refused', event.viewerId, { keyword, reason: 'points' });
    return undefined;
  }
  return command;
}

const toAction = (ctx: EngineContext, command: EngineCommand): KeyAction => ({
  id: ctx.newId(),
  key: command.key,
  holdMs: command.holdMs,
  ...(command.macro && { macro: command.macro }),
});

// What a command runs, with each start time: a chain's steps, skipping any since deleted or turned off.
function presses(ctx: EngineContext, command: EngineCommand) {
  if (!command.chain) return [{ command, delayMs: 0 }];
  return command.chain.flatMap(({ keyword, delayMs }) => {
    const step = ctx.config.commands.find((c) => c.enabled && !c.chain && c.keyword === keyword);
    return step ? [{ command: step, delayMs }] : [];
  });
}

// How long a command takes, so repeats of it don't overlap. A macro's length is only known to the companion.
export function spanOf(ctx: EngineContext, command: EngineCommand) {
  return Math.max(0, ...presses(ctx, command).map((p) => p.delayMs + p.command.holdMs));
}

export function decide(ctx: EngineContext, command: EngineCommand, viewer: string, credit: string[], delayMs?: number): Decision {
  const steps = presses(ctx, command).sort((a, b) => a.delayMs - b.delayMs);
  const [first, ...rest] = steps;
  return {
    // A chain with no steps left has nothing to send.
    action: first ? { ...toAction(ctx, first.command) } : { id: ctx.newId(), key: '', holdMs: command.holdMs },
    ...(rest.length > 0 && { then: rest.map((s) => ({ action: toAction(ctx, s.command), delayMs: s.delayMs - first!.delayMs })) }),
    keyword: command.keyword,
    viewer,
    credit,
    cost: ctx.config.points ? command.cost : 0,
    ...(delayMs !== undefined && { delayMs }),
  };
}

// Sliding one-second window of actionsPerSecond across all viewers.
export function createRateLimit(ctx: EngineContext) {
  const recent: number[] = [];
  return {
    take(): boolean {
      const t = ctx.now();
      while (recent.length > 0 && t - recent[0]! >= 1000) recent.shift();
      if (recent.length >= ctx.config.actionsPerSecond) return false;
      recent.push(t);
      return true;
    },
  };
}
