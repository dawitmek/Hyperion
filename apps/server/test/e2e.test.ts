import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { RouteOptions } from 'fastify';
import { WebSocket } from 'ws';
import { sql } from 'drizzle-orm';
import { ALERT_PRESETS, BUILT_IN_MEDIA, PROTOCOL_VERSION, WIDGET_PRESETS, type Gift, type MediaItem } from '@hyperion/shared';
import { seedLibrary } from '../src/media/library.js';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import type { PlatformAdapter } from '../src/platforms/types.js';
import { Piper } from '../src/tts/piper.js';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { hosts, serviceStatus, streamEvents, streams } from '../src/db/schema.js';
import { Secrets } from '../src/crypto.js';

const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://hyperion:hyperion@127.0.0.1:5432/hyperion_test';
const secretsKey = randomBytes(32);

let app: Awaited<ReturnType<typeof buildApp>>;
let baseWs: string;
const sockets: WebSocket[] = [];
const routes: RouteOptions[] = [];

// Stands in for cloud TTS providers: records requests and answers with fake MP3 bytes.
const cloudRequests: { url: string; init: RequestInit }[] = [];
const fakeFetch = (async (url: string | URL, init: RequestInit = {}) => {
  cloudRequests.push({ url: String(url), init });
  if (String(url).includes('bad-key')) return new Response('{"error":"API key not valid"}', { status: 403 });
  const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
  // TikTok answers 200 with a status code in the JSON; 1 means the session is no longer signed in.
  if (String(url).includes('tiktokv.com')) {
    const signedIn = new Headers(init.headers).get('cookie') === 'sessionid=goodsession0123456789';
    return Response.json(signedIn ? { status_code: 0, data: { v_str: Buffer.from(mp3).toString('base64') } } : { status_code: 1, status_msg: 'session expired' });
  }
  if (String(url).includes('googleapis.com/v1/voices')) return Response.json({ voices: [{ name: 'en-GB-Neural2-A', ssmlGender: 'FEMALE' }] });
  // Google wraps audio in JSON; Azure and ElevenLabs return the bytes.
  if (String(url).includes('googleapis')) return Response.json({ audioContent: Buffer.from(mp3).toString('base64') });
  return new Response(mp3, { status: 200 });
}) as typeof fetch;

beforeAll(async () => {
  await runMigrations(databaseUrl);
  const fakeTikTok = (): PlatformAdapter => {
    throw new Error('TikTok must not be contacted in tests');
  };
  app = await buildApp(
    { databaseUrl, port: 0, host: '127.0.0.1', eulerApiKey: undefined, production: false, secureCookies: false, piperBin: undefined, piperVoicesDir: undefined, tiktokSessionId: undefined, secretsKey },
    { logger: false, createTikTok: fakeTikTok, fetch: fakeFetch, onRoute: (route) => routes.push(route) },
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseWs = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await app.live.stopAll();
  await app.db.execute(sql`TRUNCATE hosts, auth_sessions, profiles, commands, companions, pairing_codes, actions, media, goals, viewer_stats, service_status CASCADE`);
});

// --- helpers ---------------------------------------------------------------

// Each signup and pairing comes from its own address so the rate limits (10/min per IP) don't trip.
let clientCount = 0;
const nextAddress = () => `10.0.${Math.floor(++clientCount / 250)}.${clientCount % 250}`;

async function signUp(email = 'host@example.com') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email, password: 'correct horse' },
    remoteAddress: nextAddress(),
  });
  expect(res.statusCode).toBe(201);
  const cookie = res.cookies.find((c) => c.name === 'hyperion_session')!;
  return { cookie: `${cookie.name}=${cookie.value}`, id: res.json().id as string };
}

const api = (cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie }, remoteAddress: nextAddress() });

// The smallest files each kind of upload recognises.
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(32).fill(0)]);

async function upload(cookie: string, name: string, body: Buffer, expected = 201) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/media?name=${encodeURIComponent(name)}`,
    payload: body,
    headers: { cookie, 'content-type': 'application/octet-stream' },
    remoteAddress: nextAddress(),
  });
  expect(res.statusCode).toBe(expected);
  return res.json();
}

async function pairCompanion(cookie: string) {
  const { code } = (await api(cookie, 'POST', '/api/companions/pairing-code')).json();
  const res = await app.inject({ method: 'POST', url: '/api/companions/pair', payload: { code, name: 'Gaming PC' }, remoteAddress: nextAddress() });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; token: string };
}

// A WebSocket client that buffers messages so tests can await them in order.
// Messages of the `aside` types go to their own queue (nextAside), so tests that count messages ignore them.
// Overlays always get their screen first, and widget data (stats, chat, gifts) as things happen. Tests that care
// read those with nextAside, or pass their own `aside`.
const OVERLAY_ASIDE = ['screen', 'speechVolume', 'stats', 'chat', 'gift'];
function connect(path: string, aside: string[] = path.startsWith('/ws/overlay') ? OVERLAY_ASIDE : []) {
  const socket = new WebSocket(baseWs + path);
  sockets.push(socket);
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  const asideInbox: any[] = [];
  const asideWaiters: ((m: any) => void)[] = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const [queue, queueWaiters] = aside.includes(message.type) ? [asideInbox, asideWaiters] : [inbox, waiters];
    const waiter = queueWaiters.shift();
    waiter ? waiter(message) : queue.push(message);
  });
  const take = (queue: any[], queueWaiters: ((m: any) => void)[]) =>
    queue.length > 0
      ? Promise.resolve(queue.shift())
      : new Promise<any>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('No message within 2s')), 2000);
          queueWaiters.push((m) => (clearTimeout(timer), resolve(m)));
        });
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  return {
    socket,
    closed,
    opened: new Promise<void>((resolve) => socket.on('open', () => resolve())),
    next: () => take(inbox, waiters),
    nextAside: () => take(asideInbox, asideWaiters),
    // Resolves to the messages that arrived within `ms`; used to assert nothing was sent.
    drain: (ms = 200) => new Promise<any[]>((resolve) => setTimeout(() => resolve(inbox.splice(0)), ms)),
    send: (message: object) => socket.send(JSON.stringify(message)),
  };
}

async function connectCompanion(token: string) {
  const companion = connect('/ws/companion', ['commands', 'theme']);
  await companion.opened;
  companion.send({ type: 'hello', token, protocol: PROTOCOL_VERSION });
  return companion;
}

// --- tests -----------------------------------------------------------------

describe('accounts', () => {
  it('seeds default commands on signup and rejects duplicate emails', async () => {
    const { cookie } = await signUp();
    const commands = (await api(cookie, 'GET', '/api/commands')).json();
    expect(commands.map((c: any) => [c.keyword, c.key]).sort()).toEqual([
      ['a', 'KeyA'],
      ['d', 'KeyD'],
      ['jump', 'Space'],
      ['run', 'Shift+KeyW'],
      ['s', 'KeyS'],
      ['w', 'KeyW'],
    ]);
    const dup = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'HOST@example.com', password: 'whatever123' } });
    expect(dup.statusCode).toBe(409);
  });

  // Every route answers 401 to a visitor without a session, unless it's listed here with the reason it's open.
  // A new route that forgets requireHost fails this test instead of going unnoticed.
  const PUBLIC_ROUTES: Record<string, string> = {
    'GET /api/health': 'health check',
    'POST /api/auth/signup': 'creates the session',
    'POST /api/auth/login': 'creates the session',
    'POST /api/auth/logout': 'only ends the session it was sent',
    'POST /api/companions/pair': 'the one-time pairing code is the credential',
    'POST /api/companions/tiktok-session': "the companion's device token is the credential (tested below)",
    'GET /media/:id': 'overlays in OBS have no login; ids are random UUIDs',
    'GET /ws/companion': 'websocket; the device token comes in the first message',
    'GET /ws/overlay': "websocket; the overlay's token is the credential",
  };

  it('requires a session on every route that is not deliberately public', async () => {
    const unguarded: string[] = [];
    const checked = new Set<string>();
    for (const route of routes) {
      if (!route.url.startsWith('/api/') && !route.url.startsWith('/media/') && !route.url.startsWith('/ws/')) continue; // the web app's files
      for (const method of [route.method].flat()) {
        if (method === 'HEAD') continue;
        const key = `${method} ${route.url}`;
        checked.add(key);
        if (key in PUBLIC_ROUTES) continue;
        const url = route.url.replace(/:\w+/g, '00000000-0000-4000-8000-000000000000');
        const res = await app.inject({ method: method as 'GET', url, remoteAddress: nextAddress() });
        if (res.statusCode !== 401) unguarded.push(`${key} answered ${res.statusCode}`);
      }
    }
    expect(unguarded).toEqual([]);
    // Keeps the list honest: a public route that was removed or renamed must leave the list too.
    expect(Object.keys(PUBLIC_ROUTES).filter((key) => !checked.has(key))).toEqual([]);
  });

  it('does not let a session outlive a new login from the same browser', async () => {
    const { cookie } = await signUp();
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'host@example.com', password: 'correct horse' },
      headers: { cookie },
    });
    expect(again.statusCode).toBe(200);
    expect((await api(cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('logs in, rejects a wrong password, and logs out', async () => {
    await signUp();
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'host@example.com', password: 'wrong password' } });
    expect(bad.statusCode).toBe(401);
    const good = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'host@example.com', password: 'correct horse' } });
    expect(good.statusCode).toBe(200);
    const cookie = `hyperion_session=${good.cookies.find((c) => c.name === 'hyperion_session')!.value}`;
    expect((await api(cookie, 'GET', '/api/auth/me')).json().email).toBe('host@example.com');
    await api(cookie, 'POST', '/api/auth/logout');
    expect((await api(cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('rate-limits repeated login attempts from one address', async () => {
    const remoteAddress = nextAddress();
    const attempt = () =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@example.com', password: 'wrong password' }, remoteAddress });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
  });

  it('refuses commands that press disallowed keys or use the reserved queue keyword', async () => {
    const { cookie } = await signUp();
    const res = await api(cookie, 'POST', '/api/commands', { keyword: 'quit', key: 'AltLeft', holdMs: 100, cooldownMs: 0 });
    expect(res.statusCode).toBe(400);
    const blocked = await api(cookie, 'POST', '/api/commands', { keyword: 'close', key: 'Control+Shift+KeyW', holdMs: 100, cooldownMs: 0 });
    expect([blocked.statusCode, blocked.json().error]).toEqual([400, 'Ctrl+W closes windows and tabs']);
    const win = await api(cookie, 'POST', '/api/commands', { keyword: 'run', key: 'Meta+KeyR', holdMs: 100, cooldownMs: 0 });
    expect(win.statusCode).toBe(400);
    const combo = await api(cookie, 'POST', '/api/commands', { keyword: 'emote', key: 'Control+Shift+KeyE', holdMs: 100, cooldownMs: 0 });
    expect(combo.statusCode).toBe(201);
    const join = await api(cookie, 'POST', '/api/commands', { keyword: 'Join', key: 'KeyJ', holdMs: 100, cooldownMs: 0 });
    expect(join.statusCode).toBe(400);
  });

  it('requires a TikTok username before going live on TikTok', async () => {
    const { cookie } = await signUp();
    expect((await api(cookie, 'POST', '/api/live/start', { source: 'tiktok' })).statusCode).toBe(400);
  });
});

describe('live pipeline (simulated source)', () => {
  it('turns viewer comments into companion key presses and overlay events', async () => {
    const { cookie } = await signUp();
    const { token } = await pairCompanion(cookie);
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();

    const companion = await connectCompanion(token);
    expect(await companion.next()).toMatchObject({ type: 'ready', hostId: me.id });
    expect(await companion.next()).toEqual({ type: 'profile', name: 'Default', gameProcess: null });
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.opened;

    expect((await api(cookie, 'POST', '/api/live/start', { source: 'simulated' })).json()).toEqual({
      live: true,
      source: 'simulated',
      mode: 'anarchy',
      startedAt: expect.any(Number),
      companionsOnline: 1,
    });
    expect(await overlay.next()).toEqual({ type: 'live', state: 'started' });
    expect(await overlay.next()).toMatchObject({ type: 'mode', state: { mode: 'anarchy' } });

    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'A' });
    expect(await companion.next()).toMatchObject({ type: 'action', action: { key: 'KeyA', holdMs: 300 } });
    expect(await overlay.next()).toMatchObject({ type: 'command', viewer: 'alice', keyword: 'a' });

    // Same viewer within the 1s cooldown: nothing. Another viewer: fires.
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'a' });
    expect(await companion.drain()).toEqual([]);
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'bob', text: 'a' });
    expect(await companion.next()).toMatchObject({ type: 'action', action: { key: 'KeyA' } });

    expect(await overlay.next()).toMatchObject({ type: 'command', viewer: 'bob', keyword: 'a' });

    await api(cookie, 'POST', '/api/live/stop');
    expect(await overlay.next()).toEqual({ type: 'live', state: 'stopped' });
  });

  it('picks up command changes mid-stream', async () => {
    const { cookie } = await signUp();
    const { token } = await pairCompanion(cookie);
    const companion = await connectCompanion(token);
    await companion.next(); // ready
    await companion.next(); // profile
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });

    const created = await api(cookie, 'POST', '/api/commands', { keyword: 'Shoot', key: 'KeyF', holdMs: 50, cooldownMs: 0 });
    expect(created.statusCode).toBe(201);
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'shoot' });
    expect(await companion.next()).toMatchObject({ type: 'action', action: { key: 'KeyF', holdMs: 50 } });

    // Combinations travel to the companion as written; it presses them.
    await api(cookie, 'POST', '/api/commands', { keyword: 'emote', key: 'Control+Shift+KeyE', holdMs: 50, cooldownMs: 0 });
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'emote' });
    expect(await companion.next()).toMatchObject({ type: 'action', action: { key: 'Control+Shift+KeyE' } });
  });

  it("records the PC's own name and OS, and only the latest pairing code works", async () => {
    const { cookie } = await signUp();
    const first = (await api(cookie, 'POST', '/api/companions/pairing-code')).json().code;
    const second = (await api(cookie, 'POST', '/api/companions/pairing-code')).json().code;
    const pair = (code: string) =>
      app.inject({ method: 'POST', url: '/api/companions/pair', payload: { code, name: 'Gaming PC', hostname: 'DESKTOP-7F3K2', platform: 'windows' }, remoteAddress: nextAddress() });
    expect((await pair(first)).statusCode).toBe(400); // replaced by the second
    const { token } = (await pair(second)).json();
    expect((await api(cookie, 'GET', '/api/companions')).json()).toMatchObject([{ name: 'Gaming PC', hostname: 'DESKTOP-7F3K2', platform: 'windows' }]);

    // The companion reports the PC again on every connect, so a rename shows up.
    const companion = connect('/ws/companion', ['commands', 'theme']);
    await companion.opened;
    companion.send({ type: 'hello', token, protocol: PROTOCOL_VERSION, hostname: 'Streaming-Rig', platform: 'windows' });
    await companion.next(); // ready
    expect((await api(cookie, 'GET', '/api/companions')).json()[0]).toMatchObject({ hostname: 'Streaming-Rig' });
  });

  it('tells the companion what each command presses, on connect and whenever commands change', async () => {
    const { cookie } = await signUp();
    const companion = await connectCompanion((await pairCompanion(cookie)).token);
    expect((await companion.nextAside()).commands.map((c: { keyword: string }) => c.keyword)).toEqual(['w', 'a', 's', 'd', 'jump', 'run']);
    expect(await companion.nextAside()).toMatchObject({ type: 'theme' });
    await api(cookie, 'POST', '/api/commands', { keyword: 'emote', key: 'Control+Shift+KeyE', holdMs: 100, cooldownMs: 0 });
    expect((await companion.nextAside()).commands.at(-1)).toEqual({ keyword: 'emote', key: 'Control+Shift+KeyE', enabled: true, macro: null });
    const emote = (await api(cookie, 'GET', '/api/commands')).json().find((c: { keyword: string }) => c.keyword === 'emote');
    await api(cookie, 'PATCH', `/api/commands/${emote.id}`, { enabled: false });
    expect((await companion.nextAside()).commands.at(-1)).toMatchObject({ keyword: 'emote', enabled: false });
    await api(cookie, 'DELETE', `/api/commands/${emote.id}`);
    expect((await companion.nextAside()).commands).toHaveLength(6);
  });

  it('runs chains and macros, and only lets commands do one thing', async () => {
    const { cookie } = await signUp();
    const post = (body: object) => api(cookie, 'POST', '/api/commands', { holdMs: 100, cooldownMs: 0, ...body });
    const companion = await connectCompanion((await pairCompanion(cookie)).token);
    await companion.next(); // ready
    await companion.next(); // profile

    // The PC says what it has; a server only ever gets names.
    companion.send({ type: 'macros', names: ['spin', 42] });
    await companion.drain();
    expect((await api(cookie, 'GET', '/api/commands/macros')).json()).toEqual(['spin']);

    const leap = await post({ keyword: 'leap', key: '', chain: [{ keyword: 'run', delayMs: 0 }, { keyword: 'jump', delayMs: 0 }, { keyword: 'w', delayMs: 150 }] });
    expect(leap.statusCode).toBe(201);
    expect((await post({ keyword: 'dance', key: '', macro: 'spin' })).statusCode).toBe(201);

    expect((await post({ keyword: 'both', key: 'KeyA', macro: 'spin' })).statusCode).toBe(400);
    expect((await post({ keyword: 'nothing', key: '' })).statusCode).toBe(400);
    expect((await post({ keyword: 'lost', key: '', chain: [{ keyword: 'nope', delayMs: 0 }] })).statusCode).toBe(400);
    expect((await post({ keyword: 'nested', key: '', chain: [{ keyword: 'leap', delayMs: 0 }] })).statusCode).toBe(400);
    const self = await api(cookie, 'PATCH', `/api/commands/${leap.json().id}`, { chain: [{ keyword: 'leap', delayMs: 0 }] });
    expect(self.statusCode).toBe(400);

    // A chain has nothing for a PC to approve; a macro command says which macro.
    await companion.nextAside(); // the list on connect
    await companion.nextAside(); // the theme
    await companion.nextAside(); // after adding leap
    const last = (await companion.nextAside()).commands; // after adding dance
    expect(last.map((c: { keyword: string }) => c.keyword)).not.toContain('leap');
    expect(last.find((c: { keyword: string }) => c.keyword === 'dance')).toMatchObject({ key: '', macro: 'spin' });

    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    await companion.drain();
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'leap' });
    const soon = (await companion.drain(50)).filter((m) => m.type === 'action');
    expect(soon.map((m) => m.action.key)).toEqual(['Shift+KeyW', 'Space']);
    const later = (await companion.drain(250)).filter((m) => m.type === 'action');
    expect(later.map((m) => m.action.key)).toEqual(['KeyW']);

    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'dance' });
    expect((await companion.drain()).filter((m) => m.type === 'action')).toMatchObject([{ action: { key: '', macro: 'spin' } }]);

    // Counted once, as the command viewers typed.
    await api(cookie, 'POST', '/api/live/stop');
    const report = (await api(cookie, 'GET', '/api/analytics/streams/latest')).json();
    expect(report.commandUsage.map((c: { keyword: string; fired: number }) => [c.keyword, c.fired]).sort()).toEqual([['dance', 1], ['leap', 1]]);

    companion.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await api(cookie, 'GET', '/api/commands/macros')).json()).toEqual([]);
  });

  it("keeps hosts isolated from each other's sessions", async () => {
    const a = await signUp('a@example.com');
    const b = await signUp('b@example.com');
    const companionB = await connectCompanion((await pairCompanion(b.cookie)).token);
    await companionB.next(); // ready
    await companionB.next(); // profile

    await api(a.cookie, 'POST', '/api/live/start', { source: 'simulated' });
    await api(a.cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'a' });
    expect(await companionB.drain()).toEqual([]);
    // B has no session of its own to simulate into.
    expect((await api(b.cookie, 'POST', '/api/live/simulate', { viewer: 'x', text: 'a' })).statusCode).toBe(409);
  });
});

describe('modes, gifts and leaderboard (simulated source)', () => {
  async function liveHost() {
    const host = await signUp();
    const companion = await connectCompanion((await pairCompanion(host.cookie)).token);
    await companion.next(); // ready
    await companion.next(); // profile
    const me = (await api(host.cookie, 'GET', '/api/auth/me')).json();
    await api(host.cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const say = (viewer: string, text: string) => api(host.cookie, 'POST', '/api/live/simulate', { viewer, text });
    return { ...host, companion, me, say };
  }

  it('switches to democracy mid-stream and fires the winning vote', async () => {
    const { cookie, companion, me, say } = await liveHost();
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    // A late-joining overlay catches up on the session.
    expect(await overlay.next()).toEqual({ type: 'live', state: 'started' });
    expect(await overlay.next()).toMatchObject({ type: 'mode', state: { mode: 'anarchy' } });
    expect(await overlay.next()).toEqual({ type: 'leaderboard', entries: [], progression: false });

    expect((await api(cookie, 'PATCH', '/api/settings', { mode: 'democracy', voteWindowMs: 1000 })).statusCode).toBe(200);
    expect(await overlay.next()).toMatchObject({ type: 'mode', state: { mode: 'democracy', tally: [], endsAt: null } });
    expect((await api(cookie, 'GET', '/api/live/status')).json().mode).toBe('democracy');

    await say('alice', 'a');
    await say('bob', 'd');
    await say('carol', 'd');
    expect(await companion.drain(300)).toEqual([]); // nothing until the window closes
    expect(await companion.next()).toMatchObject({ type: 'action', action: { key: 'KeyD' } });
    expect(await companion.drain(1200)).toEqual([]); // exactly one press
    const messages = await overlay.drain(0);
    expect(messages).toContainEqual(expect.objectContaining({ type: 'command', viewer: '2 votes', keyword: 'd' }));
  });

  it("saves a viewer's picture link with their counts, keeps it, and adds no row for only being seen", async () => {
    const { cookie, me, say } = await liveHost();
    const { id } = (await api(cookie, 'GET', '/api/auth/me')).json();
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.drain(100);
    app.stats.sawViewer(id, 'alice', { avatar: 'https://cdn.test/old.jpg' });
    app.stats.sawViewer(id, 'lurker', { avatar: 'https://cdn.test/lurker.jpg' });
    await say('alice', 'w');
    const messages = await overlay.drain();
    expect(messages.find((m: any) => m.type === 'command')).toMatchObject({ viewer: 'alice', avatar: 'https://cdn.test/old.jpg' });
    await app.live.flushStats();
    const avatars = async () => (await api(cookie, 'GET', '/api/leaderboard')).json().map((e: any) => [e.viewer, e.avatar]);
    expect(await avatars()).toEqual([['alice', 'https://cdn.test/old.jpg']]);
    app.stats.sawViewer(id, 'alice', { avatar: 'https://cdn.test/new.jpg' });
    app.stats.record(id, 'alice', { commands: 1, xp: 1 });
    await app.live.flushStats();
    expect(await avatars()).toEqual([['alice', 'https://cdn.test/new.jpg']]);
    // Counts still waiting when a stream stops keep the link.
    app.stats.sawViewer(id, 'bob', { avatar: 'https://cdn.test/bob.jpg' });
    app.stats.record(id, 'bob', { commands: 1, xp: 1 });
    await api(cookie, 'POST', '/api/live/stop');
    await app.live.flushStats();
    expect(await avatars()).toContainEqual(['bob', 'https://cdn.test/bob.jpg']);
    const rows = await app.db.execute(sql`select viewer_id from viewer_stats where host_id = ${id} and viewer_id = 'lurker'`);
    expect(rows).toHaveLength(0);
  });

  it('shows a viewer by display name while keeping their id as who they are', async () => {
    const { cookie, me, companion, say } = await liveHost();
    const { id } = (await api(cookie, 'GET', '/api/auth/me')).json();
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.drain(100);
    app.stats.sawViewer(id, 'owl_123', { name: 'Night Owl' });
    await say('owl_123', 'w');
    expect(await companion.next()).toMatchObject({ type: 'action' });
    expect((await overlay.drain()).find((m: any) => m.type === 'command')).toMatchObject({ viewer: 'Night Owl' });
    await app.live.flushStats();
    expect((await api(cookie, 'GET', '/api/leaderboard')).json()).toMatchObject([{ viewer: 'owl_123', name: 'Night Owl', commands: 1 }]);
    await app.live.flushRecording(id);
    expect((await api(cookie, 'GET', '/api/analytics/viewers/owl_123')).json()).toMatchObject({ viewer: 'owl_123', name: 'Night Owl' });
    const found = (await api(cookie, 'GET', '/api/analytics/activity?kinds=comment&viewer=night')).json();
    expect(found.events).toHaveLength(1);
    expect(found.events[0]).toMatchObject({ viewer: 'owl_123', data: { name: 'Night Owl' } });
    expect((await api(cookie, 'GET', '/api/analytics/streams/latest')).json().summary).toMatchObject({ topPlayer: 'owl_123', topPlayerName: 'Night Owl' });
  });

  it("presses a gift action's key once per gift and counts gifts on the leaderboard", async () => {
    const { cookie, companion, say } = await liveHost();
    const commands = (await api(cookie, 'GET', '/api/commands')).json();
    const jump = commands.find((c: any) => c.keyword === 'jump');
    const created = await api(cookie, 'POST', '/api/actions', { name: 'Rose jumps', trigger: 'gift', giftName: 'Rose', keyCommandId: jump.id, repeatWithCount: true });
    expect(created.statusCode).toBe(201);
    // A key press puts the action in its command's profile.
    const profile = (await api(cookie, 'GET', '/api/profiles')).json()[0];
    expect(created.json()).toMatchObject({ giftName: 'rose', profileId: profile.id });

    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', gift: 'Rose', count: 2 });
    expect(await companion.next()).toMatchObject({ action: { key: 'Space' } });
    expect(await companion.next()).toMatchObject({ action: { key: 'Space' } }); // repeat, 400 ms later
    await say('bob', 'a');
    await companion.next();

    await app.live.flushStats();
    expect((await api(cookie, 'GET', '/api/leaderboard')).json()).toEqual([
      { viewer: 'alice', commands: 0, gifts: 2, xp: 2, points: 0, avatar: null, name: null }, // 1 diamond per simulated gift
      { viewer: 'bob', commands: 1, gifts: 0, xp: 1, points: 0, avatar: null, name: null },
    ]);
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.next(); // live
    await overlay.next(); // mode
    expect((await overlay.next()).entries).toHaveLength(2);
    expect((await api(cookie, 'DELETE', '/api/leaderboard')).statusCode).toBe(204);
    expect((await api(cookie, 'GET', '/api/leaderboard')).json()).toEqual([]);
    expect(await overlay.next()).toEqual({ type: 'leaderboard', entries: [], progression: false });
  });

  it('rejects a simulate request with both or neither of text and gift', async () => {
    const { cookie } = await liveHost();
    const bad = (payload: object) => api(cookie, 'POST', '/api/live/simulate', payload);
    expect((await bad({ viewer: 'a' })).statusCode).toBe(400);
    expect((await bad({ viewer: 'a', text: 'a', gift: 'Rose' })).statusCode).toBe(400);
  });
});

describe('game profiles', () => {
  it("starts a profile from a game template with that game's commands", async () => {
    const { cookie } = await signUp();
    const res = await api(cookie, 'POST', '/api/profiles', { name: 'Celeste', gameProcess: 'celeste.exe', template: 'celeste' });
    expect(res.statusCode).toBe(201);
    await api(cookie, 'POST', `/api/profiles/${res.json().id}/activate`);
    const celeste = (await api(cookie, 'GET', '/api/commands')).json();
    expect(celeste.map((c: any) => [c.keyword, c.key])).toContainEqual(['dash', 'KeyX']);
    expect(celeste.map((c: any) => c.keyword)).not.toContain('run'); // nothing copied from Default
    expect((await api(cookie, 'POST', '/api/profiles', { name: 'Nope', template: 'not-a-game' })).statusCode).toBe(400);
  });

  it('switches commands and tells the companion which game to target', async () => {
    const { cookie } = await signUp();
    const companion = await connectCompanion((await pairCompanion(cookie)).token);
    await companion.next(); // ready
    expect(await companion.next()).toEqual({ type: 'profile', name: 'Default', gameProcess: null });
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });

    // A new profile copies the active one; editing it doesn't touch the original.
    const created = await api(cookie, 'POST', '/api/profiles', { name: 'GTA V', gameProcess: 'GTA5.exe' });
    expect(created.statusCode).toBe(201);
    const gta = created.json();
    expect(gta.gameProcess).toBe('gta5.exe');
    expect((await api(cookie, 'POST', '/api/profiles', { name: 'GTA V' })).statusCode).toBe(409);
    expect((await api(cookie, 'POST', '/api/profiles', { name: 'Bad', gameProcess: 'C:\\Games\\gta5.exe' })).statusCode).toBe(400);
    // macOS process names have no extension.
    expect((await api(cookie, 'POST', '/api/profiles', { name: 'Mac game', gameProcess: 'TextEdit' })).json().gameProcess).toBe('textedit');

    expect((await api(cookie, 'POST', `/api/profiles/${gta.id}/activate`)).statusCode).toBe(200);
    expect(await companion.next()).toEqual({ type: 'profile', name: 'GTA V', gameProcess: 'gta5.exe' });
    const gtaCommands = (await api(cookie, 'GET', '/api/commands')).json();
    expect(gtaCommands.map((c: any) => c.keyword).sort()).toEqual(['a', 'd', 'jump', 'run', 's', 'w']);
    const left = gtaCommands.find((c: any) => c.keyword === 'a');
    await api(cookie, 'PATCH', `/api/commands/${left.id}`, { key: 'KeyQ' });

    // The live session uses the active profile's commands immediately.
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'a' });
    expect(await companion.next()).toMatchObject({ type: 'action', action: { key: 'KeyQ' } });

    const list = (await api(cookie, 'GET', '/api/profiles')).json();
    expect(list.map((p: any) => [p.name, p.active])).toEqual([
      ['Default', false],
      ['GTA V', true],
      ['Mac game', false],
    ]);
    const original = list.find((p: any) => p.name === 'Default');
    expect((await api(cookie, 'DELETE', `/api/profiles/${gta.id}`)).statusCode).toBe(409); // active
    await api(cookie, 'POST', `/api/profiles/${original.id}/activate`);
    expect(await companion.next()).toMatchObject({ type: 'profile', name: 'Default' });
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'bob', text: 'a' });
    expect(await companion.next()).toMatchObject({ type: 'action', action: { key: 'KeyA' } });
    expect((await api(cookie, 'DELETE', `/api/profiles/${gta.id}`)).statusCode).toBe(204);
  });

  it("can't reach another host's profiles", async () => {
    const a = await signUp('a@example.com');
    const b = await signUp('b@example.com');
    const [profileA] = (await api(a.cookie, 'GET', '/api/profiles')).json();
    expect((await api(b.cookie, 'POST', `/api/profiles/${profileA.id}/activate`)).statusCode).toBe(404);
    expect((await api(b.cookie, 'PATCH', `/api/profiles/${profileA.id}`, { name: 'x' })).statusCode).toBe(404);
  });
});

describe('viewer progression', () => {
  it('gates commands by level, levels viewers up and shows levels on the overlay', async () => {
    const { cookie } = await signUp();
    const companion = await connectCompanion((await pairCompanion(cookie)).token);
    await companion.next(); // ready
    await companion.next(); // profile
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    expect([me.progression, me.levelGating]).toEqual([false, false]);
    const left = (await api(cookie, 'GET', '/api/commands')).json().find((c: any) => c.keyword === 'a');
    await api(cookie, 'PATCH', `/api/commands/${left.id}`, { minLevel: 2 });
    await api(cookie, 'PATCH', '/api/settings', { progression: true, levelGating: true });

    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.next(); // live
    await overlay.next(); // mode
    expect(await overlay.next()).toEqual({ type: 'leaderboard', entries: [], progression: true });

    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'a' });
    expect(await companion.drain()).toEqual([]); // level 1 < 2

    // A 10-diamond gift is 10 XP: level 2.
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', gift: 'Lion', diamonds: 10 });
    expect(await overlay.next()).toEqual({ type: 'levelUp', viewer: 'alice', level: 2 });
    expect(await overlay.next()).toMatchObject({ type: 'alert', text: 'alice sent 1× Lion!', sound: 'coin' }); // starter alert
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'a' });
    expect(await companion.next()).toMatchObject({ type: 'action', action: { key: 'KeyA' } });
    expect(await overlay.next()).toMatchObject({ type: 'command', viewer: 'alice', keyword: 'a', level: 2 });

    // XP survives going offline and back.
    await api(cookie, 'POST', '/api/live/stop');
    await app.live.flushStats();
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'a' });
    expect(await companion.next()).toMatchObject({ type: 'action', action: { key: 'KeyA' } });
    await app.live.flushStats();
    expect((await api(cookie, 'GET', '/api/leaderboard')).json()).toEqual([{ viewer: 'alice', commands: 2, gifts: 1, xp: 12, points: 0, avatar: null, name: null }]);
  });
});

describe('points', () => {
  it('earns points, spends them on commands, and answers !points when allowed', async () => {
    const { cookie } = await signUp();
    const companion = await connectCompanion((await pairCompanion(cookie)).token);
    await companion.next(); // ready
    await companion.next(); // profile
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    expect(me).toMatchObject({ points: false, pointsPerChat: 1, pointsPerDiamond: 10, pointsCheck: false });
    const left = (await api(cookie, 'GET', '/api/commands')).json().find((c: any) => c.keyword === 'a');
    await api(cookie, 'PATCH', `/api/commands/${left.id}`, { cost: 25 });
    expect((await api(cookie, 'POST', '/api/commands', { keyword: '!points', key: 'KeyB', holdMs: 100, cooldownMs: 0 })).statusCode).toBe(400);
    await api(cookie, 'PATCH', '/api/settings', { points: true, pointsPerDiamond: 10, pointsPerFollow: 20 });

    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.next(); // live
    await overlay.next(); // mode
    await overlay.next(); // leaderboard
    const sim = (body: object) => api(cookie, 'POST', '/api/live/simulate', body);

    await sim({ viewer: 'alice', text: 'hi' }); // 1 point for chatting
    await sim({ viewer: 'alice', text: 'a' }); // a minute hasn't passed: no point, and 1 < 25
    expect(await companion.drain()).toEqual([]);
    await sim({ viewer: 'alice', event: 'follow' }); // 21
    await sim({ viewer: 'alice', event: 'share' }); // 26
    await sim({ viewer: 'alice', text: 'a' });
    expect(await companion.next()).toMatchObject({ type: 'action', action: { key: 'KeyA' } }); // 1 left
    await sim({ viewer: 'alice', text: 'a' });
    expect(await companion.drain()).toEqual([]);

    // !points is off until the host allows it.
    await sim({ viewer: 'alice', text: '!points' });
    await api(cookie, 'PATCH', '/api/settings', { pointsCheck: true });
    await sim({ viewer: 'alice', gift: 'Rose', diamonds: 1, count: 3 }); // 31
    await sim({ viewer: 'alice', text: '!Points' });
    const messages = await overlay.drain();
    expect(messages.filter((m: any) => m.type === 'points')).toEqual([{ type: 'points', viewer: 'alice', points: 31 }]);

    await api(cookie, 'POST', '/api/live/stop');
    await app.live.flushStats();
    expect((await api(cookie, 'GET', '/api/analytics/viewers/alice')).json()).toMatchObject({ points: 31 });
    // Resetting the leaderboard keeps points; resetting points keeps the leaderboard.
    await api(cookie, 'DELETE', '/api/leaderboard');
    expect((await api(cookie, 'GET', '/api/analytics/viewers/alice')).json()).toMatchObject({ points: 31, xp: 0 });
    await api(cookie, 'DELETE', '/api/leaderboard/points');
    expect((await api(cookie, 'GET', '/api/analytics/viewers/alice')).json()).toMatchObject({ points: 0 });
  });
});

describe('voice changes mid-stream', () => {
  it('tells overlays to drop speech made with the old voice, and only when the voice changed', async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.next(); // live
    await overlay.next(); // mode
    await overlay.next(); // leaderboard
    await api(cookie, 'PATCH', '/api/settings', { actionsPerSecond: 7 });
    expect((await overlay.drain()).filter((m: any) => m.type === 'clearSpeech')).toEqual([]);
    await api(cookie, 'PATCH', '/api/settings', { ttsEngine: me.ttsEngine === 'espeak' ? 'browser' : 'espeak' });
    expect((await overlay.drain()).filter((m: any) => m.type === 'clearSpeech')).toEqual([{ type: 'clearSpeech' }]);
    await api(cookie, 'POST', '/api/live/stop');
  });

  it('cuts off read-aloud chat the moment reading chat is turned off, and reads nothing after', async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    await api(cookie, 'PATCH', '/api/settings', { ttsMode: 'all', ttsEngine: 'espeak' });
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.next(); // live
    await overlay.next(); // mode
    await overlay.next(); // leaderboard
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', text: 'hello there' });
    expect((await overlay.drain()).filter((m: any) => m.type === 'tts')).toHaveLength(1);
    // Another mode that still reads chat cuts nothing off.
    await api(cookie, 'PATCH', '/api/settings', { ttsMode: 'prefix' });
    expect((await overlay.drain()).filter((m: any) => m.type === 'clearSpeech')).toEqual([]);
    await api(cookie, 'PATCH', '/api/settings', { ttsMode: 'off' });
    expect((await overlay.drain()).filter((m: any) => m.type === 'clearSpeech')).toEqual([{ type: 'clearSpeech', chatOnly: true }]);
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'bob', text: 'still there?' });
    expect((await overlay.drain()).filter((m: any) => m.type === 'tts')).toEqual([]);
    await api(cookie, 'POST', '/api/live/stop');
  });

  it("sends the voice volume to overlays when they connect and whenever it changes, live or not", async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    expect(me.ttsVolume).toBe(100);
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.nextAside(); // screen
    expect(await overlay.nextAside()).toEqual({ type: 'speechVolume', volume: 100 });
    expect((await api(cookie, 'PATCH', '/api/settings', { ttsVolume: 40 })).statusCode).toBe(200);
    expect(await overlay.nextAside()).toEqual({ type: 'speechVolume', volume: 40 });
    expect((await api(cookie, 'GET', '/api/auth/me')).json().ttsVolume).toBe(40);
    expect((await api(cookie, 'PATCH', '/api/settings', { ttsVolume: 101 })).statusCode).toBe(400);
    // Volume isn't the voice: speech already waiting on the overlay stays.
    expect((await overlay.drain()).filter((m: any) => m.type === 'clearSpeech')).toEqual([]);
  });
});

describe('actions changed mid-stream', () => {
  it('takes back the alerts of an action turned off or deleted, and only then', async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    const follow = (await api(cookie, 'GET', '/api/actions')).json().find((a: any) => a.trigger === 'follow');
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.drain(100); // live + mode + leaderboard
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', event: 'follow' });
    expect((await overlay.drain()).filter((m: any) => m.type === 'alert')).toMatchObject([{ action: follow.id }]);
    const drops = async () => (await overlay.drain()).filter((m: any) => m.type === 'dropAlerts');
    // An edit that leaves it on keeps its alerts.
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { text: '{viewer} is here!' });
    expect(await drops()).toEqual([]);
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { enabled: false });
    expect(await drops()).toEqual([{ type: 'dropAlerts', actions: [follow.id] }]);
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'bob', event: 'follow' });
    expect((await overlay.drain()).filter((m: any) => m.type === 'alert')).toEqual([]);
    // Turning it back on takes nothing back; deleting it does.
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { enabled: true });
    expect(await drops()).toEqual([]);
    await api(cookie, 'DELETE', `/api/actions/${follow.id}`);
    expect(await drops()).toEqual([{ type: 'dropAlerts', actions: [follow.id] }]);
    await api(cookie, 'POST', '/api/live/stop');
  });
});

describe('looks', () => {
  it("styles an action's alert pop-up, sends the style with its alerts, and refuses styles out of range", async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    const follow = (await api(cookie, 'GET', '/api/actions')).json().find((a: any) => a.trigger === 'follow');
    expect(follow.alertStyle).toBeNull();
    const neon = ALERT_PRESETS.find((p) => p.id === 'neon')!.style;
    const style = { ...neon, textColor: '#ff00aa', size: 64, animation: 'bounce' };
    expect((await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertStyle: style })).statusCode).toBe(200);
    // Out of range, a color that isn't one, an unknown font, a missing part: all refused.
    for (const bad of [{ ...style, size: 500 }, { ...style, textColor: 'red' }, { ...style, font: 'papyrus' }, { ...style, glow: undefined }]) {
      expect((await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertStyle: bad })).statusCode).toBe(400);
    }
    // A part Hyperion doesn't know is dropped, not stored.
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertStyle: { ...style, extra: 1 } });
    expect((await api(cookie, 'GET', '/api/actions')).json().find((a: any) => a.id === follow.id).alertStyle).toEqual(style);
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.drain(100);
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', event: 'follow' });
    expect((await overlay.drain()).filter((m: any) => m.type === 'alert')).toMatchObject([{ action: follow.id, style }]);
    // Back to the default look: alerts carry no style at all, as before styles existed.
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertStyle: null });
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'bob', event: 'follow' });
    const [plain] = (await overlay.drain()).filter((m: any) => m.type === 'alert');
    expect(plain).not.toHaveProperty('style');
    // Test sends the style too.
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertStyle: style });
    expect((await api(cookie, 'POST', `/api/actions/${follow.id}/test`)).json().alert.style).toEqual(style);
    await api(cookie, 'POST', '/api/live/stop');
  });

  it("gives alerts of actions without their own look the host's default look, live and in Test", async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    expect(me.alertStyle).toBeNull();
    const all = (await api(cookie, 'GET', '/api/actions')).json();
    const follow = all.find((a: any) => a.trigger === 'follow');
    const share = all.find((a: any) => a.trigger === 'share');
    const solar = ALERT_PRESETS.find((p) => p.id === 'solar')!.style;
    const bold = ALERT_PRESETS.find((p) => p.id === 'bold')!.style;
    expect((await api(cookie, 'PATCH', '/api/settings', { alertStyle: { ...solar, size: 200 } })).statusCode).toBe(400);
    await api(cookie, 'PATCH', '/api/settings', { alertStyle: solar });
    expect((await api(cookie, 'GET', '/api/auth/me')).json().alertStyle).toEqual(solar);
    await api(cookie, 'PATCH', `/api/actions/${share.id}`, { enabled: true, alertStyle: bold });
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.drain(100);
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', event: 'follow' });
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', event: 'share' });
    const alerts = (await overlay.drain()).filter((m: any) => m.type === 'alert');
    expect(alerts.find((a: any) => a.action === follow.id).style).toEqual(solar);
    expect(alerts.find((a: any) => a.action === share.id).style).toEqual(bold);
    expect((await api(cookie, 'POST', `/api/actions/${follow.id}/test`)).json().alert.style).toEqual(solar);

    // A second look, shared by the actions that use it. With none saved they get the main one.
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { useAlertStyle2: true });
    expect((await api(cookie, 'POST', `/api/actions/${follow.id}/test`)).json().alert.style).toEqual(solar);
    const fast = { ...bold, speed: 200 };
    expect((await api(cookie, 'PATCH', '/api/settings', { alertStyle2: { ...bold, speed: 500 } })).statusCode).toBe(400);
    expect((await api(cookie, 'PATCH', '/api/settings', { alertStyle2: fast })).statusCode).toBe(200);
    expect((await api(cookie, 'GET', '/api/auth/me')).json().alertStyle2).toEqual(fast);
    expect((await api(cookie, 'POST', `/api/actions/${follow.id}/test`)).json().alert.style).toEqual(fast);
    // An action's own look comes first.
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertStyle: bold });
    expect((await api(cookie, 'POST', `/api/actions/${follow.id}/test`)).json().alert.style).toEqual(bold);
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertStyle: null, useAlertStyle2: false });
    // The default changes mid-stream: the next alert has the new look. The action itself still has none of its own.
    await overlay.drain(); // the Test alert
    await api(cookie, 'PATCH', '/api/settings', { alertStyle: null });
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'bob', event: 'follow' });
    expect((await overlay.drain()).find((m: any) => m.type === 'alert')).not.toHaveProperty('style');
    expect((await api(cookie, 'GET', '/api/actions')).json().find((a: any) => a.id === follow.id).alertStyle).toBeNull();
    await api(cookie, 'POST', '/api/live/stop');
  });

  it("keeps the account's theme, and the companion gets it on connect and when it changes", async () => {
    const { cookie } = await signUp();
    expect((await api(cookie, 'GET', '/api/auth/me')).json()).toMatchObject({ uiTheme: 'default', uiThemeStyle: 'colors' });
    const { token } = await pairCompanion(cookie);
    const companion = await connectCompanion(token);
    expect(await companion.next()).toMatchObject({ type: 'ready' });
    expect(await companion.next()).toMatchObject({ type: 'profile' });
    expect(await companion.nextAside()).toMatchObject({ type: 'commands' });
    expect(await companion.nextAside()).toEqual({ type: 'theme', theme: 'default', style: 'colors', mode: 'system' });
    await api(cookie, 'PATCH', '/api/settings', { uiTheme: 'solar-dusk', uiThemeStyle: 'colors' });
    expect(await companion.nextAside()).toEqual({ type: 'theme', theme: 'solar-dusk', style: 'colors', mode: 'system' });
    await api(cookie, 'PATCH', '/api/settings', { uiMode: 'dark' });
    expect(await companion.nextAside()).toEqual({ type: 'theme', theme: 'solar-dusk', style: 'colors', mode: 'dark' });
    expect((await api(cookie, 'GET', '/api/auth/me')).json()).toMatchObject({ uiTheme: 'solar-dusk', uiThemeStyle: 'colors', uiMode: 'dark' });
    expect((await api(cookie, 'PATCH', '/api/settings', { uiMode: 'dim' })).statusCode).toBe(400);

    expect((await api(cookie, 'GET', '/api/auth/me')).json().liveLayout).toBeNull();
    const liveLayout = { main: ['feed'], side: ['players', 'commands'] };
    await api(cookie, 'PATCH', '/api/settings', { liveLayout });
    expect((await api(cookie, 'GET', '/api/auth/me')).json()).toMatchObject({ liveLayout });
    expect((await api(cookie, 'PATCH', '/api/settings', { liveLayout: { main: ['nope'], side: [] } })).statusCode).toBe(400);
    expect((await api(cookie, 'PATCH', '/api/settings', { liveLayout: { main: ['feed', 'feed'], side: [] } })).statusCode).toBe(400);
    await api(cookie, 'PATCH', '/api/settings', { liveLayout: null });
    expect((await api(cookie, 'GET', '/api/auth/me')).json().liveLayout).toBeNull();
    expect((await api(cookie, 'PATCH', '/api/settings', { uiTheme: 'neon-noir' })).statusCode).toBe(400);
    expect((await api(cookie, 'PATCH', '/api/settings', { uiThemeStyle: 'half' })).statusCode).toBe(400);
  });
});

describe('command counts on the dashboard', () => {
  it("gives a dashboard that connects mid-stream the stream's presses so far, from memory, and the report counts them exactly", async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    for (const viewer of ['a', 'b', 'c']) await api(cookie, 'POST', '/api/live/simulate', { viewer, text: 'jump' });
    await api(cookie, 'POST', '/api/live/simulate', { viewer: 'a', text: 'w' });
    // Asked for straight away, before the recording's regular write: the totals are already exact.
    const report = (await api(cookie, 'GET', '/api/analytics/streams/latest')).json();
    expect(Object.fromEntries(report.commandUsage.map((u: any) => [u.keyword, u.fired]))).toEqual({ jump: 3, w: 1 });

    const dashboard = connect(`/ws/overlay?token=${me.overlayToken}&dashboard=1`);
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    expect((await dashboard.drain()).filter((m: any) => m.type === 'presses')).toEqual([{ type: 'presses', counts: { jump: 3, w: 1 } }]);
    expect((await overlay.drain()).filter((m: any) => m.type === 'presses')).toEqual([]);
    // A new stream starts over.
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const again = connect(`/ws/overlay?token=${me.overlayToken}&dashboard=1`);
    expect((await again.drain()).filter((m: any) => m.type === 'presses')).toEqual([{ type: 'presses', counts: {} }]);
    await api(cookie, 'POST', '/api/live/stop');
  });
});

describe('stats per TikTok account', () => {
  it("keeps each account's leaderboard and points apart, and each host's apart on the same account", async () => {
    const play = async (cookie: string, viewer: string) => {
      await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
      await api(cookie, 'POST', '/api/live/simulate', { viewer, gift: 'Rose', diamonds: 1, count: 5 });
      await api(cookie, 'POST', '/api/live/stop');
      await app.live.flushStats();
    };
    const leaders = async (cookie: string) => (await api(cookie, 'GET', '/api/leaderboard')).json().map((e: any) => [e.viewer, e.points]);
    const a = (await signUp('a@example.com')).cookie;
    const b = (await signUp('b@example.com')).cookie;
    await api(a, 'PATCH', '/api/settings', { tiktokUsername: '@StreamerX', points: true });
    await api(b, 'PATCH', '/api/settings', { tiktokUsername: 'streamerx', points: true });
    await play(a, 'alice');
    await play(b, 'bob');
    expect(await leaders(a)).toEqual([['alice', 50]]);
    expect(await leaders(b)).toEqual([['bob', 50]]);

    // Another account starts empty; switching back brings the old one's leaderboard and balances back.
    await api(a, 'PATCH', '/api/settings', { tiktokUsername: 'streamery' });
    expect(await leaders(a)).toEqual([]);
    expect((await api(a, 'GET', '/api/analytics/viewers/alice')).json()).toMatchObject({ points: 0, xp: 0 });
    await play(a, 'carol');
    await api(a, 'DELETE', '/api/leaderboard/points');
    expect(await leaders(a)).toEqual([['carol', 0]]);
    await api(a, 'PATCH', '/api/settings', { tiktokUsername: 'StreamerX' });
    expect(await leaders(a)).toEqual([['alice', 50]]);
    expect((await api(a, 'GET', '/api/analytics/viewers/alice')).json()).toMatchObject({ points: 50, xp: 5 });
  });
});

describe('stream activity and analytics', () => {
  it('records what viewers do and what Hyperion did, and sums it up per stream', async () => {
    const { cookie } = await signUp();
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const sim = (body: object) => api(cookie, 'POST', '/api/live/simulate', body);
    await sim({ viewer: 'alice', event: 'join' });
    await sim({ viewer: 'alice', text: 'hello stream' });
    await sim({ viewer: 'alice', text: 'a' }); // fires
    await sim({ viewer: 'alice', text: 'a' }); // within the 1 s cooldown: refused
    await sim({ viewer: 'bob', gift: 'Rose', count: 3, diamonds: 1 });
    await sim({ viewer: 'bob', event: 'follow' });
    await sim({ viewer: 'carol', event: 'like', count: 15 });
    await sim({ viewers: 40 });
    await sim({ viewers: 25 });
    await api(cookie, 'POST', '/api/live/stop');

    const activity = (await api(cookie, 'GET', '/api/analytics/activity')).json();
    expect(activity.stream).toMatchObject({ source: 'simulated', live: false });
    // Newest first, viewer interactions only (the fired command shows as alice's comment).
    expect(activity.events.map((e: { kind: string; viewer: string }) => `${e.kind}:${e.viewer}`)).toEqual([
      'like:carol', 'follow:bob', 'gift:bob', 'comment:alice', 'comment:alice', 'comment:alice', 'join:alice',
    ]);
    expect(activity.events[2].data).toEqual({ gift: 'Rose', count: 3, diamonds: 1 });
    const chatOnly = (await api(cookie, 'GET', '/api/analytics/activity?kinds=comment&viewer=ALI')).json();
    expect(chatOnly.events).toHaveLength(3);
    const older = (await api(cookie, 'GET', `/api/analytics/activity?before=${activity.events[1].id}&limit=2`)).json();
    expect(older.events.map((e: { kind: string }) => e.kind)).toEqual(['gift', 'comment']);

    const detail = (await api(cookie, 'GET', '/api/analytics/streams/latest')).json();
    const gifts = (await api(cookie, 'GET', '/api/actions/gifts')).json() as Gift[];
    expect(gifts.length).toBeGreaterThan(100); // TikTok's catalog
    expect(gifts.filter((g) => g.received).map((g) => g.name)).toEqual(['Rose']);
    expect(detail.summary).toMatchObject({ source: 'simulated', viewers: 3, peakViewers: 40, participants: 2, comments: 3, commands: 1, gifts: 3, diamonds: 3, follows: 1, topCommand: 'a', topPlayer: 'alice' });
    expect(detail.commandUsage).toEqual([{ keyword: 'a', fired: 1, refused: 1, reasons: { cooldown: 1 } }]);
    expect(detail.gifts.byGift).toEqual([{ gift: 'Rose', count: 3, diamonds: 3, image: null }]);
    expect(detail.markers.map((m: { label: string }) => m.label)).toEqual(['bob sent 3× Rose', 'bob followed']);
    expect(detail.peaks[0]).toMatchObject({ events: 6 }); // 3 comments, the gift, the follow and the fired command
    // Test mode stays out of the stream history.
    expect((await api(cookie, 'GET', '/api/analytics/streams')).json()).toEqual([]);
  });

  it('counts new and returning viewers across real streams, and keeps hosts apart', async () => {
    const a = await signUp('a@example.com');
    const b = await signUp('b@example.com');
    const day = 24 * 3600 * 1000;
    const stream = async (hostId: string, daysAgo: number, viewers: string[], tiktokUsername = 'main_account') => {
      const startedAt = new Date(Date.now() - daysAgo * day);
      const [row] = await app.db
        .insert(streams)
        .values({ hostId, source: 'tiktok', profileName: 'Default', tiktokUsername, startedAt, endedAt: new Date(startedAt.getTime() + 3600_000) })
        .returning();
      await app.db.insert(streamEvents).values(viewers.map((viewer) => ({ streamId: row!.id, at: startedAt, kind: 'comment' as const, viewer, data: { text: 'hi' } })));
      return row!.id;
    };
    await stream(a.id, 3, ['mira', 'jules']);
    await stream(a.id, 2, ['mira', 'kai', 'nova']);
    await stream(a.id, 1, ['mira', 'kai'], 'second_account'); // a different audience: both are new there
    const other = await stream(b.id, 1, ['mira']);

    const history = (await api(a.cookie, 'GET', '/api/analytics/streams')).json();
    expect(history.map((s: { tiktokUsername: string; participants: number; newParticipants: number }) => [s.tiktokUsername, s.participants, s.newParticipants])).toEqual([
      ['second_account', 2, 2],
      ['main_account', 3, 2], // mira returned; kai and nova are new
      ['main_account', 2, 2],
    ]);

    // A viewer's profile, across all streams or one account's.
    const mira = (await api(a.cookie, 'GET', '/api/analytics/viewers/mira')).json();
    expect(mira).toMatchObject({ viewer: 'mira', streams: 3, comments: 3 });
    expect(mira.perStream.map((s: { tiktokUsername: string }) => s.tiktokUsername)).toEqual(['second_account', 'main_account', 'main_account']);
    expect((await api(a.cookie, 'GET', '/api/analytics/viewers/mira?account=main_account')).json()).toMatchObject({ streams: 2 });
    const recent = (await api(a.cookie, 'GET', '/api/analytics/viewers/mira/activity?limit=2')).json();
    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({ kind: 'comment', data: { text: 'hi' } });

    // Their activity narrowed by kind, stream and text, across pages; a gift's picture reaches its stream's report.
    const giftStream = mira.perStream[0].streamId;
    await app.db.insert(streamEvents).values([
      { streamId: giftStream, at: new Date(), kind: 'gift', viewer: 'mira', data: { gift: '50% Rose', count: 1, diamonds: 1, image: 'https://cdn.test/rose.png' } },
      { streamId: giftStream, at: new Date(), kind: 'command', viewer: 'mira', data: { keyword: 'jump', via: 'chat' } },
      { streamId: giftStream, at: new Date(), kind: 'comment', viewer: 'mira', data: { text: 'gg ROSE' } },
    ]);
    const activity = async (query: string) => (await api(a.cookie, 'GET', `/api/analytics/viewers/mira/activity?${query}`)).json();
    const kinds = async (query: string) => (await activity(query)).map((e: { kind: string }) => e.kind);
    expect(await kinds('kinds=gift,command')).toEqual(['command', 'gift']);
    expect(await kinds(`stream=${giftStream}&kinds=comment`)).toEqual(['comment', 'comment']);
    expect(await kinds('search=rose')).toEqual(['comment', 'gift']);
    expect(await kinds('search=ROSE&kinds=gift')).toEqual(['gift']);
    expect(await kinds('search=jump')).toEqual(['command']);
    expect(await kinds(`search=${encodeURIComponent('50%')}`)).toEqual(['gift']); // taken literally
    expect(await kinds(`search=${encodeURIComponent('5%')}`)).toEqual([]);
    const [newest] = await activity('search=rose&limit=1');
    expect(await kinds(`search=rose&before=${newest.id}`)).toEqual(['gift']);
    expect((await api(a.cookie, 'GET', '/api/analytics/viewers/mira/activity?kinds=refused')).statusCode).toBe(400);
    expect((await api(b.cookie, 'GET', `/api/analytics/viewers/mira/activity?stream=${giftStream}`)).json()).toEqual([]);
    const report = (await api(a.cookie, 'GET', `/api/analytics/streams/${giftStream}`)).json();
    expect(report.gifts.byGift).toEqual([{ gift: '50% Rose', count: 1, diamonds: 1, image: 'https://cdn.test/rose.png' }]);
    // Host B's mira is someone else as far as host A is concerned, and the other way round.
    expect((await api(b.cookie, 'GET', '/api/analytics/viewers/mira')).json()).toMatchObject({ streams: 1 });
    expect((await api(a.cookie, 'GET', '/api/analytics/viewers/nobody')).json()).toMatchObject({ streams: 0, firstSeen: null });
    // Another host's stream counts separately and can't be opened.
    expect((await api(b.cookie, 'GET', '/api/analytics/streams')).json()[0]).toMatchObject({ participants: 1, newParticipants: 1 });
    expect((await api(a.cookie, 'GET', `/api/analytics/streams/${other}`)).statusCode).toBe(404);
    expect((await api(a.cookie, 'GET', `/api/analytics/activity?stream=${other}`)).json()).toEqual({ stream: null, events: [] });
  });
});

describe('media and actions', () => {
  it('shares built-in files, stored once, and removing one only hides it for that host', async () => {
    await seedLibrary(app.db);
    await seedLibrary(app.db); // every startup does this
    const a = await signUp('a@example.com');
    const b = await signUp('b@example.com');
    const list = async (cookie: string) => (await api(cookie, 'GET', '/api/media')).json() as MediaItem[];
    const shared = await list(a.cookie);
    expect(shared.map((m) => m.name)).toEqual(BUILT_IN_MEDIA.map((m) => m.name).sort());
    expect(shared.every((m) => m.builtIn && m.kind === 'image')).toBe(true);
    expect((await list(b.cookie)).map((m) => m.id)).toEqual(shared.map((m) => m.id));
    expect((await app.db.execute(sql`select count(*)::int as n from media`))[0]!.n).toBe(BUILT_IN_MEDIA.length); // one copy each

    const dance = shared[0]!;
    expect((await app.inject({ method: 'GET', url: `/media/${dance.id}` })).headers['content-type']).toBe('image/gif');
    const action = (await api(a.cookie, 'POST', '/api/actions', { name: 'Hi', trigger: 'follow', mediaId: dance.id })).json();
    expect(action.mediaId).toBe(dance.id);

    expect((await api(a.cookie, 'DELETE', `/api/media/${dance.id}`)).statusCode).toBe(204);
    expect((await list(a.cookie)).map((m) => m.id)).not.toContain(dance.id);
    expect((await list(b.cookie)).map((m) => m.id)).toContain(dance.id);
    expect((await app.inject({ method: 'GET', url: `/media/${dance.id}` })).statusCode).toBe(200);
    expect((await api(a.cookie, 'GET', '/api/actions')).json().find((x: { id: string }) => x.id === action.id).mediaId).toBeNull();
    expect((await api(a.cookie, 'PATCH', `/api/media/${dance.id}`, { name: 'Mine' })).statusCode).toBe(404);

    expect((await api(a.cookie, 'DELETE', '/api/media/hidden')).statusCode).toBe(204);
    expect(await list(a.cookie)).toHaveLength(BUILT_IN_MEDIA.length);
  });

  it('uploads files, serves them publicly, and refuses anything that is not a picture, video or sound', async () => {
    const { cookie } = await signUp();
    const ding = await upload(cookie, ' Ding ', WAV);
    expect(ding).toMatchObject({ name: 'Ding', kind: 'audio', mime: 'audio/wav', size: WAV.length });
    await upload(cookie, 'page', Buffer.from('<svg onload=alert(1)>'), 415);
    await upload(cookie, 'empty', Buffer.alloc(0), 400);
    const file = await app.inject({ method: 'GET', url: `/media/${ding.id}` });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('audio/wav');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.rawPayload.equals(WAV)).toBe(true);
    expect((await api(cookie, 'PATCH', `/api/media/${ding.id}`, { name: 'Bell' })).json()).toMatchObject({ name: 'Bell' });
    expect((await api(cookie, 'GET', '/api/media')).json()).toHaveLength(1);
    expect((await api(cookie, 'DELETE', `/api/media/${ding.id}`)).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/media/${ding.id}` })).statusCode).toBe(404);
  });

  it('runs actions with files, audiences, points and new TikTok events while live', async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    const ding = await upload(cookie, 'ding', WAV);
    const pic = await upload(cookie, 'pic', PNG);
    // A picture can't be the sound, nor a sound the picture.
    expect((await api(cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', soundMediaId: pic.id })).statusCode).toBe(400);
    expect((await api(cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', mediaId: ding.id })).statusCode).toBe(400);
    for (const a of (await api(cookie, 'GET', '/api/actions')).json()) await api(cookie, 'DELETE', `/api/actions/${a.id}`);
    const add = async (body: object) => {
      const res = await api(cookie, 'POST', '/api/actions', body);
      expect(res.statusCode).toBe(201);
      return res.json();
    };
    await add({ name: 'Sub', trigger: 'subscribe', text: '{viewer} subscribed for {months} months', soundMediaId: ding.id, mediaId: pic.id, durationMs: 8000 });
    await add({ name: 'Mods', trigger: 'command', command: '!Hype', text: 'HYPE from {viewer}: {text}', sound: null, audience: 'moderators' });
    await add({ name: 'Top', trigger: 'command', command: '!crown', text: 'crown {viewer}', sound: null, audience: 'top_gifters' });
    await add({ name: 'Sticker points', trigger: 'emote', points: 7 });
    await api(cookie, 'PATCH', '/api/settings', { points: true });

    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.drain(100); // live + mode + leaderboard
    const sim = (body: object) => api(cookie, 'POST', '/api/live/simulate', body);
    const alerts = async () => (await overlay.drain()).filter((m) => m.type === 'alert').map((m) => m.text ?? m);

    await sim({ viewer: 'alice', event: 'subscribe', count: 3 });
    expect((await overlay.drain()).filter((m) => m.type === 'alert')).toEqual([
      {
        type: 'alert',
        action: expect.any(String),
        text: 'alice subscribed for 3 months',
        sound: null,
        speech: null,
        soundFile: ding.id,
        media: { id: pic.id, kind: 'image' },
        durationMs: 8000,
      },
    ]);
    await sim({ viewer: 'bob', text: '!hype lets go' });
    expect(await alerts()).toEqual([]);
    await sim({ viewer: 'bob', text: '!hype lets go', badges: ['moderator'] });
    expect(await alerts()).toEqual(['HYPE from bob: lets go']);
    await sim({ viewer: 'carol', text: '!crown' });
    expect(await alerts()).toEqual([]);
    await sim({ viewers: 120, topGifters: ['carol'] });
    await sim({ viewer: 'carol', text: '!crown' });
    expect(await alerts()).toEqual(['crown carol']);
    await sim({ viewer: 'dave', event: 'emote' });
    await api(cookie, 'POST', '/api/live/stop');
    await app.live.flushStats();
    expect((await api(cookie, 'GET', '/api/analytics/viewers/dave')).json()).toMatchObject({ points: 7 });
    const kinds = (await api(cookie, 'GET', '/api/analytics/activity')).json().events.map((e: any) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['subscribe', 'emote']));
  });

  it('copies a profile with its own actions, pressing the copied commands', async () => {
    const { cookie } = await signUp();
    const jump = (await api(cookie, 'GET', '/api/commands')).json().find((c: any) => c.keyword === 'jump');
    await api(cookie, 'POST', '/api/actions', { name: 'Rose jumps', trigger: 'gift', giftName: 'rose', keyCommandId: jump.id });
    const gta = (await api(cookie, 'POST', '/api/profiles', { name: 'GTA' })).json();
    await api(cookie, 'POST', `/api/profiles/${gta.id}/activate`);
    const actions = (await api(cookie, 'GET', '/api/actions')).json();
    const copied = actions.find((a: any) => a.name === 'Rose jumps');
    const gtaJump = (await api(cookie, 'GET', '/api/commands')).json().find((c: any) => c.keyword === 'jump');
    expect(copied).toMatchObject({ profileId: gta.id, keyCommandId: gtaJump.id });
    expect(actions.filter((a: any) => a.name === 'Rose jumps')).toHaveLength(1); // the Default one isn't shown
    expect(actions.filter((a: any) => a.profileId === null)).toHaveLength(4); // starter alerts apply everywhere
  });
});

describe('overlay screens', () => {
  it('replaces a leaked link, keeping the setup and cutting off the old one', async () => {
    const { cookie } = await signUp('a@example.com');
    const other = await signUp('b@example.com');
    const [main] = (await api(cookie, 'GET', '/api/screens')).json();
    const side = (await api(cookie, 'POST', '/api/screens', { name: 'Side' })).json();
    await api(cookie, 'PATCH', `/api/screens/${main.id}`, { scale: 150 });
    const old = connect(`/ws/overlay?token=${main.token}`);
    await old.opened;
    await old.drain(100);

    expect((await api(other.cookie, 'POST', `/api/screens/${main.id}/new-link`)).statusCode).toBe(404);
    const renewed = (await api(cookie, 'POST', `/api/screens/${main.id}/new-link`)).json();
    expect(renewed.token).not.toBe(main.token);
    expect(renewed).toMatchObject({ id: main.id, scale: 150 });
    expect(await old.closed).toBe(4001);
    expect(await connect(`/ws/overlay?token=${main.token}`).closed).toBe(4001);
    // The main link is the host's overlay token too; other screens keep theirs.
    expect((await api(cookie, 'GET', '/api/auth/me')).json().overlayToken).toBe(renewed.token);
    const fresh = connect(`/ws/overlay?token=${renewed.token}`);
    await fresh.opened;
    expect((await api(cookie, 'GET', '/api/screens')).json().find((s: any) => s.id === side.id).token).toBe(side.token);

    const before = (await api(cookie, 'GET', '/api/auth/me')).json().overlayToken;
    expect((await api(cookie, 'POST', `/api/screens/${side.id}/new-link`)).json().token).not.toBe(side.token);
    expect((await api(cookie, 'GET', '/api/auth/me')).json().overlayToken).toBe(before);
  });

  it('gives each screen its own address and settings, and sends alerts to the chosen screen', async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    const [main] = (await api(cookie, 'GET', '/api/screens')).json();
    expect(main).toMatchObject({ name: 'Main', main: true, token: me.overlayToken, alerts: true, audio: true });
    expect((await api(cookie, 'DELETE', `/api/screens/${main.id}`)).statusCode).toBe(400);

    const side = (await api(cookie, 'POST', '/api/screens', { name: ' Side ' })).json();
    expect(side).toMatchObject({ name: 'Side', main: false, alerts: true, feed: false, audio: false });
    const overlay = connect(`/ws/overlay?token=${side.token}`);
    expect(await overlay.nextAside()).toEqual({ type: 'screen', screen: expect.objectContaining({ id: side.id, name: 'Side' }) });
    await overlay.nextAside(); // speechVolume
    await api(cookie, 'PATCH', `/api/screens/${side.id}`, { alertPosition: 'top', scale: 150 });
    expect(await overlay.nextAside()).toMatchObject({ type: 'screen', screen: { alertPosition: 'top', scale: 150 } });
    expect((await api(cookie, 'PATCH', `/api/screens/${side.id}`, { scale: 500 })).statusCode).toBe(400);

    const action = (await api(cookie, 'POST', '/api/actions', { name: 'Side follow', trigger: 'follow', text: 'side!', screenId: side.id })).json();
    expect((await api(cookie, 'POST', `/api/actions/${action.id}/test`)).json()).toMatchObject({ overlays: 1 });
    expect(await overlay.next()).toMatchObject({ type: 'alert', text: 'side!', screen: side.id });

    // An animation alone is enough for an action to test, and goes to its screen.
    const hearts = (await api(cookie, 'POST', '/api/actions', { name: 'Hearts', trigger: 'gift', giftName: 'Rose', effect: 'hearts', effectAmount: 2, effectColor: '#ff0000', effectSpeed: 150, screenId: side.id })).json();
    expect(hearts).toMatchObject({ effect: 'hearts', effectAmount: 2, effectColor: '#ff0000' });
    expect((await api(cookie, 'POST', `/api/actions/${hearts.id}/test`)).json()).toMatchObject({ alert: null, overlays: 1 });
    expect(await overlay.next()).toEqual({ type: 'effect', effect: 'hearts', amount: 2, speed: 150, color: '#ff0000', screen: side.id });
    expect((await api(cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', effectSpeed: 120 })).statusCode).toBe(400);
    const banner = (await api(cookie, 'POST', '/api/actions', { name: 'Tip', trigger: 'gift', text: 'Thanks!', alertEffect: 'graphic_banner', alertEmoji: '💸', alertEffectSpeed: 200, screenId: side.id })).json();
    expect((await api(cookie, 'POST', `/api/actions/${banner.id}/test`)).json().alert.fx).toEqual({ effect: 'graphic_banner', emoji: '💸', shape: 'star', color: null, amount: 3, speed: 200 });
    await overlay.next();
    const reveal = (await api(cookie, 'POST', '/api/actions', { name: 'Reveal', trigger: 'gift', text: 'Thanks!', alertEffect: 'character_reveal', alertShape: 'heart', alertEffectColor: '#22c55e', screenId: side.id })).json();
    expect((await api(cookie, 'POST', `/api/actions/${reveal.id}/test`)).json().alert.fx).toMatchObject({ effect: 'character_reveal', shape: 'heart', color: '#22c55e' });
    await overlay.next();
    expect((await api(cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', alertShape: 'blob' })).statusCode).toBe(400);
    expect((await api(cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', alertEffectColor: 'blue' })).statusCode).toBe(400);
    expect((await api(cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', alertEffect: 'emoji_burst', alertEmoji: '  ' })).statusCode).toBe(400);
    expect((await api(cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', alertEffect: 'spin' })).statusCode).toBe(400);
    expect((await api(cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', effect: 'lasers' })).statusCode).toBe(400);
    expect((await api(cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', effectAmount: 9 })).statusCode).toBe(400);

    const other = await signUp('other@example.com');
    expect((await api(other.cookie, 'PATCH', `/api/screens/${side.id}`, { name: 'x' })).statusCode).toBe(404);
    expect((await api(other.cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', screenId: side.id })).statusCode).toBe(400);

    // Deleting a screen disconnects its overlays; its actions go back to every screen.
    expect((await api(cookie, 'DELETE', `/api/screens/${side.id}`)).statusCode).toBe(204);
    expect(await overlay.closed).toBe(4001);
    const after = (await api(cookie, 'GET', '/api/actions')).json().find((a: any) => a.id === action.id);
    expect(after.screenId).toBeNull();
  });
});

describe('widgets and goals', () => {
  it('saves widgets on a screen and sends stream stats, chat and gifts while live', async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    const [main] = (await api(cookie, 'GET', '/api/screens')).json();
    expect(main.widgets).toEqual([]);
    const widgets = [
      { type: 'goals', spot: 'top' },
      { type: 'level_ups', spot: 'right' },
      { type: 'firework', spot: 'top', minDiamonds: 100, effect: 'confetti', effectSpeed: 200 },
    ];
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { widgets })).json().widgets).toEqual(widgets);
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { widgets: [{ type: 'clock', spot: 'top' }] })).statusCode).toBe(400);
    // A widget can be placed by hand, anywhere on the screen.
    const placed = [{ type: 'chat', spot: 'bottom-right', pos: { x: 12.5, y: 60 } }];
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { widgets: placed })).json().widgets).toEqual(placed);
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { widgets: [{ ...placed[0], pos: { x: 120, y: 0 } }] })).statusCode).toBe(400);
    await api(cookie, 'PATCH', `/api/screens/${main.id}`, { widgets });

    const likes = (await api(cookie, 'POST', '/api/goals', { name: ' Likes ', metric: 'likes', target: 100 })).json();
    expect(likes).toMatchObject({ name: 'Likes', metric: 'likes', target: 100, enabled: true });
    // A new goal gets a widget of its own on the main screen.
    expect((await api(cookie, 'GET', '/api/screens')).json()[0].widgets).toEqual([...widgets, { type: 'goals', spot: 'top', goalId: likes.id }]);
    expect((await api(cookie, 'POST', '/api/goals', { name: 'x', metric: 'hugs', target: 1 })).statusCode).toBe(400);
    const raise = { kind: 'times', by: 1.5 };
    expect((await api(cookie, 'PATCH', `/api/goals/${likes.id}`, { raise })).json()).toMatchObject({ raise });
    expect((await api(cookie, 'PATCH', `/api/goals/${likes.id}`, { raise: { kind: 'times', by: 1 } })).statusCode).toBe(400);
    expect((await api(cookie, 'PATCH', `/api/goals/${likes.id}`, { raise: { kind: 'plus', by: 1.5 } })).statusCode).toBe(400);
    expect((await api(cookie, 'PATCH', `/api/goals/${likes.id}`, { raise: null })).json()).toMatchObject({ raise: null });
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { leaderboardSize: 10 })).json().leaderboardSize).toBe(10);
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { leaderboardSize: 16 })).statusCode).toBe(400);
    const linkStyles = { chat: WIDGET_PRESETS[0]!.style };
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { linkStyles })).json().linkStyles).toEqual(linkStyles);
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { linkStyles: { chat: { ...WIDGET_PRESETS[0]!.style, font: 'nope' } } })).statusCode).toBe(400);
    const alertPos = { x: 30, y: 70 };
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { alertPos })).json().alertPos).toEqual(alertPos);
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { alertPos: { x: 130, y: 70 } })).statusCode).toBe(400);
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { alertPos: null })).json().alertPos).toBeNull();
    for (const preset of WIDGET_PRESETS) {
      expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { widgets: [{ type: 'chat', spot: 'left', style: preset.style }] })).statusCode).toBe(200);
    }
    const style = WIDGET_PRESETS[0]!.style;
    const styled = (await api(cookie, 'PATCH', `/api/screens/${main.id}`, { widgets: [...widgets, { type: 'chat', spot: 'left', style }] })).json();
    expect(styled.widgets.at(-1).style).toEqual(style);
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { widgets: [{ type: 'chat', spot: 'left', style: { ...style, accent: 'red' } }] })).statusCode).toBe(400);
    await api(cookie, 'PATCH', `/api/screens/${main.id}`, { widgets });
    for (const a of (await api(cookie, 'GET', '/api/actions')).json()) await api(cookie, 'DELETE', `/api/actions/${a.id}`);
    expect((await api(cookie, 'POST', '/api/actions', { name: 'x', trigger: 'goal' })).statusCode).toBe(400);
    await api(cookie, 'POST', '/api/actions', { name: 'Goal!', trigger: 'goal', goalId: likes.id, text: '{goal} reached thanks to {viewer}', sound: null });

    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`, ['screen', 'speechVolume']);
    await overlay.next(); // live
    await overlay.next(); // mode
    await overlay.next(); // leaderboard
    expect(await overlay.next()).toMatchObject({ type: 'stats', stats: { likes: 0, goals: [{ name: 'Likes', current: 0, target: 100 }] } });
    const sim = (body: object) => api(cookie, 'POST', '/api/live/simulate', body);
    await sim({ viewer: 'alice', text: 'hello' });
    await sim({ viewer: 'bob', gift: 'Lion', count: 2, diamonds: 50 });
    await sim({ viewer: 'carol', event: 'like', count: 120 });
    const messages = (await overlay.drain(600)).filter((m) => m.type !== 'leaderboard');
    expect(messages).toContainEqual({ type: 'chat', viewer: 'alice', text: 'hello' });
    expect(messages).toContainEqual({ type: 'gift', viewer: 'bob', gift: 'Lion', count: 2, diamonds: 100 });
    expect(messages).toContainEqual(expect.objectContaining({ type: 'alert', text: 'Likes reached thanks to carol' }));
    const last = messages.filter((m) => m.type === 'stats').at(-1);
    expect(last.stats).toMatchObject({ likes: 120, diamonds: 100, topGift: { viewer: 'bob', diamonds: 100 }, goals: [{ current: 120 }] });

    const other = await signUp('other@example.com');
    expect((await api(other.cookie, 'PATCH', `/api/goals/${likes.id}`, { target: 5 })).statusCode).toBe(404);
    expect((await api(other.cookie, 'POST', '/api/actions', { name: 'x', trigger: 'goal', goalId: likes.id })).statusCode).toBe(400);
    // A goal can have a widget of its own; deleting the goal takes that widget off the screen.
    const own = { type: 'goals', spot: 'top-left', goalId: likes.id };
    expect((await api(cookie, 'PATCH', `/api/screens/${main.id}`, { widgets: [...widgets, own] })).json().widgets).toContainEqual(own);
    expect((await api(cookie, 'DELETE', `/api/goals/${likes.id}`)).statusCode).toBe(204);
    expect((await api(cookie, 'GET', '/api/actions')).json()).toEqual([]); // its action went with it
    expect((await api(cookie, 'GET', '/api/screens')).json()[0].widgets).toEqual(widgets);
  });
});

describe('alerts and text-to-speech', () => {
  // The 5 s stats flush can push a leaderboard at any moment; these tests don't care about it.
  const withoutLeaderboard = (messages: any[]) => messages.filter((m) => m.type !== 'leaderboard');

  it('seeds starter actions, tests them offline, and speaks prefixed chat while live', async () => {
    const { cookie } = await signUp();
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    expect(me).toMatchObject({ ttsMode: 'prefix', ttsPrefix: '!tts', ttsVoice: null, ttsAutoMaxViewers: 25 });
    expect((await api(cookie, 'PATCH', '/api/settings', { ttsAutoMaxViewers: -1 })).statusCode).toBe(400);
    expect((await api(cookie, 'PATCH', '/api/settings', { ttsAutoMaxViewers: 40 })).statusCode).toBe(200);
    expect((await api(cookie, 'GET', '/api/auth/me')).json()).toMatchObject({ ttsAutoMaxViewers: 40 });
    const actions = (await api(cookie, 'GET', '/api/actions')).json();
    expect(actions.map((a: any) => a.trigger)).toEqual(['follow', 'share', 'gift', 'likes']);
    expect(actions.every((a: any) => a.profileId === null)).toBe(true); // every profile

    // The Test button works without being live.
    const overlay = connect(`/ws/overlay?token=${me.overlayToken}`);
    await overlay.opened;
    const follow = actions.find((a: any) => a.trigger === 'follow');
    const dashboard = connect(`/ws/overlay?token=${me.overlayToken}&dashboard=1`);
    await dashboard.opened;
    const tested = (await api(cookie, 'POST', `/api/actions/${follow.id}/test`)).json();
    const alert = { type: 'alert', action: follow.id, text: 'test_viewer followed!', sound: 'chime', speech: null };
    expect(tested).toEqual({ alert, overlays: 1 }); // the dashboard's own listener isn't an overlay on stream
    expect(await overlay.next()).toEqual(alert);

    // An alert can be placed and sized by hand; its place needs both across and down.
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertX: 25, alertY: 70.5, alertScale: 140 });
    expect((await api(cookie, 'POST', `/api/actions/${follow.id}/test`)).json().alert).toEqual({ ...alert, pos: { x: 25, y: 70.5 }, scale: 140 });
    expect(await overlay.next()).toMatchObject({ pos: { x: 25, y: 70.5 }, scale: 140 });
    expect((await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertY: null })).statusCode).toBe(400);
    expect((await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertScale: 300 })).statusCode).toBe(400);
    await api(cookie, 'PATCH', `/api/actions/${follow.id}`, { alertX: null, alertY: null, alertScale: 100 });
    expect((await api(cookie, 'POST', `/api/actions/${follow.id}/test`)).json().alert).toEqual(alert);
    await overlay.next();

    // Validation: likes need a step, commands need a command; trigger-specific fields are cleared for other triggers.
    const create = (body: object) => api(cookie, 'POST', '/api/actions', { name: 'x', ...body });
    expect((await create({ trigger: 'likes', text: 'x' })).statusCode).toBe(400);
    expect((await create({ trigger: 'command', text: 'x' })).statusCode).toBe(400);
    expect((await create({ trigger: 'command', command: '!points' })).statusCode).toBe(400);
    expect((await create({ trigger: 'follow', audience: 'viewer' })).statusCode).toBe(400);
    expect((await create({ trigger: 'follow', text: 'x', sound: 'airhorn' })).statusCode).toBe(400);
    const lion = await create({ trigger: 'gift', giftName: ' Lion ', likeStep: 5, command: '!x', text: 'ROAR {viewer}', sound: 'fanfare', speak: true });
    expect(lion.statusCode).toBe(201);
    expect(lion.json()).toMatchObject({ giftName: 'lion', likeStep: null, command: null });

    // The default engine is TikTok, with no session here, and this test server has no Piper: speech falls back to in-overlay eSpeak.
    await api(cookie, 'PATCH', '/api/settings', { ttsEspeakVoice: 'en-gb', ttsCooldownMs: 0 });
    await api(cookie, 'POST', '/api/live/start', { source: 'simulated' });
    await overlay.drain(100); // live + mode + leaderboard
    const sim = (payload: object) => api(cookie, 'POST', '/api/live/simulate', { viewer: 'alice', ...payload });

    await sim({ event: 'follow' });
    const nextAlert = async () => {
      for (;;) {
        const m = await overlay.next();
        if (m.type !== 'leaderboard') return m;
      }
    };
    expect(await nextAlert()).toMatchObject({ type: 'alert', text: 'alice followed!' });
    await sim({ gift: 'Lion' });
    expect(await nextAlert()).toEqual({ type: 'alert', action: expect.any(String), text: 'ROAR alice', sound: 'fanfare', speech: { kind: 'espeak', text: 'ROAR alice', voice: 'en-gb', effect: 'none' } });
    await sim({ event: 'like', count: 1000 });
    expect(await nextAlert()).toMatchObject({ type: 'alert', text: '1000 likes! Thanks alice' });

    await sim({ text: '!tts hello chat' });
    expect(await nextAlert()).toEqual({
      type: 'tts',
      viewer: 'alice',
      text: 'hello chat',
      speech: { kind: 'espeak', text: 'alice says hello chat', voice: 'en-gb', effect: 'none' },
    });
    await sim({ text: 'hello chat' });
    expect(withoutLeaderboard(await overlay.drain())).toEqual([]);

    expect((await api(cookie, 'POST', '/api/tts/skip')).statusCode).toBe(200);
    expect(await nextAlert()).toEqual({ type: 'skipSpeech' });

    // Switching to "all" applies mid-stream; commands still aren't read.
    expect((await api(cookie, 'PATCH', '/api/settings', { ttsMode: 'all' })).statusCode).toBe(200);
    await sim({ text: 'hello chat' });
    expect(await nextAlert()).toMatchObject({ type: 'tts', text: 'hello chat' });
    await sim({ text: 'jump' });
    expect((await overlay.drain()).filter((m) => m.type === 'tts')).toEqual([]);

    // With chat's key presses off, a keyword is an ordinary comment.
    await api(cookie, 'PATCH', '/api/settings', { mode: 'gift', ttsCooldownMs: 0 });
    await overlay.drain();
    await sim({ text: 'jump' });
    const said = await overlay.drain();
    expect(said.filter((m) => m.type === 'tts')).toMatchObject([{ text: 'jump' }]);
    expect(said.filter((m) => m.type === 'command')).toEqual([]);

    // Chosen gifts unlock being read, in all chat too.
    const unlock = await api(cookie, 'PATCH', '/api/settings', { ttsUnlockGifts: ['Rose'], ttsUnlockMinutes: 5 });
    expect(unlock.statusCode).toBe(200);
    expect((await api(cookie, 'GET', '/api/auth/me')).json()).toMatchObject({ ttsUnlockGifts: ['Rose'], ttsUnlockMinutes: 5 });
    await overlay.drain();
    await sim({ text: 'hello chat' });
    expect((await overlay.drain()).filter((m) => m.type === 'tts')).toEqual([]);
    await sim({ gift: 'Rose' });
    await sim({ text: 'hello chat' });
    expect((await overlay.drain()).filter((m) => m.type === 'tts')).toMatchObject([{ text: 'hello chat' }]);

    expect((await api(cookie, 'DELETE', `/api/actions/${follow.id}`)).statusCode).toBe(204);
    await sim({ event: 'follow' });
    expect(withoutLeaderboard(await overlay.drain())).toEqual([{ type: 'dropAlerts', actions: [follow.id] }]);
  });

  it('speaks through the chosen engine, keeps cloud keys secret, and reports cloud errors on preview', async () => {
    const { cookie } = await signUp();
    expect((await api(cookie, 'GET', '/api/tts/options')).json()).toMatchObject({ piperVoices: [], espeakVoices: expect.arrayContaining(['en-us']) });

    await api(cookie, 'PATCH', '/api/settings', { ttsEngine: 'browser', ttsVoice: 'Microsoft Zira', ttsEffect: 'chipmunk' });
    expect((await api(cookie, 'POST', '/api/tts/preview', { text: 'hi' })).json()).toEqual({
      kind: 'browser',
      text: 'hi',
      voice: 'Microsoft Zira',
      effect: 'chipmunk',
    });
    expect((await api(cookie, 'PATCH', '/api/settings', { ttsEffect: 'kazoo' })).statusCode).toBe(400);

    // Cloud without a key is an error on preview (live speech would fall back to eSpeak instead).
    await api(cookie, 'PATCH', '/api/settings', { ttsEngine: 'cloud' });
    expect((await api(cookie, 'POST', '/api/tts/preview')).statusCode).toBe(502);
    expect((await api(cookie, 'GET', '/api/tts/cloud-voices')).statusCode).toBe(400);

    const res = await api(cookie, 'PATCH', '/api/settings', { ttsCloudProvider: 'google', ttsCloudKey: 'secret-123', ttsCloudVoice: 'en-GB-Neural2-A' });
    expect(res.statusCode).toBe(200);
    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    expect(me).toMatchObject({ ttsCloudProvider: 'google', ttsCloudKeySet: true });
    expect(JSON.stringify(me)).not.toContain('secret-123');

    cloudRequests.length = 0;
    expect((await api(cookie, 'POST', '/api/tts/preview', { text: 'hi' })).json()).toEqual({ kind: 'audio', data: '//uQAA==', mime: 'audio/mpeg', effect: 'chipmunk' });
    expect((await api(cookie, 'GET', '/api/tts/cloud-voices')).json()).toEqual([{ id: 'en-GB-Neural2-A', label: 'en-GB-Neural2-A (female)' }]);
    expect(cloudRequests[0]!.url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize?key=secret-123');
    expect(JSON.parse(String(cloudRequests[0]!.init.body))).toMatchObject({ input: { text: 'hi' }, voice: { languageCode: 'en-GB', name: 'en-GB-Neural2-A' } });

    await api(cookie, 'PATCH', '/api/settings', { ttsCloudKey: 'bad-key' });
    const bad = await api(cookie, 'POST', '/api/tts/preview');
    expect(bad.statusCode).toBe(502);
    expect(bad.json().error).toContain('Google TTS failed (403)');

    // Stored encrypted, not as typed.
    const [stored] = await app.db.select({ key: hosts.ttsCloudKey }).from(hosts);
    expect(stored!.key).toMatch(/^enc:v1:/);

    // Clearing the key works too.
    await api(cookie, 'PATCH', '/api/settings', { ttsCloudKey: null });
    expect((await api(cookie, 'GET', '/api/auth/me')).json().ttsCloudKeySet).toBe(false);
  });

  it('signs in to TikTok voices through the companion and keeps the session secret', async () => {
    const { cookie } = await signUp();
    const { token } = await pairCompanion(cookie);
    const sendSession = (sessionId: string, auth = `Bearer ${token}`) =>
      app.inject({ method: 'POST', url: '/api/companions/tiktok-session', payload: { sessionId }, headers: { authorization: auth }, remoteAddress: nextAddress() });

    await api(cookie, 'PATCH', '/api/settings', { ttsEngine: 'tiktok', ttsTiktokVoice: 'en_us_002' });
    const before = await api(cookie, 'POST', '/api/tts/preview');
    expect([before.statusCode, before.json().error]).toEqual([502, 'Sign in to TikTok from the companion app first']);

    // Only a paired companion can send a session, and only one TikTok accepts.
    expect((await sendSession('goodsession0123456789', 'Bearer not-a-token')).statusCode).toBe(401);
    const expired = await sendSession('expiredsession0123456');
    expect([expired.statusCode, expired.json().error]).toEqual([400, 'TikTok signed you out. Sign in to TikTok again from the companion app.']);
    const signedIn = async () =>
      (await app.inject({ method: 'GET', url: '/api/companions/tiktok-session', headers: { authorization: `Bearer ${token}` } })).json().signedIn;
    expect(await signedIn()).toBe(false);
    expect((await sendSession('goodsession0123456789')).statusCode).toBe(200);
    expect(await signedIn()).toBe(true);

    const me = (await api(cookie, 'GET', '/api/auth/me')).json();
    expect(me).toMatchObject({ ttsEngine: 'tiktok', ttsTiktokVoice: 'en_us_002', ttsTiktokConnected: true });
    expect(JSON.stringify(me)).not.toContain('goodsession');
    const [stored] = await app.db.select({ session: hosts.ttsTiktokSession }).from(hosts);
    expect(stored!.session).toMatch(/^enc:v1:/);

    cloudRequests.length = 0;
    expect((await api(cookie, 'POST', '/api/tts/preview', { text: 'hi & bye' })).json()).toEqual({ kind: 'audio', data: '//uQAA==', mime: 'audio/mpeg', effect: 'none' });
    const query = new URL(cloudRequests[0]!.url).searchParams;
    expect([query.get('text_speaker'), query.get('req_text')]).toEqual(['en_us_002', 'hi  and  bye']);

    // Signing out from the dashboard clears it; the session can't be set from the browser.
    expect((await api(cookie, 'PATCH', '/api/settings', { ttsTiktokSession: 'goodsession0123456789' })).statusCode).toBe(400);
    await api(cookie, 'PATCH', '/api/settings', { ttsTiktokSession: null });
    expect((await api(cookie, 'GET', '/api/auth/me')).json().ttsTiktokConnected).toBe(false);
    expect(await signedIn()).toBe(false);
  });

  it("offers TikTok sign-in in the companion only while the server's own account isn't working", async () => {
    const withAccount = (tiktokSessionId: string) =>
      buildApp(
        { databaseUrl, port: 0, host: '127.0.0.1', eulerApiKey: undefined, production: false, secureCookies: false, piperBin: undefined, piperVoicesDir: undefined, tiktokSessionId, secretsKey },
        { logger: false, fetch: fakeFetch },
      );
    const server = await withAccount('goodsession0123456789');
    try {
      const signup = await server.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'a@example.com', password: 'correct horse' }, remoteAddress: nextAddress() });
      const session = signup.cookies.find((c) => c.name === 'hyperion_session')!;
      const cookie = `${session.name}=${session.value}`;
      const { code } = (await server.inject({ method: 'POST', url: '/api/companions/pairing-code', headers: { cookie } })).json();
      const { token } = (await server.inject({ method: 'POST', url: '/api/companions/pair', payload: { code, name: 'PC' }, remoteAddress: nextAddress() })).json();
      const companionView = async () =>
        (await server.inject({ method: 'GET', url: '/api/companions/tiktok-session', headers: { authorization: `Bearer ${token}` } })).json();
      const dashboardView = async () => (await server.inject({ method: 'GET', url: '/api/tts/options', headers: { cookie } })).json().tiktokServerAccount;

      await server.tiktokAccount.check();
      expect(await companionView()).toEqual({ signedIn: false, needed: false });
      expect(await dashboardView()).toBe(true);

      // The account's session expires: TikTok refuses a line, the status goes offline, sign-in appears.
      await server.inject({ method: 'PATCH', url: '/api/settings', payload: { ttsEngine: 'tiktok' }, headers: { cookie } });
      const expired = await withAccount('expiredsession0123456');
      await expired.tiktokAccount.check();
      await expired.close();
      expect(await companionView()).toEqual({ signedIn: false, needed: true });
      expect(await dashboardView()).toBe(false);
      const [row] = await server.db.select().from(serviceStatus);
      expect(row).toMatchObject({ name: 'tiktok-account', ok: false, detail: expect.stringContaining('signed you out') });

      // A line that works again with the account brings it back.
      expect((await server.inject({ method: 'POST', url: '/api/tts/preview', headers: { cookie } })).json().kind).toBe('audio');
      expect(await companionView()).toEqual({ signedIn: false, needed: false });
    } finally {
      await server.close();
    }
  });

  it('encrypts secrets saved before encryption existed when the server starts', async () => {
    await signUp();
    await app.db.update(hosts).set({ ttsCloudKey: 'old-plain-key', ttsTiktokSession: 'oldplainsession' });
    const restarted = await buildApp(
      { databaseUrl, port: 0, host: '127.0.0.1', eulerApiKey: undefined, production: false, secureCookies: false, piperBin: undefined, piperVoicesDir: undefined, tiktokSessionId: undefined, secretsKey },
      { logger: false },
    );
    await restarted.close();
    const [row] = await app.db.select({ key: hosts.ttsCloudKey, session: hosts.ttsTiktokSession }).from(hosts);
    expect(row!.key).toMatch(/^enc:v1:/);
    const secrets = new Secrets(secretsKey);
    expect([secrets.open(row!.key), secrets.open(row!.session)]).toEqual(['old-plain-key', 'oldplainsession']);
  });

  it('keeps the Piper speaker within the chosen voice', async () => {
    // A second app with a fake Piper offering a 3-speaker and a 1-speaker voice.
    const fixture = (p: string) => fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url));
    const withPiper = await buildApp(
      { databaseUrl, port: 0, host: '127.0.0.1', eulerApiKey: undefined, production: false, secureCookies: false, piperBin: undefined, piperVoicesDir: undefined, tiktokSessionId: undefined, secretsKey },
      { logger: false, piper: new Piper(process.execPath, fixture('piper-voices'), [fixture('fake-piper.mjs')]) },
    );
    try {
      const signup = await withPiper.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: 'piper@example.com', password: 'correct horse' },
        remoteAddress: nextAddress(),
      });
      const cookie = `hyperion_session=${signup.cookies.find((c) => c.name === 'hyperion_session')!.value}`;
      const patch = (payload: object) => withPiper.inject({ method: 'PATCH', url: '/api/settings', payload, headers: { cookie } });
      const me = async () => (await withPiper.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json();

      expect((await patch({ ttsPiperVoice: 'many_voices', ttsPiperSpeaker: 2 })).statusCode).toBe(200);
      expect((await patch({ ttsPiperSpeaker: 3 })).json().error).toBe('many_voices has speakers 0–2');
      // Switching voice resets the speaker; a single-speaker voice only has speaker 0.
      await patch({ ttsPiperVoice: 'test_voice' });
      expect((await me()).ttsPiperSpeaker).toBeNull();
      expect((await patch({ ttsPiperSpeaker: 1 })).statusCode).toBe(400);
      expect((await patch({ ttsPiperVoice: 'many_voices', ttsPiperSpeaker: 1 })).statusCode).toBe(200);
      expect((await me()).ttsPiperSpeaker).toBe(1);
    } finally {
      await withPiper.close();
    }
  });

  it("can't touch another host's actions, commands or files", async () => {
    const a = await signUp('a@example.com');
    const b = await signUp('b@example.com');
    const [actionA] = (await api(a.cookie, 'GET', '/api/actions')).json();
    expect((await api(b.cookie, 'POST', `/api/actions/${actionA.id}/test`)).statusCode).toBe(404);
    expect((await api(b.cookie, 'PATCH', `/api/actions/${actionA.id}`, { text: 'x' })).statusCode).toBe(404);
    expect((await api(b.cookie, 'DELETE', `/api/actions/${actionA.id}`)).statusCode).toBe(404);
    const [commandA] = (await api(a.cookie, 'GET', '/api/commands')).json();
    const file = await upload(a.cookie, 'ding', WAV);
    expect((await api(b.cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', keyCommandId: commandA.id })).statusCode).toBe(400);
    expect((await api(b.cookie, 'POST', '/api/actions', { name: 'x', trigger: 'follow', soundMediaId: file.id })).statusCode).toBe(400);
    expect((await api(b.cookie, 'DELETE', `/api/media/${file.id}`)).statusCode).toBe(404);
    expect((await api(b.cookie, 'GET', '/api/media')).json()).toEqual([]);
  });
});

describe('gateway auth', () => {
  it('rejects a companion with a bad token or wrong protocol', async () => {
    const bad = connect('/ws/companion');
    await bad.opened;
    bad.send({ type: 'hello', token: 'nope', protocol: PROTOCOL_VERSION });
    expect(await bad.next()).toMatchObject({ type: 'error' });
    expect(await bad.closed).toBe(4001);

    const { cookie } = await signUp();
    const { token } = await pairCompanion(cookie);
    const old = connect('/ws/companion');
    await old.opened;
    old.send({ type: 'hello', token, protocol: PROTOCOL_VERSION + 1 });
    expect(await old.next()).toMatchObject({ type: 'error' });
    expect(await old.closed).toBe(4001);
  });

  it('pairing codes work once', async () => {
    const { cookie } = await signUp();
    const { code } = (await api(cookie, 'POST', '/api/companions/pairing-code')).json();
    const remoteAddress = nextAddress();
    const first = await app.inject({ method: 'POST', url: '/api/companions/pair', payload: { code, name: 'PC' }, remoteAddress });
    const second = await app.inject({ method: 'POST', url: '/api/companions/pair', payload: { code, name: 'PC' }, remoteAddress });
    expect([first.statusCode, second.statusCode]).toEqual([201, 400]);
  });

  it('disconnects a companion when the host revokes it', async () => {
    const { cookie } = await signUp();
    const { id, token } = await pairCompanion(cookie);
    const companion = await connectCompanion(token);
    await companion.next(); // ready
    await companion.next(); // profile
    expect((await api(cookie, 'DELETE', `/api/companions/${id}`)).statusCode).toBe(204);
    expect(await companion.closed).toBe(4003);
  });

  it('rejects an overlay with an unknown token', async () => {
    const overlay = connect('/ws/overlay?token=nope');
    expect(await overlay.closed).toBe(4001);
  });

  it.each([
    ['null', 'null'],
    ['a number', '5'],
    ['a NUL in the hostname', JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token: 'x', hostname: 'a\u0000b' })],
  ])('survives a hello of %s from an unknown client', async (_name, hello) => {
    const companion = connect('/ws/companion');
    await companion.opened;
    companion.socket.send(hello);
    expect(await companion.closed).toBe(4001);
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
  });

  it('keeps a NUL out of a paired companion\'s hostname', async () => {
    const { cookie } = await signUp();
    const { token } = await pairCompanion(cookie);
    const companion = connect('/ws/companion', ['commands', 'theme']);
    await companion.opened;
    companion.socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token, hostname: 'Game\u0000PC' }));
    expect((await companion.next()).type).toBe('ready');
    expect((await api(cookie, 'GET', '/api/companions')).json()[0].hostname).toBe('GamePC');
  });

  it('closes a WebSocket that sends an oversized message', async () => {
    const companion = connect('/ws/companion');
    await companion.opened;
    companion.socket.send('x'.repeat(65 * 1024));
    expect(await companion.closed).toBe(1009);
  });
});

describe('endpoint protection', () => {
  it('refuses an upload without a login before reading its body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/media?name=x',
      payload: Buffer.alloc(11 * 1024 * 1024),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('checks the login before validating a request', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/screens/not-a-uuid', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('answers a NUL in text with a 400 that quotes no SQL', async () => {
    const { cookie } = await signUp();
    const res = await api(cookie, 'POST', '/api/screens', { name: 'a\u0000b' });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/insert|overlay_screens/i);
  });

  it('hides the text of an unexpected error', async () => {
    const { cookie } = await signUp();
    const status = vi.spyOn(app.live, 'status').mockImplementationOnce(() => {
      throw new Error('secret detail');
    });
    const res = await api(cookie, 'GET', '/api/live/status');
    status.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret detail');
  });

  it('keeps each client behind a proxy to their own rate limit', async () => {
    const proxied = await buildApp({ ...app.config, trustProxy: 'loopback' }, { logger: false, fetch: fakeFetch });
    const login = (address: string) =>
      proxied.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.com', password: 'wrong password' },
        headers: { 'x-forwarded-for': address },
        remoteAddress: '127.0.0.1',
      });
    for (let i = 0; i < 10; i++) expect((await login('203.0.113.1')).statusCode).toBe(401);
    expect((await login('203.0.113.1')).statusCode).toBe(429);
    expect((await login('203.0.113.2')).statusCode).toBe(401);
    await proxied.close();
  });

  it('applies a ceiling to routes with no limit of their own', async () => {
    const limited = await buildApp(app.config, { logger: false, fetch: fakeFetch });
    const health = () => limited.inject({ url: '/api/health' });
    for (let i = 0; i < 600; i++) expect((await health()).statusCode).toBe(200);
    expect((await health()).statusCode).toBe(429);
    await limited.close();
  });
});
