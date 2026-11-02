import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  ACTION_TRIGGERS,
  ALERT_EFFECTS,
  ALERT_SHAPES,
  ALERT_ANIMATIONS,
  ALERT_FONTS,
  ALERT_SOUNDS,
  ALERT_STYLE_LIMITS,
  AUDIENCES,
  EFFECT_SPEEDS,
  MAX_ALERT_EMOJI_LENGTH,
  MAX_EFFECT_AMOUNT,
  pickEffect,
  POINTS_CHECK,
  QUEUE_JOIN,
  SCREEN_EFFECTS,
  type ActionEffect,
  type ActionTrigger,
  type AlertEffect,
  type AlertShape,
  type AlertSound,
  type AlertStyle,
  type Audience,
} from '@hyperion/shared';
import { actions, commands, goals, hosts, media, overlayScreens, profiles } from '../db/schema.js';
import { requireHost } from '../auth/session.js';
import { activeProfile } from '../profiles/active.js';
import { alertMessage, effectMessage } from '../live/session-manager.js';
import { voiceConfig } from '../tts/speech.js';
import { fillTemplate, showsAlert } from './engine.js';
import { createGiftCatalog, withReceived } from './gift-catalog.js';
import { loadActionRules } from './load.js';

const giftCatalog = createGiftCatalog();

type Body = {
  name: string;
  enabled?: boolean;
  profileId?: string | null;
  trigger: ActionTrigger;
  giftName?: string | null;
  minDiamonds?: number | null;
  likeStep?: number | null;
  likeGrowth?: number | null;
  command?: string | null;
  goalId?: string | null;
  audience?: Audience;
  audienceViewer?: string | null;
  cooldownMs?: number;
  viewerCooldownMs?: number;
  random?: boolean;
  text?: string | null;
  sound?: AlertSound | null;
  soundMediaId?: string | null;
  mediaId?: string | null;
  speak?: boolean;
  durationMs?: number;
  effect?: ActionEffect | null;
  effectAmount?: number;
  effectColor?: string | null;
  effectSpeed?: number;
  alertEffect?: AlertEffect | null;
  alertEmoji?: string;
  alertShape?: AlertShape;
  alertEffectColor?: string | null;
  alertEffectAmount?: number;
  alertEffectSpeed?: number;
  alertX?: number | null;
  alertY?: number | null;
  alertScale?: number;
  alertStyle?: AlertStyle | null;
  useAlertStyle2?: boolean;
  keyCommandId?: string | null;
  repeatWithCount?: boolean;
  points?: number;
  screenId?: string | null;
};

const nullableId = { type: ['string', 'null'], format: 'uuid' } as const;
const fields = {
  name: { type: 'string', minLength: 1, maxLength: 60 },
  enabled: { type: 'boolean' },
  profileId: nullableId,
  trigger: { enum: ACTION_TRIGGERS },
  giftName: { type: ['string', 'null'], maxLength: 64 },
  minDiamonds: { type: ['integer', 'null'], minimum: 1, maximum: 10_000_000 },
  likeStep: { type: ['integer', 'null'], minimum: 1, maximum: 1_000_000 },
  likeGrowth: { type: ['number', 'null'], exclusiveMinimum: 1, maximum: 100 },
  command: { type: ['string', 'null'], pattern: '^\\S{1,32}$' },
  goalId: nullableId,
  audience: { enum: AUDIENCES },
  audienceViewer: { type: ['string', 'null'], maxLength: 64 },
  cooldownMs: { type: 'integer', minimum: 0, maximum: 3_600_000 },
  viewerCooldownMs: { type: 'integer', minimum: 0, maximum: 3_600_000 },
  random: { type: 'boolean' },
  text: { type: ['string', 'null'], maxLength: 200 },
  sound: { enum: [...ALERT_SOUNDS, null] },
  soundMediaId: nullableId,
  mediaId: nullableId,
  speak: { type: 'boolean' },
  durationMs: { type: 'integer', minimum: 1000, maximum: 60_000 },
  effect: { enum: [...SCREEN_EFFECTS, 'random', null] },
  effectAmount: { type: 'integer', minimum: 1, maximum: MAX_EFFECT_AMOUNT },
  effectColor: { type: ['string', 'null'], pattern: '^#[0-9a-fA-F]{6}$' },
  effectSpeed: { enum: EFFECT_SPEEDS },
  alertEffect: { enum: [...ALERT_EFFECTS, null] },
  alertEmoji: { type: 'string', pattern: '\\S', maxLength: MAX_ALERT_EMOJI_LENGTH },
  alertShape: { enum: ALERT_SHAPES },
  alertEffectColor: { type: ['string', 'null'], pattern: '^#[0-9a-fA-F]{6}$' },
  alertEffectAmount: { type: 'integer', minimum: 1, maximum: MAX_EFFECT_AMOUNT },
  alertEffectSpeed: { enum: EFFECT_SPEEDS },
  alertX: { type: ['number', 'null'], minimum: 0, maximum: 100 },
  alertY: { type: ['number', 'null'], minimum: 0, maximum: 100 },
  alertScale: { type: 'integer', minimum: 50, maximum: 200 },
  alertStyle: { anyOf: [{ type: 'null' }, alertStyleSchema()] },
  useAlertStyle2: { type: 'boolean' },
  keyCommandId: nullableId,
  repeatWithCount: { type: 'boolean' },
  points: { type: 'integer', minimum: 0, maximum: 1_000_000 },
  screenId: nullableId,
} as const;

const idParam = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } as const;
type Row = typeof actions.$inferSelect;
type Problem = { error: string };

export async function actionRoutes(app: FastifyInstance) {
  const { db } = app;
  app.addHook('onRequest', requireHost);

  // Trigger-specific fields only mean something for their trigger; anything else is cleared. Files, commands and
  // profiles must be the host's own. A key press puts the action in its command's profile.
  async function check(hostId: string, a: Omit<Row, 'id' | 'hostId' | 'position'>): Promise<Problem | Partial<Row>> {
    const fixed: Partial<Row> = {
      giftName: a.trigger === 'gift' ? a.giftName?.trim().toLowerCase() || null : null,
      minDiamonds: a.trigger === 'gift' ? a.minDiamonds : null,
      likeStep: a.trigger === 'likes' || a.trigger === 'viewer_likes' ? a.likeStep : null,
      likeGrowth: a.trigger === 'likes' || a.trigger === 'viewer_likes' ? a.likeGrowth : null,
      command: a.trigger === 'command' ? a.command?.trim().toLowerCase() || null : null,
      goalId: a.trigger === 'goal' ? a.goalId : null,
      audienceViewer: a.audience === 'viewer' ? a.audienceViewer?.trim().replace(/^@/, '') || null : null,
      text: a.text?.trim() || null,
    };
    if ((a.trigger === 'likes' || a.trigger === 'viewer_likes') && !fixed.likeStep) return { error: 'Likes actions need a step, e.g. every 1000 likes' };
    if (a.trigger === 'command' && !fixed.command) return { error: 'Command actions need the command, e.g. !dance' };
    if (fixed.command === QUEUE_JOIN || fixed.command === POINTS_CHECK) return { error: `"${fixed.command}" is already used by Hyperion` };
    if (a.trigger === 'goal') {
      const [goal] = fixed.goalId ? await db.select({ id: goals.id }).from(goals).where(and(eq(goals.id, fixed.goalId), eq(goals.hostId, hostId))) : [];
      if (!goal) return { error: 'Pick one of your goals' };
    }
    if (a.audience === 'viewer' && !fixed.audienceViewer) return { error: 'Name the viewer this action is for' };
    if ((a.alertX === null) !== (a.alertY === null)) return { error: "An alert's place needs both across and down" };
    for (const [id, kinds, what] of [
      [a.soundMediaId, ['audio'], 'sound'],
      [a.mediaId, ['image', 'video'], 'picture or video'],
    ] as const) {
      if (!id) continue;
      const [file] = await db.select({ kind: media.kind }).from(media).where(and(eq(media.id, id), or(eq(media.hostId, hostId), isNull(media.hostId))));
      if (!file || !(kinds as readonly string[]).includes(file.kind)) return { error: `That file isn't one of your uploaded ${what}s` };
    }
    if (a.screenId) {
      const [screen] = await db
        .select({ id: overlayScreens.id })
        .from(overlayScreens)
        .where(and(eq(overlayScreens.id, a.screenId), eq(overlayScreens.hostId, hostId)));
      if (!screen) return { error: 'Screen not found' };
    }
    if (a.keyCommandId) {
      const [command] = await db
        .select({ profileId: commands.profileId })
        .from(commands)
        .where(and(eq(commands.id, a.keyCommandId), eq(commands.hostId, hostId)));
      if (!command) return { error: 'Command not found' };
      fixed.profileId = command.profileId;
    } else if (a.profileId) {
      const [profile] = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.id, a.profileId), eq(profiles.hostId, hostId)));
      if (!profile) return { error: 'Profile not found' };
    }
    return fixed;
  }

  // Actions that apply with the active profile: the host's general ones and the profile's own.
  // Gifts this host has received, most sent first, with their pictures: what the action editor offers.
  app.get('/gifts', async (req) => {
    const rows = await db.execute<{ name: string; coins: number | null; image: string | null }>(sql`
      select e.data->>'gift' as name, max((e.data->>'diamonds')::int) as coins, max(e.data->>'image') as image
      from stream_events e join streams s on s.id = e.stream_id
      where s.host_id = ${req.hostId} and e.kind = 'gift'
      group by 1 order by count(*) desc limit 40`);
    return withReceived(giftCatalog.list(), [...rows]);
  });

  app.get('/', async (req) => {
    const profile = await activeProfile(db, req.hostId);
    return db
      .select()
      .from(actions)
      .where(and(eq(actions.hostId, req.hostId), or(isNull(actions.profileId), eq(actions.profileId, profile.id))))
      .orderBy(actions.position);
  });

  app.post<{ Body: Body }>(
    '/',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['name', 'trigger'], properties: fields } } },
    async (req, reply) => {
      const defaults = {
        enabled: true,
        profileId: null,
        giftName: null,
        minDiamonds: null,
        likeStep: null,
        likeGrowth: null,
        command: null,
        goalId: null,
        audience: 'everyone' as const,
        audienceViewer: null,
        cooldownMs: 0,
        viewerCooldownMs: 0,
        random: false,
        text: null,
        sound: null,
        soundMediaId: null,
        mediaId: null,
        speak: false,
        durationMs: 5000,
        effect: null,
        effectAmount: 3,
        effectColor: null,
        effectSpeed: 100,
        alertEffect: null,
        alertEmoji: '🎉',
        alertShape: 'star' as const,
        alertEffectColor: null,
        alertEffectAmount: 3,
        alertEffectSpeed: 100,
        alertX: null,
        alertY: null,
        alertScale: 100,
        alertStyle: null,
        useAlertStyle2: false,
        keyCommandId: null,
        repeatWithCount: false,
        points: 0,
        screenId: null,
      };
      const merged = { ...defaults, ...req.body, name: req.body.name.trim() };
      const fixed = await check(req.hostId, merged);
      if ('error' in fixed) return reply.code(400).send(fixed);
      const [created] = await db
        .insert(actions)
        .values({ ...merged, ...fixed, hostId: req.hostId })
        .returning();
      await app.live.reload(req.hostId);
      return reply.code(201).send(created);
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<Body> }>(
    '/:id',
    { schema: { params: idParam, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: fields } } },
    async (req, reply) => {
      const where = and(eq(actions.id, req.params.id), eq(actions.hostId, req.hostId));
      const [existing] = await db.select().from(actions).where(where);
      if (!existing) return reply.code(404).send({ error: 'Action not found' });
      const merged = { ...existing, ...req.body, ...(req.body.name !== undefined && { name: req.body.name.trim() }) };
      // Taking the key press away leaves the action in the profile it was in.
      const fixed = await check(req.hostId, merged);
      if ('error' in fixed) return reply.code(400).send(fixed);
      const [updated] = await db
        .update(actions)
        .set({ ...req.body, ...fixed, name: merged.name })
        .where(where)
        .returning();
      await app.live.reload(req.hostId);
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>('/:id', { schema: { params: idParam } }, async (req, reply) => {
    const [deleted] = await db
      .delete(actions)
      .where(and(eq(actions.id, req.params.id), eq(actions.hostId, req.hostId)))
      .returning({ id: actions.id });
    if (!deleted) return reply.code(404).send({ error: 'Action not found' });
    await app.live.reload(req.hostId);
    return reply.code(204).send();
  });

  // Shows an action's alert on the overlay with sample values, live or not, so hosts can check how it looks and
  // sounds. Key presses and points are left out: a test shouldn't move the game or anyone's balance. Returns the
  // alert, so the dashboard can play it too, and how many overlays on stream showed it.
  // A sent alert reaches every screen's sockets; only screens that show alerts (and are its target) display it.
  app.post<{ Params: { id: string } }>('/:id/test', { schema: { params: idParam } }, async (req, reply) => {
    const [row] = await db
      .select({ profileId: actions.profileId })
      .from(actions)
      .where(and(eq(actions.id, req.params.id), eq(actions.hostId, req.hostId)));
    if (!row) return reply.code(404).send({ error: 'Action not found' });
    const profileId = row.profileId ?? (await activeProfile(db, req.hostId)).id;
    const [action] = await loadActionRules(db, req.hostId, profileId, req.params.id);
    if (!action || (!showsAlert(action) && !action.effect)) return reply.code(400).send({ error: 'This action has nothing to show. Give it text, a sound, a picture or video, or a screen or alert animation.' });
    const [host] = await db.select().from(hosts).where(eq(hosts.id, req.hostId));
    const text = action.text
      ? fillTemplate(action.text, {
          viewer: 'test_viewer',
          count: 5,
          gift: action.giftName ?? 'Rose',
          coins: Math.max(5, action.minDiamonds ?? 0),
          diamonds: Math.max(5, action.minDiamonds ?? 0),
          total: action.likeStep ?? 1000,
          months: 3,
          text: 'hello',
          goal: 'Like goal',
          target: 1000,
        })
      : '';
    const speech = showsAlert(action) && action.speak && text ? await app.speech.speak(voiceConfig(host!, app.secrets), text) : null;
    const alert = !showsAlert(action) ? null : alertMessage(
      {
        type: 'alert',
        action: action.id,
        text,
        sound: action.sound,
        soundFile: action.soundMediaId,
        media: action.media,
        speak: action.speak,
        durationMs: action.durationMs,
        screen: action.screenId,
        pos: action.alertPos,
        scale: action.alertScale,
        style: action.alertStyle,
        fx: action.alertFx,
      },
      speech,
    );
    if (alert) app.hub.sendToOverlays(req.hostId, alert);
    if (action.effect) {
      app.hub.sendToOverlays(req.hostId, effectMessage({ type: 'effect', effect: pickEffect(action.effect), amount: action.effectAmount, speed: action.effectSpeed, color: action.effectColor, screen: action.screenId }));
    }
    const screens = await db
      .select({ id: overlayScreens.id })
      .from(overlayScreens)
      .where(and(eq(overlayScreens.hostId, req.hostId), eq(overlayScreens.alerts, true), action.screenId ? eq(overlayScreens.id, action.screenId) : undefined));
    return { alert, overlays: app.hub.overlayCount(req.hostId, screens.map((s) => s.id)) };
  });
}

// Every part of an alert's look, within the limits the dashboard offers.
export function alertStyleSchema() {
  const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' };
  const range = (key: keyof typeof ALERT_STYLE_LIMITS) => ({ type: 'number', minimum: ALERT_STYLE_LIMITS[key][0], maximum: ALERT_STYLE_LIMITS[key][1] });
  const properties = {
    background: { enum: ['solid', 'gradient', 'none'] },
    color1: color,
    color2: color,
    angle: range('angle'),
    opacity: range('opacity'),
    textColor: color,
    font: { enum: ALERT_FONTS },
    size: range('size'),
    weight: range('weight'),
    uppercase: { type: 'boolean' },
    textShadow: { type: 'boolean' },
    radius: range('radius'),
    borderWidth: range('borderWidth'),
    borderColor: color,
    glowColor: color,
    glow: range('glow'),
    shine: { type: 'boolean' },
    animation: { enum: ALERT_ANIMATIONS },
    speed: range('speed'),
  };
  // Styles saved before speed existed don't have it.
  const required = Object.keys(properties).filter((key) => key !== 'speed');
  return { type: 'object', additionalProperties: false, required, properties };
}
