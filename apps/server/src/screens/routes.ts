import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ALERT_FONTS, ALERT_POSITIONS, EFFECT_SPEEDS, WIDGET_STYLE_LIMITS, MAX_LEADERBOARD_SIZE, MAX_MESSAGE_LENGTH, MAX_WIDGETS, MIN_LEADERBOARD_SIZE, SCREEN_EFFECTS, WIDGET_SPOTS, WIDGET_TYPES, type OverlayScreen } from '@hyperion/shared';
import { hosts, overlayScreens } from '../db/schema.js';
import { requireHost } from '../auth/session.js';
import { newToken } from '../crypto.js';

type Row = typeof overlayScreens.$inferSelect;
export const toScreen = ({ hostId: _h, token: _t, position: _p, ...screen }: Row): OverlayScreen => screen;

const MAX_SCREENS = 8;
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const widgetStyle = {
  type: 'object',
  additionalProperties: false,
  required: ['background', 'opacity', 'textColor', 'accent', 'borderColor', 'borderWidth', 'radius', 'font', 'size'],
  properties: {
    background: color,
    textColor: color,
    accent: color,
    borderColor: color,
    font: { enum: ALERT_FONTS },
    ...Object.fromEntries(Object.entries(WIDGET_STYLE_LIMITS).map(([key, [minimum, maximum]]) => [key, { type: 'integer', minimum, maximum }])),
  },
};
const fields = {
  name: { type: 'string', minLength: 1, maxLength: 40 },
  alerts: { type: 'boolean' },
  feed: { type: 'boolean' },
  leaderboard: { type: 'boolean' },
  leaderboardSize: { type: 'integer', minimum: MIN_LEADERBOARD_SIZE, maximum: MAX_LEADERBOARD_SIZE },
  mode: { type: 'boolean' },
  audio: { type: 'boolean' },
  alertPosition: { enum: ALERT_POSITIONS },
  alertPos: {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['x', 'y'],
    properties: { x: { type: 'number', minimum: 0, maximum: 100 }, y: { type: 'number', minimum: 0, maximum: 100 } },
  },
  scale: { type: 'integer', minimum: 50, maximum: 200 },
  linkStyles: { type: 'object', maxProperties: 40, propertyNames: { maxLength: 64 }, additionalProperties: widgetStyle },
  widgets: {
    type: 'array',
    maxItems: MAX_WIDGETS,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'spot'],
      properties: {
        type: { enum: WIDGET_TYPES },
        spot: { enum: WIDGET_SPOTS },
        minDiamonds: { type: 'integer', minimum: 1, maximum: 10_000_000 },
        effect: { enum: [...SCREEN_EFFECTS, 'random'] },
        effectSpeed: { enum: EFFECT_SPEEDS },
        goalId: { type: 'string', format: 'uuid' },
        text: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
        style: widgetStyle,
        pos: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'y'],
          properties: { x: { type: 'number', minimum: 0, maximum: 100 }, y: { type: 'number', minimum: 0, maximum: 100 } },
        },
      },
    },
  },
} as const;
const idParam = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } as const;

// Overlay screens. Their tokens are returned here (each screen's address) but never to the overlay itself.
export async function screenRoutes(app: FastifyInstance) {
  const { db, hub } = app;
  app.addHook('onRequest', requireHost);

  app.get('/', async (req) => {
    const rows = await db.select().from(overlayScreens).where(eq(overlayScreens.hostId, req.hostId)).orderBy(overlayScreens.position);
    return rows.map((r) => ({ ...toScreen(r), token: r.token }));
  });

  // A new screen shows only alerts, silently: most extra screens are for putting alerts somewhere else.
  app.post<{ Body: { name: string } }>(
    '/',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: fields.name } } } },
    async (req, reply) => {
      const existing = await db.select({ id: overlayScreens.id }).from(overlayScreens).where(eq(overlayScreens.hostId, req.hostId));
      if (existing.length >= MAX_SCREENS) return reply.code(400).send({ error: `You can have up to ${MAX_SCREENS} screens` });
      const [created] = await db
        .insert(overlayScreens)
        .values({ hostId: req.hostId, name: req.body.name.trim(), token: newToken(), feed: false, leaderboard: false, mode: false, audio: false })
        .returning();
      return reply.code(201).send({ ...toScreen(created!), token: created!.token });
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<Omit<OverlayScreen, 'id' | 'main'>> }>(
    '/:id',
    { schema: { params: idParam, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: fields } } },
    async (req, reply) => {
      const patch = { ...req.body, ...(req.body.name !== undefined && { name: req.body.name.trim() }) };
      const [updated] = await db
        .update(overlayScreens)
        .set(patch)
        .where(and(eq(overlayScreens.id, req.params.id), eq(overlayScreens.hostId, req.hostId)))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'Screen not found' });
      const screen = toScreen(updated);
      hub.sendToScreen(req.hostId, screen.id, { type: 'screen', screen });
      return { ...screen, token: updated.token };
    },
  );

  // A leaked link can be replaced without losing the screen's setup. The old one stops working at once, and anything
  // using it is disconnected. The main screen's link is also the host's overlay token.
  app.post<{ Params: { id: string } }>('/:id/new-link', { schema: { params: idParam } }, async (req, reply) => {
    const token = newToken();
    const updated = await db.transaction(async (tx) => {
      const [screen] = await tx
        .update(overlayScreens)
        .set({ token })
        .where(and(eq(overlayScreens.id, req.params.id), eq(overlayScreens.hostId, req.hostId)))
        .returning();
      if (screen?.main) await tx.update(hosts).set({ overlayToken: token }).where(eq(hosts.id, req.hostId));
      return screen;
    });
    if (!updated) return reply.code(404).send({ error: 'Screen not found' });
    hub.sendToScreen(req.hostId, updated.id, null);
    return { ...toScreen(updated), token };
  });

  app.delete<{ Params: { id: string } }>('/:id', { schema: { params: idParam } }, async (req, reply) => {
    const where = and(eq(overlayScreens.id, req.params.id), eq(overlayScreens.hostId, req.hostId));
    const [screen] = await db.select({ main: overlayScreens.main }).from(overlayScreens).where(where);
    if (!screen) return reply.code(404).send({ error: 'Screen not found' });
    if (screen.main) return reply.code(400).send({ error: "The main screen can't be deleted" });
    await db.delete(overlayScreens).where(where);
    hub.sendToScreen(req.hostId, req.params.id, null);
    await app.live.reload(req.hostId);
    return reply.code(204).send();
  });
}
