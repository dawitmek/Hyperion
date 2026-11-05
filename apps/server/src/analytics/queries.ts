import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { levelForXp, type StreamDetail, type StreamEvent, type StreamSummary, type StreamViewer, type ViewerHistoryEvent, type ViewerProfile } from '@hyperion/shared';
import type { Db } from '../db/client.js';
import { streams, viewerStats } from '../db/schema.js';

// Interacting means chatting or gifting; joins and likes are too passive to count.
const PARTICIPATION = sql`('comment', 'gift')`;
const PEAK_WINDOW_MIN = 2;

// An ilike pattern that finds `text` anywhere, taking it literally.
const containing = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

type SummaryRow = {
  id: string;
  source: 'tiktok' | 'simulated';
  profile_name: string;
  tiktok_username: string | null;
  started_at: Date;
  ended_at: Date | null;
  peak_viewers: number | null;
  viewers: number;
  participants: number;
  new_participants: number;
  comments: number;
  commands: number;
  gifts: number;
  diamonds: number;
  follows: number;
  top_command: string | null;
  top_player: string | null;
  top_player_name: string | null;
};

const toSummary = (r: SummaryRow): StreamSummary => ({
  id: r.id,
  source: r.source,
  profileName: r.profile_name,
  tiktokUsername: r.tiktok_username,
  startedAt: new Date(r.started_at).getTime(),
  endedAt: r.ended_at ? new Date(r.ended_at).getTime() : null,
  viewers: Number(r.viewers),
  peakViewers: r.peak_viewers,
  participants: Number(r.participants),
  newParticipants: Number(r.new_participants),
  comments: Number(r.comments),
  commands: Number(r.commands),
  gifts: Number(r.gifts),
  diamonds: Number(r.diamonds),
  follows: Number(r.follows),
  topCommand: r.top_command,
  topPlayer: r.top_player,
  topPlayerName: r.top_player_name,
});

// Summaries of streams that have ended, by stream id. An ended stream gets no more events, and "new" participants only
// look at streams before it, which have ended too, so its summary never changes and is only worked out once.
const endedSummaries = new Map<string, StreamSummary>();

// Per-stream totals. "New" participants never took part in an earlier real stream on the same TikTok account.
export async function streamSummaries(db: Db, hostId: string, opts: { streamId?: string; limit?: number } = {}): Promise<StreamSummary[]> {
  const listed = await db
    .select({ id: streams.id })
    .from(streams)
    .where(and(eq(streams.hostId, hostId), opts.streamId ? eq(streams.id, opts.streamId) : eq(streams.source, 'tiktok')))
    .orderBy(desc(streams.startedAt))
    .limit(opts.limit ?? 50);
  const missing = listed.filter((s) => !endedSummaries.has(s.id)).map((s) => s.id);
  const fresh = new Map((missing.length > 0 ? await summarize(db, hostId, missing) : []).map((s) => [s.id, s]));
  for (const s of fresh.values()) if (s.endedAt !== null) endedSummaries.set(s.id, s);
  return listed.flatMap((s) => endedSummaries.get(s.id) ?? fresh.get(s.id) ?? []);
}

// Each total is a grouped pass over all the given streams' events at once, rather than one query per stream per total.
async function summarize(db: Db, hostId: string, ids: string[]): Promise<StreamSummary[]> {
  const rows = await db.execute<SummaryRow>(sql`
    with s as (
      select id, source, profile_name, tiktok_username, started_at, ended_at, peak_viewers from streams
      where host_id = ${hostId} and ${inArray(streams.id, ids)}
    ),
    -- Each viewer once per stream, and whether they took part; counting these avoids sorting every event for count(distinct).
    seen as (
      select e.stream_id, e.viewer, bool_or(e.kind in ${PARTICIPATION}) as took_part from stream_events e
      where e.stream_id in (select id from s) and e.viewer is not null group by 1, 2
    ),
    viewer_counts as (
      select stream_id, count(*) as viewers, count(*) filter (where took_part) as participants from seen group by 1
    ),
    totals as (
      select e.stream_id,
        count(*) filter (where e.kind = 'comment') as comments,
        count(*) filter (where e.kind = 'command') as commands,
        coalesce(sum((e.data->>'count')::int) filter (where e.kind = 'gift'), 0) as gifts,
        coalesce(sum((e.data->>'count')::int * (e.data->>'diamonds')::int) filter (where e.kind = 'gift'), 0) as diamonds,
        count(*) filter (where e.kind = 'follow') as follows
      from stream_events e where e.stream_id in (select id from s) group by 1
    ),
    commands as (
      select e.stream_id, e.viewer, e.data->>'keyword' as keyword from stream_events e
      where e.stream_id in (select id from s) and e.kind = 'command'
    ),
    top_command as (
      select distinct on (stream_id) stream_id, keyword from commands group by 1, 2 order by stream_id, count(*) desc, keyword
    ),
    -- Who pressed the most keys.
    top_player as (
      select distinct on (stream_id) stream_id, viewer from commands where viewer is not null
      group by 1, 2 order by stream_id, count(*) desc, viewer
    ),
    top_player_name as (
      select p.stream_id, max(e.data->>'name') as name
      from top_player p join stream_events e on e.stream_id = p.stream_id and e.viewer = p.viewer group by 1
    ),
    participants as (select stream_id, viewer from seen where took_part),
    -- When each of those viewers first took part on each TikTok account.
    firsts as (
      select s2.tiktok_username, e2.viewer, min(s2.started_at) as first_at
      from stream_events e2 join streams s2 on s2.id = e2.stream_id
      where s2.host_id = ${hostId} and s2.source = 'tiktok' and e2.kind in ${PARTICIPATION}
        and e2.viewer in (select viewer from participants)
      group by 1, 2
    ),
    new_participants as (
      select p.stream_id, count(*) as n from participants p join s on s.id = p.stream_id
      where not exists (
        select 1 from firsts f
        where f.viewer = p.viewer and f.tiktok_username is not distinct from s.tiktok_username and f.first_at < s.started_at)
      group by 1
    )
    select s.id, s.source, s.profile_name, s.tiktok_username, s.started_at, s.ended_at, s.peak_viewers,
      coalesce(vc.viewers, 0) as viewers, coalesce(vc.participants, 0) as participants, coalesce(np.n, 0) as new_participants,
      coalesce(t.comments, 0) as comments, coalesce(t.commands, 0) as commands, coalesce(t.gifts, 0) as gifts,
      coalesce(t.diamonds, 0) as diamonds, coalesce(t.follows, 0) as follows,
      tc.keyword as top_command, tp.viewer as top_player, tpn.name as top_player_name
    from s
      left join viewer_counts vc on vc.stream_id = s.id
      left join totals t on t.stream_id = s.id
      left join new_participants np on np.stream_id = s.id
      left join top_command tc on tc.stream_id = s.id
      left join top_player tp on tp.stream_id = s.id
      left join top_player_name tpn on tpn.stream_id = s.id
  `);
  return rows.map(toSummary);
}

export async function streamDetail(db: Db, hostId: string, streamId: string): Promise<StreamDetail | null> {
  const [summary] = await streamSummaries(db, hostId, { streamId });
  if (!summary) return null;
  const minuteOf = sql`floor(extract(epoch from (e.at - s.started_at)) / 60)::int`;
  const from = sql`from stream_events e join streams s on s.id = e.stream_id where e.stream_id = ${streamId}`;

  const [minutes, markers, usage, gifts, giftHours, votes, queue] = await Promise.all([
    db.execute<{ minute: number; commands: number; comments: number; all_events: number }>(sql`
      select ${minuteOf} as minute,
        count(*) filter (where e.kind = 'command') as commands,
        count(*) filter (where e.kind = 'comment') as comments,
        count(*) filter (where e.kind in ('comment', 'gift', 'follow', 'share', 'command')) as all_events
      ${from} group by 1 order by 1`),
    db.execute<{ at: Date; kind: 'gift' | 'follow' | 'level'; viewer: string | null; data: Record<string, unknown> }>(sql`
      select e.at, e.kind, e.viewer, e.data ${from} and e.kind in ('gift', 'follow', 'level') order by e.id limit 300`),
    db.execute<{ keyword: string; fired: number; refused: number; reasons: Record<string, number> | null }>(sql`
      select keyword, sum(fired)::int as fired, sum(refused)::int as refused,
        jsonb_object_agg(reason, refused) filter (where reason is not null) as reasons
      from (
        select e.data->>'keyword' as keyword, e.data->>'reason' as reason,
          count(*) filter (where e.kind = 'command') as fired, count(*) filter (where e.kind = 'refused') as refused
        ${from} and e.kind in ('command', 'refused') group by 1, 2
      ) per_reason group by keyword order by sum(fired) + sum(refused) desc`),
    db.execute<{ gift: string; count: number; diamonds: number; image: string | null }>(sql`
      select e.data->>'gift' as gift, sum((e.data->>'count')::int)::int as count,
        sum((e.data->>'count')::int * (e.data->>'diamonds')::int)::int as diamonds, max(e.data->>'image') as image
      ${from} and e.kind = 'gift' group by 1 order by 3 desc, 2 desc`),
    db.execute<{ hour: number; diamonds: number }>(sql`
      select floor(extract(epoch from (e.at - s.started_at)) / 3600)::int as hour,
        sum((e.data->>'count')::int * (e.data->>'diamonds')::int)::int as diamonds
      ${from} and e.kind = 'gift' group by 1 order by 1`),
    db.execute<{ rounds: number; avg_voters: number | null; close_rounds: number }>(sql`
      select count(*)::int as rounds, avg((e.data->>'voters')::int)::float as avg_voters,
        count(*) filter (where (e.data->>'margin')::int <= 1)::int as close_rounds
      ${from} and e.kind = 'vote'`),
    db.execute<{ joins: number; turns: number; avg_wait: number | null }>(sql`
      select count(*) filter (where e.kind = 'queue_join')::int as joins, count(*) filter (where e.kind = 'turn')::int as turns,
        avg((e.data->>'waitedMs')::int) filter (where e.kind = 'turn')::float as avg_wait
      ${from} and e.kind in ('queue_join', 'turn')`),
  ]);

  // Every minute from the start to the last event (or now, while live), including quiet ones.
  const end = summary.endedAt ?? Date.now();
  const lastMinute = Math.max(Math.floor((end - summary.startedAt) / 60_000), ...minutes.map((m) => Number(m.minute)), 0);
  const byMinute = new Map(minutes.map((m) => [Number(m.minute), m]));
  const perMinute = Array.from({ length: lastMinute + 1 }, (_, minute) => ({
    minute,
    commands: Number(byMinute.get(minute)?.commands ?? 0),
    comments: Number(byMinute.get(minute)?.comments ?? 0),
  }));

  return {
    summary,
    perMinute,
    markers: markers.map((m) => ({
      at: new Date(m.at).getTime(),
      kind: m.kind,
      viewer: m.viewer,
      label:
        m.kind === 'gift'
          ? `${m.viewer} sent ${Number(m.data.count) > 1 ? `${m.data.count}× ` : ''}${String(m.data.gift)}`
          : m.kind === 'follow'
            ? `${m.viewer} followed`
            : `${m.viewer} reached level ${m.data.level}`,
    })),
    commandUsage: usage.map((u) => ({ keyword: u.keyword, fired: Number(u.fired), refused: Number(u.refused), reasons: u.reasons ?? {} })),
    peaks: busiestWindows(
      lastMinute,
      new Map(minutes.map((m) => [Number(m.minute), Number(m.all_events)])),
    ).map((p) => ({ ...p, start: summary.startedAt + p.start * 60_000, end: summary.startedAt + p.end * 60_000 })),
    gifts: {
      byGift: gifts.map((g) => ({ gift: g.gift, count: Number(g.count), diamonds: Number(g.diamonds), image: g.image })),
      perHour: giftHours.map((h) => ({ hour: Number(h.hour), diamonds: Number(h.diamonds) })),
    },
    modes: {
      votes: { rounds: Number(votes[0]?.rounds ?? 0), avgVoters: Number(votes[0]?.avg_voters ?? 0), closeRounds: Number(votes[0]?.close_rounds ?? 0) },
      queue: { joins: Number(queue[0]?.joins ?? 0), turns: Number(queue[0]?.turns ?? 0), avgWaitMs: Number(queue[0]?.avg_wait ?? 0) },
    },
  };
}

// The three busiest non-overlapping two-minute windows, in minutes from the start.
export function busiestWindows(lastMinute: number, counts: Map<number, number>) {
  const windows = Array.from({ length: Math.max(1, lastMinute + 2 - PEAK_WINDOW_MIN) }, (_, start) => {
    let events = 0;
    for (let m = start; m < start + PEAK_WINDOW_MIN; m++) events += counts.get(m) ?? 0;
    return { start, end: start + PEAK_WINDOW_MIN, events };
  });
  const picked: typeof windows = [];
  for (const w of windows.filter((w) => w.events > 0).sort((a, b) => b.events - a.events || a.start - b.start)) {
    if (picked.length === 3) break;
    if (picked.every((p) => w.end <= p.start || w.start >= p.end)) picked.push(w);
  }
  return picked;
}

// A page of a stream's events, newest first. `after` returns only newer ones (oldest first) for live polling.
export async function streamActivity(
  db: Db,
  streamId: string,
  opts: { before?: number; after?: number; from?: number; to?: number; kinds: string[]; viewer?: string; viewerId?: string; keyword?: string; gift?: string; limit: number },
): Promise<StreamEvent[]> {
  const rows = await db.execute<{ id: number; at: Date; kind: StreamEvent['kind']; viewer: string | null; data: Record<string, unknown> }>(sql`
    select id, at, kind, viewer, data from stream_events
    where stream_id = ${streamId}
      and kind in (${sql.join(opts.kinds.map((k) => sql`${k}`), sql`, `)})
      ${opts.viewer ? sql`and (viewer ilike ${containing(opts.viewer)} or data->>'name' ilike ${containing(opts.viewer)})` : sql``}
      ${opts.before !== undefined ? sql`and id < ${opts.before}` : sql``}
      ${opts.after !== undefined ? sql`and id > ${opts.after}` : sql``}
      ${opts.from !== undefined ? sql`and at >= to_timestamp(${opts.from}::bigint / 1000.0)` : sql``}
      ${opts.to !== undefined ? sql`and at < to_timestamp(${opts.to}::bigint / 1000.0)` : sql``}
      ${opts.viewerId !== undefined ? sql`and viewer = ${opts.viewerId}` : sql``}
      ${opts.keyword !== undefined ? sql`and data->>'keyword' = ${opts.keyword}` : sql``}
      ${opts.gift !== undefined ? sql`and data->>'gift' = ${opts.gift}` : sql``}
    order by id ${opts.after !== undefined ? sql`asc` : sql`desc`}
    limit ${opts.limit}`);
  return rows.map((r) => ({ id: Number(r.id), at: new Date(r.at).getTime(), kind: r.kind, viewer: r.viewer, data: r.data }));
}

// Everyone who did something in a stream, with what they did, the biggest gifters and players first.
export async function streamViewers(db: Db, hostId: string, streamId: string, limit: number): Promise<StreamViewer[]> {
  const rows = await db.execute<{
    viewer: string; name: string | null; avatar: string | null; comments: number; commands: number; gifts: number; coins: number; likes: number;
    followed: boolean; first_at: Date; last_at: Date;
  }>(sql`
    select e.viewer,
      (array_agg(e.data->>'name' order by e.id desc) filter (where e.data->>'name' is not null))[1] as name,
      (select vs.avatar_url from viewer_stats vs where vs.host_id = ${hostId} and vs.viewer_id = e.viewer and vs.avatar_url is not null
        order by vs.updated_at desc limit 1) as avatar,
      count(*) filter (where e.kind = 'comment')::int as comments,
      count(*) filter (where e.kind = 'command')::int as commands,
      coalesce(sum((e.data->>'count')::int) filter (where e.kind = 'gift'), 0)::int as gifts,
      coalesce(sum((e.data->>'count')::int * (e.data->>'diamonds')::int) filter (where e.kind = 'gift'), 0)::int as coins,
      coalesce(sum(coalesce((e.data->>'count')::int, 1)) filter (where e.kind = 'like'), 0)::int as likes,
      bool_or(e.kind = 'follow') as followed,
      min(e.at) as first_at, max(e.at) as last_at
    from stream_events e
    where e.stream_id = ${streamId} and e.viewer is not null
      and e.kind in ('comment', 'command', 'gift', 'like', 'follow', 'share', 'join', 'subscribe', 'emote')
    group by e.viewer
    order by 7 desc, 5 desc, 4 desc, 8 desc, e.viewer
    limit ${limit}`);
  return rows.map((r) => ({
    viewer: r.viewer,
    name: r.name,
    avatar: r.avatar,
    comments: Number(r.comments),
    commands: Number(r.commands),
    gifts: Number(r.gifts),
    coins: Number(r.coins),
    likes: Number(r.likes),
    followed: r.followed,
    firstAt: new Date(r.first_at).getTime(),
    lastAt: new Date(r.last_at).getTime(),
  }));
}

// Limits a query on streams `s` to one TikTok account, when given.
const onAccount = (account?: string) => (account ? sql`and s.tiktok_username = ${account}` : sql``);

// Level and points are the ones held on `streamer` (see streamerKey); the rest covers `account`, or every account.
export async function viewerProfile(db: Db, hostId: string, viewer: string, streamer: string, account?: string): Promise<ViewerProfile> {
  const [perStream, topCommands, [stats], [named]] = await Promise.all([
    db.execute<{
      id: string; started_at: Date; source: 'tiktok' | 'simulated'; tiktok_username: string | null;
      comments: number; commands: number; gifts: number; diamonds: number; first_at: Date; last_at: Date;
    }>(sql`
      select s.id, s.started_at, s.source, s.tiktok_username,
        count(*) filter (where e.kind = 'comment') as comments,
        count(*) filter (where e.kind = 'command') as commands,
        coalesce(sum((e.data->>'count')::int) filter (where e.kind = 'gift'), 0) as gifts,
        coalesce(sum((e.data->>'count')::int * (e.data->>'diamonds')::int) filter (where e.kind = 'gift'), 0) as diamonds,
        min(e.at) as first_at, max(e.at) as last_at
      from stream_events e join streams s on s.id = e.stream_id
      where s.host_id = ${hostId} and e.viewer = ${viewer} ${onAccount(account)}
      group by s.id order by s.started_at desc`),
    db.execute<{ keyword: string; count: number }>(sql`
      select e.data->>'keyword' as keyword, count(*)::int as count
      from stream_events e join streams s on s.id = e.stream_id
      where s.host_id = ${hostId} and e.viewer = ${viewer} and e.kind = 'command' ${onAccount(account)}
      group by 1 order by 2 desc, 1 limit 5`),
    db
      .select({ xp: viewerStats.xp, points: viewerStats.points, avatar: viewerStats.avatarUrl })
      .from(viewerStats)
      .where(and(eq(viewerStats.hostId, hostId), eq(viewerStats.streamer, streamer), eq(viewerStats.viewerId, viewer))),
    db.execute<{ name: string }>(sql`
      select e.data->>'name' as name
      from stream_events e join streams s on s.id = e.stream_id
      where s.host_id = ${hostId} and e.viewer = ${viewer} and e.data->>'name' is not null
      order by e.id desc limit 1`),
  ]);
  const sum = (key: 'comments' | 'commands' | 'gifts' | 'diamonds') => perStream.reduce((n, r) => n + Number(r[key]), 0);
  const times = perStream.flatMap((r) => [new Date(r.first_at).getTime(), new Date(r.last_at).getTime()]);
  const xp = stats?.xp ?? 0;
  return {
    viewer,
    name: named?.name ?? null,
    avatar: stats?.avatar ?? null,
    firstSeen: times.length ? Math.min(...times) : null,
    lastSeen: times.length ? Math.max(...times) : null,
    streams: perStream.length,
    comments: sum('comments'),
    commands: sum('commands'),
    gifts: sum('gifts'),
    diamonds: sum('diamonds'),
    xp,
    level: levelForXp(xp),
    points: stats?.points ?? 0,
    topCommands: topCommands.map((c) => ({ keyword: c.keyword, count: Number(c.count) })),
    perStream: perStream.map((r) => ({
      streamId: r.id,
      startedAt: new Date(r.started_at).getTime(),
      source: r.source,
      tiktokUsername: r.tiktok_username,
      comments: Number(r.comments),
      commands: Number(r.commands),
      diamonds: Number(r.diamonds),
    })),
  };
}

// What a viewer did across streams, newest first. `search` looks in chat text, gift names and command keywords.
export async function viewerActivity(
  db: Db,
  hostId: string,
  viewer: string,
  opts: { before?: number; account?: string; stream?: string; search?: string; kinds: string[]; limit: number },
): Promise<ViewerHistoryEvent[]> {
  const rows = await db.execute<{ id: number; at: Date; kind: StreamEvent['kind']; data: Record<string, unknown>; stream_id: string; started_at: Date }>(sql`
    select e.id, e.at, e.kind, e.data, e.stream_id, s.started_at
    from stream_events e join streams s on s.id = e.stream_id
    where s.host_id = ${hostId} and e.viewer = ${viewer}
      and e.kind in (${sql.join(opts.kinds.map((k) => sql`${k}`), sql`, `)})
      ${onAccount(opts.account)}
      ${opts.stream ? sql`and e.stream_id = ${opts.stream}` : sql``}
      ${opts.search ? sql`and concat_ws(' ', e.data->>'text', e.data->>'gift', e.data->>'keyword') ilike ${containing(opts.search)}` : sql``}
      ${opts.before !== undefined ? sql`and e.id < ${opts.before}` : sql``}
    order by e.id desc limit ${opts.limit}`);
  return rows.map((r) => ({
    id: Number(r.id),
    at: new Date(r.at).getTime(),
    kind: r.kind,
    viewer,
    data: r.data,
    streamId: r.stream_id,
    streamStartedAt: new Date(r.started_at).getTime(),
  }));
}
