import {
  levelForXp,
  pickEffect,
  QUEUE_JOIN,
  type LeaderboardEntry,
  type ModeState,
  type ServerToOverlay,
  type StreamEvent,
  type StreamStats,
} from '@hyperion/shared';
import type { Action, LiveStatus } from '../api';
import { actions, commands, eventId, giftNamed, goals, host, media, screens, type PastStream, startingLeaderboard, newId } from './data';
import { DEMO_CHANNEL, type DemoEnvelope, type DemoHello } from './socket';

// The demo's live stream, played in this tab: what the server's session manager, crowd modes and actions do for a
// real one, cut down to what shows on the dashboard and overlay. Test mode's chat (the Test as a viewer form and auto
// chat) reaches it through the demo API's /live/simulate, and everything it does goes out over the demo channel.

const me = Math.random().toString(36).slice(2);
const channel = new BroadcastChannel(DEMO_CHANNEL);
// Only the tab that started the stream answers sockets. The activity window opened from the demo loads its own copy of
// the demo API, which mustn't answer for it.
let claimed = false;
const post = (envelope: Omit<Extract<DemoEnvelope, { type: 'message' }>, 'type' | 'from'>) => channel.postMessage({ type: 'message', from: me, ...envelope } satisfies DemoEnvelope);
const send = (message: ServerToOverlay) => post({ message });

export type SimulateBody =
  | { viewer: string; text: string }
  | { viewer: string; gift: string; count?: number; diamonds?: number }
  | { viewer: string; event: 'follow' | 'share' | 'join' | 'like' | 'subscribe' | 'emote'; count?: number }
  | { viewers: number; topGifters?: string[] };

const board: Map<string, LeaderboardEntry> = startingLeaderboard();
let session: PastStream | null = null; // the stream on now
let last: PastStream | null = null; // the last test, for its recap
let stats: StreamStats = emptyStats();
let pressed: Record<string, number> = {};
let mode: ModeState = { mode: 'anarchy' };
let modeTimer: ReturnType<typeof setTimeout> | undefined;
let votes = new Map<string, string>(); // democracy: viewer -> keyword; raffle: entrant -> keyword
const lastPress = new Map<string, number>();
const lastAction = new Map<string, number>();
const lastSpoke = new Map<string, number>();
const seen = new Set<string>(); // viewers active this stream, for first_activity
const interactors = new Set<string>();
let leaderboardTimer: ReturnType<typeof setTimeout> | undefined;

function emptyStats(): StreamStats {
  return { likes: 0, follows: 0, shares: 0, diamonds: 0, gifts: 0, subscriptions: 0, viewers: 0, peakViewers: 0, interactors: 0, topGift: null, topStreak: null, lastFollower: null, lastGifter: null, avatars: {}, goals: [] };
}

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (all, key: string) => String(values[key] ?? all));
const activeCommands = () => commands.filter((c) => c.profileId === host.profileId && c.enabled);
const activeActions = () => actions.filter((a) => a.enabled && (a.profileId === null || a.profileId === host.profileId));

function record(kind: StreamEvent['kind'], viewer: string | null, data: Record<string, unknown> = {}) {
  session?.events.push({ id: eventId(), at: Date.now(), kind, viewer, data });
}

// Goals, raised as they're reached, the way the server's are for the rest of a stream.
function goalStats(): StreamStats['goals'] {
  const metric = { likes: stats.likes, follows: stats.follows, shares: stats.shares, diamonds: stats.diamonds, subscriptions: stats.subscriptions };
  return goals
    .filter((g) => g.enabled)
    .map((g) => {
      const current = metric[g.metric];
      let target = g.target;
      for (let i = 0; g.raise && current >= target && i < 50; i++) {
        const next = g.raise.kind === 'times' ? target * g.raise.by : g.raise.kind === 'plus' ? target + g.raise.by : Math.max(target, g.raise.by);
        if (next <= target) break;
        target = next;
      }
      return { id: g.id, name: g.name, metric: g.metric, target, current };
    });
}
function sendStats() {
  stats = { ...stats, interactors: interactors.size, goals: goalStats() };
  send({ type: 'stats', stats });
}

const topEntries = () => [...board.values()].sort((a, b) => b.xp - a.xp).slice(0, 20);
export const leaderboard = topEntries;
function sendLeaderboard(now = false) {
  if (now) return (clearTimeout(leaderboardTimer), (leaderboardTimer = undefined), send({ type: 'leaderboard', entries: topEntries(), progression: host.progression }));
  leaderboardTimer ??= setTimeout(() => sendLeaderboard(true), 500);
}
export function clearLeaderboard(pointsOnly: boolean) {
  if (pointsOnly) board.forEach((e) => (e.points = 0));
  else board.clear();
  sendLeaderboard(true);
}

function entry(viewer: string) {
  let e = board.get(viewer);
  if (!e) board.set(viewer, (e = { viewer, commands: 0, gifts: 0, coins: 0, xp: 0, points: 0, avatar: null, name: null }));
  return e;
}
function addXp(viewer: string, xp: number) {
  const e = entry(viewer);
  const before = levelForXp(e.xp);
  e.xp += xp;
  const after = levelForXp(e.xp);
  if (host.progression && after > before) {
    send({ type: 'levelUp', viewer, level: after });
    record('level', viewer, { level: after });
  }
  sendLeaderboard();
}

// A key press, from chat, a vote, a raffle draw or an action. Only chat's own presses wait out the cooldown.
function press(viewer: string | null, keyword: string, via: 'chat' | 'vote' | 'action') {
  const command = activeCommands().find((c) => c.keyword.toLowerCase() === keyword.toLowerCase());
  if (!command) return;
  const now = Date.now();
  if (via === 'chat' && viewer) {
    if (now - (lastPress.get(command.id) ?? 0) < command.cooldownMs) return record('refused', viewer, { keyword: command.keyword, reason: 'cooldown' });
    if (host.levelGating && levelForXp(entry(viewer).xp) < command.minLevel) return record('refused', viewer, { keyword: command.keyword, reason: 'level' });
  }
  lastPress.set(command.id, now);
  pressed = { ...pressed, [command.keyword]: (pressed[command.keyword] ?? 0) + 1 };
  record('command', viewer, { keyword: command.keyword, via });
  const name = viewer ?? 'chat';
  send({ type: 'command', viewer: name, keyword: command.keyword, at: now, ...(host.progression && viewer && { level: levelForXp(entry(viewer).xp) }) });
  if (viewer) {
    entry(viewer).commands++;
    addXp(viewer, 1);
  }
}

// --- Crowd modes ---

function setModeState(state: ModeState) {
  mode = state;
  if (session) send({ type: 'mode', state, serverNow: Date.now() });
}
export function resetMode() {
  clearTimeout(modeTimer);
  votes = new Map();
  const m = host.mode;
  setModeState(
    m === 'democracy'
      ? { mode: 'democracy', tally: [], endsAt: null, lastCommand: null, lastVotes: null, lastDrawAt: null }
      : m === 'queue'
        ? { mode: 'queue', viewer: null, endsAt: null, queue: [] }
        : m === 'raffle'
          ? { mode: 'raffle', entrants: 0, endsAt: null, lastCommand: null, lastDrawAt: null }
          : { mode: m },
  );
}

const tally = () => {
  const counts = new Map<string, number>();
  votes.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
  return [...counts].map(([keyword, n]) => ({ keyword, votes: n })).sort((a, b) => b.votes - a.votes);
};

function vote(viewer: string, keyword: string) {
  if (mode.mode !== 'democracy') return;
  votes.set(viewer, keyword);
  const endsAt = mode.endsAt ?? Date.now() + host.voteWindowMs;
  if (!mode.endsAt) {
    modeTimer = setTimeout(() => {
      if (mode.mode !== 'democracy') return;
      const [winner] = tally();
      votes = new Map();
      if (winner) press(null, winner.keyword, 'vote');
      setModeState({ ...mode, tally: [], endsAt: null, lastCommand: winner?.keyword ?? null, lastVotes: winner?.votes ?? null, lastDrawAt: Date.now() });
    }, host.voteWindowMs);
  }
  setModeState({ ...mode, tally: tally(), endsAt });
}

function enter(viewer: string, keyword: string) {
  if (mode.mode !== 'raffle') return;
  votes.set(viewer, keyword);
  const endsAt = mode.endsAt ?? Date.now() + host.raffleMs;
  if (!mode.endsAt) {
    modeTimer = setTimeout(() => {
      if (mode.mode !== 'raffle') return;
      const entries = [...votes];
      votes = new Map();
      const drawn = entries[Math.floor(Math.random() * entries.length)];
      if (drawn) press(drawn[0], drawn[1], 'vote');
      setModeState({ mode: 'raffle', entrants: 0, endsAt: null, lastCommand: drawn?.[1] ?? null, lastDrawAt: Date.now() });
    }, host.raffleMs);
  }
  setModeState({ ...mode, entrants: votes.size, endsAt });
}

function nextTurn() {
  if (mode.mode !== 'queue') return;
  clearTimeout(modeTimer);
  const [viewer = null, ...queue] = mode.queue;
  if (viewer) {
    record('turn', viewer, { waitedMs: 0 });
    modeTimer = setTimeout(nextTurn, host.turnMs);
  }
  setModeState({ mode: 'queue', viewer, endsAt: viewer ? Date.now() + host.turnMs : null, queue });
}
function join(viewer: string) {
  if (mode.mode !== 'queue' || mode.viewer === viewer || mode.queue.includes(viewer)) return;
  record('queue_join', viewer);
  setModeState({ ...mode, queue: [...mode.queue, viewer] });
  if (!mode.viewer) nextTurn();
}

function chatCommand(viewer: string, text: string) {
  const word = text.trim().toLowerCase();
  if (mode.mode === 'queue' && word === QUEUE_JOIN) return join(viewer);
  const command = activeCommands().find((c) => c.keyword.toLowerCase() === word);
  if (!command) return;
  if (mode.mode === 'anarchy') press(viewer, command.keyword, 'chat');
  else if (mode.mode === 'democracy') vote(viewer, command.keyword);
  else if (mode.mode === 'raffle') enter(viewer, command.keyword);
  else if (mode.mode === 'queue' && mode.viewer === viewer) press(viewer, command.keyword, 'chat');
  // Gift mode: only gifts' actions press keys.
}

// --- Actions ---

export function alertFor(a: Action, values: Record<string, string | number>): Extract<ServerToOverlay, { type: 'alert' }> | null {
  const text = a.text ? fill(a.text, values) : '';
  if (!text && !a.sound && !a.soundMediaId && !a.mediaId && !a.alertEffect) return null;
  const file = a.mediaId ? media.find((m) => m.id === a.mediaId) : undefined;
  const style = a.alertStyle ?? (a.useAlertStyle2 ? (host.alertStyle2 ?? host.alertStyle) : host.alertStyle);
  return {
    type: 'alert',
    action: a.id,
    text,
    sound: a.sound,
    speech: a.speak && text ? { kind: 'browser', text, voice: host.ttsVoice } : null,
    ...(a.soundMediaId && { soundFile: a.soundMediaId }),
    ...(a.sound && host.soundVolumes[a.sound] !== undefined && { soundVolume: host.soundVolumes[a.sound] }),
    ...(file && { media: { id: file.id, kind: file.kind } }),
    durationMs: a.durationMs,
    ...(a.screenId && { screen: a.screenId }),
    ...(a.alertX !== null && a.alertY !== null && { pos: { x: a.alertX, y: a.alertY } }),
    scale: a.alertScale,
    ...(style && { style }),
    ...(a.alertEffect && { fx: { effect: a.alertEffect, emoji: a.alertEmoji, shape: a.alertShape, color: a.alertEffectColor, amount: a.alertEffectAmount, speed: a.alertEffectSpeed } }),
  };
}

function run(list: { action: Action; alert?: boolean; effect?: boolean }[], viewer: string, values: Record<string, string | number>, count = 1) {
  const now = Date.now();
  for (const { action: a, alert = true, effect = true } of list) {
    if (a.audience === 'viewer' && a.audienceViewer?.toLowerCase() !== viewer.toLowerCase()) continue;
    if (now - (lastAction.get(a.id) ?? -Infinity) < a.cooldownMs) continue;
    if (now - (lastAction.get(`${a.id}:${viewer}`) ?? -Infinity) < a.viewerCooldownMs) continue;
    lastAction.set(a.id, now);
    lastAction.set(`${a.id}:${viewer}`, now);
    const shown = alert ? alertFor(a, values) : null;
    if (shown) send(shown);
    if (effect && a.effect) send({ type: 'effect', effect: pickEffect(a.effect), amount: a.effectAmount, speed: a.effectSpeed, ...(a.effectColor && { color: a.effectColor }), ...(a.screenId && { screen: a.screenId }) });
    const key = a.keyCommandId && commands.find((c) => c.id === a.keyCommandId);
    if (key) for (let i = 0; i < (a.repeatWithCount ? Math.min(count, 10) : 1); i++) setTimeout(() => press(viewer, key.keyword, 'action'), i * 250);
  }
}
const on = (trigger: Action['trigger']) => activeActions().filter((a) => a.trigger === trigger).map((action) => ({ action }));

// --- Viewer events ---

function speak(viewer: string, text: string) {
  const { ttsMode, ttsPrefix } = host;
  let said: string | null = null;
  if (ttsMode === 'all' || (ttsMode === 'auto' && stats.viewers <= host.ttsAutoMaxViewers)) said = text;
  if (ttsMode === 'prefix' && text.toLowerCase().startsWith(`${ttsPrefix.toLowerCase()} `)) said = text.slice(ttsPrefix.length + 1);
  if (!said || Date.now() - (lastSpoke.get(viewer) ?? -Infinity) < host.ttsCooldownMs) return;
  lastSpoke.set(viewer, Date.now());
  const line = fill(host.ttsTemplate, { viewer, text: said.slice(0, host.ttsMaxLength) });
  send({ type: 'tts', viewer, text: said, speech: { kind: 'browser', text: line, voice: host.ttsVoice, effect: host.ttsEffect } });
}

function handle(body: SimulateBody) {
  if ('viewers' in body) {
    stats = { ...stats, viewers: body.viewers, peakViewers: Math.max(stats.peakViewers, body.viewers) };
    if (session) session.meta.peakViewers = stats.peakViewers;
    return sendStats();
  }
  const { viewer } = body;
  const first = !('event' in body && body.event === 'join') && !seen.has(viewer);
  if (first) seen.add(viewer);
  const firstActions = first ? on('first_activity') : [];
  const values = { viewer };

  if ('text' in body) {
    interactors.add(viewer);
    record('comment', viewer, { text: body.text });
    send({ type: 'chat', viewer, text: body.text });
    chatCommand(viewer, body.text);
    speak(viewer, body.text);
    const word = body.text.trim().toLowerCase();
    run([...firstActions, ...on('command').filter(({ action: a }) => a.command && (word === a.command.toLowerCase() || word.startsWith(`${a.command.toLowerCase()} `)))], viewer, values);
  } else if ('gift' in body) {
    interactors.add(viewer);
    const count = body.count ?? 1;
    const gift = giftNamed(body.gift);
    const name = gift?.name ?? body.gift;
    const each = gift?.coins ?? body.diamonds ?? 1;
    const coins = count * each;
    const image = gift?.image ?? undefined;
    record('gift', viewer, { gift: name, count, diamonds: each, image });
    send({ type: 'gift', viewer, gift: name, count, diamonds: coins });
    stats = {
      ...stats,
      gifts: stats.gifts + count,
      diamonds: stats.diamonds + coins,
      lastGifter: { viewer, gift: name, count, image },
      topGift: !stats.topGift || coins > stats.topGift.diamonds ? { viewer, gift: name, diamonds: coins, image } : stats.topGift,
      topStreak: !stats.topStreak || count > stats.topStreak.count ? { viewer, gift: name, count, image } : stats.topStreak,
    };
    const e = entry(viewer);
    e.gifts += count;
    e.coins += coins;
    addXp(viewer, Math.max(coins, 1));
    // As on the server: an alert for this exact gift replaces the any-gift alerts, and its animation theirs.
    const candidates = on('gift').filter(({ action: a }) => (a.giftName === null || a.giftName.toLowerCase() === name.toLowerCase()) && (a.minDiamonds === null || coins >= a.minDiamonds));
    const specific = (test: (a: Action) => boolean) => candidates.some(({ action: a }) => a.giftName !== null && test(a));
    const specificAlert = specific((a) => !!(a.text || a.sound || a.soundMediaId || a.mediaId || a.alertEffect));
    const specificEffect = specific((a) => !!a.effect);
    run(
      [...firstActions, ...candidates.map(({ action: a }) => ({ action: a, alert: !(specificAlert && a.giftName === null), effect: !(specificEffect && a.giftName === null) }))],
      viewer,
      { ...values, gift: name, count, coins, diamonds: coins },
      count,
    );
  } else {
    const count = body.count ?? 1;
    switch (body.event) {
      case 'follow':
        record('follow', viewer);
        stats = { ...stats, follows: stats.follows + 1, lastFollower: viewer };
        break;
      case 'share':
        record('share', viewer);
        stats = { ...stats, shares: stats.shares + 1 };
        break;
      case 'join':
        record('join', viewer);
        break;
      case 'subscribe':
        record('subscribe', viewer, { months: count });
        stats = { ...stats, subscriptions: stats.subscriptions + 1 };
        break;
      case 'emote':
        record('emote', viewer, { emoteId: 'demo' });
        break;
      case 'like': {
        record('like', viewer, { count });
        const before = stats.likes;
        stats = { ...stats, likes: before + count };
        const passed = on('likes').filter(({ action: a }) => a.likeStep && Math.floor(stats.likes / a.likeStep) > Math.floor(before / a.likeStep));
        for (const p of passed) run([p], viewer, { ...values, count, total: Math.floor(stats.likes / p.action.likeStep!) * p.action.likeStep! });
        run(firstActions, viewer, values);
        return sendStats();
      }
    }
    run([...firstActions, ...on(body.event === 'subscribe' ? 'subscribe' : body.event)], viewer, { ...values, months: count });
  }
  sendStats();
}

// --- Going live ---

export const status = (): LiveStatus =>
  session ? { live: true, source: 'simulated', mode: host.mode, startedAt: session.meta.startedAt, companionsOnline: 1 } : { live: false, companionsOnline: 1 };

export function start() {
  if (!claimed) (claimed = true), channel.postMessage({ type: 'hello?', from: me } satisfies DemoEnvelope);
  if (session) return status();
  session = {
    meta: { id: newId(), source: 'simulated', profileName: host.profileName, tiktokUsername: host.tiktokUsername, startedAt: Date.now(), endedAt: null, peakViewers: 0 },
    events: [],
    mode: host.mode,
  };
  stats = emptyStats();
  pressed = {};
  seen.clear();
  interactors.clear();
  send({ type: 'live', state: 'started' });
  resetMode();
  sendStats();
  sendLeaderboard(true);
  return status();
}

export function stop() {
  if (!session) return status();
  clearTimeout(modeTimer);
  session.meta.endedAt = Date.now();
  last = session;
  session = null;
  send({ type: 'live', state: 'stopped' });
  return status();
}

export function simulate(body: SimulateBody) {
  if (!session) return false;
  handle(body);
  return true;
}

// The stream on now, or else the last test, for "latest" in analytics.
export const currentStream = () => session ?? last;

export const sendAlert = (alert: ServerToOverlay) => send(alert);
export const screenChanged = (token: string) => {
  const screen = screens.find((s) => s.token === token);
  if (screen) post({ token, message: { type: 'screen', screen } });
};
export const dropAlerts = (ids: string[]) => send({ type: 'dropAlerts', actions: ids });
export const speechVolume = () => send({ type: 'speechVolume', volume: host.ttsVolume });
export const skipSpeech = () => send({ type: 'skipSpeech' });

// A socket that just opened gets the state so far, as the server sends it on connect.
channel.onmessage = (event: MessageEvent<DemoEnvelope | DemoHello>) => {
  const hello = event.data;
  if (hello.type !== 'hello' || !claimed) return;
  const to = (message: ServerToOverlay) => post({ socket: hello.socket, message });
  const screen = screens.find((s) => s.token === hello.token);
  if (screen) to({ type: 'screen', screen });
  to({ type: 'speechVolume', volume: host.ttsVolume });
  to({ type: 'leaderboard', entries: topEntries(), progression: host.progression });
  if (!session) return;
  to({ type: 'live', state: 'started' });
  to({ type: 'mode', state: mode, serverNow: Date.now() });
  to({ type: 'stats', stats });
  if (hello.dashboard) to({ type: 'presses', counts: pressed });
};
