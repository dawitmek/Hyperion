import type { Goal, GoalMetric, GoalRaise, RoomStats, StreamStats, ViewerEvent } from '@hyperion/shared';

type Totals = Pick<StreamStats, GoalMetric | 'gifts'>;

// Where a goal goes after `target`, past the `total` that reached it; null if it stays where it is.
function nextTarget(raise: GoalRaise | null, target: number, total: number): number | null {
  if (!raise) return null;
  if (raise.kind === 'to') return raise.by > total ? raise.by : null;
  const step = (t: number) => (raise.kind === 'times' ? Math.ceil(t * raise.by) : t + raise.by);
  let next = step(target);
  while (next <= total) next = step(next);
  return next;
}

// The current stream's totals and highlights, for overlay widgets and goals. One per live session.
export class StreamStatsTracker {
  private totals: Totals = { likes: 0, follows: 0, shares: 0, diamonds: 0, gifts: 0, subscriptions: 0 };
  private viewers = 0;
  private peakViewers = 0;
  private interactors = new Set<string>();
  private topGift: StreamStats['topGift'] = null;
  private topStreak: StreamStats['topStreak'] = null;
  private lastFollower: string | null = null;
  private lastGifter: StreamStats['lastGifter'] = null;
  private reached = new Set<string>(); // goal ids reached this stream, with nowhere further to go
  private raised = new Map<string, number>(); // goal id -> its target after being reached; only for this stream
  private avatars = new Map<string, string>(); // followers' and gifters' picture links

  constructor(public goals: Goal[]) {}

  // Counts an event; returns the goals it pushed over their target, each with the target it reached.
  add(event: ViewerEvent): Goal[] {
    const before = { ...this.totals };
    const viewer = event.name ?? event.viewerId; // what the overlay shows
    if (event.avatar && (event.kind === 'follow' || event.kind === 'gift')) this.avatars.set(viewer, event.avatar);
    if (event.kind === 'comment' || event.kind === 'gift') this.interactors.add(event.viewerId);
    switch (event.kind) {
      case 'like':
        this.totals.likes += event.count;
        break;
      case 'follow':
        this.totals.follows += 1;
        this.lastFollower = viewer;
        break;
      case 'share':
        this.totals.shares += 1;
        break;
      case 'subscribe':
        this.totals.subscriptions += 1;
        break;
      case 'gift': {
        const diamonds = event.diamonds * event.count;
        this.totals.diamonds += diamonds;
        this.totals.gifts += event.count;
        const gift = { viewer, gift: event.giftName, image: event.image };
        this.lastGifter = { ...gift, count: event.count };
        if (!this.topGift || diamonds > this.topGift.diamonds) this.topGift = { ...gift, diamonds };
        if (!this.topStreak || event.count > this.topStreak.count) this.topStreak = { ...gift, count: event.count };
        break;
      }
      default:
        return [];
    }
    return this.goals.flatMap((g) => {
      const target = this.targetOf(g);
      const total = this.totals[g.metric];
      if (!g.enabled || this.reached.has(g.id) || before[g.metric] >= target || total < target) return [];
      const next = nextTarget(g.raise, target, total);
      if (next === null) this.reached.add(g.id);
      else this.raised.set(g.id, next);
      return [{ ...g, target }];
    });
  }

  private targetOf(goal: Goal) {
    return this.raised.get(goal.id) ?? goal.target;
  }

  room(stats: RoomStats) {
    this.viewers = stats.viewers;
    this.peakViewers = Math.max(this.peakViewers, stats.viewers);
  }

  // A changed goal starts over: raising the target of a reached goal makes it reachable again.
  setGoals(goals: Goal[]) {
    for (const goal of goals) {
      const old = this.goals.find((g) => g.id === goal.id);
      if (old && (old.target !== goal.target || old.metric !== goal.metric || JSON.stringify(old.raise) !== JSON.stringify(goal.raise))) {
        this.reached.delete(goal.id);
        this.raised.delete(goal.id);
      }
    }
    this.goals = goals;
  }

  snapshot(): StreamStats {
    const shown = [this.topGift?.viewer, this.topStreak?.viewer, this.lastFollower, this.lastGifter?.viewer];
    const avatars = shown.flatMap((viewer) => (viewer && this.avatars.has(viewer) ? [[viewer, this.avatars.get(viewer)!]] : []));
    return {
      ...this.totals,
      viewers: this.viewers,
      peakViewers: this.peakViewers,
      interactors: this.interactors.size,
      topGift: this.topGift,
      topStreak: this.topStreak,
      lastFollower: this.lastFollower,
      lastGifter: this.lastGifter,
      avatars: Object.fromEntries(avatars),
      goals: this.goals
        .filter((g) => g.enabled)
        .map((g) => ({ id: g.id, name: g.name, metric: g.metric, target: this.targetOf(g), current: this.totals[g.metric] })),
    };
  }
}
