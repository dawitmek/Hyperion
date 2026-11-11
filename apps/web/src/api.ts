import { isDemo } from './router';

// Thin JSON client for the Hyperion API. Same origin, so the session cookie rides along. The demo answers in the
// browser instead (demo/api.ts), loaded only when it's used.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  if (isDemo()) return (await import('./demo/api')).demoApi<T>(method, path, body);
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  // The session ended (expired, or logged out in another tab): back to login, then back here afterwards.
  if (res.status === 401 && !path.startsWith('/auth/') && location.pathname.startsWith('/dashboard')) {
    location.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? data.message ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

import type {
  ActionEffect,
  AlertEffect,
  AlertShape,
  ChainStep,
  LiveLayout,
  ActionTrigger,
  AlertPosition,
  AlertSound,
  AlertStyle,
  Audience,
  Goal,
  CloudProvider,
  LeaderboardEntry,
  MediaItem,
  Mode,
  OverlayScreen,
  Speech,
  TtsEngine,
  TtsMode,
  UiMode,
  UiTheme,
  UiThemeStyle,
  VoiceEffect,
} from '@hyperion/shared';

export type { ActionTrigger, AlertPosition, AlertSound, Audience, Goal, CloudProvider, LeaderboardEntry, MediaItem, Mode, Speech, TtsEngine, TtsMode, VoiceEffect };

// Sends a file as the raw request body; the server works out what it is.
export async function uploadMedia(file: File): Promise<MediaItem> {
  if (isDemo()) throw new ApiError("Uploading files isn't part of the demo. Sign up free to use it.", 403);
  const res = await fetch(`/api/media?name=${encodeURIComponent(file.name.replace(/\.[^.]+$/, '') || file.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = res.status === 413 && !data.error ? 'That file is over 10 MB' : (data.error ?? `Upload failed (${res.status})`);
    throw new ApiError(message, res.status);
  }
  return data as MediaItem;
}

export interface Host {
  id: string;
  email: string;
  tiktokUsername: string | null;
  overlayToken: string;
  actionsPerSecond: number;
  progression: boolean;
  levelGating: boolean;
  points: boolean;
  pointsPerChat: number;
  pointsPerDiamond: number;
  pointsPerFollow: number;
  pointsPerShare: number;
  pointsCheck: boolean;
  ttsMode: TtsMode;
  ttsPrefix: string;
  ttsMaxLength: number;
  ttsMaxWords: number;
  ttsUnlockGifts: string[];
  ttsUnlockMinutes: number;
  ttsTemplate: string;
  ttsCommands: boolean;
  ttsCommandTemplate: string;
  ttsCooldownMs: number;
  ttsAutoMaxViewers: number;
  ttsMinLevel: number;
  ttsBlockedWords: string;
  ttsVoice: string | null;
  ttsEngine: TtsEngine;
  ttsEspeakVoice: string;
  ttsPiperVoice: string | null;
  ttsPiperSpeaker: number | null;
  ttsEffect: VoiceEffect;
  ttsVolume: number; // percent
  ttsCloudProvider: CloudProvider | null;
  ttsCloudKeySet: boolean;
  ttsCloudRegion: string | null;
  ttsCloudVoice: string | null;
  ttsTiktokVoice: string | null;
  ttsTiktokConnected: boolean;
  uiTheme: UiTheme;
  uiThemeStyle: UiThemeStyle;
  uiMode: UiMode;
  liveLayout: LiveLayout | null; // the Live page's cards; null: DEFAULT_LIVE_LAYOUT
  streamRecap: boolean; // sum up a stream when it ends
  alertStyle: AlertStyle | null; // the look of alerts whose action has none; null: DEFAULT_ALERT_STYLE
  alertStyle2: AlertStyle | null; // a second look actions can share; null: same as alertStyle
  hiddenSounds: AlertSound[]; // built-in sounds the host removed
  soundVolumes: Record<string, number>; // percent, by built-in sound or built-in file id; missing: 100
  // Active profile
  profileId: string;
  profileName: string;
  mode: Mode;
  voteWindowMs: number;
  turnMs: number;
  raffleMs: number;
  giftBoosts: boolean;
}

export interface Command {
  id: string;
  keyword: string;
  key: string;
  macro: string | null;
  gameAction: string | null;
  chain: ChainStep[] | null;
  holdMs: number;
  cooldownMs: number;
  enabled: boolean;
  minLevel: number;
  cost: number;
}

export interface Action {
  id: string;
  profileId: string | null; // null: every profile
  name: string;
  enabled: boolean;
  trigger: ActionTrigger;
  giftName: string | null;
  minDiamonds: number | null;
  likeStep: number | null;
  likeGrowth: number | null; // each target this many times the last; null: every likeStep
  command: string | null;
  goalId: string | null;
  audience: Audience;
  audienceViewer: string | null;
  cooldownMs: number;
  viewerCooldownMs: number;
  random: boolean;
  text: string | null;
  sound: AlertSound | null;
  soundMediaId: string | null;
  mediaId: string | null;
  speak: boolean;
  durationMs: number;
  effect: ActionEffect | null;
  effectAmount: number;
  effectColor: string | null; // null: the animation's own colors
  effectSpeed: number; // percent of normal
  alertEffect: AlertEffect | null;
  alertEmoji: string;
  alertShape: AlertShape;
  alertEffectColor: string | null; // null: the alert look's color
  alertEffectAmount: number;
  alertEffectSpeed: number; // percent of normal
  alertX: number | null; // with alertY: where the alert's middle sits, in percent; null: the screen's alert position
  alertY: number | null;
  alertScale: number; // percent
  alertStyle: AlertStyle | null; // null: DEFAULT_ALERT_STYLE
  useAlertStyle2: boolean; // with no alertStyle: the host's second look
  keyCommandId: string | null;
  repeatWithCount: boolean;
  points: number;
  screenId: string | null;
}

export type Screen = OverlayScreen & { token: string };

export interface Profile {
  id: string;
  name: string;
  gameProcess: string | null;
  active: boolean;
}

export interface Companion {
  id: string;
  name: string;
  lastSeenAt: string | null;
  hostname: string | null; // the PC's own name, as the companion reports it
  platform: string | null;
}

export interface LiveStatus {
  live: boolean;
  source?: 'tiktok' | 'simulated';
  mode?: Mode;
  startedAt?: number; // server clock, ms
  companionsOnline: number;
}
