import { levelForXp, type AnalyticsOverview, type ProfileGame, type StreamEvent, type StreamSummary, type ViewerProfile } from '@hyperion/shared';
import { ApiError, type Action, type Command, type Host, type Screen } from '../api';
import { actions, commands, companions, gifts, goals, host, media, newId, pastStreams, profiles, report, screens, summarize, templateCommands, viewersOf, type PastStream } from './data';
import * as live from './engine';
import { autoChatRunning, startAutoChat } from '../dashboard/auto-chat-run';

// The demo's stand-in for the server: the same routes, answered from this tab's made-up data. Changes stick until the
// page reloads. Anything that would reach past this tab (TikTok, the companion, email, uploads, cloud voices) is
// turned away with a note to sign up.

const SIGN_UP = (what: string) => new ApiError(`${what} isn't part of the demo. Sign up free to use it.`, 403);

type Handler = (match: RegExpExecArray, body: any, query: URLSearchParams) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
const routes: [method: string, path: RegExp, handler: Handler][] = [];
const route = (method: string, path: string, handler: Handler) => routes.push([method, new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}$`), handler]);
const notFound = (what: string) => new ApiError(`${what} not found`, 404);
const find = <T extends { id: string }>(list: T[], id: string, what: string) => {
  const item = list.find((x) => x.id === id);
  if (!item) throw notFound(what);
  return item;
};
const remove = <T extends { id: string }>(list: T[], id: string) => {
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list.splice(i, 1);
};

export async function demoApi<T>(method: string, url: string, body?: unknown): Promise<T> {
  const [path, search = ''] = url.split('?') as [string, string?];
  const query = new URLSearchParams(search);
  // A moment's wait, so the dashboard's loading states look as they do for real.
  await new Promise((resolve) => setTimeout(resolve, 60));
  for (const [m, pattern, handler] of routes) {
    const match = m === method ? pattern.exec(path) : null;
    if (match) return structuredClone(handler(match, body ?? {}, query)) as T;
  }
  throw SIGN_UP('That');
}

// --- Account ---

route('GET', '/auth/me', () => host);
route('GET', '/auth/config', () => ({ signups: true, email: false }));
route('POST', '/auth/logout', () => ({ ok: true }));
for (const path of ['/auth/password', '/auth/logout-all', '/auth/delete-account']) route('POST', path, () => {
  throw SIGN_UP('Your login');
});

route('PATCH', '/settings', (_, body: Partial<Host> & { ttsCloudKey?: string; tiktokUsername?: string | null }) => {
  const { ttsCloudKey, ...rest } = body;
  if (ttsCloudKey !== undefined) throw SIGN_UP('Cloud voices');
  const modeChanged = rest.mode !== undefined && rest.mode !== host.mode;
  if (rest.tiktokUsername) rest.tiktokUsername = rest.tiktokUsername.replace(/^@/, ''); // stored without the @, as on the server
  Object.assign(host, rest);
  // Crowd mode and its timings belong to the profile.
  const profile = profiles.find((p) => p.id === host.profileId)!;
  for (const key of ['mode', 'voteWindowMs', 'turnMs', 'raffleMs', 'giftBoosts'] as const) if (key in rest) Object.assign(profile, { [key]: host[key] });
  if (modeChanged) live.resetMode();
  if (rest.ttsVolume !== undefined) live.speechVolume();
  return { ok: true };
});

// --- Profiles ---

const profileView = ({ id, name, games, active }: (typeof profiles)[number]) => ({ id, name, games, active });
route('GET', '/profiles', () => profiles.map(profileView));
// The demo has no PC, so it shows what a streamer's might have open.
route('GET', '/profiles/running-games', () => ({
  companions: 1,
  answered: 1,
  games: [
    { title: 'Minecraft', process: 'javaw.exe', icon: null },
    { title: 'Grand Theft Auto V', process: 'gta5.exe', icon: null },
    { title: 'OBS Studio', process: 'obs64.exe', icon: null },
    { title: 'Discord', process: 'discord.exe', icon: null },
  ],
}));
const cleanGames = (games: ProfileGame[] = []) =>
  games.map((g) => ({ process: g.process.trim().toLowerCase(), icon: g.icon ?? null })).filter((g, i, all) => g.process && all.findIndex((x) => x.process === g.process) === i);
// As on the server: a new profile takes the active one's settings, and either a game template's commands or a copy of
// the active one's commands and its own actions.
route('POST', '/profiles', (_, body: { name: string; games?: ProfileGame[]; template?: string }) => {
  if (profiles.some((p) => p.name.toLowerCase() === body.name.trim().toLowerCase())) throw new ApiError('A profile with that name already exists', 409);
  const source = profiles.find((p) => p.id === host.profileId)!;
  const profile = { ...source, id: newId(), name: body.name.trim(), games: cleanGames(body.games), active: false };
  profiles.push(profile);
  if (body.template) {
    commands.push(...templateCommands(body.template, profile.id));
  } else {
    const newIds = new Map<string, string>();
    for (const c of commands.filter((c) => c.profileId === source.id)) {
      const copy = { ...c, id: newId(), profileId: profile.id };
      newIds.set(c.id, copy.id);
      commands.push(copy);
    }
    for (const a of actions.filter((a) => a.profileId === source.id)) {
      actions.push({ ...a, id: newId(), profileId: profile.id, keyCommandId: a.keyCommandId && (newIds.get(a.keyCommandId) ?? null) });
    }
  }
  return profileView(profile);
});
route('PATCH', '/profiles/:id', ([, id], body) => {
  const profile = find(profiles, id!, 'Profile');
  Object.assign(profile, body, body.games && { games: cleanGames(body.games) });
  if (profile.id === host.profileId) Object.assign(host, { profileName: profile.name, profileGames: profile.games });
  return profileView(profile);
});
route('POST', '/profiles/:id/activate', ([, id]) => {
  const profile = find(profiles, id!, 'Profile');
  profiles.forEach((p) => (p.active = p === profile));
  Object.assign(host, { profileId: profile.id, profileName: profile.name, profileGames: profile.games, mode: profile.mode, voteWindowMs: profile.voteWindowMs, turnMs: profile.turnMs, raffleMs: profile.raffleMs, giftBoosts: profile.giftBoosts });
  live.resetMode();
  // Auto chat types the commands it read when it started; restarted, it plays the new game's.
  if (autoChatRunning()) setTimeout(() => void startAutoChat());
  return { ok: true };
});
route('DELETE', '/profiles/:id', ([, id]) => {
  if (id === host.profileId) throw new ApiError('Switch to another profile before deleting this one', 409);
  remove(profiles, id!);
  for (let i = commands.length - 1; i >= 0; i--) if (commands[i]!.profileId === id) commands.splice(i, 1);
});

// --- Commands ---

const ofProfile = () => commands.filter((c) => c.profileId === host.profileId);
const keywordTaken = (keyword: string, except?: string) => ofProfile().some((c) => c.id !== except && c.keyword.toLowerCase() === keyword.toLowerCase());
route('GET', '/commands', ofProfile);
route('GET', '/commands/macros', () => []);
route('GET', '/commands/game-actions', () => []);
route('POST', '/commands', (_, body: Omit<Command, 'id' | 'enabled'>) => {
  if (keywordTaken(body.keyword)) throw new ApiError('Keyword already exists', 409);
  const command = { ...body, id: newId(), enabled: true, profileId: host.profileId };
  commands.push(command);
  return command;
});
route('PATCH', '/commands/:id', ([, id], body: Partial<Command>) => {
  const command = find(commands, id!, 'Command');
  if (body.keyword && keywordTaken(body.keyword, command.id)) throw new ApiError('Keyword already exists', 409);
  // Lowercase, and kept in the chains that run it, as on the server.
  const before = command.keyword;
  if (body.keyword) body = { ...body, keyword: body.keyword.toLowerCase() };
  Object.assign(command, body);
  if (command.keyword !== before) {
    for (const c of commands) if (c.profileId === command.profileId && c.chain) c.chain = c.chain.map((s) => (s.keyword === before ? { ...s, keyword: command.keyword } : s));
  }
  return command;
});
route('DELETE', '/commands/:id', ([, id]) => remove(commands, id!));

// --- Actions ---

route('GET', '/actions', () => actions.filter((a) => a.profileId === null || a.profileId === host.profileId));
route('GET', '/actions/gifts', () => gifts);
route('POST', '/actions', (_, body: Partial<Action>) => {
  const created = { ...actions[0]!, text: null, sound: null, alertEffect: null, effect: null, giftName: null, ...body, id: newId() } as Action;
  actions.push(created);
  return created;
});
route('PATCH', '/actions/:id', ([, id], body: Partial<Action>) => {
  const action = find(actions, id!, 'Action');
  Object.assign(action, body);
  if (body.enabled === false) live.dropAlerts([action.id]);
  return action;
});
route('DELETE', '/actions/:id', ([, id]) => (live.dropAlerts([id!]), remove(actions, id!)));
route('POST', '/actions/:id/test', ([, id]) => {
  const action = find(actions, id!, 'Action');
  const alert = live.alertFor(action, { viewer: 'tester', gift: action.giftName ?? 'Rose', count: 1, coins: 1, diamonds: 1, total: action.likeStep ?? 1000, months: 1, text: 'hello' });
  if (!alert && !action.effect) throw new ApiError('This action has nothing to show. Give it text, a sound, a picture or video, or a screen or alert animation.', 400);
  if (alert) live.sendAlert(alert);
  if (action.effect) live.sendAlert({ type: 'effect', effect: action.effect === 'random' ? 'confetti' : action.effect, amount: action.effectAmount, speed: action.effectSpeed });
  return { alert, overlays: 1 };
});

// --- Goals, screens, media, companions ---

route('GET', '/goals', () => goals);
route('POST', '/goals', (_, body) => {
  const goal = { enabled: true, raise: null, ...body, id: newId() };
  goals.push(goal);
  return goal;
});
route('PATCH', '/goals/:id', ([, id], body) => Object.assign(find(goals, id!, 'Goal'), body));
route('DELETE', '/goals/:id', ([, id]) => remove(goals, id!));

route('GET', '/screens', () => screens);
route('POST', '/screens', (_, body: { name: string }) => {
  const screen: Screen = { ...screens[0]!, id: newId(), token: `demo.${newId()}`, name: body.name, main: false, widgets: [], linkStyles: {} };
  screens.push(screen);
  return screen;
});
route('POST', '/screens/:id/duplicate', ([, id], body: { name: string }) => {
  const source = find(screens, id!, 'Screen');
  if (screens.length >= 8) throw new ApiError('You can have up to 8 screens', 400);
  const screen: Screen = { ...structuredClone(source), id: newId(), token: `demo.${newId()}`, name: body.name.trim(), main: false, linkStyles: {} };
  screens.push(screen);
  return screen;
});
route('PATCH', '/screens/:id', ([, id], body: Partial<Screen>) => {
  const screen = Object.assign(find(screens, id!, 'Screen'), body);
  live.screenChanged(screen.token);
  return screen;
});
route('POST', '/screens/:id/new-link', ([, id]) => find(screens, id!, 'Screen'));
route('DELETE', '/screens/:id', ([, id]) => {
  if (find(screens, id!, 'Screen').main) throw new ApiError("The main screen can't be deleted", 400);
  remove(screens, id!);
});

route('GET', '/media', () => media);
route('PATCH', '/media/:id', ([, id], body: { name: string }) => Object.assign(find(media, id!, 'File'), body));
route('DELETE', '/media/hidden', () => undefined);
route('DELETE', '/media/:id', ([, id]) => remove(media, id!));

route('GET', '/companions', () => companions);
route('POST', '/companions/pairing-code', () => {
  throw SIGN_UP('Pairing a companion');
});
route('DELETE', '/companions/:id', ([, id]) => remove(companions, id!));

// --- Voice ---

route('GET', '/tts/options', () => ({ piperVoices: [], espeakVoices: ['en-us', 'en', 'es', 'fr', 'de', 'it', 'pt-br', 'ja', 'ko'], tiktokServerAccount: false }));
route('GET', '/tts/cloud-voices', () => {
  throw SIGN_UP('Cloud voices');
});
// The browser's own voice, the one engine that needs no server.
route('POST', '/tts/preview', (_, body: { text?: string }) => ({ kind: 'browser', text: body.text ?? 'Hello from Hyperion', voice: host.ttsVoice, effect: host.ttsEffect }));
route('POST', '/tts/skip', () => (live.skipSpeech(), { ok: true }));

// --- Live ---

route('GET', '/live/status', () => live.status());
route('POST', '/live/start', (_, body: { source: 'tiktok' | 'simulated' }) => {
  if (body.source === 'tiktok') throw SIGN_UP('Going live on TikTok');
  return live.start();
});
route('POST', '/live/stop', () => live.stop());
route('POST', '/live/simulate', (_, body: live.SimulateBody) => {
  if (!live.simulate(body)) throw new ApiError('Start a simulated session first', 409);
  return { ok: true };
});

route('GET', '/leaderboard', () => live.leaderboard());
route('DELETE', '/leaderboard', () => live.clearLeaderboard(false));
route('DELETE', '/leaderboard/points', () => live.clearLeaderboard(true));

// --- Analytics ---

// Summaries of the made-up past streams, newest first, each counting who was new as of then.
let summaries: Map<PastStream, StreamSummary> | null = null;
function summaryList() {
  if (!summaries) {
    summaries = new Map();
    const seen = new Set<string>();
    for (const s of pastStreams()) {
      summaries.set(s, summarize(s, seen));
      for (const v of viewersOf(s)) if (v.comments || v.gifts) seen.add(v.viewer);
    }
  }
  return [...summaries.values()].reverse();
}
const allStreams = () => {
  const current = live.currentStream();
  return current ? [current, ...[...pastStreams()].reverse()] : [...pastStreams()].reverse();
};
const summaryOf = (s: PastStream) => (summaryList(), summaries!.get(s) ?? summarize(s, new Set()));
function streamById(id: string) {
  const stream = id === 'latest' ? allStreams()[0] : allStreams().find((s) => s.meta.id === id);
  if (!stream) throw notFound('Stream');
  return stream;
}

route('GET', '/analytics/streams', summaryList);
route('GET', '/analytics/streams/:id', ([, id]) => {
  const stream = streamById(id!);
  return report(stream, summaryOf(stream));
});
route('GET', '/analytics/streams/:id/viewers', ([, id]) => viewersOf(streamById(id!)));

route('GET', '/analytics/overview', (_, __, query) => {
  const days = { '7d': 7, '30d': 30, '90d': 90 }[query.get('range') ?? '30d'];
  const from = days ? Date.now() - days * 86_400_000 : 0;
  const streams = pastStreams().filter((s) => s.meta.startedAt >= from);
  const taking = new Map<string, number>(); // interactor -> streams they took part in
  const viewers = new Set<string>();
  const activity = new Map<string, { day: number; hour: number; minutes: number; events: number }>();
  const slot = (at: number) => {
    const d = new Date(at);
    const key = `${d.getDay()}:${d.getHours()}`;
    let a = activity.get(key);
    if (!a) activity.set(key, (a = { day: d.getDay(), hour: d.getHours(), minutes: 0, events: 0 }));
    return a;
  };
  const presses: Record<string, number> = {};
  const giftTotals = new Map<string, AnalyticsOverview['topGifts'][number]>();
  let follows = 0;
  let coins = 0;
  for (const s of streams) {
    for (let t = s.meta.startedAt; t < s.meta.endedAt!; t += 60_000) slot(t).minutes++;
    for (const v of viewersOf(s)) {
      viewers.add(v.viewer);
      if (v.comments || v.gifts) taking.set(v.viewer, (taking.get(v.viewer) ?? 0) + 1);
    }
    for (const e of s.events) {
      if (e.kind === 'comment' || e.kind === 'gift') slot(e.at).events++;
      if (e.kind === 'command') presses[String(e.data.keyword)] = (presses[String(e.data.keyword)] ?? 0) + 1;
      if (e.kind === 'follow') follows++;
      if (e.kind === 'gift') {
        const count = Number(e.data.count);
        const g = giftTotals.get(String(e.data.gift)) ?? { gift: String(e.data.gift), count: 0, coins: 0, image: (e.data.image as string) ?? null };
        giftTotals.set(g.gift, g);
        g.count += count;
        g.coins += count * Number(e.data.diamonds);
        coins += count * Number(e.data.diamonds);
      }
    }
  }
  const counts = [...taking.values()];
  return {
    streams: streams.length,
    liveMs: streams.reduce((n, s) => n + s.meta.endedAt! - s.meta.startedAt, 0),
    viewers: viewers.size,
    interactors: taking.size,
    follows,
    coins,
    loyalty: { once: counts.filter((n) => n === 1).length, few: counts.filter((n) => n === 2 || n === 3).length, many: counts.filter((n) => n >= 4).length },
    activity: [...activity.values()],
    topCommands: Object.entries(presses)
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    topGifts: [...giftTotals.values()].sort((a, b) => b.coins - a.coins).slice(0, 8),
  } satisfies AnalyticsOverview;
});

// A page of what happened, newest first, with the filters the activity list and viewer panel use.
function pageOf(events: StreamEvent[], query: URLSearchParams, viewerId?: string) {
  const kinds = query.get('kinds')?.split(',');
  const search = (query.get('viewer') ?? query.get('search'))?.trim().toLowerCase();
  const n = (key: string) => (query.has(key) ? Number(query.get(key)) : undefined);
  const [before, after, from, to] = [n('before'), n('after'), n('from'), n('to')];
  const keyword = query.get('keyword');
  const gift = query.get('gift');
  const one = viewerId ?? query.get('viewerId');
  const found = events.filter(
    (e) =>
      (!kinds || kinds.includes(e.kind)) &&
      (!one || e.viewer === one) &&
      (!search || (query.has('search') ? String(e.data.text ?? '').toLowerCase().includes(search) : e.viewer?.toLowerCase().includes(search))) &&
      (before === undefined || e.id < before) &&
      (after === undefined || e.id > after) &&
      (from === undefined || e.at >= from) &&
      (to === undefined || e.at <= to) &&
      (!keyword || e.data.keyword === keyword) &&
      (!gift || e.data.gift === gift),
  );
  return found.reverse().slice(0, n('limit') ?? 100);
}

route('GET', '/analytics/activity', (_, __, query) => {
  const stream = streamById(query.get('stream') ?? 'latest');
  return {
    stream: { id: stream.meta.id, source: stream.meta.source, startedAt: stream.meta.startedAt, live: stream.meta.endedAt === null },
    events: pageOf(stream.events, query),
  };
});

route('GET', '/analytics/viewers/:viewer', ([, viewer]): ViewerProfile => {
  const name = decodeURIComponent(viewer!);
  const perStream = allStreams().flatMap((s) => {
    const v = viewersOf(s).find((x) => x.viewer === name);
    return v ? [{ stream: s, v }] : [];
  });
  const sum = (key: 'comments' | 'commands' | 'gifts' | 'coins') => perStream.reduce((n, p) => n + p.v[key], 0);
  const presses: Record<string, number> = {};
  for (const { stream } of perStream) for (const e of stream.events) if (e.kind === 'command' && e.viewer === name) presses[String(e.data.keyword)] = (presses[String(e.data.keyword)] ?? 0) + 1;
  const entry = live.leaderboard().find((e) => e.viewer === name);
  const xp = entry?.xp ?? sum('commands') + sum('coins');
  return {
    viewer: name,
    name: null,
    avatar: null,
    firstSeen: perStream.at(-1)?.v.firstAt ?? null,
    lastSeen: perStream[0]?.v.lastAt ?? null,
    streams: perStream.length,
    comments: sum('comments'),
    commands: sum('commands'),
    gifts: sum('gifts'),
    diamonds: sum('coins'),
    xp,
    points: entry?.points ?? 0,
    level: levelForXp(xp),
    topCommands: Object.entries(presses)
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    perStream: perStream.map(({ stream, v }) => ({
      streamId: stream.meta.id,
      startedAt: stream.meta.startedAt,
      source: stream.meta.source,
      tiktokUsername: stream.meta.tiktokUsername,
      comments: v.comments,
      commands: v.commands,
      diamonds: v.coins,
    })),
  };
});
route('GET', '/analytics/viewers/:viewer/activity', ([, viewer], _, query) => {
  const name = decodeURIComponent(viewer!);
  const streamId = query.get('stream');
  const events = allStreams()
    .filter((s) => !streamId || s.meta.id === streamId)
    .reverse()
    .flatMap((s) => s.events.filter((e) => e.viewer === name).map((e) => ({ ...e, streamId: s.meta.id, streamStartedAt: s.meta.startedAt })));
  return pageOf(events, query, name);
});
