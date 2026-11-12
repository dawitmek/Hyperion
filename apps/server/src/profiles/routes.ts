import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { GAME_ICON_PATTERN, GAME_PROCESS_PATTERN, GAME_TEMPLATES, MAX_GAME_ICON_CHARS, MAX_PROFILE_GAMES, PLAIN_TEXT_PATTERN, type ProfileGame } from '@hyperion/shared';
import { GAME_TEMPLATE_ICONS } from '@hyperion/shared/game-icons';
import { actions, commands, hosts, profiles } from '../db/schema.js';
import { requireHost } from '../auth/session.js';
import { isUniqueViolation } from '../db/client.js';
import { activeProfile, sendProfileToCompanions } from './active.js';

type Body = { name: string; games?: ProfileGame[] };
type CreateBody = Body & { template?: string };

// A template's programs, without an icon of their own yet, get the game's icon. The companion's icon, taken from the
// program itself, replaces it whenever the game is picked from the ones running.
const withTemplateIcon = (games: ProfileGame[], template: (typeof GAME_TEMPLATES)[number] | undefined) =>
  games.map((g) => (!g.icon && template?.processes.includes(g.process) && GAME_TEMPLATE_ICONS[template.id] ? { ...g, icon: GAME_TEMPLATE_ICONS[template.id]! } : g));

// Making, switching to or giving a game to a profile ticks the setup guide's game step.
const GAME_STEP = sql`'["game"]'::jsonb`;
const gameStepDone = { onboardingSteps: sql`case when ${hosts.onboardingSteps} @> ${GAME_STEP} then ${hosts.onboardingSteps} else ${hosts.onboardingSteps} || ${GAME_STEP} end` };

const COMMAND_COOLDOWN_MS = 1000; // a game template's commands, per viewer

const fields = {
  name: { type: 'string', minLength: 1, maxLength: 48, pattern: PLAIN_TEXT_PATTERN },
  // Programs as the companion lists them, e.g. "gta5.exe" on Windows or "textedit" on macOS, each with its icon when
  // it was picked from the companion's list.
  games: {
    type: 'array',
    maxItems: MAX_PROFILE_GAMES,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['process'],
      properties: {
        process: { type: 'string', pattern: GAME_PROCESS_PATTERN },
        icon: { type: ['string', 'null'], maxLength: MAX_GAME_ICON_CHARS, pattern: GAME_ICON_PATTERN },
      },
    },
  },
} as const;

const idParam = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } as const;

// Lowercase and trimmed, each program once.
const normalize = (games: ProfileGame[] = []) => {
  const seen = new Set<string>();
  return games.flatMap(({ process, icon }) => {
    const name = process.trim().toLowerCase();
    if (!name || seen.has(name)) return [];
    seen.add(name);
    return [{ process: name, icon: icon ?? null }];
  });
};

export async function profileRoutes(app: FastifyInstance) {
  const { db } = app;
  app.addHook('onRequest', requireHost);

  const applyIfActive = async (hostId: string, profileId: string) => {
    const [host] = await db.select({ active: hosts.activeProfileId }).from(hosts).where(eq(hosts.id, hostId));
    if (host?.active !== profileId) return;
    await app.live.reload(hostId);
    await sendProfileToCompanions(app, hostId);
  };

  app.get('/', async (req) => {
    const active = await activeProfile(db, req.hostId);
    const rows = await db.select().from(profiles).where(eq(profiles.hostId, req.hostId)).orderBy(profiles.name);
    return rows.map((p) => ({ id: p.id, name: p.name, games: p.games, active: p.id === active.id }));
  });

  // The programs open on the host's PCs right now, to pick a profile's games from.
  app.get('/running-games', async (req) => app.hub.runningGames(req.hostId));

  // A new profile starts as a copy of the active one: settings, commands and the profile's own actions.
  // From a game template, it takes the active one's settings and the game's commands instead.
  const templateIds = GAME_TEMPLATES.map((t) => t.id);
  app.post<{ Body: CreateBody }>(
    '/',
    {
      schema: {
        body: { type: 'object', additionalProperties: false, required: ['name'], properties: { ...fields, template: { enum: templateIds } } },
      },
    },
    async (req, reply) => {
      const source = await activeProfile(db, req.hostId);
      const template = GAME_TEMPLATES.find((t) => t.id === req.body.template);
      try {
        const created = await db.transaction(async (tx) => {
          const { id: _, ...settings } = source;
          const [profile] = await tx
            .insert(profiles)
            .values({ ...settings, name: req.body.name.trim(), games: withTemplateIcon(normalize(req.body.games), template) })
            .returning();
          if (template) {
            await tx
              .insert(commands)
              .values(template.commands.map((c) => ({ ...c, cooldownMs: COMMAND_COOLDOWN_MS, hostId: req.hostId, profileId: profile!.id })));
            return profile!;
          }
          const oldCommands = await tx.select().from(commands).where(eq(commands.profileId, source.id));
          const newIds = new Map<string, string>();
          for (const { id, ...command } of oldCommands) {
            const [copy] = await tx.insert(commands).values({ ...command, profileId: profile!.id }).returning({ id: commands.id });
            newIds.set(id, copy!.id);
          }
          const oldActions = await tx.select().from(actions).where(eq(actions.profileId, source.id));
          for (const { id: _id, position: _position, ...action } of oldActions) {
            const keyCommandId = action.keyCommandId && (newIds.get(action.keyCommandId) ?? null);
            await tx.insert(actions).values({ ...action, profileId: profile!.id, keyCommandId });
          }
          return profile!;
        });
        await db.update(hosts).set(gameStepDone).where(eq(hosts.id, req.hostId));
        return reply.code(201).send(created);
      } catch (err) {
        if (isUniqueViolation(err)) return reply.code(409).send({ error: 'A profile with that name already exists' });
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<Body> }>(
    '/:id',
    { schema: { params: idParam, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: fields } } },
    async (req, reply) => {
      const { name, games } = req.body;
      try {
        const [updated] = await db
          .update(profiles)
          .set({
            ...(name !== undefined && { name: name.trim() }),
            ...(games !== undefined && { games: normalize(games) }),
          })
          .where(and(eq(profiles.id, req.params.id), eq(profiles.hostId, req.hostId)))
          .returning();
        if (!updated) return reply.code(404).send({ error: 'Profile not found' });
        if (updated.games.length) await db.update(hosts).set(gameStepDone).where(eq(hosts.id, req.hostId));
        await applyIfActive(req.hostId, updated.id);
        return updated;
      } catch (err) {
        if (isUniqueViolation(err)) return reply.code(409).send({ error: 'A profile with that name already exists' });
        throw err;
      }
    },
  );

  // Switching profiles applies immediately, even while live.
  app.post<{ Params: { id: string } }>('/:id/activate', { schema: { params: idParam } }, async (req, reply) => {
    const [profile] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.id, req.params.id), eq(profiles.hostId, req.hostId)));
    if (!profile) return reply.code(404).send({ error: 'Profile not found' });
    await db.update(hosts).set({ activeProfileId: profile.id, ...gameStepDone }).where(eq(hosts.id, req.hostId));
    await applyIfActive(req.hostId, profile.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/:id', { schema: { params: idParam } }, async (req, reply) => {
    const active = await activeProfile(db, req.hostId);
    if (active.id === req.params.id) return reply.code(409).send({ error: 'Switch to another profile before deleting this one' });
    const [deleted] = await db
      .delete(profiles)
      .where(and(eq(profiles.id, req.params.id), eq(profiles.hostId, req.hostId)))
      .returning({ id: profiles.id });
    if (!deleted) return reply.code(404).send({ error: 'Profile not found' });
    return reply.code(204).send();
  });
}
