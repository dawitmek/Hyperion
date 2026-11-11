import { describe, expect, it } from 'vitest';
import { makeCrowd, nextDelay, nextEvent, PACES } from '../src/dashboard/auto-chat';

// A seeded random, so each test sees the same sequence.
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe('auto chat', () => {
  it('invents a different crowd each run, with no repeats inside one', () => {
    const a = makeCrowd(seeded(1));
    const b = makeCrowd(seeded(2));
    expect(new Set(a).size).toBe(a.length);
    expect(a.length).toBeGreaterThanOrEqual(10);
    expect(a.filter((name) => b.includes(name)).length).toBeLessThan(2);
    for (const name of a) expect(name).toMatch(/^[a-z0-9._]{2,40}$/);
  });

  it('only types the host’s commands, chatter, and the host’s gifts', () => {
    const random = seeded(3);
    const crowd = makeCrowd(random);
    const events = Array.from({ length: 2000 }, () => nextEvent(crowd, ['jump', 'left'], ['Rose'], random));
    const texts = events.flatMap((e) => ('text' in e ? [e.text.toLowerCase()] : []));
    const commands = texts.filter((t) => t === 'jump' || t === 'left');
    expect(commands.length / events.length).toBeGreaterThan(0.6);
    for (const e of events) {
      expect(crowd).toContain(e.viewer);
      if ('gift' in e) expect(e.gift).toBe('Rose');
    }
    expect(events.some((e) => 'gift' in e)).toBe(true);
  });

  it('only chats and follows when nothing is set up', () => {
    const random = seeded(4);
    const events = Array.from({ length: 500 }, () => nextEvent(['a'], [], [], random));
    expect(events.some((e) => 'gift' in e)).toBe(false);
  });

  it('only chats when extras are off', () => {
    const random = seeded(6);
    const crowd = makeCrowd(random);
    const events = Array.from({ length: 2000 }, () => nextEvent(crowd, ['jump'], ['Rose'], random, false));
    expect(events.every((e) => 'text' in e)).toBe(true);
    const commands = events.filter((e) => 'text' in e && e.text.toLowerCase() === 'jump').length;
    expect(commands / events.length).toBeGreaterThan(0.75);
  });

  it('lines up in queue mode, and the viewer whose turn it is presses the keys', () => {
    const random = seeded(7);
    const crowd = makeCrowd(random);
    const queue = { turn: crowd[0]!, waiting: [crowd[1]!] };
    const events = Array.from({ length: 2000 }, () => nextEvent(crowd, ['jump'], ['Rose'], random, true, queue));
    const texts = events.flatMap((e) => ('text' in e ? [e] : []));
    const pressed = texts.filter((e) => e.text.toLowerCase() === 'jump');
    expect(pressed.length / events.length).toBeGreaterThan(0.4);
    for (const e of pressed) expect(e.viewer).toBe(queue.turn);
    const joins = texts.filter((e) => e.text === 'join');
    expect(joins.length).toBeGreaterThan(0);
    for (const e of joins) expect([queue.turn, ...queue.waiting]).not.toContain(e.viewer);
  });

  it('joins the empty queue before anyone has a turn', () => {
    const random = seeded(8);
    const crowd = makeCrowd(random);
    const events = Array.from({ length: 500 }, () => nextEvent(crowd, ['jump'], [], random, false, { turn: null, waiting: [] }));
    expect(events.some((e) => 'text' in e && e.text === 'join')).toBe(true);
    expect(events.some((e) => 'text' in e && e.text.toLowerCase() === 'jump')).toBe(false);
  });

  it('waits within the pace', () => {
    const random = seeded(5);
    for (let i = 0; i < 100; i++) {
      const ms = nextDelay('hype', random);
      expect(ms).toBeGreaterThanOrEqual(PACES.hype.minMs);
      expect(ms).toBeLessThanOrEqual(PACES.hype.maxMs);
    }
    const average = (p: keyof typeof PACES) => (PACES[p].minMs + PACES[p].maxMs) / 2;
    expect(average('hypest')).toBeLessThan(average('hype'));
    // The server allows 600 requests a minute; leave room for the dashboard's own.
    expect(60_000 / ((PACES.hypest.minMs + PACES.hypest.maxMs) / 2)).toBeLessThan(400);
  });
});
