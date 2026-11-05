import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { streams } from '../db/schema.js';
import { requireHost } from '../auth/session.js';
import { streamerKey } from '../leaderboard/stats.js';
import { streamActivity, streamDetail, streamSummaries, streamViewers, viewerActivity, viewerProfile } from './queries.js';

const VIEWER_KINDS = ['comment', 'gift', 'like', 'follow', 'share', 'join', 'subscribe', 'emote'];
const HISTORY_KINDS = [...VIEWER_KINDS, 'command'];
// A stream's activity can also show the commands chat asked for but didn't get, when looking into one command.
const STREAM_KINDS = [...HISTORY_KINDS, 'refused'];
// The most viewers a stream's report lists.
const STREAM_VIEWERS = 500;
const kindList = (kinds: string[]) => ({ type: 'string', pattern: `^(${kinds.join('|')})(,(${kinds.join('|')}))*$` });
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
// A live stream's report reads every event it has, and each open Live page asks for it every 10 s. It's built at
// most once in this long and shared, so three tabs cost what one does.
const LIVE_REPORT_MS = 5000;

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireHost);
  const { db } = app;

  // "latest" is the stream being recorded now, or else the most recent one (test mode included).
  const resolve = async (hostId: string, id: string) => {
    if (id !== 'latest') {
      const [own] = await db.select({ id: streams.id }).from(streams).where(and(eq(streams.id, id), eq(streams.hostId, hostId)));
      return own?.id ?? null;
    }
    const live = app.live.currentStreamId(hostId);
    if (live) return live;
    const [last] = await db.select({ id: streams.id }).from(streams).where(eq(streams.hostId, hostId)).orderBy(desc(streams.startedAt)).limit(1);
    return last?.id ?? null;
  };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'Stream not found' });
  // Live streams' reports, by stream id; requests while one is being built wait for it rather than build another.
  const liveReports = new Map<string, { at: number; report: ReturnType<typeof streamDetail> }>();
  const liveReport = (hostId: string, id: string) => {
    const now = Date.now();
    for (const [key, cached] of liveReports) if (now - cached.at >= LIVE_REPORT_MS) liveReports.delete(key);
    const cached = liveReports.get(id);
    if (cached) return cached.report;
    // The stream being recorded writes its events every couple of seconds; write them now, so the totals are exact.
    const report = app.live.flushRecording(hostId).then(() => streamDetail(db, hostId, id));
    liveReports.set(id, { at: now, report });
    report.catch(() => liveReports.delete(id)); // a failed build isn't kept
    return report;
  };
  const streamParam = { type: 'string', pattern: `^(latest|${UUID.slice(1, -1)})$` };

  // Real streams, newest first, with their totals.
  app.get('/streams', async (req) => streamSummaries(db, req.hostId));

  const viewerParams = { type: 'object', properties: { viewer: { type: 'string', minLength: 1, maxLength: 64 } } };
  const account = { type: 'string', minLength: 1, maxLength: 64 };

  // One viewer across the host's streams; `account` keeps to one TikTok account.
  app.get<{ Params: { viewer: string }; Querystring: { account?: string } }>(
    '/viewers/:viewer',
    { schema: { params: viewerParams, querystring: { type: 'object', additionalProperties: false, properties: { account } } } },
    async (req) => {
      await app.live.flushRecording(req.hostId);
      const profile = await viewerProfile(db, req.hostId, req.params.viewer, req.query.account ? streamerKey(req.query.account) : await app.stats.streamerOf(req.hostId), req.query.account);
      // A viewer on the stream right now may have a newer picture than the saved one, or none saved yet.
      return { ...profile, avatar: app.stats.avatarOf(req.hostId, req.params.viewer) ?? profile.avatar };
    },
  );

  app.get<{ Params: { viewer: string }; Querystring: { account?: string; stream?: string; search?: string; kinds?: string; before?: number; limit?: number } }>(
    '/viewers/:viewer/activity',
    {
      schema: {
        params: viewerParams,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            account,
            stream: { type: 'string', pattern: UUID },
            search: { type: 'string', maxLength: 100 },
            kinds: kindList(HISTORY_KINDS),
            before: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (req) => {
      await app.live.flushRecording(req.hostId); // so a viewer's panel shows what they just did
      return viewerActivity(db, req.hostId, req.params.viewer, {
        account: req.query.account,
        stream: req.query.stream,
        search: req.query.search?.trim() || undefined,
        before: req.query.before,
        kinds: req.query.kinds?.split(',') ?? HISTORY_KINDS,
        limit: req.query.limit ?? 50,
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/streams/:id',
    { schema: { params: { type: 'object', properties: { id: streamParam } } } },
    async (req, reply) => {
      const id = await resolve(req.hostId, req.params.id);
      const live = id !== null && id === app.live.currentStreamId(req.hostId);
      const detail = id && (await (live ? liveReport(req.hostId, id) : streamDetail(db, req.hostId, id)));
      return detail || notFound(reply);
    },
  );

  // Everyone who took part in a stream, and what they did.
  app.get<{ Params: { id: string } }>(
    '/streams/:id/viewers',
    { schema: { params: { type: 'object', properties: { id: streamParam } } } },
    async (req, reply) => {
      const id = await resolve(req.hostId, req.params.id);
      if (!id) return notFound(reply);
      if (id === app.live.currentStreamId(req.hostId)) await app.live.flushRecording(req.hostId);
      return streamViewers(db, req.hostId, id, STREAM_VIEWERS);
    },
  );

  // What viewers did during a stream: a page of it, newest first, or what's new since `after`. `from` and `to` (ms) keep
  // to a stretch of it; `viewerId` to exactly one viewer (`viewer` searches), `keyword` to one command, `gift` to one gift.
  app.get<{
    Querystring: { stream?: string; before?: number; after?: number; from?: number; to?: number; kinds?: string; viewer?: string; viewerId?: string; keyword?: string; gift?: string; limit?: number };
  }>(
    '/activity',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stream: streamParam,
            before: { type: 'integer', minimum: 0 },
            after: { type: 'integer', minimum: 0 },
            from: { type: 'integer', minimum: 0 },
            to: { type: 'integer', minimum: 0 },
            kinds: kindList(STREAM_KINDS),
            viewer: { type: 'string', maxLength: 64 },
            viewerId: { type: 'string', minLength: 1, maxLength: 64 },
            keyword: { type: 'string', minLength: 1, maxLength: 64 },
            gift: { type: 'string', minLength: 1, maxLength: 100 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (req) => {
      const id = await resolve(req.hostId, req.query.stream ?? 'latest');
      if (!id) return { stream: null, events: [] };
      const [stream] = await db.select().from(streams).where(eq(streams.id, id));
      const events = await streamActivity(db, id, {
        before: req.query.before,
        after: req.query.after,
        from: req.query.from,
        to: req.query.to,
        kinds: req.query.kinds?.split(',') ?? VIEWER_KINDS,
        viewer: req.query.viewer?.trim() || undefined,
        viewerId: req.query.viewerId,
        keyword: req.query.keyword,
        gift: req.query.gift,
        limit: req.query.limit ?? 100,
      });
      return {
        stream: { id, source: stream!.source, startedAt: stream!.startedAt.getTime(), live: id === app.live.currentStreamId(req.hostId) },
        events,
      };
    },
  );
}
