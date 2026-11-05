import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { levelForXp, MAX_LEADERBOARD_SIZE, type LeaderboardEntry } from '@hyperion/shared';
import type { Db } from '../db/client.js';
import { hosts, viewerStats } from '../db/schema.js';

type Counts = { commands: number; gifts: number; coins: number; xp: number; points: number };
type Totals = { xp: number; points: number };
type Seen = { avatar?: string; name?: string };
type Pending = { hostId: string; streamer: string; viewers: Map<string, Counts> };

// Stats are kept per TikTok account a host streams as, so switching accounts starts a fresh leaderboard and
// fresh balances; the old account's rows stay for when they switch back. '' is "no account set".
export const streamerKey = (username: string | null | undefined) => (username ?? '').replace(/^@/, '').toLowerCase();

// Buffers per-viewer counts in memory and writes them in one upsert per flush, so a busy chat
// doesn't turn into a database write per comment. While a host is live, it also keeps every viewer's
// XP and points in memory so levels and balances can be checked synchronously on each comment.
export class Stats {
  private pending = new Map<string, Pending>(); // "hostId/streamer" -> unflushed counts per viewer
  private totals = new Map<string, Map<string, Totals>>(); // hostId -> viewerId -> XP and points (live hosts only)
  private streamers = new Map<string, string>(); // hostId -> the account a live host is streaming as
  private seen = new Map<string, Map<string, Seen>>(); // hostId -> viewerId -> their latest picture and name, this stream

  constructor(private db: Db) {}

  // Returns the viewer's new level if this pushed them up one, else null. Negative points spend them;
  // a balance never goes below 0. Points only change for loaded hosts, the only ones that can earn or spend.
  record(hostId: string, viewerId: string, add: Partial<Counts>): number | null {
    const totals = this.totals.get(hostId);
    const streamer = this.streamers.get(hostId);
    if (streamer === undefined) return null; // not live
    const before = totals?.get(viewerId) ?? { xp: 0, points: 0 };
    const points = totals ? Math.max(add.points ?? 0, -before.points) : 0;
    this.addPending(hostId, streamer, viewerId, { commands: 0, gifts: 0, coins: 0, xp: 0, ...add, points });
    if (!totals) return null;
    const after = { xp: before.xp + (add.xp ?? 0), points: before.points + points };
    totals.set(viewerId, after);
    const level = levelForXp(after.xp);
    return level > levelForXp(before.xp) ? level : null;
  }

  // Kept in memory; only viewers with counts to write get theirs saved, so joining doesn't add a row.
  sawViewer(hostId: string, viewerId: string, seen: Seen) {
    const viewers = this.seen.get(hostId);
    viewers?.set(viewerId, { ...viewers.get(viewerId), ...seen });
  }

  avatarOf(hostId: string, viewerId: string) {
    return this.seen.get(hostId)?.get(viewerId)?.avatar;
  }

  // What to call a viewer on screen.
  nameOf(hostId: string, viewerId: string) {
    return this.seen.get(hostId)?.get(viewerId)?.name ?? viewerId;
  }

  // Levels and points are only known for hosts loaded with load(); others count as level 1 with no points.
  levelOf(hostId: string, viewerId: string): number {
    return levelForXp(this.totals.get(hostId)?.get(viewerId)?.xp ?? 0);
  }

  pointsOf(hostId: string, viewerId: string): number {
    return this.totals.get(hostId)?.get(viewerId)?.points ?? 0;
  }

  // The account a host's stats are read and written under: the one they're live as, else the one in their settings.
  async streamerOf(hostId: string): Promise<string> {
    const live = this.streamers.get(hostId);
    if (live !== undefined) return live;
    const [host] = await this.db.select({ tiktokUsername: hosts.tiktokUsername }).from(hosts).where(eq(hosts.id, hostId));
    return streamerKey(host?.tiktokUsername);
  }

  // Loads a host's XP and points for the account they're streaming as into memory; call when they go live.
  async load(hostId: string, username: string | null) {
    const streamer = streamerKey(username);
    const rows = await this.db
      .select({ viewerId: viewerStats.viewerId, xp: viewerStats.xp, points: viewerStats.points })
      .from(viewerStats)
      .where(and(eq(viewerStats.hostId, hostId), eq(viewerStats.streamer, streamer)));
    const totals = new Map(rows.map((r) => [r.viewerId, { xp: r.xp, points: r.points }]));
    for (const [viewerId, counts] of this.pending.get(`${hostId}/${streamer}`)?.viewers ?? []) {
      const t = totals.get(viewerId) ?? { xp: 0, points: 0 };
      totals.set(viewerId, { xp: t.xp + counts.xp, points: Math.max(0, t.points + counts.points) }); // not flushed yet
    }
    this.totals.set(hostId, totals);
    this.streamers.set(hostId, streamer);
    this.seen.set(hostId, new Map());
  }

  unload(hostId: string) {
    this.totals.delete(hostId);
    this.streamers.delete(hostId); // seen stays until the next stream: the last counts are still to be flushed
  }

  // Returns the hosts whose stats changed.
  async flush(): Promise<string[]> {
    const batch = this.pending;
    if (batch.size === 0) return [];
    this.pending = new Map();
    const rows = [...batch.values()].flatMap(({ hostId, streamer, viewers }) =>
      [...viewers].map(([viewerId, counts]) => {
        const seen = this.seen.get(hostId)?.get(viewerId);
        return { hostId, streamer, viewerId, ...counts, avatarUrl: seen?.avatar ?? null, displayName: seen?.name ?? null };
      }),
    );
    try {
      // A host deleted since its counts were recorded would fail the whole insert on the foreign key.
      const existing = await this.db.select({ id: hosts.id }).from(hosts).where(inArray(hosts.id, [...new Set(rows.map((r) => r.hostId))]));
      const live = new Set(existing.map((h) => h.id));
      const valid = rows.filter((r) => live.has(r.hostId));
      if (valid.length === 0) return [];
      await this.db
        .insert(viewerStats)
        .values(valid)
        .onConflictDoUpdate({
          target: [viewerStats.hostId, viewerStats.streamer, viewerStats.viewerId],
          set: {
            commands: sql`${viewerStats.commands} + excluded.commands`,
            gifts: sql`${viewerStats.gifts} + excluded.gifts`,
            coins: sql`${viewerStats.coins} + excluded.coins`,
            xp: sql`${viewerStats.xp} + excluded.xp`,
            points: sql`greatest(0, ${viewerStats.points} + excluded.points)`,
            avatarUrl: sql`coalesce(excluded.avatar_url, ${viewerStats.avatarUrl})`,
            displayName: sql`coalesce(excluded.display_name, ${viewerStats.displayName})`,
            updatedAt: sql`now()`,
          },
        });
      return [...live];
    } catch (err) {
      // Put the counts back so the next flush retries them. The in-memory totals already include them.
      for (const { hostId, streamer, viewerId, avatarUrl: _a, displayName: _n, ...counts } of rows) this.addPending(hostId, streamer, viewerId, counts);
      throw err;
    }
  }

  async top(hostId: string, limit = MAX_LEADERBOARD_SIZE): Promise<LeaderboardEntry[]> {
    const streamer = await this.streamerOf(hostId);
    return this.db
      .select({ viewer: viewerStats.viewerId, commands: viewerStats.commands, gifts: viewerStats.gifts, coins: viewerStats.coins, xp: viewerStats.xp, points: viewerStats.points, avatar: viewerStats.avatarUrl, name: viewerStats.displayName })
      .from(viewerStats)
      // Viewers who have only earned points from chat haven't played yet.
      .where(and(eq(viewerStats.hostId, hostId), eq(viewerStats.streamer, streamer), sql`(${viewerStats.commands} > 0 or ${viewerStats.gifts} > 0)`))
      .orderBy(desc(viewerStats.xp), desc(viewerStats.commands))
      .limit(limit);
  }

  // Clears the current account's leaderboard (commands, gifts, coins, XP). Points are kept: viewers may be saving them up.
  async reset(hostId: string) {
    const streamer = await this.streamerOf(hostId);
    const mine = and(eq(viewerStats.hostId, hostId), eq(viewerStats.streamer, streamer));
    for (const counts of this.pending.get(`${hostId}/${streamer}`)?.viewers.values() ?? []) Object.assign(counts, { commands: 0, gifts: 0, coins: 0, xp: 0 });
    if (this.streamers.get(hostId) === streamer) for (const t of this.totals.get(hostId)?.values() ?? []) t.xp = 0;
    await this.db.delete(viewerStats).where(and(mine, eq(viewerStats.points, 0)));
    await this.db.update(viewerStats).set({ commands: 0, gifts: 0, coins: 0, xp: 0 }).where(mine);
  }

  // Sets every viewer's points on the current account back to 0.
  async resetPoints(hostId: string) {
    const streamer = await this.streamerOf(hostId);
    for (const counts of this.pending.get(`${hostId}/${streamer}`)?.viewers.values() ?? []) counts.points = 0;
    if (this.streamers.get(hostId) === streamer) for (const t of this.totals.get(hostId)?.values() ?? []) t.points = 0;
    await this.db.update(viewerStats).set({ points: 0 }).where(and(eq(viewerStats.hostId, hostId), eq(viewerStats.streamer, streamer)));
  }

  private addPending(hostId: string, streamer: string, viewerId: string, add: Counts) {
    const key = `${hostId}/${streamer}`;
    let entry = this.pending.get(key);
    if (!entry) this.pending.set(key, (entry = { hostId, streamer, viewers: new Map() }));
    const viewers = entry.viewers;
    const counts = viewers.get(viewerId) ?? { commands: 0, gifts: 0, coins: 0, xp: 0, points: 0 };
    viewers.set(viewerId, {
      commands: counts.commands + add.commands,
      gifts: counts.gifts + add.gifts,
      coins: counts.coins + add.coins,
      xp: counts.xp + add.xp,
      points: counts.points + add.points,
    });
  }
}
