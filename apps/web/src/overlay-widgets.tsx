import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DEFAULT_MESSAGE, type GoalMetric, type ScreenEffect, type ScreenWidget, type StreamStats, type WidgetStyle } from '@hyperion/shared';
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

export const DEFAULT_FIREWORK_DIAMONDS = 100;
export const DEFAULT_JAR_DIAMONDS = 1000;
// What a gift animation widget plays, and from which gifts.
export const giftAnimation = (w: ScreenWidget) => ({ min: w.minDiamonds ?? DEFAULT_FIREWORK_DIAMONDS, effect: w.effect ?? ('fireworks' as const), speed: w.effectSpeed ?? 100 });

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
  const { style } = props.widget;
  return (
    <div className={`widget-box ${style ? 'widget-look' : ''}`} style={style && widgetLook(style)}>
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
      return <CoinJar diamonds={stats?.diamonds ?? 0} target={widget.minDiamonds ?? DEFAULT_JAR_DIAMONDS} bus={bus} />;
    case 'firework':
      return null; // drawn over the whole screen by <Fireworks>
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

// Coins drop into a jar that fills toward a diamond target. More diamonds, more coins (up to a handful per gift).
type Coin = { id: number; x: number; delay: number };
let coinId = 0;
function CoinJar({ diamonds, target, bus }: { diamonds: number; target: number; bus: GiftBus }) {
  const [coins, setCoins] = useState<Coin[]>([]);
  useGifts(bus, (gift) => {
    const count = Math.min(12, Math.max(1, Math.ceil(Math.log2(gift.diamonds + 1))));
    const added = Array.from({ length: count }, (_, i) => ({ id: coinId++, x: 20 + Math.random() * 60, delay: i * 90 }));
    setCoins((current) => [...current, ...added].slice(-40));
    setTimeout(() => setCoins((current) => current.filter((c) => !added.includes(c))), 1400 + count * 90);
  });
  const level = Math.min(1, diamonds / target);
  return (
    <div className="overlay-panel w-jar tone-amber">
      <div className="w-jar-glass">
        <div className="w-jar-fill" style={{ height: `${level * 100}%` }} />
        {coins.map((c) => (
          <span key={c.id} className="w-coin" style={{ left: `${c.x}%`, animationDelay: `${c.delay}ms`, '--land': `${(1 - level) * 100}%` } as CSSProperties} />
        ))}
      </div>
      <div className="w-jar-label">
        <strong>{number(diamonds)}</strong> / {number(target)} coins
      </div>
    </div>
  );
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
    fetch('/api/goals')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: { id: string; name: string; metric: StreamStats['goals'][number]['metric']; target: number; enabled: boolean }[]) => {
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
