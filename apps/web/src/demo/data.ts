import {
  GAME_TEMPLATES,
  levelForXp,
  type Gift,
  type Goal,
  type LeaderboardEntry,
  type MediaItem,
  type StreamDetail,
  type StreamEvent,
  type StreamSummary,
  type StreamViewer,
} from '@hyperion/shared';
import type { Action, Command, Companion, Host, Profile, Screen } from '../api';
import { makeCrowd } from '../dashboard/auto-chat';

// The demo's made-up account: a Minecraft streamer with a few weeks of streams behind them. Everything lives in this
// tab and is gone on reload. Past streams come from a fixed seed, so every visitor sees the same history.

// A small seeded random, so the history is the same on every visit.
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uuidFrom = (random: () => number) =>
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(random() * 16).toString(16));
// Not crypto.randomUUID: that needs HTTPS, and a self-hosted server may be reached over plain HTTP on a LAN.
export const newId = () => uuidFrom(Math.random);

export const MAIN_TOKEN = 'demo.main';
const MINECRAFT = '6f0d1c52-3a5e-4d8b-9a41-0c7e2b9d5a10';
const GTA = 'b3e8a7c4-1d2f-4e6a-8b59-7f0a3c2d1e94';

// Built-in library files: their ids are the same on every server (see the server's media/library.ts).
const LIBRARY = {
  dance: '8c921f11-0694-5980-8c5d-910df1031d20',
  scubaCat: '9c166819-cb53-50cf-8f1b-96c356abc75e',
  jackpot: '0a4b9bef-8835-5694-8931-758750a726c2',
};
export const media: MediaItem[] = [
  ['05c3d2bd-4a0d-5f3a-81d8-db2121019a45', 'Balls in your jaws', 'audio', 'audio/mpeg', 242188],
  [LIBRARY.dance, 'Dance', 'image', 'image/gif', 356364],
  ['0502d586-11a7-52b7-8479-587f815ee0a8', 'Giga Chad', 'audio', 'audio/mpeg', 321173],
  ['2a420d37-6678-52c1-8a82-a6cbf66d69f3', 'Heavenly music', 'audio', 'audio/mpeg', 189103],
  [LIBRARY.jackpot, 'I just hit the jackpot', 'audio', 'audio/mpeg', 272286],
  ['bb01f1f4-0488-5de5-8e12-59c79e5b1ec4', 'Luffy Gear 5', 'image', 'image/gif', 362051],
  ['1c5ac68b-50c0-5193-802e-19a7e9317a04', 'Raaaah', 'audio', 'audio/mpeg', 52847],
  ['76b579a8-be0d-5fcf-8a2e-c47276b6406b', 'Sad meow song', 'audio', 'audio/mpeg', 150859],
  [LIBRARY.scubaCat, 'Scuba Cat', 'image', 'image/gif', 1042798],
  ['a5794c6c-49ad-5665-8a27-1c049e5600b3', 'Talking Ben: yes', 'audio', 'audio/mpeg', 27772],
  ['d2d8372b-9fd7-5b07-837f-c69ef2b18c37', 'Woah, look at that look', 'image', 'image/gif', 261623],
].map(([id, name, kind, mime, size]) => ({ id, name, kind, mime, size, createdAt: 0, builtIn: true }) as MediaItem);

const CDN = 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/';
export const gifts: Gift[] = [
  { name: 'Rose', coins: 1, image: `${CDN}eba3a9bb85c33e017f3648eaf88d7189~tplv-obj.webp` },
  { name: 'TikTok', coins: 1, image: `${CDN}802a21ae29f9fae5abe3693de9f874bd~tplv-obj.webp` },
  { name: 'GG', coins: 1, image: `${CDN}3f02fa9594bd1495ff4e8aa5ae265eef~tplv-obj.webp` },
  { name: 'Ice Cream Cone', coins: 1, image: `${CDN}968820bc85e274713c795a6aef3f7c67~tplv-obj.webp` },
  { name: 'Finger Heart', coins: 5, image: `${CDN}a4c4dc437fd3a6632aba149769491f49.png~tplv-obj.webp` },
  { name: 'Rosa', coins: 10, image: `${CDN}eb77ead5c3abb6da6034d3cf6cfeb438~tplv-obj.webp` },
  { name: 'Perfume', coins: 20, image: `${CDN}20b8f61246c7b6032777bb81bf4ee055~tplv-obj.webp` },
  { name: 'Doughnut', coins: 30, image: `${CDN}4e7ad6bdf0a1d860c538f38026d4e812~tplv-obj.webp` },
  { name: 'Hat and Mustache', coins: 99, image: `${CDN}2f1e4f3f5c728ffbfa35705b480fdc92~tplv-obj.webp` },
  { name: 'Corgi', coins: 299, image: `${CDN}148eef0884fdb12058d1c6897d1e02b9~tplv-obj.webp` },
  { name: 'Money Gun', coins: 500, image: `${CDN}e0589e95a2b41970f0f30f6202f5fce6~tplv-obj.webp` },
  { name: 'Galaxy', coins: 1000, image: `${CDN}resource/79a02148079526539f7599150da9fd28.png~tplv-obj.webp` },
];
export const giftNamed = (name: string) => gifts.find((g) => g.name.toLowerCase() === name.trim().toLowerCase());

export const host: Host = {
  id: 'demo',
  email: 'demo@hyperion.local',
  tiktokUsername: 'hyperion.demo',
  tiktokAvatar: null,
  overlayToken: MAIN_TOKEN,
  actionsPerSecond: 5,
  progression: true,
  levelGating: false,
  points: false,
  pointsPerChat: 1,
  pointsPerDiamond: 10,
  pointsPerFollow: 20,
  pointsPerShare: 5,
  pointsCheck: false,
  ttsMode: 'prefix',
  ttsPrefix: '!tts',
  ttsMaxLength: 150,
  ttsMaxWords: 0,
  ttsUnlockGifts: [],
  ttsUnlockMinutes: 0,
  ttsTemplate: '{viewer} says {text}',
  ttsCommands: false,
  ttsCommandTemplate: '{viewer} pressed {command}',
  ttsCooldownMs: 15000,
  ttsAutoMaxViewers: 25,
  ttsMinLevel: 1,
  ttsBlockedWords: '',
  ttsVoice: null,
  ttsEngine: 'browser',
  ttsEspeakVoice: 'en-us',
  ttsPiperVoice: null,
  ttsPiperSpeaker: null,
  ttsEffect: 'none',
  ttsVolume: 100,
  ttsCloudProvider: null,
  ttsCloudKeySet: false,
  ttsCloudRegion: null,
  ttsCloudVoice: null,
  ttsTiktokVoice: null,
  ttsTiktokConnected: false,
  uiTheme: 'default',
  uiThemeStyle: 'colors',
  uiMode: 'system',
  liveLayout: null,
  streamRecap: true,
  commandDefaults: null,
  alertStyle: null,
  alertStyle2: null,
  hiddenSounds: [],
  soundVolumes: {},
  onboarding: 'done',
  onboardingSteps: [],
  profileId: MINECRAFT,
  profileName: 'Minecraft',
  profileGames: [
    { process: 'javaw.exe', icon: null },
    { process: 'minecraft.windows.exe', icon: null },
  ],
  mode: 'anarchy',
  voteWindowMs: 3000,
  turnMs: 30000,
  raffleMs: 8000,
  giftBoosts: true,
};

// What each profile keeps for itself.
export interface ProfileSettings {
  mode: Host['mode'];
  voteWindowMs: number;
  turnMs: number;
  raffleMs: number;
  giftBoosts: boolean;
}
// One profile per game template, each with that game's commands, the way a host gets them by picking the template.
// Minecraft is on; GTA V plays as a democracy, to show another crowd mode.
const PROFILE_IDS: Record<string, string> = { minecraft: MINECRAFT, gta5: GTA };
export const profiles: (Profile & ProfileSettings)[] = GAME_TEMPLATES.map((t) => ({
  id: PROFILE_IDS[t.id] ?? newId(),
  name: t.name,
  games: t.processes.map((process) => ({ process, icon: null })),
  active: t.id === 'minecraft',
  mode: t.id === 'gta5' ? 'democracy' : 'anarchy',
  voteWindowMs: 3000,
  turnMs: 30000,
  raffleMs: 8000,
  giftBoosts: true,
}));

// A template's commands, as the server makes them for a new profile.
export const templateCommands = (templateId: string, profileId: string): (Command & { profileId: string })[] =>
  (GAME_TEMPLATES.find((t) => t.id === templateId)?.commands ?? []).map((c) => ({
    id: newId(),
    profileId,
    ...c,
    macro: null,
    gameAction: null,
    chain: null,
    cooldownMs: 1000,
    enabled: true,
    minLevel: 1,
    cost: 0,
  }));
export const commands: (Command & { profileId: string })[] = GAME_TEMPLATES.flatMap((t, i) => templateCommands(t.id, profiles[i]!.id));
const jump = commands.find((c) => c.profileId === MINECRAFT && c.keyword === 'jump')!;

const action = (name: string, trigger: Action['trigger'], extra: Partial<Action> = {}): Action => ({
  id: newId(),
  profileId: null,
  name,
  enabled: true,
  trigger,
  giftName: null,
  minDiamonds: null,
  likeStep: null,
  likeGrowth: null,
  command: null,
  goalId: null,
  audience: 'everyone',
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
  alertShape: 'star',
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
  ...extra,
});
export const actions: Action[] = [
  action('Follow alert', 'follow', { text: '{viewer} followed!', sound: 'chime', alertEffect: 'emoji_burst', alertEmoji: '💜' }),
  action('Share alert', 'share', { text: '{viewer} shared the stream!', sound: 'whoosh' }),
  action('Gift alert', 'gift', { text: '{viewer} sent {count}× {gift}!', sound: 'coin' }),
  action('Rose makes me jump', 'gift', { profileId: MINECRAFT, giftName: 'Rose', keyCommandId: jump.id, repeatWithCount: true, text: "{viewer}'s Rose: jump ×{count}!", sound: 'pop' }),
  action('Galaxy party', 'gift', { giftName: 'Galaxy', text: '{viewer} sent a GALAXY!', mediaId: LIBRARY.dance, soundMediaId: LIBRARY.jackpot, effect: 'fireworks', effectAmount: 4, durationMs: 7000, alertEffect: 'character_reveal', alertShape: 'star' }),
  action('Big spender', 'gift', { minDiamonds: 299, text: 'Thank you {viewer} for {coins} coins!', sound: 'fanfare', effect: 'coins' }),
  action('Likes alert', 'likes', { likeStep: 1000, text: '{total} likes! Thanks {viewer}', sound: 'pop', effect: 'hearts', effectAmount: 2 }),
  action('Sub hype', 'subscribe', { text: '{viewer} subscribed!', sound: 'fanfare', alertEffect: 'graphic_banner', effect: 'confetti' }),
];

export const goals: Goal[] = [
  { id: newId(), name: 'Like goal', metric: 'likes', target: 5000, enabled: true, raise: { kind: 'times', by: 2 } },
  { id: newId(), name: 'New followers', metric: 'follows', target: 25, enabled: true, raise: null },
];

const screen = (token: string, name: string, extra: Partial<Screen>): Screen => ({
  id: newId(),
  token,
  name,
  main: false,
  alerts: true,
  feed: true,
  leaderboard: true,
  leaderboardSize: 5,
  mode: true,
  audio: true,
  alertPosition: 'top',
  alertPos: null,
  alertScale: 100,
  scale: 100,
  layout: 'desktop',
  widgets: [],
  linkStyles: {},
  parts: {},
  phoneSafe: { top: 13, bottom: 30 },
  ...extra,
});
export const screens: Screen[] = [
  screen(MAIN_TOKEN, 'Main', {
    main: true,
    widgets: [
      { type: 'goals', spot: 'left' },
      { type: 'top_gift', spot: 'top-right' },
      { type: 'last_follower', spot: 'bottom-left' },
    ],
  }),
  screen('demo.phone', 'Phone stream', { layout: 'phone', leaderboard: false, widgets: [{ type: 'chat', spot: 'left' }] }),
];

export const companions: Companion[] = [{ id: newId(), name: 'Gaming PC', lastSeenAt: new Date().toISOString(), hostname: 'GAMING-PC', platform: 'windows' }];

// Past streams, made up once from the seed. Event ids go up across streams, as they do on a real server.
export interface PastStream {
  meta: Omit<StreamSummary, 'viewers' | 'participants' | 'newParticipants' | 'comments' | 'commands' | 'gifts' | 'diamonds' | 'follows' | 'topCommand' | 'topPlayer' | 'topPlayerName'>;
  events: StreamEvent[];
  mode: Host['mode'];
}
let nextEventId = 1;
export const eventId = () => nextEventId++;

const CHATTER = ['lol', 'W', 'LETS GOOO', 'no way', 'gg', 'omg', 'this is so fun', 'again!!', '🔥', 'first time here', 'how does this work', 'clutch', 'W stream', 'who did that 😭', 'creeper behind you'];

function makeHistory(): PastStream[] {
  const random = seeded(20261109);
  const regulars = makeCrowd(random, 60); // the ones who chat and play
  const lurkers = makeCrowd(random, 400).filter((v) => !regulars.includes(v)); // who only drop by, or like
  const followed = new Set<string>(); // a viewer follows once
  const day = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const streams: PastStream[] = [];
  // Most evenings in the last eight weeks, a little more often lately as the channel grows.
  for (let daysAgo = 56; daysAgo >= 1; daysAgo -= 1 + Math.floor(random() * 3)) {
    const growth = 1 - daysAgo / 80;
    const gta = random() < 0.25;
    const startedAt = today.getTime() - daysAgo * day + (17 + Math.floor(random() * 5)) * 3600_000 + Math.floor(random() * 4) * 15 * 60_000;
    const minutes = 40 + Math.floor(random() * 110);
    const endedAt = startedAt + minutes * 60_000;
    const keywords = commands.filter((c) => c.profileId === (gta ? GTA : MINECRAFT)).map((c) => c.keyword);
    const crowd = regulars.slice(0, Math.floor(20 + growth * 40));
    const events: StreamEvent[] = [];
    const push = (at: number, kind: StreamEvent['kind'], viewer: string | null, data: Record<string, unknown> = {}) =>
      events.push({ id: 0, at, kind, viewer, data }); // numbered once in order, below
    const lastPress = new Map<string, number>();
    for (let m = 0; m < minutes; m++) {
      // Busy at the start, a lull, busier again near the end.
      const shape = 0.6 + 0.5 * Math.sin((m / minutes) * Math.PI * 2.2 + 0.8) ** 2;
      const perMinute = Math.round((6 + growth * 22) * shape * (0.6 + random() * 0.8));
      for (let i = 0; i < perMinute; i++) {
        const at = startedAt + m * 60_000 + Math.floor(random() * 60_000);
        const viewer = crowd[Math.floor(random() ** 1.7 * crowd.length)]!;
        const roll = random();
        if (roll < 0.04) {
          const gift = gifts[Math.floor(random() ** 2.5 * gifts.length)]!;
          push(at, 'gift', viewer, { gift: gift.name, count: random() < 0.75 ? 1 : 5, diamonds: gift.coins, image: gift.image });
        } else if (roll < 0.06 && !followed.has(viewer)) (followed.add(viewer), push(at, 'follow', viewer));
        else if (roll < 0.14) push(at, 'like', viewer, { count: 5 + Math.floor(random() * 40) });
        else if (roll < 0.15) push(at, 'share', viewer);
        else if (roll < 0.2) push(at, 'join', viewer);
        else if (roll < 0.36) push(at, 'comment', viewer, { text: CHATTER[Math.floor(random() * CHATTER.length)] });
        else {
          const keyword = keywords[Math.floor(random() ** 1.4 * keywords.length)]!;
          push(at, 'comment', viewer, { text: keyword });
          const cooled = at - (lastPress.get(keyword) ?? 0) < 1000;
          if (cooled) push(at, 'refused', viewer, { keyword, reason: 'cooldown' });
          else (lastPress.set(keyword, at), push(at, 'command', viewer, { keyword, via: 'chat' }));
        }
      }
      // Quiet viewers: they join, some leave a like, a few follow.
      for (let i = Math.round((3 + growth * 8) * random()); i > 0; i--) {
        const at = startedAt + m * 60_000 + Math.floor(random() * 60_000);
        const viewer = lurkers[Math.floor(random() * lurkers.length)]!;
        push(at, 'join', viewer);
        if (random() < 0.3) push(at + 5000, 'like', viewer, { count: 1 + Math.floor(random() * 15) });
        if (random() < 0.04 && !followed.has(viewer)) (followed.add(viewer), push(at + 9000, 'follow', viewer));
      }
    }
    events.sort((a, b) => a.at - b.at);
    events.forEach((e) => (e.id = eventId()));
    streams.push({
      meta: { id: uuidFrom(random), source: 'tiktok', profileName: gta ? 'GTA V' : 'Minecraft', tiktokUsername: host.tiktokUsername, startedAt, endedAt, peakViewers: Math.floor((60 + random() * 200) * (0.5 + growth)) },
      events,
      mode: gta ? 'democracy' : 'anarchy',
    });
  }
  return streams;
}
let history: PastStream[] | null = null;
export const pastStreams = () => (history ??= makeHistory());

// What a stream's events add up to, for its summary, report and viewer list. `before` is everyone who took part in an
// earlier stream, for counting the new ones.
export function summarize(stream: PastStream, before: Set<string>): StreamSummary {
  const v = viewersOf(stream);
  const total = (key: 'comments' | 'commands' | 'gifts' | 'coins') => v.reduce((n, x) => n + x[key], 0);
  const presses = countBy(stream.events.filter((e) => e.kind === 'command').map((e) => String(e.data.keyword)));
  const top = [...v].sort((a, b) => b.commands - a.commands)[0];
  const participants = v.filter((x) => x.comments || x.gifts);
  return {
    ...stream.meta,
    viewers: v.length,
    participants: participants.length,
    newParticipants: participants.filter((x) => !before.has(x.viewer)).length,
    comments: total('comments'),
    commands: total('commands'),
    gifts: total('gifts'),
    diamonds: total('coins'),
    follows: v.filter((x) => x.followed).length,
    topCommand: Object.entries(presses).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    topPlayer: top?.commands ? top.viewer : null,
    topPlayerName: null,
  };
}

export function viewersOf(stream: PastStream): StreamViewer[] {
  const by = new Map<string, StreamViewer>();
  for (const e of stream.events) {
    if (!e.viewer) continue;
    let v = by.get(e.viewer);
    if (!v) by.set(e.viewer, (v = { viewer: e.viewer, name: null, avatar: null, comments: 0, commands: 0, gifts: 0, coins: 0, likes: 0, followed: false, firstAt: e.at, lastAt: e.at }));
    v.lastAt = e.at;
    if (e.kind === 'comment') v.comments++;
    if (e.kind === 'command') v.commands++;
    if (e.kind === 'gift') (v.gifts += Number(e.data.count)), (v.coins += Number(e.data.count) * Number(e.data.diamonds));
    if (e.kind === 'like') v.likes += Number(e.data.count);
    if (e.kind === 'follow') v.followed = true;
  }
  return [...by.values()].sort((a, b) => b.commands + b.comments - (a.commands + a.comments));
}

const countBy = (list: string[]) => list.reduce<Record<string, number>>((n, k) => ((n[k] = (n[k] ?? 0) + 1), n), {});

export function report(stream: PastStream, summary: StreamSummary): StreamDetail {
  const { startedAt } = stream.meta;
  const end = stream.meta.endedAt ?? Date.now();
  const perMinute = Array.from({ length: Math.max(1, Math.ceil((end - startedAt) / 60_000)) }, (_, minute) => ({ minute, commands: 0, comments: 0 }));
  const usage = new Map<string, StreamDetail['commandUsage'][number]>();
  const byGift = new Map<string, StreamDetail['gifts']['byGift'][number]>();
  const perHour = new Map<number, number>();
  const markers: StreamDetail['markers'] = [];
  for (const e of stream.events) {
    const slot = perMinute[Math.min(perMinute.length - 1, Math.floor((e.at - startedAt) / 60_000))]!;
    if (e.kind === 'comment') slot.comments++;
    if (e.kind === 'command' || e.kind === 'refused') {
      const keyword = String(e.data.keyword);
      const u = usage.get(keyword) ?? { keyword, fired: 0, refused: 0, reasons: {} };
      usage.set(keyword, u);
      if (e.kind === 'command') (u.fired++, slot.commands++);
      else (u.refused++, (u.reasons[String(e.data.reason)] = (u.reasons[String(e.data.reason)] ?? 0) + 1));
    }
    if (e.kind === 'gift') {
      const count = Number(e.data.count);
      const coins = count * Number(e.data.diamonds);
      const g = byGift.get(String(e.data.gift)) ?? { gift: String(e.data.gift), count: 0, diamonds: 0, image: (e.data.image as string) ?? null };
      byGift.set(g.gift, g);
      g.count += count;
      g.diamonds += coins;
      const hour = Math.floor((e.at - startedAt) / 3600_000);
      perHour.set(hour, (perHour.get(hour) ?? 0) + coins);
      markers.push({ at: e.at, kind: 'gift', viewer: e.viewer, label: `${e.viewer} sent ${count > 1 ? `${count}× ` : ''}${g.gift}` });
    }
    if (e.kind === 'follow') markers.push({ at: e.at, kind: 'follow', viewer: e.viewer, label: `${e.viewer} followed` });
    if (e.kind === 'level') markers.push({ at: e.at, kind: 'level', viewer: e.viewer, label: `${e.viewer} reached level ${e.data.level}` });
  }
  // The busiest two-minute windows, without overlaps.
  const windows = perMinute.map((m, i) => ({ start: startedAt + i * 60_000, end: startedAt + (i + 2) * 60_000, events: m.comments + (perMinute[i + 1]?.comments ?? 0) }));
  const peaks: StreamDetail['peaks'] = [];
  for (const w of [...windows].sort((a, b) => b.events - a.events)) {
    if (peaks.length === 3 || !w.events) break;
    if (peaks.every((p) => w.end <= p.start || w.start >= p.end)) peaks.push(w);
  }
  return {
    summary,
    perMinute,
    markers,
    commandUsage: [...usage.values()].sort((a, b) => b.fired - a.fired),
    peaks,
    gifts: { byGift: [...byGift.values()].sort((a, b) => b.diamonds - a.diamonds), perHour: [...perHour].map(([hour, diamonds]) => ({ hour, diamonds })) },
    modes:
      stream.mode === 'democracy'
        ? { votes: { rounds: Math.round(summary.commands / 4), avgVoters: 3.4, closeRounds: Math.round(summary.commands / 15) }, queue: { joins: 0, turns: 0, avgWaitMs: 0 } }
        : { votes: { rounds: 0, avgVoters: 0, closeRounds: 0 }, queue: { joins: 0, turns: 0, avgWaitMs: 0 } },
  };
}

// The leaderboard as the history left it.
export function startingLeaderboard(): Map<string, LeaderboardEntry> {
  const board = new Map<string, LeaderboardEntry>();
  for (const s of pastStreams()) {
    for (const v of viewersOf(s)) {
      const e = board.get(v.viewer) ?? { viewer: v.viewer, commands: 0, gifts: 0, coins: 0, xp: 0, points: 0, avatar: null, name: null };
      board.set(v.viewer, e);
      e.commands += v.commands;
      e.gifts += v.gifts;
      e.coins += v.coins;
      e.xp += v.commands + v.coins;
    }
  }
  return board;
}
export const levelOf = (e: LeaderboardEntry) => levelForXp(e.xp);
