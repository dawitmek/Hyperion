import { describe, expect, it } from 'vitest';
import type { Goal, ViewerEvent } from '@hyperion/shared';
import { StreamStatsTracker } from '../src/live/stream-stats.js';

const goal = (g: Partial<Goal> & Pick<Goal, 'metric' | 'target'>): Goal => ({ raise: null, id: g.metric, name: `${g.metric} goal`, enabled: true, ...g });
const gift = (viewerId: string, giftName: string, count: number, diamonds: number): ViewerEvent => ({ kind: 'gift', viewerId, giftId: 1, giftName, count, diamonds, at: 0 });

describe('stream stats', () => {
  it('totals the stream and keeps its highlights', () => {
    const stats = new StreamStatsTracker([]);
    stats.add({ kind: 'like', viewerId: 'a', count: 40, at: 0 });
    stats.add({ kind: 'follow', viewerId: 'fan', at: 0 });
    stats.add(gift('big', 'Lion', 1, 500));
    stats.add(gift('streaky', 'Rose', 30, 1));
    stats.add({ kind: 'subscribe', viewerId: 's', months: 1, at: 0 });
    stats.room({ viewers: 90, topGifters: [] });
    stats.room({ viewers: 77, topGifters: [] });
    expect(stats.snapshot()).toEqual({
      likes: 40,
      follows: 1,
      shares: 0,
      diamonds: 530,
      gifts: 31,
      subscriptions: 1,
      viewers: 77,
      peakViewers: 90,
      interactors: 2,
      topGift: { viewer: 'big', gift: 'Lion', diamonds: 500 },
      topStreak: { viewer: 'streaky', gift: 'Rose', count: 30 },
      lastFollower: 'fan',
      lastGifter: { viewer: 'streaky', gift: 'Rose', count: 30 },
      avatars: {},
      goals: [],
    });
  });

  it('shows viewers by display name', () => {
    const stats = new StreamStatsTracker([]);
    stats.add({ ...gift('big', 'Lion', 1, 500), name: 'Big Spender', avatar: 'https://x/big.jpg' });
    expect(stats.snapshot()).toMatchObject({ topGift: { viewer: 'Big Spender' }, avatars: { 'Big Spender': 'https://x/big.jpg' } });
  });

  it('gives the picture links of the viewers it shows, and no others', () => {
    const stats = new StreamStatsTracker([]);
    stats.add({ kind: 'follow', viewerId: 'fan', at: 0, avatar: 'https://x/fan.jpg' });
    stats.add({ ...gift('big', 'Lion', 1, 500), avatar: 'https://x/big.jpg' });
    stats.add({ ...gift('small', 'Rose', 1, 1), avatar: 'https://x/small.jpg' });
    expect(stats.snapshot().avatars).toEqual({ fan: 'https://x/fan.jpg', big: 'https://x/big.jpg', small: 'https://x/small.jpg' });
    stats.add({ kind: 'follow', viewerId: 'fan2', at: 0 });
    stats.add(gift('later', 'Rose', 1, 1));
    expect(stats.snapshot().avatars).toEqual({ big: 'https://x/big.jpg' }); // only the top gift's viewer is still shown
  });

  it('reports a goal once, when the event that crosses it arrives', () => {
    const stats = new StreamStatsTracker([goal({ metric: 'likes', target: 100 }), goal({ metric: 'diamonds', target: 10, enabled: false })]);
    expect(stats.add({ kind: 'like', viewerId: 'a', count: 60, at: 0 })).toEqual([]);
    expect(stats.add({ kind: 'like', viewerId: 'b', count: 60, at: 0 }).map((g) => g.id)).toEqual(['likes']);
    expect(stats.add({ kind: 'like', viewerId: 'c', count: 60, at: 0 })).toEqual([]);
    expect(stats.add(gift('x', 'Lion', 1, 50))).toEqual([]); // disabled
    expect(stats.snapshot().goals).toEqual([{ id: 'likes', name: 'likes goal', metric: 'likes', target: 100, current: 180 }]);
  });

  it('lets a reached goal be reached again once its target changes', () => {
    const stats = new StreamStatsTracker([goal({ metric: 'follows', target: 1 })]);
    expect(stats.add({ kind: 'follow', viewerId: 'a', at: 0 })).toHaveLength(1);
    stats.setGoals([goal({ metric: 'follows', target: 2 })]);
    expect(stats.add({ kind: 'follow', viewerId: 'b', at: 0 })).toHaveLength(1);
  });

  const likes = (stats: StreamStatsTracker, count: number) => stats.add({ kind: 'like', viewerId: 'a', count, at: 0 });
  const target = (stats: StreamStatsTracker) => stats.snapshot().goals[0]!.target;

  it('moves a reached goal up by a multiple, again each time', () => {
    const stats = new StreamStatsTracker([goal({ metric: 'likes', target: 1000, raise: { kind: 'times', by: 1.5 } })]);
    expect(likes(stats, 1000).map((g) => g.target)).toEqual([1000]);
    expect(target(stats)).toBe(1500);
    expect(likes(stats, 499)).toEqual([]);
    expect(likes(stats, 1).map((g) => g.target)).toEqual([1500]);
    expect(target(stats)).toBe(2250);
  });

  it('moves a reached goal up by an amount, past whatever reached it', () => {
    const stats = new StreamStatsTracker([goal({ metric: 'likes', target: 1000, raise: { kind: 'plus', by: 5000 } })]);
    expect(likes(stats, 12_000).map((g) => g.target)).toEqual([1000]); // one alert, not three
    expect(target(stats)).toBe(16_000);
  });

  it('moves a reached goal to a new target once', () => {
    const stats = new StreamStatsTracker([goal({ metric: 'likes', target: 100, raise: { kind: 'to', by: 250 } })]);
    expect(likes(stats, 100)).toHaveLength(1);
    expect(target(stats)).toBe(250);
    expect(likes(stats, 150)).toHaveLength(1);
    expect(target(stats)).toBe(250);
    expect(likes(stats, 500)).toEqual([]);
  });

  it('keeps a raised target through unrelated reloads, and drops it when the goal is edited', () => {
    const raise = { kind: 'plus', by: 10 } as const;
    const stats = new StreamStatsTracker([goal({ metric: 'likes', target: 10, raise })]);
    likes(stats, 10);
    stats.setGoals([goal({ metric: 'likes', target: 10, raise })]);
    expect(target(stats)).toBe(20);
    stats.setGoals([goal({ metric: 'likes', target: 12, raise })]);
    expect(target(stats)).toBe(12);
  });

  it('keeps the gift picture with the highlights', () => {
    const stats = new StreamStatsTracker([]);
    stats.add({ ...gift('fan', 'Rose', 2, 1), image: 'https://x/rose.png' } as ViewerEvent);
    const { topGift, topStreak, lastGifter } = stats.snapshot();
    expect([topGift?.image, topStreak?.image, lastGifter?.image]).toEqual(['https://x/rose.png', 'https://x/rose.png', 'https://x/rose.png']);
  });
});
