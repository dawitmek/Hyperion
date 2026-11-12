import type { FastifyInstance } from 'fastify';
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { hash, verify } from '@node-rs/argon2';
import {
  actions,
  commands,
  companions,
  emailTokens,
  goals,
  hiddenMedia,
  hosts,
  media,
  overlayScreens,
  profiles,
  streamEvents,
  streams,
  viewerStats,
} from '../db/schema.js';
import { DEFAULT_ACTIONS } from '../actions/defaults.js';
import { newToken, sha256 } from '../crypto.js';
import { cancelEmailTokens, createEmailToken } from './email-tokens.js';
import type { Mail } from './mail.js';
import { endAllSessions, endSession, requireHost, SESSION_COOKIE, startSession } from './session.js';

const DEFAULT_COMMANDS = [
  { keyword: 'w', key: 'KeyW', holdMs: 300 },
  { keyword: 'a', key: 'KeyA', holdMs: 300 },
  { keyword: 's', key: 'KeyS', holdMs: 300 },
  { keyword: 'd', key: 'KeyD', holdMs: 300 },
  { keyword: 'jump', key: 'Space', holdMs: 300 },
  { keyword: 'run', key: 'Shift+KeyW', holdMs: 1000 }, // running needs a longer hold than a step to get anywhere
].map((c) => ({ ...c, cooldownMs: 1000 }));

const password = { type: 'string', minLength: 8, maxLength: 128 } as const;
const credentials = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password,
  },
} as const;

type Credentials = { email: string; password: string };

const gzipAsync = promisify(gzip);

export async function authRoutes(app: FastifyInstance) {
  const { db, config } = app;
  const rateLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  // Checked against when an email has no account, so a wrong login takes as long either way and its timing doesn't
  // show which emails have accounts.
  const noAccountHash = hash(newToken());

  // What the login and signup pages offer on this server.
  app.get('/config', async () => ({ signups: config.signupsEnabled, email: app.mail !== null }));

  app.post<{ Body: Credentials }>('/signup', { ...rateLimit, schema: { body: credentials } }, async (req, reply) => {
    if (!config.signupsEnabled) return reply.code(403).send({ error: 'This server isn’t taking new accounts' });
    const email = req.body.email.toLowerCase();
    const passwordHash = await hash(req.body.password);
    const host = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(hosts)
        .values({ email, passwordHash, overlayToken: newToken(), emailVerified: app.mail === null })
        .onConflictDoNothing()
        .returning({ id: hosts.id, overlayToken: hosts.overlayToken });
      if (!created) return undefined;
      await tx.insert(overlayScreens).values({ hostId: created.id, name: 'Main', token: created.overlayToken, main: true });
      const [profile] = await tx.insert(profiles).values({ hostId: created.id, name: 'Default' }).returning({ id: profiles.id });
      await tx.update(hosts).set({ activeProfileId: profile!.id }).where(eq(hosts.id, created.id));
      await tx.insert(commands).values(DEFAULT_COMMANDS.map((c) => ({ ...c, hostId: created.id, profileId: profile!.id })));
      await tx.insert(actions).values(DEFAULT_ACTIONS.map((a) => ({ ...a, hostId: created.id })));
      return created;
    });
    // With email set up, the answer is the same whether or not the email has an account, and its owner hears about
    // it by email; without email, there's no way to say "check your inbox", so a taken email is said outright.
    if (app.mail) {
      if (host) sendLink(host.id, email, 'verify');
      else if (app.emailCooldown.take('exists', email))
        sendMail('account exists', {
          to: email,
          subject: 'You already have a Hyperion account',
          text: `Someone, probably you, tried to sign up for Hyperion with this email, which already has an account.\n\nLog in: ${app.mail.publicUrl}/login\nForgot your password? ${app.mail.publicUrl}/forgot-password\n\nIf it wasn't you, you can ignore this email: nothing changed.`,
        });
      return reply.code(201).send({ verify: true });
    }
    if (!host) return reply.code(409).send({ error: 'Email already registered' });
    await startSession(db, req, reply, host.id, config.secureCookies);
    return reply.code(201).send({ id: host.id });
  });

  app.post<{ Body: Credentials }>('/login', { ...rateLimit, schema: { body: credentials } }, async (req, reply) => {
    const email = req.body.email.toLowerCase();
    if (app.loginLimiter.blocked(email)) {
      return reply.code(429).send({ error: 'Too many wrong passwords for this account. Try again in 15 minutes, or reset your password.' });
    }
    const [host] = await db.select().from(hosts).where(eq(hosts.email, email));
    const right = await verify(host?.passwordHash ?? (await noAccountHash), req.body.password);
    if (!host || !right) {
      app.loginLimiter.fail(email);
      return reply.code(401).send({ error: 'Wrong email or password' });
    }
    // Only said after the right password, so it doesn't tell strangers which emails have accounts.
    if (!host.emailVerified) {
      return reply.code(403).send({ error: 'Confirm your email first: open the link we sent you.', unverified: true });
    }
    app.loginLimiter.clear(email);
    await startSession(db, req, reply, host.id, config.secureCookies);
    return { id: host.id };
  });

  app.post('/logout', async (req, reply) => {
    await endSession(db, req, reply);
    return { ok: true };
  });

  app.post('/logout-all', { onRequest: requireHost }, async (req, reply) => {
    await endAllSessions(db, req.hostId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Signs out every other browser too, so a leaked password stops working everywhere at once.
  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    '/password',
    {
      ...rateLimit,
      onRequest: requireHost,
      schema: {
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          additionalProperties: false,
          properties: { currentPassword: password, newPassword: password },
        },
      },
    },
    async (req, reply) => {
      const [host] = await db.select({ email: hosts.email, passwordHash: hosts.passwordHash }).from(hosts).where(eq(hosts.id, req.hostId));
      if (!host) return reply.code(400).send({ error: 'Your current password is wrong' });
      // Wrong guesses count toward the same pause as logins, so a stolen session can't guess its way to the password.
      if (app.loginLimiter.blocked(host.email)) {
        return reply.code(429).send({ error: 'Too many wrong passwords for this account. Try again in 15 minutes.' });
      }
      // 400, not 401: a 401 makes the dashboard think the session ended.
      if (!(await verify(host.passwordHash, req.body.currentPassword))) {
        app.loginLimiter.fail(host.email);
        return reply.code(400).send({ error: 'Your current password is wrong' });
      }
      app.loginLimiter.clear(host.email);
      await db.update(hosts).set({ passwordHash: await hash(req.body.newPassword) }).where(eq(hosts.id, req.hostId));
      await cancelEmailTokens(db, req.hostId);
      await endAllSessions(db, req.hostId);
      await startSession(db, req, reply, req.hostId, config.secureCookies);
      passwordChanged(host.email);
      return { ok: true };
    },
  );

  // A copy of everything the account holds, as one JSON file. Secrets are left out: the password hash, the cloud voice
  // key, the TikTok session and the overlay, screen and companion tokens. Uploads come along as base64. Sent gzipped
  // when the browser accepts it (it unpacks it on arrival, so the file saved is still plain JSON): stream history
  // shrinks several times over.
  app.get('/export', { onRequest: requireHost, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { hostId } = req;
    const { passwordHash: _p, ttsCloudKey: _k, ttsTiktokSession: _t, overlayToken: _o, ...account } = getTableColumns(hosts);
    const { token: _s, ...screen } = getTableColumns(overlayScreens);
    const { tokenHash: _c, ...companion } = getTableColumns(companions);
    const { data: _d, ...upload } = getTableColumns(media);
    const [host] = await db.select(account).from(hosts).where(eq(hosts.id, hostId));
    const hostStreams = await db.select().from(streams).where(eq(streams.hostId, hostId)).orderBy(streams.startedAt);
    const events = hostStreams.length
      ? await db.select().from(streamEvents).where(inArray(streamEvents.streamId, hostStreams.map((s) => s.id))).orderBy(streamEvents.id)
      : [];
    const uploads = await db.select({ ...upload, data: media.data }).from(media).where(eq(media.hostId, hostId));
    const data = {
      exportedAt: new Date().toISOString(),
      account: host,
      profiles: await db.select().from(profiles).where(eq(profiles.hostId, hostId)),
      commands: await db.select().from(commands).where(eq(commands.hostId, hostId)),
      actions: await db.select().from(actions).where(eq(actions.hostId, hostId)),
      goals: await db.select().from(goals).where(eq(goals.hostId, hostId)),
      overlayScreens: await db.select(screen).from(overlayScreens).where(eq(overlayScreens.hostId, hostId)),
      companions: await db.select(companion).from(companions).where(eq(companions.hostId, hostId)),
      uploads: uploads.map(({ data, ...rest }) => ({ ...rest, base64: data.toString('base64') })),
      hiddenUploads: await db.select().from(hiddenMedia).where(eq(hiddenMedia.hostId, hostId)),
      leaderboard: await db.select().from(viewerStats).where(eq(viewerStats.hostId, hostId)),
      streams: hostStreams.map((s) => ({ ...s, events: events.filter((e) => e.streamId === s.id) })),
    };
    reply.header('content-disposition', `attachment; filename="hyperion-data-${new Date().toISOString().slice(0, 10)}.json"`);
    reply.header('cache-control', 'no-store');
    reply.header('vary', 'accept-encoding');
    reply.type('application/json; charset=utf-8');
    const json = JSON.stringify(data);
    if (!/\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) return json;
    reply.header('content-encoding', 'gzip');
    return gzipAsync(json);
  });

  // Deletes the account and everything that belongs to it (every table cascades from hosts). Asks for the password,
  // so a stolen session alone can't do it. A live stream stops first, so nothing is written after the rows are gone.
  app.post<{ Body: { password: string } }>(
    '/delete-account',
    {
      ...rateLimit,
      onRequest: requireHost,
      schema: { body: { type: 'object', required: ['password'], additionalProperties: false, properties: { password: { type: 'string', maxLength: 128 } } } },
    },
    async (req, reply) => {
      const [host] = await db.select({ email: hosts.email, passwordHash: hosts.passwordHash }).from(hosts).where(eq(hosts.id, req.hostId));
      if (!host) return reply.code(400).send({ error: 'Your password is wrong' });
      if (app.loginLimiter.blocked(host.email)) {
        return reply.code(429).send({ error: 'Too many wrong passwords for this account. Try again in 15 minutes.' });
      }
      // 400, not 401: a 401 makes the dashboard think the session ended.
      if (!(await verify(host.passwordHash, req.body.password))) {
        app.loginLimiter.fail(host.email);
        return reply.code(400).send({ error: 'Your password is wrong' });
      }
      await app.live.stop(req.hostId, 'account deleted');
      await db.delete(hosts).where(eq(hosts.id, req.hostId));
      app.hub.disconnectHost(req.hostId);
      app.loginLimiter.clear(host.email);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      if (app.mail) {
        sendMail('account deleted', {
          to: host.email,
          subject: 'Your Hyperion account was deleted',
          text: 'Your Hyperion account and everything in it (settings, uploads, stream history and leaderboard) were just deleted. This can’t be undone.\n\nIf you didn’t do this, someone had your password: change it anywhere else you use it.',
        });
      }
      return { ok: true };
    },
  );

  const emailOnly = { type: 'object', required: ['email'], additionalProperties: false, properties: { email: credentials.properties.email } } as const;

  // The same answer whether or not the email has an account, so these can't be used to find out who does.
  app.post<{ Body: { email: string } }>('/resend-verification', { ...rateLimit, schema: { body: emailOnly } }, async (req, reply) => {
    if (!app.mail) return reply.code(400).send({ error: 'This server doesn’t send emails' });
    const email = req.body.email.toLowerCase();
    const [host] = await db.select({ id: hosts.id, verified: hosts.emailVerified }).from(hosts).where(eq(hosts.email, email));
    if (host && !host.verified) sendLink(host.id, email, 'verify');
    return { ok: true };
  });

  app.post<{ Body: { email: string } }>('/forgot-password', { ...rateLimit, schema: { body: emailOnly } }, async (req, reply) => {
    if (!app.mail) return reply.code(400).send({ error: 'This server doesn’t send emails. Ask whoever runs it for a reset link.' });
    const email = req.body.email.toLowerCase();
    const [host] = await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.email, email));
    if (host) sendLink(host.id, email, 'reset');
    return { ok: true };
  });

  const tokenBody = { type: 'string', minLength: 20, maxLength: 100 } as const;

  app.post<{ Body: { token: string } }>(
    '/verify-email',
    { ...rateLimit, schema: { body: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: tokenBody } } } },
    async (req, reply) => {
      const hostId = await useToken(req.body.token, 'verify');
      if (!hostId) return reply.code(400).send({ error: 'This link has expired or was already used. Log in to get a new one.' });
      await db.update(hosts).set({ emailVerified: true }).where(eq(hosts.id, hostId));
      await startSession(db, req, reply, hostId, config.secureCookies);
      return { ok: true };
    },
  );

  // Also confirms the email (the link proves it), unlocks the account and signs out everywhere else.
  app.post<{ Body: { token: string; password: string } }>(
    '/reset-password',
    {
      ...rateLimit,
      schema: {
        body: { type: 'object', required: ['token', 'password'], additionalProperties: false, properties: { token: tokenBody, password } },
      },
    },
    async (req, reply) => {
      const hostId = await useToken(req.body.token, 'reset');
      if (!hostId) return reply.code(400).send({ error: 'This link has expired or was already used. Ask for a new one.' });
      const [host] = await db
        .update(hosts)
        .set({ passwordHash: await hash(req.body.password), emailVerified: true })
        .where(eq(hosts.id, hostId))
        .returning({ email: hosts.email });
      await cancelEmailTokens(db, hostId);
      await endAllSessions(db, hostId);
      await startSession(db, req, reply, hostId, config.secureCookies);
      if (host) {
        app.loginLimiter.clear(host.email);
        passwordChanged(host.email);
      }
      return { ok: true };
    },
  );

  // Emails go out in the background, so a reply takes as long whether or not the address has an account. Each kind
  // goes to an address at most once every 2 minutes (see EmailCooldown); extra requests get the same answer.
  function sendMail(kind: string, mail: Mail | (() => Promise<Mail>)) {
    if (!app.mail) return;
    const { mailer } = app.mail;
    void (async () => mailer.send(typeof mail === 'function' ? await mail() : mail))().catch((err) =>
      app.log.error({ err }, `Could not send the ${kind} email`),
    );
  }

  function sendLink(hostId: string, email: string, purpose: 'verify' | 'reset') {
    if (!app.mail || !app.emailCooldown.take(purpose, email)) return;
    const { publicUrl } = app.mail;
    sendMail(purpose === 'verify' ? 'confirmation' : 'password reset', async () => {
      // Made only when the email really goes out, so a request held back by the cooldown leaves the last link working.
      const token = await createEmailToken(db, hostId, purpose);
      const link = `${publicUrl}/${purpose === 'verify' ? 'verify-email' : 'reset-password'}#${token}`;
      return purpose === 'verify'
        ? {
            to: email,
            subject: 'Confirm your Hyperion account',
            text: `Open this link to confirm your email and sign in:\n\n${link}\n\nIt works once, for 24 hours. If you didn't sign up for Hyperion, ignore this email.`,
          }
        : {
            to: email,
            subject: 'Reset your Hyperion password',
            text: `Open this link to choose a new password:\n\n${link}\n\nIt works once, for 1 hour, and signs you out everywhere else. If you didn't ask for this, ignore this email: your password stays the same.`,
          };
    });
  }

  // So a change someone else made doesn't go unnoticed. Not held back by the cooldown: it only follows a change.
  function passwordChanged(email: string) {
    if (!app.mail) return;
    sendMail('password changed', {
      to: email,
      subject: 'Your Hyperion password was changed',
      text: `The password for your Hyperion account was just changed, and every device was signed out.\n\nIf this wasn't you, reset it now: ${app.mail.publicUrl}/forgot-password`,
    });
  }

  // A link's token works once: it's deleted as it's used, and only counts for its own purpose.
  async function useToken(token: string, purpose: 'verify' | 'reset') {
    const [row] = await db
      .delete(emailTokens)
      .where(and(eq(emailTokens.tokenHash, sha256(token)), eq(emailTokens.purpose, purpose)))
      .returning({ hostId: emailTokens.hostId, expiresAt: emailTokens.expiresAt });
    return row && row.expiresAt > new Date() ? row.hostId : undefined;
  }

  app.get('/me', { onRequest: requireHost }, async (req) => {
    const [host] = await db
      .select({
        id: hosts.id,
        email: hosts.email,
        tiktokUsername: hosts.tiktokUsername,
        overlayToken: hosts.overlayToken,
        actionsPerSecond: hosts.actionsPerSecond,
        progression: hosts.progression,
        levelGating: hosts.levelGating,
        points: hosts.points,
        pointsPerChat: hosts.pointsPerChat,
        pointsPerDiamond: hosts.pointsPerDiamond,
        pointsPerFollow: hosts.pointsPerFollow,
        pointsPerShare: hosts.pointsPerShare,
        pointsCheck: hosts.pointsCheck,
        ttsMode: hosts.ttsMode,
        ttsPrefix: hosts.ttsPrefix,
        ttsMaxLength: hosts.ttsMaxLength,
        ttsMaxWords: hosts.ttsMaxWords,
        ttsUnlockGifts: hosts.ttsUnlockGifts,
        ttsUnlockMinutes: hosts.ttsUnlockMinutes,
        ttsTemplate: hosts.ttsTemplate,
        ttsCommands: hosts.ttsCommands,
        ttsCommandTemplate: hosts.ttsCommandTemplate,
        ttsCooldownMs: hosts.ttsCooldownMs,
        ttsAutoMaxViewers: hosts.ttsAutoMaxViewers,
        ttsMinLevel: hosts.ttsMinLevel,
        ttsBlockedWords: hosts.ttsBlockedWords,
        ttsVoice: hosts.ttsVoice,
        ttsEngine: hosts.ttsEngine,
        ttsEspeakVoice: hosts.ttsEspeakVoice,
        ttsPiperVoice: hosts.ttsPiperVoice,
        ttsPiperSpeaker: hosts.ttsPiperSpeaker,
        ttsEffect: hosts.ttsEffect,
        ttsVolume: hosts.ttsVolume,
        ttsCloudProvider: hosts.ttsCloudProvider,
        ttsCloudRegion: hosts.ttsCloudRegion,
        ttsCloudVoice: hosts.ttsCloudVoice,
        // The key itself never leaves the server.
        ttsCloudKeySet: sql<boolean>`${hosts.ttsCloudKey} is not null`,
        ttsTiktokVoice: hosts.ttsTiktokVoice,
        // Same for the TikTok session.
        ttsTiktokConnected: sql<boolean>`${hosts.ttsTiktokSession} is not null`,
        uiTheme: hosts.uiTheme,
        uiThemeStyle: hosts.uiThemeStyle,
        uiMode: hosts.uiMode,
        liveLayout: hosts.liveLayout,
        streamRecap: hosts.streamRecap,
        commandDefaults: hosts.commandDefaults,
        alertStyle: hosts.alertStyle,
        alertStyle2: hosts.alertStyle2,
        hiddenSounds: hosts.hiddenSounds,
        soundVolumes: hosts.soundVolumes,
        onboarding: hosts.onboarding,
        onboardingSteps: hosts.onboardingSteps,
        // Mode settings of the active profile.
        profileId: profiles.id,
        profileName: profiles.name,
        profileGames: profiles.games,
        mode: profiles.mode,
        voteWindowMs: profiles.voteWindowMs,
        turnMs: profiles.turnMs,
        raffleMs: profiles.raffleMs,
        giftBoosts: profiles.giftBoosts,
      })
      .from(hosts)
      .innerJoin(profiles, eq(profiles.id, hosts.activeProfileId))
      .where(eq(hosts.id, req.hostId));
    return host;
  });
}
