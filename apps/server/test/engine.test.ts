import { describe, expect, it } from 'vitest';
import type { Mode, ViewerEvent } from '@hyperion/shared';
import { createEngine, keyPresses, type EngineConfig } from '../src/engine/index.js';
import { IDLE_MS } from '../src/engine/queue.js';
import type { EngineCommand } from '../src/engine/types.js';

const left: EngineCommand = { keyword: 'left', key: 'KeyA', holdMs: 300, cooldownMs: 1000, enabled: true, minLevel: 1, cost: 0 };
const right: EngineCommand = { keyword: 'right', key: 'KeyD', holdMs: 300, cooldownMs: 1000, enabled: true, minLevel: 1, cost: 0 };
const jump: EngineCommand = { keyword: 'jump', key: 'Space', holdMs: 100, cooldownMs: 0, enabled: true, minLevel: 1, cost: 0 };

const comment = (viewerId: string, text: string): ViewerEvent => ({ kind: 'comment', viewerId, text, at: 0 });
const gift = (viewerId: string, giftName: string, count = 1): ViewerEvent => ({
  kind: 'gift',
  viewerId,
  giftId: 1,
  giftName,
  count,
  diamonds: 1,
  at: 0,
});

function setup(mode: Mode, config: Partial<EngineConfig> = {}, levels: Record<string, number> = {}, points: Record<string, number> = {}) {
  let t = 0;
  let id = 0;
  const ctx = {
    config: {
      commands: [left, right, jump],
      actionsPerSecond: 100,
      voteWindowMs: 3000,
      turnMs: 30000,
      raffleMs: 10000,
      giftBoosts: true,
      levelGating: false,
      points: false,
      ...config,
    },
    now: () => t,
    newId: () => `a${++id}`,
    levelOf: (viewerId: string) => levels[viewerId] ?? 1,
    pointsOf: (viewerId: string) => points[viewerId] ?? 0,
  };
  const engine = createEngine(mode, ctx);
  const keys = (decisions: { action: { key: string } }[]) => decisions.map((d) => d.action.key);
  return {
    engine,
    ctx,
    advance: (ms: number) => (t += ms),
    // Keys pressed by an event; for time-based modes, call tick() separately.
    press: (event: ViewerEvent) => keys(engine.handle(event)),
    tick: () => keys(engine.tick()),
  };
}

describe('anarchy mode', () => {
  it('turns a matching comment into a key action', () => {
    const { engine } = setup('anarchy');
    expect(engine.handle(comment('alice', 'left'))).toEqual([
      { action: { id: 'a1', key: 'KeyA', holdMs: 300 }, keyword: 'left', viewer: 'alice', credit: ['alice'], cost: 0 },
    ]);
  });

  it('matches the whole comment, ignoring case and surrounding spaces', () => {
    const { press } = setup('anarchy');
    expect(press(comment('alice', '  LeFt '))).toEqual(['KeyA']);
    expect(press(comment('bob', 'go left'))).toEqual([]);
    expect(press(comment('bob', 'lefty'))).toEqual([]);
  });

  it('ignores non-comment events and disabled commands', () => {
    const { press } = setup('anarchy', { commands: [{ ...left, enabled: false }] });
    expect(press(comment('alice', 'left'))).toEqual([]);
    expect(press({ kind: 'follow', viewerId: 'alice', at: 0 })).toEqual([]);
  });

  it('applies the cooldown per viewer and per command', () => {
    const { press, advance } = setup('anarchy');
    expect(press(comment('alice', 'left'))).toHaveLength(1);
    expect(press(comment('alice', 'left'))).toHaveLength(0); // same viewer, cooling down
    expect(press(comment('bob', 'left'))).toHaveLength(1); // other viewer unaffected
    expect(press(comment('alice', 'jump'))).toHaveLength(1); // other command unaffected
    advance(999);
    expect(press(comment('alice', 'left'))).toHaveLength(0);
    advance(1);
    expect(press(comment('alice', 'left'))).toHaveLength(1);
  });

  it('caps total actions per second across all viewers', () => {
    const { press, advance } = setup('anarchy', { actionsPerSecond: 2 });
    expect(press(comment('a', 'jump'))).toHaveLength(1);
    expect(press(comment('b', 'jump'))).toHaveLength(1);
    expect(press(comment('c', 'jump'))).toHaveLength(0);
    advance(1000);
    expect(press(comment('c', 'jump'))).toHaveLength(1);
  });

  it('does not start a cooldown for a comment dropped by the rate limit', () => {
    const { press, advance } = setup('anarchy', { actionsPerSecond: 1 });
    expect(press(comment('a', 'left'))).toHaveLength(1);
    expect(press(comment('b', 'left'))).toHaveLength(0); // rate-limited
    advance(1000);
    expect(press(comment('b', 'left'))).toHaveLength(1);
  });

  it('applies config changes without losing cooldowns', () => {
    const { press, ctx } = setup('anarchy');
    expect(press(comment('alice', 'left'))).toEqual(['KeyA']);
    ctx.config = { ...ctx.config, commands: [{ ...left, key: 'KeyQ' }] };
    expect(press(comment('alice', 'left'))).toEqual([]); // still cooling down
    expect(press(comment('bob', 'left'))).toEqual(['KeyQ']);
  });
});

describe('democracy mode', () => {
  it('fires the most-voted command once when the window closes', () => {
    const { engine, press, tick, advance } = setup('democracy');
    expect(press(comment('a', 'left'))).toEqual([]);
    press(comment('b', 'right'));
    press(comment('c', 'right'));
    expect(engine.state()).toEqual({
      mode: 'democracy',
      tally: [
        { keyword: 'right', votes: 2 },
        { keyword: 'left', votes: 1 },
      ],
      endsAt: 3000,
      lastCommand: null,
      lastVotes: null,
      lastDrawAt: null,
    });
    advance(2999);
    expect(tick()).toEqual([]);
    advance(1);
    const [decision, ...rest] = engine.tick();
    expect(rest).toEqual([]);
    expect(decision).toMatchObject({ action: { key: 'KeyD' }, viewer: '2 votes', credit: ['b', 'c'] });
    expect(engine.state()).toEqual({ mode: 'democracy', tally: [], endsAt: null, lastCommand: 'right', lastVotes: 2, lastDrawAt: 3000 });
    expect(tick()).toEqual([]);
  });

  it('counts one vote per viewer, keeping the latest', () => {
    const { press, tick, advance } = setup('democracy');
    press(comment('a', 'left'));
    press(comment('a', 'left'));
    press(comment('b', 'right'));
    press(comment('a', 'right')); // a changes their vote
    advance(3000);
    expect(tick()).toEqual(['KeyD']);
  });

  it('breaks ties in favour of the command voted first', () => {
    const { press, tick, advance } = setup('democracy');
    press(comment('a', 'right'));
    press(comment('b', 'left'));
    advance(3000);
    expect(tick()).toEqual(['KeyD']);
  });

  it('lets gifts add votes to the gifter’s current vote', () => {
    const { press, tick, advance, engine } = setup('democracy');
    press(comment('a', 'left'));
    press(comment('b', 'right'));
    press(comment('c', 'right'));
    press(gift('a', 'Rose', 5));
    expect(engine.state()).toMatchObject({ tally: [{ keyword: 'left', votes: 6 }, { keyword: 'right', votes: 2 }] });
    advance(3000);
    expect(tick()).toEqual(['KeyA']);
  });

  it('ignores gift boosts when the host turned them off', () => {
    const { press, tick, advance } = setup('democracy', { giftBoosts: false });
    press(comment('a', 'left'));
    press(comment('b', 'right'));
    press(comment('c', 'right'));
    press(gift('a', 'Rose', 5));
    advance(3000);
    expect(tick()).toEqual(['KeyD']);
  });
});

describe('raffle mode', () => {
  it('runs one random entrant’s command when the draw closes', () => {
    const { engine, ctx, press, tick, advance } = setup('raffle');
    expect(press(comment('alice', 'left'))).toEqual([]);
    press(comment('bob', 'right'));
    press(comment('cara', 'jump'));
    expect(engine.state()).toEqual({ mode: 'raffle', entrants: 3, endsAt: 10000, lastCommand: null, lastDrawAt: null });
    advance(9999);
    expect(tick()).toEqual([]);
    advance(1);
    Object.assign(ctx, { random: () => 0.5 }); // the middle of three entries
    const [won, ...others] = engine.tick();
    expect(others).toEqual([]);
    expect(won).toMatchObject({ action: { key: 'KeyD' }, keyword: 'right', viewer: 'bob', credit: ['bob'] });
    expect(engine.state()).toEqual({ mode: 'raffle', entrants: 0, endsAt: null, lastCommand: 'right', lastDrawAt: 10000 });
  });

  it('keeps one entry per viewer, their latest command', () => {
    const { ctx, press, tick, advance } = setup('raffle');
    press(comment('alice', 'left'));
    press(comment('alice', 'jump'));
    advance(10000);
    Object.assign(ctx, { random: () => 0 });
    expect(tick()).toEqual(['Space']);
  });

  it('gives a gifting entrant extra chances when gift boosts are on', () => {
    const boosted = setup('raffle');
    boosted.press(comment('alice', 'left'));
    boosted.press(comment('bob', 'right'));
    boosted.press(gift('bob', 'Rose', 3)); // bob: 4 entries of 5
    boosted.advance(10000);
    Object.assign(boosted.ctx, { random: () => 0.3 }); // 1.5 of 5: past alice's one entry
    expect(boosted.tick()).toEqual(['KeyD']);

    const plain = setup('raffle', { giftBoosts: false });
    plain.press(comment('alice', 'left'));
    plain.press(comment('bob', 'right'));
    plain.press(gift('bob', 'Rose', 3));
    plain.advance(10000);
    Object.assign(plain.ctx, { random: () => 0.3 }); // 0.6 of 2: alice
    expect(plain.tick()).toEqual(['KeyA']);
  });

  it('does nothing until someone enters, and skips a command turned off meanwhile', () => {
    const { ctx, press, tick, advance } = setup('raffle');
    advance(20000);
    expect(tick()).toEqual([]);
    press(comment('alice', 'left'));
    ctx.config.commands = [right, jump];
    advance(10000);
    expect(tick()).toEqual([]);
  });
});

describe('queue mode', () => {
  it('gives control to one viewer at a time, in join order', () => {
    const { engine, press, tick, advance } = setup('queue', { turnMs: 5000 });
    press(comment('a', 'join'));
    press(comment('b', 'JOIN'));
    press(comment('a', 'join')); // already waiting
    tick();
    expect(engine.state()).toEqual({ mode: 'queue', viewer: 'a', endsAt: 5000, queue: ['b'] });

    expect(press(comment('b', 'left'))).toEqual([]); // not b's turn
    expect(press(comment('a', 'left'))).toEqual(['KeyA']);
    expect(press(comment('a', 'left'))).toEqual(['KeyA']); // no per-command cooldown on your turn

    advance(5000);
    tick();
    expect(engine.state()).toMatchObject({ viewer: 'b', queue: [] });
    expect(press(comment('a', 'left'))).toEqual([]);
    expect(press(comment('b', 'right'))).toEqual(['KeyD']);
  });

  it('ends a turn early when the viewer goes idle', () => {
    const { engine, press, tick, advance } = setup('queue');
    press(comment('a', 'join'));
    press(comment('b', 'join'));
    tick();
    advance(IDLE_MS - 1);
    tick();
    expect(engine.state()).toMatchObject({ viewer: 'a' });
    advance(1);
    tick();
    expect(engine.state()).toMatchObject({ viewer: 'b' });
  });

  it('moves a gifter to the front of the line', () => {
    const { engine, press, tick } = setup('queue');
    press(comment('a', 'join'));
    tick();
    press(comment('b', 'join'));
    press(comment('c', 'join'));
    press(gift('c', 'Rose'));
    press(gift('d', 'Rose')); // gifting also joins
    press(gift('a', 'Rose')); // the current player isn't re-queued
    expect(engine.state()).toMatchObject({ viewer: 'a', queue: ['d', 'c', 'b'] });
  });
});

describe('macros and chains', () => {
  const run = { ...left, keyword: 'run', key: 'ShiftLeft', holdMs: 500 };
  const hop = { ...jump, keyword: 'hop', key: 'Space', holdMs: 200 };
  const leap = { ...left, keyword: 'leap', key: '', chain: [{ keyword: 'run', delayMs: 0 }, { keyword: 'hop', delayMs: 100 }] };

  it('asks the companion for a macro by name', () => {
    const macro = { ...left, keyword: 'dance', key: '', macro: 'dance move' };
    const { engine } = setup('anarchy', { commands: [macro] });
    expect(engine.handle(comment('a', 'dance'))[0]!.action).toMatchObject({ key: '', macro: 'dance move' });
  });

  it('asks the companion for a game action by name, with the gift count for its blanks', () => {
    const rain = { ...left, keyword: 'rain', key: '', gameAction: 'creeper rain' };
    const { engine, ctx } = setup('anarchy', { commands: [rain] });
    expect(engine.handle(comment('a', 'rain'))[0]!.action).toMatchObject({ key: '', gameAction: 'creeper rain' });
    expect(keyPresses(ctx, 'rain', 'alice', 2, 7).map((d) => [d.action.gameAction, d.count])).toEqual([
      ['creeper rain', 7],
      ['creeper rain', 7],
    ]);
  });

  it('runs a chain from one comment, each step at its time', () => {
    const { engine } = setup('anarchy', { commands: [run, hop, leap] });
    const [decision, ...others] = engine.handle(comment('a', 'leap'));
    expect(others).toEqual([]);
    expect(decision).toMatchObject({ keyword: 'leap', action: { key: 'ShiftLeft', holdMs: 500 }, then: [{ action: { key: 'Space', holdMs: 200 }, delayMs: 100 }] });
  });

  it('runs steps that start together together, and in time order', () => {
    const together = { ...leap, chain: [{ keyword: 'hop', delayMs: 300 }, { keyword: 'run', delayMs: 100 }] };
    const { engine } = setup('anarchy', { commands: [run, hop, together] });
    const decision = engine.handle(comment('a', 'leap'))[0]!;
    expect(decision.action.key).toBe('ShiftLeft');
    expect(decision.then).toMatchObject([{ action: { key: 'Space' }, delayMs: 200 }]);
  });

  it('skips steps turned off or deleted, and never follows a chain inside a chain', () => {
    const inner = { ...leap, keyword: 'inner' };
    const outer = { ...leap, keyword: 'outer', chain: [{ keyword: 'inner', delayMs: 0 }, { keyword: 'gone', delayMs: 0 }, { keyword: 'run', delayMs: 0 }, { keyword: 'hop', delayMs: 0 }] };
    const { engine } = setup('anarchy', { commands: [run, { ...hop, enabled: false }, inner, outer] });
    const decision = engine.handle(comment('a', 'outer'))[0]!;
    expect(decision.action.key).toBe('ShiftLeft');
    expect(decision.then).toBeUndefined();
  });

  it('has nothing to send with no steps left', () => {
    const { engine } = setup('anarchy', { commands: [{ ...leap, chain: [] }] });
    expect(engine.handle(comment('a', 'leap'))[0]!.action).toMatchObject({ key: '' });
    expect(engine.handle(comment('b', 'leap'))[0]!.action.macro).toBeUndefined();
  });

  it('spaces repeats of a chain by its whole length', () => {
    const { ctx } = setup('anarchy', { commands: [run, hop, leap] });
    expect(keyPresses(ctx, 'leap', 'alice', 2).map((d) => d.delayMs)).toEqual([undefined, 600]);
  });
});

describe('action key presses', () => {
  it('press their command, spaced out, once per repeat', () => {
    const { ctx } = setup('anarchy');
    expect(keyPresses(ctx, 'jump', 'alice', 3).map((d) => [d.action.key, d.delayMs, d.credit])).toEqual([
      ['Space', undefined, []],
      ['Space', 200, []],
      ['Space', 400, []],
    ]);
  });

  it('skip commands that are off or missing', () => {
    const { ctx } = setup('anarchy', { commands: [{ ...jump, enabled: false }] });
    expect(keyPresses(ctx, 'jump', 'alice', 1)).toEqual([]);
    expect(keyPresses(ctx, 'nope', 'alice', 1)).toEqual([]);
  });

  it('leave gift-only mode with nothing for chat to do', () => {
    const { press, engine } = setup('gift');
    expect(press(comment('alice', 'left'))).toEqual([]);
    expect(engine.state()).toEqual({ mode: 'gift' });
  });
});

describe('level gating', () => {
  const shoot: EngineCommand = { keyword: 'shoot', key: 'KeyF', holdMs: 100, cooldownMs: 0, enabled: true, minLevel: 3, cost: 0 };
  const levels = { rookie: 1, veteran: 3 };

  it('ignores commands above the viewer’s level, in every comment-driven mode', () => {
    const { press } = setup('anarchy', { commands: [left, shoot], levelGating: true }, levels);
    expect(press(comment('rookie', 'shoot'))).toEqual([]);
    expect(press(comment('rookie', 'left'))).toEqual(['KeyA']);
    expect(press(comment('veteran', 'shoot'))).toEqual(['KeyF']);

    const democracy = setup('democracy', { commands: [shoot], levelGating: true }, levels);
    democracy.press(comment('rookie', 'shoot'));
    democracy.advance(3000);
    expect(democracy.tick()).toEqual([]); // the vote never counted
  });

  it('is off unless the host turns it on, and never applies to action key presses', () => {
    expect(setup('anarchy', { commands: [shoot] }, levels).press(comment('rookie', 'shoot'))).toEqual(['KeyF']);
    const gated = setup('anarchy', { commands: [shoot], levelGating: true }, levels);
    expect(keyPresses(gated.ctx, 'shoot', 'rookie', 1)).toHaveLength(1);
  });
});

describe('point costs', () => {
  const nuke: EngineCommand = { keyword: 'nuke', key: 'KeyN', holdMs: 100, cooldownMs: 0, enabled: true, minLevel: 1, cost: 50 };
  const points = { broke: 10, rich: 80 };

  it('ignores commands a viewer can’t afford, and charges those who can', () => {
    const { engine } = setup('anarchy', { commands: [left, nuke], points: true }, {}, points);
    expect(engine.handle(comment('broke', 'nuke'))).toEqual([]);
    expect(engine.handle(comment('broke', 'left'))).toMatchObject([{ keyword: 'left', cost: 0 }]);
    expect(engine.handle(comment('rich', 'nuke'))).toMatchObject([{ keyword: 'nuke', credit: ['rich'], cost: 50 }]);
  });

  it('charges a vote only when it wins, and only voters who could afford it', () => {
    const { engine, advance } = setup('democracy', { commands: [left, nuke], points: true }, {}, points);
    engine.handle(comment('broke', 'nuke')); // refused, so no vote
    engine.handle(comment('rich', 'nuke'));
    engine.handle(comment('other', 'left'));
    engine.handle(comment('more', 'left'));
    advance(3000);
    expect(engine.tick()).toMatchObject([{ keyword: 'left', credit: ['other', 'more'], cost: 0 }]);
  });

  it('is free with points off, and for action key presses', () => {
    expect(setup('anarchy', { commands: [nuke] }, {}, points).engine.handle(comment('broke', 'nuke'))).toMatchObject([{ cost: 0 }]);
    const { ctx } = setup('anarchy', { commands: [nuke], points: true }, {}, points);
    expect(keyPresses(ctx, 'nuke', 'broke', 1)).toMatchObject([{ keyword: 'nuke', credit: [], cost: 0 }]);
  });
});
