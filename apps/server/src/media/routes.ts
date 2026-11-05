import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { MAX_MEDIA_BYTES, MAX_MEDIA_TOTAL_BYTES, type MediaItem, type MediaKind } from '@hyperion/shared';
import { actions, hiddenMedia, media } from '../db/schema.js';
import { requireHost } from '../auth/session.js';
import { sniff } from './sniff.js';

const idParam = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } as const;
const name = { type: 'string', minLength: 1, maxLength: 100 } as const;
const listed = {
  id: media.id,
  name: media.name,
  kind: media.kind,
  mime: media.mime,
  size: media.size,
  createdAt: media.createdAt,
  builtIn: sql<boolean>`${media.hostId} is null`,
};
const toItem = (row: Omit<MediaItem, 'createdAt'> & { createdAt: Date }): MediaItem => ({ ...row, createdAt: row.createdAt.getTime() });

// The host's uploads. The files themselves are served by mediaFileRoute.
export async function mediaRoutes(app: FastifyInstance) {
  const { db } = app;
  app.addHook('onRequest', requireHost);
  // Uploads are the raw file as the request body, whatever type the browser says it is; sniff() decides.
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_MEDIA_BYTES }, (_req, body, done) => done(null, body));

  // The host's own files, newest first, then the built-in ones they haven't removed.
  app.get('/', async (req) =>
    (
      await db
        .select(listed)
        .from(media)
        .where(
          or(
            eq(media.hostId, req.hostId),
            and(isNull(media.hostId), sql`not exists (select 1 from ${hiddenMedia} h where h.host_id = ${req.hostId} and h.media_id = ${media.id})`),
          ),
        )
        .orderBy(sql`${media.hostId} is null`, sql`case when ${media.hostId} is null then null else ${media.createdAt} end desc`, media.name)
    ).map(toItem),
  );

  // Brings back the built-in files this host removed: every one, or only pictures or sounds.
  app.delete<{ Querystring: { kind?: MediaKind } }>(
    '/hidden',
    { schema: { querystring: { type: 'object', properties: { kind: { enum: ['image', 'video', 'audio'] } } } } },
    async (req, reply) => {
      const { kind } = req.query;
      await db
        .delete(hiddenMedia)
        .where(and(eq(hiddenMedia.hostId, req.hostId), kind ? inArray(hiddenMedia.mediaId, db.select({ id: media.id }).from(media).where(eq(media.kind, kind))) : undefined));
      return reply.code(204).send();
    },
  );

  app.post<{ Querystring: { name: string }; Body: Buffer }>(
    '/',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { querystring: { type: 'object', required: ['name'], properties: { name } } } },
    async (req, reply) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'The file is empty' });
      const type = sniff(body);
      if (!type) return reply.code(415).send({ error: 'Use a PNG, JPEG, GIF or WebP picture, an MP4 or WebM video, or an MP3, OGG, WAV or M4A sound' });
      const [used] = await db.select({ bytes: sql<number>`coalesce(sum(${media.size}), 0)::int` }).from(media).where(eq(media.hostId, req.hostId));
      if (used!.bytes + body.length > MAX_MEDIA_TOTAL_BYTES) {
        return reply.code(413).send({ error: `That would go over your ${MAX_MEDIA_TOTAL_BYTES / 1024 / 1024} MB of uploads. Delete some first.` });
      }
      const [created] = await db
        .insert(media)
        .values({ hostId: req.hostId, name: req.query.name.trim(), ...type, size: body.length, data: body })
        .returning(listed);
      return reply.code(201).send(toItem(created!));
    },
  );

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    '/:id',
    { schema: { params: idParam, body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name } } } },
    async (req, reply) => {
      const [updated] = await db
        .update(media)
        .set({ name: req.body.name.trim() })
        .where(and(eq(media.id, req.params.id), eq(media.hostId, req.hostId)))
        .returning(listed);
      return updated ? toItem(updated) : reply.code(404).send({ error: 'File not found' });
    },
  );

  app.delete<{ Params: { id: string } }>('/:id', { schema: { params: idParam } }, async (req, reply) => {
    const [deleted] = await db
      .delete(media)
      .where(and(eq(media.id, req.params.id), eq(media.hostId, req.hostId)))
      .returning({ id: media.id });
    if (!deleted) {
      // A built-in file stays for everyone: it's only hidden here, and this host's actions let go of it.
      const [shared] = await db.select({ id: media.id }).from(media).where(and(eq(media.id, req.params.id), isNull(media.hostId)));
      if (!shared) return reply.code(404).send({ error: 'File not found' });
      await db.insert(hiddenMedia).values({ hostId: req.hostId, mediaId: shared.id }).onConflictDoNothing();
      await db.update(actions).set({ mediaId: null }).where(and(eq(actions.hostId, req.hostId), eq(actions.mediaId, shared.id)));
      await db.update(actions).set({ soundMediaId: null }).where(and(eq(actions.hostId, req.hostId), eq(actions.soundMediaId, shared.id)));
    }
    await app.live.reload(req.hostId);
    return reply.code(204).send();
  });
}

// GET /media/:id. Public, because overlays in OBS have no login; ids are random UUIDs, so only someone who
// was given an overlay or a link can find a file. A file never changes, so browsers may keep it.
export async function mediaFileRoute(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/media/:id', { schema: { params: idParam } }, async (req, reply) => {
    const [file] = await app.db.select({ mime: media.mime, data: media.data }).from(media).where(eq(media.id, req.params.id));
    if (!file) return reply.code(404).send({ error: 'File not found' });
    return reply
      .header('Content-Type', file.mime)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(file.data);
  });
}
