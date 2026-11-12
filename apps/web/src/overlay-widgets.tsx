import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DEFAULT_MESSAGE, type Goal, type GoalMetric, type GoalRaise, type ScreenEffect, type ScreenWidget, type StreamStats, type WidgetStyle } from '@hyperion/shared';
import { api } from './api';
import { ALERT_FONT_STACKS } from './alert-style';
import { Icon, type IconName } from './icons';
import { ViewerAvatar } from './ui';

// Overlay widgets. Each reads the stream's totals (StreamStats) or listens for chat and gifts.

export type GiftEvent = { viewer: string; gift: string; count: number; diamonds: number };
export type ChatLine = { id: number; viewer: string; text: string; avatar?: string };
export type EffectEvent = { effect: ScreenEffect; amount: number; speed: number; color?: string };
export type BurstEvent = { box: DOMRect; emoji: string; amount: number; speed: number };
export type LevelUpEvent = { viewer: string; level: number; avatar?: string };

// Gifts reach the coin jar and gift animations as events rather than state, so a burst of gifts is a burst of animation.
// Level-ups come the same way, so the widget works on a browser source of its own too.
export class GiftBus extends EventTarget {
  emit(gift: GiftEvent) {
    this.dispatchEvent(new CustomEvent<GiftEvent>('gift', { detail: gift }));
  }

  emitEffect(effect: EffectEvent) {
    this.dispatchEvent(new CustomEvent<EffectEvent>('effect', { detail: effect }));
  }

  // Scatters an alert's emoji from the middle of `box`, its place in the viewport.
  emitBurst(burst: BurstEvent) {
    this.dispatchEvent(new CustomEvent<BurstEvent>('burst', { detail: burst }));
  }

  emitLevelUp(levelUp: LevelUpEvent) {
    this.dispatchEvent(new CustomEvent<LevelUpEvent>('levelUp', { detail: levelUp }));
  }
}

function useBus<T>(bus: GiftBus, name: string, on: (detail: T) => void) {
  const handler = useRef(on);
  handler.current = on;
  useEffect(() => {
    const listener = (e: Event) => handler.current((e as CustomEvent<T>).detail);
    bus.addEventListener(name, listener);
    return () => bus.removeEventListener(name, listener);
  }, [bus, name]);
}
export const useGifts = (bus: GiftBus, onGift: (gift: GiftEvent) => void) => useBus(bus, 'gift', onGift);
export const useBursts = (bus: GiftBus, onBurst: (burst: BurstEvent) => void) => useBus(bus, 'burst', onBurst);
export const useEffects = (bus: GiftBus, onEffect: (effect: EffectEvent) => void) => useBus(bus, 'effect', onEffect);

const number = (n: number) => n.toLocaleString();
const MAX_LEVEL_UPS = 3;
const LEVEL_UP_MS = 8000;
const METRIC_UNITS = { likes: 'likes', follows: 'follows', shares: 'shares', diamonds: 'coins', subscriptions: 'subs' } as const;
// Each widget has one accent (a tone- class in overlay.css), the same as its icon on the dashboard.
type Tone = 'amber' | 'orange' | 'sky' | 'indigo' | 'teal' | 'violet' | 'pink' | 'green';
const METRIC_LOOK: Record<GoalMetric, { icon: IconName; tone: Tone }> = {
  likes: { icon: 'heart', tone: 'pink' },
  follows: { icon: 'follower', tone: 'sky' },
  shares: { icon: 'share', tone: 'green' },
  diamonds: { icon: 'coin', tone: 'amber' },
  subscriptions: { icon: 'star', tone: 'violet' },
};

export const DEFAULT_JAR_DIAMONDS = 1000;

type WidgetProps = { widget: ScreenWidget; stats: StreamStats | null; chat: ChatLine[]; bus: GiftBus };

// A widget's own colors, as variables overlay.css puts on its panel.
const widgetLook = (s: WidgetStyle) =>
  ({
    '--w-bg': `color-mix(in srgb, ${s.background} ${s.opacity}%, transparent)`,
    '--w-ink': s.textColor,
    '--w-shadow': s.opacity < 40 ? '0 1px 4px rgba(0, 0, 0, 0.8)' : 'none', // with little behind it, the text needs its own edge
    '--w-accent': s.accent,
    '--w-accent-soft': `color-mix(in srgb, ${s.accent} 18%, transparent)`,
    '--w-border': `${s.borderWidth}px solid ${s.borderColor}`,
    '--w-radius': `${s.radius}px`,
    '--w-font': ALERT_FONT_STACKS[s.font][1],
    '--w-size': s.size / 100,
  }) as CSSProperties;

export function Widget(props: WidgetProps) {
  // Always the same wrapper: a widget that gains a look keeps what it's showing.
  const { style, size } = props.widget;
  return (
    <div className={`widget-box ${style ? 'widget-look' : ''} ${size ? 'own-size' : ''}`} style={{ ...(style && widgetLook(style)), ...(size && { '--w-scale': size / 100 }) } as CSSProperties}>
      <WidgetBody {...props} />
    </div>
  );
}

function WidgetBody({ widget, stats, chat, bus }: WidgetProps) {
  switch (widget.type) {
    case 'goals': {
      if (!stats) return null;
      const goals = widget.goalId ? stats.goals.filter((g) => g.id === widget.goalId) : stats.goals;
      return goals.length > 0 ? <Goals goals={goals} /> : null;
    }
    case 'top_gift':
      return stats?.topGift ? (
        <Highlight title="Top gift" icon="trophy" tone="amber" viewer={stats.topGift.viewer} avatar={stats.avatars[stats.topGift.viewer]} detail={`${stats.topGift.gift}, ${number(stats.topGift.diamonds)} coins`} image={stats.topGift.image} />
      ) : null;
    case 'top_streak':
      return stats?.topStreak ? (
        <Highlight title="Longest streak" icon="flame" tone="orange" viewer={stats.topStreak.viewer} avatar={stats.avatars[stats.topStreak.viewer]} detail={stats.topStreak.gift} count={stats.topStreak.count} image={stats.topStreak.image} />
      ) : null;
    case 'last_follower':
      return stats?.lastFollower ? <Highlight title="Latest follower" icon="follower" tone="sky" viewer={stats.lastFollower} avatar={stats.avatars[stats.lastFollower]} /> : null;
    case 'last_gifter':
      return stats?.lastGifter ? (
        <Highlight title="Latest gift" icon="gift" tone="amber" viewer={stats.lastGifter.viewer} avatar={stats.avatars[stats.lastGifter.viewer]} detail={`${stats.lastGifter.gift} ×${number(stats.lastGifter.count)}`} image={stats.lastGifter.image} />
      ) : null;
    case 'stats':
      return stats ? <Stats stats={stats} /> : null;
    case 'chat':
      return chat.length > 0 ? <Chat lines={chat} /> : null;
    case 'coin_jar':
      return <CoinJar diamonds={stats?.diamonds ?? 0} target={widget.minDiamonds ?? DEFAULT_JAR_DIAMONDS} raise={widget.raise} shine={widget.shine !== false} bus={bus} />;
    case 'level_ups':
      return <LevelUps bus={bus} />;
    case 'message':
      return <div className="overlay-panel w-message tone-indigo">{widget.text ?? DEFAULT_MESSAGE}</div>;
  }
}

export function LevelUpLine({ viewer, level, avatar }: LevelUpEvent) {
  return (
    <div className="overlay-item overlay-levelup">
      <Icon name="star" size={18} strokeWidth={2.5} />
      <ViewerAvatar className="small" name={viewer} src={avatar} />
      <span className="overlay-viewer">{viewer}</span> reached <span className="overlay-keyword">level {level}</span>
    </div>
  );
}

function LevelUps({ bus }: { bus: GiftBus }) {
  const [items, setItems] = useState<(LevelUpEvent & { id: number })[]>([]);
  useEffect(() => {
    let nextId = 0;
    const timers = new Set<number>();
    const listener = (e: Event) => {
      const item = { ...(e as CustomEvent<LevelUpEvent>).detail, id: nextId++ };
      setItems((current) => [item, ...current].slice(0, MAX_LEVEL_UPS));
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        setItems((current) => current.filter((i) => i.id !== item.id));
      }, LEVEL_UP_MS);
      timers.add(timer);
    };
    bus.addEventListener('levelUp', listener);
    return () => {
      bus.removeEventListener('levelUp', listener);
      timers.forEach(clearTimeout);
    };
  }, [bus]);
  if (items.length === 0) return null;
  return (
    <div className="overlay">
      {items.map((item) => (
        <LevelUpLine key={item.id} viewer={item.viewer} level={item.level} avatar={item.avatar} />
      ))}
    </div>
  );
}

// A panel's title: an icon on a tinted badge, then the name, and anything else (a countdown) at the far end.
export function Title({ icon, children, end }: { icon: IconName; children: ReactNode; end?: ReactNode }) {
  return (
    <div className="overlay-title">
      <span className="overlay-badge">
        <Icon name={icon} size={14} strokeWidth={2.5} />
      </span>
      <span className="overlay-title-text">{children}</span>
      {end}
    </div>
  );
}

function Goals({ goals }: { goals: StreamStats['goals'] }) {
  // One goal takes its own color; several share the violet of the goals widget.
  const tone = goals.length === 1 ? METRIC_LOOK[goals[0]!.metric].tone : 'violet';
  return (
    <div className={`overlay-panel w-goals tone-${tone}`}>
      {goals.map((g) => {
        const done = g.current >= g.target;
        const look = METRIC_LOOK[g.metric];
        return (
          <div key={g.id} className={`w-goal tone-${look.tone} ${done ? 'done' : ''}`}>
            <div className="w-goal-head">
              <span className="overlay-badge">
                <Icon name={done ? 'star' : look.icon} size={14} strokeWidth={2.5} />
              </span>
              <span className="w-goal-name">{g.name}</span>
              <span className="overlay-score">{done ? 'Done!' : `${number(g.current)} / ${number(g.target)}`}</span>
            </div>
            <div className="w-goal-track" role="progressbar" aria-valuemin={0} aria-valuemax={g.target} aria-valuenow={Math.min(g.current, g.target)} aria-label={`${g.name}, ${METRIC_UNITS[g.metric]}`}>
              <span style={{ width: `${Math.min(100, (g.current / g.target) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// One viewer worth showing: the top gifter, the latest follower and so on. Pops when the viewer changes.
// A streak shows its count beside a flame.
function GiftPicture({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? <img className="w-gift-image" src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : null;
}

function Highlight({ title, icon, tone, viewer, avatar, detail, count, image }: { title: string; icon: IconName; tone: Tone; viewer: string; avatar?: string; detail?: string; count?: number; image?: string }) {
  return (
    <div className={`overlay-panel w-highlight tone-${tone}`}>
      <Title icon={icon}>{title}</Title>
      <div key={`${viewer}:${detail}:${count}`} className="w-highlight-body">
        <ViewerAvatar className="w-avatar" name={viewer} src={avatar} />
        <span className="w-highlight-text">
          <span className="w-highlight-name">{viewer}</span>
          {detail && <span className="overlay-muted">{detail}</span>}
        </span>
        <GiftPicture key={image} src={image} />
        {count !== undefined && (
          <span className="w-streak">
            <Flame />
            <span className="w-streak-count">×{number(count)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// A flickering flame, filled, for streaks.
function Flame() {
  return (
    <svg className="w-flame" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="w-flame-fill" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff4d2e" />
          <stop offset="0.55" stopColor="#ff9a2e" />
          <stop offset="1" stopColor="#ffd84d" />
        </linearGradient>
      </defs>
      <path fill="url(#w-flame-fill)" d="M12 23a7 7 0 0 0 7-7c0-4.5-3.2-7-4.4-11.5-2.3 2.2-3.4 4.5-3.4 6.8-1.2-1-2.1-2.4-2.3-4.4C6.6 9.6 5 12.6 5 16a7 7 0 0 0 7 7z" />
      <path fill="#fff6c8" opacity="0.85" d="M12 22a3.5 3.5 0 0 0 3.5-3.5c0-2.3-1.6-3.4-2.2-5.6-1.7 1.4-2.6 3-2.6 4.6-.6-.4-1-1-1.2-1.8-.7 1-1 2-1 2.8A3.5 3.5 0 0 0 12 22z" />
    </svg>
  );
}

function Stats({ stats }: { stats: StreamStats }) {
  const tiles: [string, number, IconName, Tone][] = [
    ['Viewers', stats.viewers, 'eye', 'teal'],
    ['Likes', stats.likes, 'heart', 'pink'],
    ['Follows', stats.follows, 'follower', 'sky'],
    ['Coins', stats.diamonds, 'coin', 'amber'],
  ];
  return (
    <div className="overlay-panel w-stats tone-teal">
      {tiles.map(([label, value, icon, tone]) => (
        <div key={label} className={`tone-${tone}`}>
          <span className="w-stat-icon">
            <Icon name={icon} size={18} strokeWidth={2.5} />
          </span>
          <strong>{number(value)}</strong>
          <span className="w-stat-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

// Each viewer keeps one name color, picked from their name, so a conversation is easy to follow.
const NAME_COLORS = ['#ff8fbf', '#7cc8ff', '#ffc35a', '#8fe3a8', '#b9a1ff', '#ff9a6b', '#5fe0d0'];
const nameColor = (name: string) => NAME_COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % NAME_COLORS.length];

function Chat({ lines }: { lines: ChatLine[] }) {
  return (
    <div className="overlay-panel w-chat tone-indigo">
      <Title icon="chat">Chat</Title>
      {lines.map((l) => (
        <div key={l.id} className="w-chat-line">
          <ViewerAvatar className="small" name={l.viewer} src={l.avatar} />
          <span className="overlay-viewer" style={{ color: nameColor(l.viewer) }}>
            {l.viewer}
          </span>
          {l.text}
        </div>
      ))}
    </div>
  );
}

// Coins drop into a glass jar and settle onto a pile that rises toward a diamond target. More diamonds, more coins (up
// to a dozen per gift). A full jar glows and sparkles; with `raise`, it then empties and fills toward a bigger target.
type Coin = { id: number; x: number; delay: number };
let coinId = 0;
const COIN_FALL_MS = 1100;
const COIN_GAP_MS = 90;
// The jar, drawn 140 × 180: an open mouth with a rim, a short neck and a round-shouldered body.
const JAR_BODY = 'M38 24 H102 V32 C102 40 126 42 126 60 V154 Q126 174 106 174 H34 Q14 174 14 154 V60 C14 42 38 40 38 32 Z';
const PILE_EMPTY = 182; // the pile's top, out of sight below the jar
const PILE_FULL = 46; // the pile's top at the shoulders, where the jar counts as full
const PILE_BOTTOM = 174;
const MOUTH = [46, 94]; // where coins fall, the mouth's inside less a coin's width
const BUMPS = Array.from({ length: 11 }, (_, i) => 10 + i * 12);
const JAR_FULL_MS = 2500; // how long a filled jar shows off before emptying for the next
const MAX_JARS = 1000;

// The jar being filled now: which one (0 for the first), and the totals it fills from and to. Raised the way goals are.
export function currentJar(diamonds: number, target: number, raise?: GoalRaise) {
  if (!raise || diamonds < target) return { jar: 0, from: 0, to: target };
  if (raise.kind === 'plus') {
    const jar = Math.floor((diamonds - target) / raise.by) + 1;
    return { jar, from: target + (jar - 1) * raise.by, to: target + jar * raise.by };
  }
  if (raise.kind === 'to') return raise.by > target ? { jar: 1, from: target, to: raise.by } : { jar: 0, from: 0, to: target };
  let jar = { jar: 0, from: 0, to: target };
  while (diamonds >= jar.to && jar.jar < MAX_JARS) jar = { jar: jar.jar + 1, from: jar.to, to: Math.max(jar.to + 1, Math.ceil(jar.to * raise.by)) };
  return jar;
}

function CoinJar({ diamonds, target, raise, shine, bus }: { diamonds: number; target: number; raise?: GoalRaise; shine: boolean; bus: GiftBus }) {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [gifts, setGifts] = useState(0); // restarts the shine that follows each gift's coins
  const id = `jar${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  useGifts(bus, (gift) => {
    const count = Math.min(12, Math.max(1, Math.ceil(Math.log2(gift.diamonds + 1))));
    const added = Array.from({ length: count }, (_, i) => ({ id: coinId++, x: MOUTH[0]! + Math.random() * (MOUTH[1]! - MOUTH[0]!), delay: i * COIN_GAP_MS }));
    setCoins((current) => [...current, ...added].slice(-40));
    setGifts((n) => n + 1);
    setTimeout(() => setCoins((current) => current.filter((c) => !added.includes(c))), COIN_FALL_MS + count * COIN_GAP_MS + 100);
  });
  const { jar, from, to } = currentJar(diamonds, target, raise);
  // A jar just filled shows off for a moment before the next one starts (not one already past when the overlay opened).
  const [showingOff, setShowingOff] = useState<{ jar: number; to: number } | null>(null);
  const lastJar = useRef(jar);
  useEffect(() => {
    if (jar <= lastJar.current) return void (lastJar.current = jar);
    setShowingOff({ jar: lastJar.current, to: from });
    lastJar.current = jar;
    const timer = setTimeout(() => setShowingOff(null), JAR_FULL_MS);
    return () => clearTimeout(timer);
  }, [jar, from]);
  const level = showingOff ? 1 : Math.min(1, (diamonds - from) / (to - from));
  const full = level >= 1;
  const filled = showingOff ? showingOff.jar : jar; // the full one, while full
  const top = diamonds > 0 ? PILE_BOTTOM - 8 - level * (PILE_BOTTOM - 8 - PILE_FULL) : PILE_EMPTY;
  const shown = useCountUp(diamonds);
  return (
    <div className={`overlay-panel w-jar tone-amber ${full ? 'full' : ''}`}>
      <div className="w-jar-stage">
        <svg className="w-jar-layer" viewBox="0 0 140 180" aria-hidden="true">
          <defs>
            <clipPath id={`${id}-body`}>
              <path d={JAR_BODY} />
            </clipPath>
            <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffe08a" />
              <stop offset="0.5" stopColor="#f7b733" />
              <stop offset="1" stopColor="#c97a0a" />
            </linearGradient>
            <linearGradient id={`${id}-round`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#000" stopOpacity="0.35" />
              <stop offset="0.3" stopColor="#000" stopOpacity="0" />
              <stop offset="0.75" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="0.4" />
            </linearGradient>
            {/* Coins lying every which way, so the pile doesn't read as a grid. */}
            <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.14" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <pattern id={`${id}-coins`} width="44" height="22" patternUnits="userSpaceOnUse">
              <ellipse cx="8" cy="4" rx="7.5" ry="3.4" fill="#ffd56e" stroke="#c07a0c" strokeWidth="0.8" />
              <ellipse cx="27" cy="7" rx="7" ry="2.6" fill="#f6b53a" stroke="#c07a0c" strokeWidth="0.8" transform="rotate(-12 27 7)" />
              <ellipse cx="40" cy="15" rx="7.5" ry="3.2" fill="#ffcf5e" stroke="#c07a0c" strokeWidth="0.8" />
              <ellipse cx="16" cy="15" rx="7" ry="3.6" fill="#eea530" stroke="#c07a0c" strokeWidth="0.8" transform="rotate(10 16 15)" />
              <ellipse cx="2" cy="19" rx="6.5" ry="2.8" fill="#ffda78" stroke="#c07a0c" strokeWidth="0.8" />
              <circle cx="30" cy="18" r="1.1" fill="#fff4c4" opacity="0.8" />
              <circle cx="6" cy="9" r="0.9" fill="#fff4c4" opacity="0.7" />
            </pattern>
          </defs>
          <path className="w-jar-glass" d={JAR_BODY} />
          <g clipPath={`url(#${id}-body)`}>
            <g className="w-jar-pile" style={{ transform: `translateY(${top}px)` }}>
              <rect x="0" y="2" width="140" height="190" fill={`url(#${id}-gold)`} />
              <rect x="0" y="2" width="140" height="190" fill={`url(#${id}-coins)`} opacity="0.55" />
              {BUMPS.map((x, i) => (
                <ellipse key={x} cx={x} cy={i % 2 ? 1 : -1} rx="8" ry="3.6" fill="#ffdc7d" stroke="#b86e06" strokeWidth="1" />
              ))}
              <rect x="0" y="-6" width="140" height="196" fill={`url(#${id}-round)`} />
            </g>
          </g>
        </svg>
        {coins.map((c) => (
          <span key={c.id} className="w-coin" style={{ left: c.x, animationDelay: `${c.delay}ms`, '--land': `${top - 12}px` } as CSSProperties} />
        ))}
        <svg className="w-jar-layer" viewBox="0 0 140 180" aria-hidden="true">
          <path className="w-jar-outline" d={JAR_BODY} />
          <rect className="w-jar-rim" x="34" y="18" width="72" height="10" rx="5" />
          {shine && (
            <>
              <path className="w-jar-gleam" d="M24 70 C22 92 22 124 25 150" />
              <path className="w-jar-gleam thin" d="M34 66 C33 76 33 84 33.5 92" />
              <g clipPath={`url(#${id}-body)`}>
                {gifts > 0 && <rect key={gifts} className="w-jar-shine" x="-60" y="0" width="34" height="180" fill={`url(#${id}-shine)`} />}
              </g>
            </>
          )}
        </svg>
        {full && (
          <div className="w-jar-sparkles" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} />
            ))}
          </div>
        )}
      </div>
      <div className="w-jar-label">
        <strong>{number(shown)}</strong>
        <span>{full ? `Jar ${filled > 0 ? `${filled + 1} ` : ''}full!` : `of ${number(to)} coins${jar > 0 ? ` · jar ${jar + 1}` : ''}`}</span>
      </div>
    </div>
  );
}

// Counts up to `value` over a moment rather than jumping to it.
function useCountUp(value: number, ms = 800) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const next = Math.round(begin + (value - begin) * (1 - (1 - t) ** 3));
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

// Preview: sample numbers and gifts, so a host can see their widgets before going live. Goals are the host's own
// (the preview opens from the dashboard, so the session cookie is there), filling up and starting over.
const SAMPLE_VIEWERS = ['nightowl', 'pixelpanda', 'mapleleaf', 'riverstone', 'kitekid'];
const SAMPLE_GIFTS = [
  { gift: 'Rose', diamonds: 1 },
  { gift: 'Finger Heart', diamonds: 5 },
  { gift: 'Doughnut', diamonds: 30 },
  { gift: 'Hand Hearts', diamonds: 100 },
  { gift: 'Money Gun', diamonds: 500 },
];
const SAMPLE_CHAT = ['hi from Ohio!', 'jump!', 'this is so fun', 'left', 'lets gooo'];
const PREVIEW_TICK_MS = 2500;

export function usePreview(enabled: boolean, bus: GiftBus) {
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let goals: StreamStats['goals'] = [];
    // Through api(), so the demo's own goals show; on an overlay, where there's no login, there are none.
    api<Goal[]>('GET', '/goals')
      .then((list) => {
        goals = list.filter((g) => g.enabled).map((g) => ({ id: g.id, name: g.name, metric: g.metric, target: g.target, current: 0 }));
      })
      .catch(() => {});
    let tick = 0;
    let current: StreamStats = {
      likes: 0, follows: 0, shares: 0, diamonds: 0, gifts: 0, subscriptions: 0, viewers: 128, peakViewers: 128, interactors: 0,
      topGift: null, topStreak: null, lastFollower: null, lastGifter: null, avatars: {}, goals: [],
    };
    const step = () => {
      const viewer = SAMPLE_VIEWERS[tick % SAMPLE_VIEWERS.length]!;
      const { gift, diamonds } = SAMPLE_GIFTS[tick % SAMPLE_GIFTS.length]!;
      const count = 1 + (tick % 3);
      // Goals fill over about 20 ticks, stay done for a few, then start over.
      const progress = Math.min(1, (tick % 24) / 20);
      current = {
        ...current,
        likes: current.likes + 40 + (tick % 7) * 9,
        follows: current.follows + (tick % 2),
        shares: current.shares + (tick % 4 === 0 ? 1 : 0),
        diamonds: current.diamonds + diamonds * count,
        gifts: current.gifts + count,
        viewers: 120 + ((tick * 7) % 40),
        topGift: !current.topGift || diamonds * count > current.topGift.diamonds ? { viewer, gift, diamonds: diamonds * count } : current.topGift,
        topStreak: !current.topStreak || count > current.topStreak.count ? { viewer, gift, count } : current.topStreak,
        lastFollower: tick % 2 ? SAMPLE_VIEWERS[(tick + 2) % SAMPLE_VIEWERS.length]! : current.lastFollower,
        lastGifter: { viewer, gift, count },
        goals: goals.map((g) => ({ ...g, current: Math.round(g.target * progress) })),
      };
      setStats(current);
      setChat((lines) => [...lines, { id: tick, viewer, text: SAMPLE_CHAT[tick % SAMPLE_CHAT.length]! }].slice(-6));
      bus.emit({ viewer, gift, count, diamonds: diamonds * count });
      bus.emitLevelUp({ viewer, level: 2 + (tick % 20) });
      tick++;
    };
    const first = setTimeout(step, 300); // after the goals have likely arrived
    const timer = setInterval(step, PREVIEW_TICK_MS);
    return () => (clearTimeout(first), clearInterval(timer));
  }, [enabled, bus]);
  return { stats, chat };
}
