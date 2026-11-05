// The contract between server, web, and companion. Bump PROTOCOL_VERSION on breaking changes.
export const PROTOCOL_VERSION = 1;

export * from './keys.js';
export * from './games.js';

// What the platform says about a viewer's relationship to the host, when it says anything.
export const BADGES = ['follower', 'subscriber', 'moderator'] as const;
export type Badge = (typeof BADGES)[number];

// Platform-neutral events produced by a platform adapter (TikTok first). `badges` is absent when the
// platform didn't say, which is not the same as an empty list.
export type ViewerEvent = (
  | { kind: 'comment'; text: string }
  | { kind: 'gift'; giftId: number; giftName: string; count: number; diamonds: number; image?: string } // diamonds per gift; image: TikTok's picture of it
  | { kind: 'like'; count: number }
  | { kind: 'follow' }
  | { kind: 'share' }
  | { kind: 'join' }
  | { kind: 'subscribe'; months: number }
  | { kind: 'emote'; emoteId: string } // a subscriber sticker sent in chat
) & { viewerId: string; at: number; badges?: Badge[]; avatar?: string; name?: string }; // avatar: a link to their profile picture; name: their display name

// An uploaded file for alerts.
export const MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MAX_MEDIA_TOTAL_BYTES = 10 * 1024 * 1024; // per host
export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  mime: string;
  size: number;
  createdAt: number;
  builtIn: boolean; // shared by every host, stored once; removing it only hides it for this host
}
// Files every host gets, from apps/server/assets/library.
export const BUILT_IN_MEDIA = [
  { file: 'dance.gif', name: 'Dance', kind: 'image' },
  { file: 'luffy-gear-5.gif', name: 'Luffy Gear 5', kind: 'image' },
  { file: 'scuba-cat.gif', name: 'Scuba Cat', kind: 'image' },
  { file: 'woah-look-at-that-look.gif', name: 'Woah, look at that look', kind: 'image' },
  { file: 'balls-in-your-jaws.mp3', name: 'Balls in your jaws', kind: 'audio' },
  { file: 'giga-chad.mp3', name: 'Giga Chad', kind: 'audio' },
  { file: 'heavenly-music.mp3', name: 'Heavenly music', kind: 'audio' },
  { file: 'i-just-hit-the-jackpot.mp3', name: 'I just hit the jackpot', kind: 'audio' },
  { file: 'raaaah.mp3', name: 'Raaaah', kind: 'audio' },
  { file: 'sad-meow-song.mp3', name: 'Sad meow song', kind: 'audio' },
  { file: 'talking-ben-yes.mp3', name: 'Talking Ben: yes', kind: 'audio' },
] as const;

// An overlay URL and what it shows. Every host has a main screen (their original overlay address) and can add more,
// to put alerts and widgets in different places. Only screens with audio play sounds and voices.
export const ALERT_POSITIONS = ['top', 'middle', 'bottom'] as const;
export type AlertPosition = (typeof ALERT_POSITIONS)[number];
// Widgets a screen can add, each pinned to a spot on the screen. Widgets in the same spot stack.
export const WIDGET_TYPES = ['goals', 'top_gift', 'top_streak', 'last_follower', 'last_gifter', 'stats', 'chat', 'coin_jar', 'level_ups', 'message'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
export const WIDGET_SPOTS = ['top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export type WidgetSpot = (typeof WIDGET_SPOTS)[number];
// Where a goal's own widget goes when the goal is made.
export const GOAL_WIDGET_SPOT: WidgetSpot = 'left';
export interface ScreenWidget {
  type: WidgetType;
  spot: WidgetSpot;
  minDiamonds?: number; // coin jar: diamonds that fill the jar
  raise?: GoalRaise; // coin jar: where its target goes once it's full, and it starts filling again; without it, it stays full
  shine?: false; // coin jar: without the glass's gleam and the shine after each gift
  text?: string; // message: what it says
  goalId?: string; // goals: just this goal; without it, every goal
  pos?: { x: number; y: number }; // placed by hand instead of in its spot: the top-left corner, in percent of the screen
  style?: WidgetStyle; // without it, the widget's own colors
  size?: number; // percent, on top of the screen's size (WIDGET_STYLE_LIMITS.size); without it, 100
}
// A widget's look. Colors are #rrggbb.
export interface WidgetStyle {
  background: string;
  opacity: number; // of the background, percent
  textColor: string;
  accent: string; // icons, numbers and bars
  borderColor: string;
  borderWidth: number; // px; 0 for none
  radius: number; // px
  font: AlertFont;
  size: number; // percent, on top of the screen's size. A Widget link's; a widget on a screen has its own size instead
}
export const WIDGET_STYLE_LIMITS = { opacity: [0, 100], borderWidth: [0, 8], radius: [0, 40], size: [50, 200] } as const;
export const WIDGET_PRESETS: { id: string; label: string; style: WidgetStyle }[] = [
  { id: 'midnight', label: 'Midnight', style: { background: '#12141f', opacity: 90, textColor: '#ffffff', accent: '#a3a6ff', borderColor: '#ffffff', borderWidth: 0, radius: 16, font: 'geist', size: 100 } },
  { id: 'daylight', label: 'Daylight', style: { background: '#ffffff', opacity: 95, textColor: '#14161f', accent: '#4f46e5', borderColor: '#14161f', borderWidth: 0, radius: 16, font: 'geist', size: 100 } },
  { id: 'neon', label: 'Neon', style: { background: '#0b0221', opacity: 88, textColor: '#f5f3ff', accent: '#22f0d6', borderColor: '#ff2bd6', borderWidth: 2, radius: 10, font: 'oxanium', size: 100 } },
  { id: 'sunset', label: 'Sunset', style: { background: '#7c1d3f', opacity: 92, textColor: '#fff4e6', accent: '#ffc35a', borderColor: '#ffc35a', borderWidth: 1, radius: 22, font: 'geist', size: 100 } },
  { id: 'transparent', label: 'Transparent', style: { background: '#000000', opacity: 0, textColor: '#ffffff', accent: '#ffc35a', borderColor: '#ffffff', borderWidth: 0, radius: 16, font: 'geist', size: 100 } },
];
// Tells a screen's widgets apart: a goal's own widget by its goal, the rest by type.
export const widgetKey = (w: Pick<ScreenWidget, 'type' | 'goalId'>) => (w.goalId ? `goal:${w.goalId}` : w.type);
export const MAX_WIDGETS = 12;
export const DEFAULT_MESSAGE = 'Type a command in chat to play!';
export const MAX_MESSAGE_LENGTH = 200;
export const MIN_LEADERBOARD_SIZE = 3;
export const MAX_LEADERBOARD_SIZE = 15;

// What a goal counts, over the current stream.
export const GOAL_METRICS = ['likes', 'follows', 'shares', 'diamonds', 'subscriptions'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
// What a reached goal does next, for the rest of that stream. `times` and `plus` keep going each time it's reached;
// `to` moves it once.
export type GoalRaise = { kind: 'times' | 'plus' | 'to'; by: number };
export interface Goal {
  id: string;
  name: string;
  metric: GoalMetric;
  target: number; // where it starts each stream
  enabled: boolean;
  raise: GoalRaise | null; // null: it stays reached
}

// The current stream's totals and highlights, for widgets. Sent whenever something changes.
export interface StreamStats {
  likes: number;
  follows: number;
  shares: number;
  diamonds: number;
  gifts: number;
  subscriptions: number;
  viewers: number;
  peakViewers: number;
  interactors: number; // viewers who chatted or gifted
  topGift: { viewer: string; gift: string; diamonds: number; image?: string } | null; // the most valuable single gift (streak included)
  topStreak: { viewer: string; gift: string; count: number; image?: string } | null;
  lastFollower: string | null;
  lastGifter: { viewer: string; gift: string; count: number; image?: string } | null;
  avatars: Record<string, string>; // profile picture links of the viewers above, for those who have one
  goals: { id: string; name: string; metric: GoalMetric; target: number; current: number }[];
}

// What a screen is laid out for: a landscape stream, or a portrait one, as TikTok shows it on phones.
export const SCREEN_LAYOUTS = ['desktop', 'phone'] as const;
export type ScreenLayout = (typeof SCREEN_LAYOUTS)[number];
export interface OverlayScreen {
  id: string;
  name: string;
  main: boolean;
  alerts: boolean;
  feed: boolean; // commands, !points answers, and level-ups unless the level-ups widget is on this screen
  leaderboard: boolean;
  leaderboardSize: number; // players it lists
  mode: boolean; // the vote, queue or gift-mode panel
  audio: boolean;
  alertPosition: AlertPosition;
  alertPos: { x: number; y: number } | null; // dragged by hand instead: its middle, in percent of the screen
  alertScale: number; // percent: its alerts' size, on top of the screen's size and each action's own
  scale: number; // percent
  layout: ScreenLayout;
  widgets: ScreenWidget[];
  linkStyles: Record<string, WidgetStyle>; // by widgetKey: looks for Widget links, over the same widget's look on this screen
}

// How the stream is doing, sent by the platform every few seconds while live.
export interface RoomStats {
  viewers: number;
  topGifters: string[]; // viewer ids, highest first, as TikTok ranks them for this stream
}

// A key press the server asks the companion to perform. The companion enforces its own whitelist.
export interface KeyAction {
  id: string;
  key: string; // e.g. "KeyA", "Space" (KeyboardEvent.code names); empty for a macro
  holdMs: number;
  macro?: string; // instead of a key: the name of a macro recorded on the companion
}

// A command that runs other commands: each step starts delayMs after the chain does, so 0 and 0 run together.
// Steps are plain commands, never other chains.
export interface ChainStep {
  keyword: string;
  delayMs: number;
}
export const MAX_CHAIN_STEPS = 8;
export const MAX_MACROS = 100; // on one PC
export const MAX_CHAIN_DELAY_MS = 10_000;

// Companion <-> server, over /ws/companion.
export type CompanionToServer =
  // hostname and platform describe the PC (older companions leave them out).
  | { type: 'hello'; token: string; protocol: number; hostname?: string; platform?: string }
  | { type: 'ack'; id: string; status: 'done' | 'rejected'; reason?: string }
  // The macros recorded on this PC, by name: they stay on the PC, so a server can only ask for one, never write one.
  | { type: 'macros'; names: string[] };

// `profile` tells the companion which game to target (null: keep the host's own choice).
// Older companions ignore message types they don't know, so this needs no protocol bump.
export type ServerToCompanion =
  | { type: 'ready'; hostId: string }
  | { type: 'error'; reason: string }
  | { type: 'action'; action: KeyAction }
  | { type: 'profile'; name: string; gameProcess: string | null }
  // The active profile's commands, so the companion can show them and ask for its own OK on key combinations.
  // Sent on connect and whenever commands or the active profile change.
  | { type: 'commands'; commands: { keyword: string; key: string; enabled: boolean; macro: string | null }[] }
  // The host's dashboard theme, which the companion follows. Sent on connect and when the host changes it.
  | { type: 'theme'; theme: UiTheme; style: UiThemeStyle; mode: UiMode };

// Crowd-control modes. The host picks one and can switch while live.
export const MODES = ['anarchy', 'democracy', 'queue', 'gift'] as const;
export type Mode = (typeof MODES)[number];

// In queue mode, a viewer types this to join the line.
export const QUEUE_JOIN = 'join';
// Typed in chat to see your points on the overlay, when the host allows it.
export const POINTS_CHECK = '!points';

// What the overlay shows for the current mode. Times are server-clock milliseconds.
export type ModeState =
  | { mode: 'anarchy' }
  | { mode: 'gift' }
  | { mode: 'democracy'; tally: { keyword: string; votes: number }[]; endsAt: number | null }
  | { mode: 'queue'; viewer: string | null; endsAt: number | null; queue: string[] };

export interface LeaderboardEntry {
  viewer: string;
  commands: number;
  gifts: number; // gifts sent, counting each of a combo
  coins: number; // what those gifts were worth
  xp: number;
  points: number; // spendable balance
  avatar: string | null; // a link to their profile picture; TikTok's links stop working after a while
  name: string | null; // their display name; `viewer` is their id
}

// Viewer progression. XP: 1 per command that fires, plus each gift's diamond value (at least 1).
export const XP_PER_COMMAND = 1;
export const MAX_LEVEL = 99;

// Level n needs 10·(n-1)² XP: level 2 at 10, 3 at 40, 4 at 90, 5 at 160...
export function levelForXp(xp: number): number {
  return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(Math.max(0, xp) / 10)) + 1);
}

export function xpForLevel(level: number): number {
  return 10 * (level - 1) ** 2;
}

// Actions: what happens when viewers do something. An action has one trigger, an audience it applies to, and
// any of: an alert on the overlay (text, sound, picture or video), reading the text aloud, a key press, points.
//   likes: every time the stream's total passes a multiple of likeStep, or with likeGrowth likeStep, then that times likeGrowth, and so on
//   command: a chat message that is the command, or starts with it and a space ({text} is the rest)
//   first_activity: a viewer's first chat, gift, like, follow, share, subscription or sticker of the stream
//   goal: one of the host's goals is reached ({viewer} is who pushed it over)
export const ACTION_TRIGGERS = ['follow', 'share', 'gift', 'likes', 'viewer_likes', 'join', 'subscribe', 'emote', 'command', 'first_activity', 'goal'] as const;
export type ActionTrigger = (typeof ACTION_TRIGGERS)[number];
// top_gifters: TikTok's top three gifters of the stream; viewer: one named viewer.
export const AUDIENCES = ['everyone', 'followers', 'subscribers', 'moderators', 'top_gifters', 'viewer'] as const;
export type Audience = (typeof AUDIENCES)[number];
// A TikTok gift, for picking one. `coins` is 0 for a gift only seen on stream without a price.
export interface Gift {
  name: string;
  coins: number;
  image: string | null;
  received?: boolean; // this host has been sent it
}

// A gift streak of N repeats an action's key press N times, up to this many.
export const MAX_KEY_REPEATS = 10;
// Synthesized in the overlay, so there are no audio files to host.
export const ALERT_SOUNDS = ['chime', 'coin', 'pop', 'fanfare', 'whoosh'] as const;
export type AlertSound = (typeof ALERT_SOUNDS)[number];

// How an alert pop-up looks: an action can have its own, starting from one of ALERT_PRESETS, or use the host's main
// or second style. A host without a main style gets the Plasma preset. Colors are #rrggbb, or #rrggbbaa where a preset needs transparency.
export const ALERT_FONTS = ['geist', 'oxanium', 'dm-sans', 'jakarta', 'fredoka', 'bebas', 'anton', 'impact', 'orbitron', 'righteous', 'press-start', 'bangers', 'permanent-marker', 'pacifico', 'lobster', 'caveat', 'comic', 'georgia', 'courier'] as const;
export type AlertFont = (typeof ALERT_FONTS)[number];
// Full-screen animations. Any action can play any of them.
export const SCREEN_EFFECTS = ['fireworks', 'confetti', 'hearts', 'coins', 'balloons', 'snow', 'stars', 'bubbles'] as const;
export type ScreenEffect = (typeof SCREEN_EFFECTS)[number];
export type ActionEffect = ScreenEffect | 'random'; // random: a different one each time
export const MAX_EFFECT_AMOUNT = 5;
export const EFFECT_SPEEDS = [50, 100, 150, 200, 300] as const; // percent of normal
// Alert animations play around the alert itself, where screen animations fill the screen. The emoji is any text:
// a burst scatters each one in it, and the banner uses it as its graphic when the action has no picture or video.
export const ALERT_EFFECTS = ['emoji_burst', 'character_reveal', 'graphic_banner'] as const;
export type AlertEffect = (typeof ALERT_EFFECTS)[number];
export const ALERT_SHAPES = ['star', 'heart', 'circle', 'diamond'] as const; // the outline a character reveal opens with
export type AlertShape = (typeof ALERT_SHAPES)[number];
export const MAX_ALERT_EMOJI_LENGTH = 32;
export interface AlertFx {
  effect: AlertEffect;
  emoji: string;
  shape: AlertShape;
  color: string | null; // null: the alert look's color
  amount: number;
  speed: number; // percent of normal
}
export const pickEffect = (effect: ActionEffect, random: () => number = Math.random): ScreenEffect =>
  effect === 'random' ? SCREEN_EFFECTS[Math.floor(random() * SCREEN_EFFECTS.length)]! : effect;

export const ALERT_ANIMATIONS = ['pop', 'slide-up', 'slide-down', 'fade', 'bounce', 'zoom'] as const;
export type AlertAnimation = (typeof ALERT_ANIMATIONS)[number];
export interface AlertStyle {
  background: 'solid' | 'gradient' | 'none';
  color1: string; // the solid color, or where the gradient starts
  color2: string; // where the gradient ends
  angle: number; // gradient direction, degrees
  opacity: number; // of the background, percent
  textColor: string;
  font: AlertFont;
  size: number; // px on a 1080p screen, before the action's and screen's scale
  weight: number; // 400 to 900
  uppercase: boolean;
  textShadow: boolean;
  radius: number; // px
  borderWidth: number; // px; 0 for none
  borderColor: string;
  glowColor: string;
  glow: number; // percent; 0 for none
  shine: boolean; // a light passes over it as it arrives
  animation: AlertAnimation;
  speed?: number; // of the animation, percent; 200 is twice as fast. Without it, 100; styles saved before it have none
}
export const ALERT_STYLE_LIMITS = { angle: [0, 360], opacity: [0, 100], size: [16, 120], weight: [400, 900], radius: [0, 60], borderWidth: [0, 12], glow: [0, 100], speed: [25, 400] } as const;

export const ALERT_PRESETS: { id: string; label: string; style: AlertStyle }[] = [
  {
    id: 'plasma',
    label: 'Plasma',
    style: {
      background: 'gradient', color1: '#e8175d', color2: '#7c3aed', angle: 100, opacity: 95, textColor: '#ffffff', font: 'geist', size: 40,
      weight: 800, uppercase: false, textShadow: true, radius: 18, borderWidth: 1, borderColor: '#ffffff33', glowColor: '#7c3aed', glow: 75,
      shine: true, animation: 'pop',
    },
  },
  {
    id: 'solar',
    label: 'Solar',
    style: {
      background: 'gradient', color1: '#f59e0b', color2: '#b45309', angle: 120, opacity: 100, textColor: '#fff8ea', font: 'oxanium', size: 40,
      weight: 700, uppercase: false, textShadow: true, radius: 6, borderWidth: 1, borderColor: '#fde68a66', glowColor: '#f97316', glow: 60,
      shine: true, animation: 'slide-up',
    },
  },
  {
    id: 'clean',
    label: 'Clean',
    style: {
      background: 'solid', color1: '#ffffff', color2: '#e5e7eb', angle: 90, opacity: 96, textColor: '#111827', font: 'geist', size: 38,
      weight: 700, uppercase: false, textShadow: false, radius: 14, borderWidth: 0, borderColor: '#e5e7eb', glowColor: '#000000', glow: 30,
      shine: false, animation: 'slide-down',
    },
  },
  {
    id: 'neon',
    label: 'Neon',
    style: {
      background: 'solid', color1: '#0b0f1a', color2: '#1e1b4b', angle: 90, opacity: 88, textColor: '#67e8f9', font: 'oxanium', size: 40,
      weight: 800, uppercase: false, textShadow: true, radius: 10, borderWidth: 2, borderColor: '#22d3ee', glowColor: '#22d3ee', glow: 85,
      shine: false, animation: 'zoom',
    },
  },
  {
    id: 'bold',
    label: 'Bold',
    style: {
      background: 'solid', color1: '#facc15', color2: '#f59e0b', angle: 90, opacity: 100, textColor: '#111111', font: 'impact', size: 48,
      weight: 400, uppercase: true, textShadow: false, radius: 4, borderWidth: 4, borderColor: '#111111', glowColor: '#000000', glow: 0,
      shine: false, animation: 'bounce',
    },
  },
  {
    id: 'text-only',
    label: 'Text only',
    style: {
      background: 'none', color1: '#000000', color2: '#000000', angle: 90, opacity: 100, textColor: '#ffffff', font: 'geist', size: 44,
      weight: 800, uppercase: false, textShadow: true, radius: 0, borderWidth: 0, borderColor: '#ffffff', glowColor: '#000000', glow: 0,
      shine: false, animation: 'fade',
    },
  },
];
export const DEFAULT_ALERT_STYLE = ALERT_PRESETS[0]!.style;

// The dashboard's and companion's look, chosen per account. A style of 'colors' takes only the theme's colors,
// 'full' its font, corners and shadows too.
export const UI_THEMES = [
  { id: 'default', label: 'Default' },
  { id: 'legacy', label: 'Legacy' },
  { id: 'solar-dusk', label: 'Solar Dusk' },
  { id: 'graphite-mono', label: 'Graphite Mono' },
  { id: 'sage-mist', label: 'Sage Mist' },
] as const;
export type UiTheme = (typeof UI_THEMES)[number]['id'];
export type UiThemeStyle = 'full' | 'colors';
export const UI_MODES = ['system', 'light', 'dark'] as const;
export type UiMode = (typeof UI_MODES)[number]; // light or dark; 'system' follows the computer's setting

// The dashboard Live page's cards. A card in neither column is hidden.
export const LIVE_CARDS = [
  'commands', 'feed', 'stream', 'mode', 'voice', 'activity', 'players',
  'viewers', 'peak-viewers', 'interactors', 'gifts', 'coins', 'likes', 'follows', 'shares', 'subscriptions', 'top-gift', 'last-follower',
] as const;
export type LiveCard = (typeof LIVE_CARDS)[number];
export type LiveColumn = 'main' | 'side';
export type LiveLayout = Record<LiveColumn, LiveCard[]>;
export const DEFAULT_LIVE_LAYOUT: LiveLayout = { main: ['stream', 'commands', 'feed'], side: ['mode', 'voice', 'activity', 'players'] };

// Template placeholders: {viewer}, {count}, {gift}, {diamonds}, {total} (likes), {months}, {text} (command), {goal}, {target}.

// 'auto' is the recommended mode: all chat up to this many viewers, prefixed chat above it. A line takes about 4 s, so
// the overlay can read about 15 a minute, which a stream bigger than this usually out-chats.
// What a voice says for a chat line. Needs {text}; {viewer} is optional, so a host can skip reading names.
export const DEFAULT_TTS_TEMPLATE = '{viewer} says {text}';
export const TTS_MODES = ['off', 'auto', 'prefix', 'all'] as const;
export type TtsMode = (typeof TTS_MODES)[number];

// Where speech is made. Only browser voices bypass OBS's audio capture; the others play through Web Audio.
//   piper:   natural voices generated on the server (falls back to espeak if the server has no Piper)
//   espeak:  robotic voice synthesized inside the overlay (WebAssembly), many languages
//   tiktok:  TikTok's own voices, called by the server with the host's TikTok session (signed in via the companion)
//   cloud:   the host's own Google / Azure / ElevenLabs key, called by the server
//   browser: the browser's built-in voices (plays outside OBS's mixer)
export const TTS_ENGINES = ['piper', 'espeak', 'tiktok', 'cloud', 'browser'] as const;
export type TtsEngine = (typeof TTS_ENGINES)[number];
export const CLOUD_PROVIDERS = ['google', 'azure', 'elevenlabs'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

// TikTok's text-to-speech voices, by the speaker id TikTok's API takes. The first is the default.
export const TIKTOK_VOICES = [
  { id: 'en_us_001', label: 'Female (US)' },
  { id: 'en_us_002', label: 'Jessie (US)' },
  { id: 'en_us_006', label: 'Joey (US)' },
  { id: 'en_us_007', label: 'Professor (US)' },
  { id: 'en_us_009', label: 'Scientist (US)' },
  { id: 'en_us_010', label: 'Confidence (US)' },
  { id: 'en_uk_001', label: 'Narrator (UK)' },
  { id: 'en_uk_003', label: 'Male (UK)' },
  { id: 'en_au_001', label: 'Metro (Australia)' },
  { id: 'en_au_002', label: 'Smooth (Australia)' },
  { id: 'en_male_narration', label: 'Story teller' },
  { id: 'en_male_funny', label: 'Wacky' },
  { id: 'en_female_emotional', label: 'Peaceful' },
  { id: 'en_us_ghostface', label: 'Ghost face' },
  { id: 'en_us_chewbacca', label: 'Chewbacca' },
  { id: 'en_us_c3po', label: 'C-3PO' },
  { id: 'en_us_stitch', label: 'Stitch' },
  { id: 'en_us_stormtrooper', label: 'Stormtrooper' },
  { id: 'en_us_rocket', label: 'Rocket' },
  { id: 'fr_001', label: 'French, male 1' },
  { id: 'fr_002', label: 'French, male 2' },
  { id: 'de_001', label: 'German, female' },
  { id: 'de_002', label: 'German, male' },
  { id: 'es_002', label: 'Spanish, male' },
  { id: 'es_mx_002', label: 'Spanish (Mexico), male' },
  { id: 'br_003', label: 'Portuguese (Brazil), female' },
  { id: 'br_005', label: 'Portuguese (Brazil), male' },
  { id: 'id_001', label: 'Indonesian, female' },
  { id: 'jp_001', label: 'Japanese, female' },
  { id: 'jp_006', label: 'Japanese, male' },
  { id: 'kr_002', label: 'Korean, male' },
  { id: 'kr_003', label: 'Korean, female' },
] as const;

// Applied by the overlay to any voice. Browser voices only get the pitch/speed part.
export const VOICE_EFFECTS = ['none', 'chipmunk', 'deep', 'monster', 'robot', 'radio', 'echo'] as const;
export type VoiceEffect = (typeof VOICE_EFFECTS)[number];

// How the overlay should say something.
export type Speech = (
  | { kind: 'audio'; data: string; mime: string } // base64, from Piper, TikTok or a cloud provider
  | { kind: 'espeak'; text: string; voice: string }
  | { kind: 'browser'; text: string; voice: string | null }
) & { effect?: VoiceEffect };

// Server -> overlay, over /ws/overlay. Read-only.
export type ServerToOverlay =
  | { type: 'command'; viewer: string; keyword: string; at: number; level?: number; avatar?: string } // level: progression on
  | { type: 'live'; state: 'started' | 'stopped' }
  | { type: 'mode'; state: ModeState; serverNow: number; avatar?: string } // serverNow lets the overlay correct for clock skew; avatar: who's playing
  | { type: 'leaderboard'; entries: LeaderboardEntry[]; progression: boolean }
  | { type: 'levelUp'; viewer: string; level: number; avatar?: string }
  | { type: 'points'; viewer: string; points: number; avatar?: string } // answers a viewer's !points
  // An action's alert. soundFile and media are uploaded files (/media/:id); durationMs defaults to 5 s.
  // screen: only that screen shows it; otherwise every screen that shows alerts.
  | {
      type: 'alert';
      text: string;
      sound: AlertSound | null;
      speech: Speech | null;
      soundFile?: string;
      soundFileVolume?: number; // percent, of soundFile; without it, 100
      soundVolume?: number; // percent, of a built-in sound or built-in sound file; without it, 100
      media?: { id: string; kind: MediaKind };
      durationMs?: number;
      screen?: string;
      pos?: { x: number; y: number }; // its middle, in percent of the screen; without it, the screen's alert position
      scale?: number; // percent, on top of the screen's size
      action?: string; // the action's id, so turning the action off can take back its alerts (dropAlerts)
      style?: AlertStyle; // without it, DEFAULT_ALERT_STYLE
      fx?: AlertFx; // its alert animation
    }
  // A full-screen animation from an action. It doesn't wait its turn behind alerts. screen: as for alerts.
  | { type: 'effect'; effect: ScreenEffect; amount: number; speed: number; color?: string; screen?: string }
  | { type: 'screen'; screen: OverlayScreen } // sent first, and again when the host changes the screen
  | { type: 'stats'; stats: StreamStats }
  | { type: 'chat'; viewer: string; text: string; avatar?: string }
  | { type: 'gift'; viewer: string; gift: string; count: number; diamonds: number } // diamonds: the whole streak's
  | { type: 'tts'; viewer: string; text: string; speech: Speech }
  // Drop lines waiting and cut off the one playing: every line when the voice changed (they were made with the old
  // one), only read-aloud chat when reading chat was turned off.
  | { type: 'clearSpeech'; chatOnly?: true }
  | { type: 'skipSpeech' } // cut off the line playing; the next one starts
  | { type: 'presses'; counts: Record<string, number> } // to the dashboard on connect: the live stream's presses per command
  | { type: 'dropAlerts'; actions: string[] } // these actions were turned off or deleted: drop their alerts and speech
  | { type: 'speechVolume'; volume: number } // percent, for every voice; sent on connect and when the host changes it
  | { type: 'debug' } // the server keeps a debug log: report what happens here (see OverlayToServer)

// Overlay -> server: only debug reports, only after the server asks for them, and only in development.
export type OverlayToServer = { type: 'log'; message: string; data?: Record<string, unknown>; at: number };

// What's recorded during a stream: what viewers did, and what Hyperion did in response.
//   Events by a viewer also carry their display name, as name, when the platform gave one.
//   comment {text}, gift {gift, count, diamonds, image?}, like {count}, follow, share, join, subscribe {months}, emote {emoteId}:
//   viewer interactions
//   command {keyword, via: 'chat' | 'vote' | 'action'}: a key press fired (viewer is null for a vote's winner)
//   refused {keyword, reason}: a command that matched but didn't fire (cooldown, rate limit, level, points, not their turn)
//   level {level}, vote {winner, votes, total, voters, margin}, queue_join, turn {waitedMs}
export type ActivityKind =
  | 'comment' | 'gift' | 'like' | 'follow' | 'share' | 'join' | 'subscribe' | 'emote'
  | 'command' | 'refused' | 'level' | 'vote' | 'queue_join' | 'turn';

export interface StreamEvent {
  id: number;
  at: number;
  kind: ActivityKind;
  viewer: string | null;
  data: Record<string, unknown>;
}

export interface StreamSummary {
  id: string;
  source: 'tiktok' | 'simulated';
  profileName: string;
  tiktokUsername: string | null; // the TikTok account streamed from
  startedAt: number;
  endedAt: number | null; // null while live
  viewers: number; // everyone seen in the stream: joined, or did anything. Quiet viewers already there aren't known
  peakViewers: number | null; // the most watching at once, by TikTok's count; null for streams from before it was kept
  participants: number; // interactors: viewers who chatted or gifted
  newParticipants: number; // ... for the first time on any of the host's streams
  comments: number;
  commands: number;
  gifts: number;
  diamonds: number;
  follows: number;
  topCommand: string | null;
  topPlayer: string | null;
  topPlayerName: string | null; // their display name
}

export interface StreamDetail {
  summary: StreamSummary;
  perMinute: { minute: number; commands: number; comments: number }[]; // minute 0 is the stream's first
  markers: { at: number; kind: 'gift' | 'follow' | 'level'; viewer: string | null; label: string }[];
  commandUsage: { keyword: string; fired: number; refused: number; reasons: Record<string, number> }[];
  peaks: { start: number; end: number; events: number }[]; // busiest two-minute windows, busiest first
  gifts: { byGift: { gift: string; count: number; diamonds: number; image: string | null }[]; perHour: { hour: number; diamonds: number }[] };
  modes: {
    votes: { rounds: number; avgVoters: number; closeRounds: number }; // close: won by one vote or a tie
    queue: { joins: number; turns: number; avgWaitMs: number };
  };
}

// One viewer's part in one stream, for the stream's report.
export interface StreamViewer {
  viewer: string;
  name: string | null; // their display name in that stream
  avatar: string | null; // the picture last saved for them, if any; TikTok's links stop working after a while
  comments: number;
  commands: number; // key presses
  gifts: number;
  coins: number;
  likes: number;
  followed: boolean;
  firstAt: number;
  lastAt: number;
}

// One viewer across the host's streams (optionally one TikTok account's).
export interface ViewerProfile {
  viewer: string;
  name: string | null; // their latest display name
  avatar: string | null; // a link to their profile picture; TikTok's links stop working after a while
  firstSeen: number | null;
  lastSeen: number | null;
  streams: number; // streams they showed up in
  comments: number;
  commands: number;
  gifts: number;
  diamonds: number;
  xp: number; // leaderboard XP, across all of the host's streams
  points: number; // spendable balance
  level: number;
  topCommands: { keyword: string; count: number }[];
  perStream: {
    streamId: string;
    startedAt: number;
    source: 'tiktok' | 'simulated';
    tiktokUsername: string | null;
    comments: number;
    commands: number;
    diamonds: number;
  }[];
}

// An event with the stream it happened in, for a viewer's history across streams.
export type ViewerHistoryEvent = StreamEvent & { streamId: string; streamStartedAt: number };
