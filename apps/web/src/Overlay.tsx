import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { AlertPlayer, type ShownAlert } from './alert-player';
import { ViewerAvatar } from './ui';
import {
  levelForXp,
  QUEUE_JOIN,
  WIDGET_SPOTS,
  WIDGET_TYPES,
  widgetKey,
  type LeaderboardEntry,
  type Mode,
  type OverlayPart,
  type ModeState,
  type AlertPosition,
  type OverlayScreen,
  type PhoneSafe,
  type ScreenLayout,
  type ScreenWidget,
  type OverlayToServer,
  type ServerToOverlay,
  type StreamStats,
  type WidgetSpot,
} from '@hyperion/shared';
import { GiftBus, LevelUpLine, Title, usePreview, Widget, type ChatLine } from './overlay-widgets';
import { ScreenEffects } from './effects';
import { Icon } from './icons';
import { AlertContent, alertFxClass, alertFxStyle, MIDDLE, revealsInMiddle } from './alert-fx';
import { alertLook } from './alert-style';
import { openOverlaySocket, type OverlaySocket } from './demo/socket';

// A command, a level-up shout-out, or a viewer's points when they ask.
export type FeedItem = { id: number; viewer: string; avatar?: string } & ({ keyword: string; level?: number } | { levelUp: number } | { points: number });

const MAX_ITEMS = 6;
const ITEM_TTL_MS = 8000;
const MAX_TALLY = 4;
const CHAT_LINES = 6;

// ?preview (the dashboard's Open preview link) fills the widgets with sample numbers while offline.
const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview');
const FRAMED = window.top !== window.self; // in the dashboard's preview window
// ?widget=chat (with &goal=<id> for one goal): just that widget, as a browser source of its own. No alerts, feed or sound.
const SINGLE = (WIDGET_TYPES as readonly string[]).includes(params.get('widget') ?? '')
  ? { type: params.get('widget') as ScreenWidget['type'], goalId: params.get('goal') ?? undefined }
  : null;

// The screen each layout is laid out on. Desktop is 1920 by 1080, scaled down to fit a smaller browser source: OBS
// makes new browser sources 800 by 600 and stretches them, which at full size would crowd the corners together. A
// bigger source isn't scaled up: it gets more room, with widgets at their normal size (the screen's Size setting makes
// them bigger). Phone is a portrait stream, 1080 by 1920, scaled to fit whatever its size.
export const LAYOUT_CANVAS: Record<ScreenLayout, { width: number; height: number }> = { desktop: { width: 1920, height: 1080 }, phone: { width: 1080, height: 1920 } };
// Kept clear at the top and bottom of the screen, as fractions of its height: by alerts on desktop, and on phone by
// widgets too, as TikTok's own buttons cover the top of a portrait stream and its chat the bottom.
// A phone screen's come from its phoneSafe, set as --safe-top and --safe-bottom (safeVars) for the CSS and read back here.
export const LAYOUT_SAFE: Record<ScreenLayout, { top: number; bottom: number }> = { desktop: { top: 0.05, bottom: 0.05 }, phone: { top: 0.13, bottom: 0.3 } };
export const safeVars = (safe: PhoneSafe | undefined) => (safe ? ({ '--safe-top': `${safe.top}%`, '--safe-bottom': `${safe.bottom}%` } as CSSProperties) : {});

// How much the layout is scaled for a page this size, and the part of the page it takes. A phone screen opened in a
// browser window to preview is shown at a phone's shape, in the middle.
function fitFor(layout: ScreenLayout, width: number, height: number) {
  const canvas = LAYOUT_CANVAS[layout];
  if (layout === 'desktop') return { fit: Math.min(width / canvas.width, height / canvas.height, 1) || 1, width, left: 0 };
  const shown = PREVIEW ? Math.min(width, (height * canvas.width) / canvas.height) : width;
  return { fit: Math.min(shown / canvas.width, height / canvas.height) || 1, width: shown, left: (width - shown) / 2 };
}
function useFit(layout: ScreenLayout) {
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight });
  useEffect(() => {
    const resize = () => setSize({ width: innerWidth, height: innerHeight });
    addEventListener('resize', resize);
    return () => removeEventListener('resize', resize);
  }, []);
  const { fit, width: shown, left } = fitFor(layout, size.width, size.height);
  const width = shown / fit;
  const height = size.height / fit;
  // The canvas size goes to CSS too, for sizes that would otherwise be in vw and vh of the unscaled page.
  return { width, height, left, transform: `scale(${fit})`, '--canvas-w': `${width}px`, '--canvas-h': `${height}px` } as CSSProperties;
}

// Transparent page meant to sit on top of the stream as a browser source.
export function Overlay({ token }: { token: string }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [live, setLive] = useState(false);
  // clockOffset converts server times to this machine's clock.
  const [mode, setMode] = useState<{ state: ModeState; clockOffset: number; avatar?: string } | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ entries: LeaderboardEntry[]; progression: boolean }>({
    entries: [],
    progression: false,
  });
  const [alert, setAlert] = useState<ShownAlert | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [player] = useState(() => new AlertPlayer(setAlert, setSoundBlocked));
  // What this screen shows. Until the server says, show nothing rather than everything.
  const [screen, setScreen] = useState<OverlayScreen | null>(null);
  const alertBox = useRef<HTMLDivElement>(null);
  const screenRef = useRef<OverlayScreen | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [bus] = useState(() => new GiftBus());
  const preview = usePreview(PREVIEW && !live, bus);
  const fit = useFit(screen?.layout ?? 'desktop');

  useEffect(() => {
    let socket: OverlaySocket;
    let retry: number | undefined;
    let nextId = 0;
    let closed = false;
    player.start();
    // Reports for the server's debug log, sent only once the server asks (it keeps one in development). The last 50
    // wait while the server is away, so what played while it was down still reaches the log.
    const reports: OverlayToServer[] = [];
    let reporting = false;
    const flush = () => {
      if (reporting && socket.readyState === WebSocket.OPEN) for (const r of reports.splice(0)) socket.send(JSON.stringify(r));
    };
    const report = (message: string, data?: Record<string, unknown>) => {
      reports.push({ type: 'log', message, data, at: Date.now() });
      if (reports.length > 50) reports.shift();
      flush();
    };
    player.report = report;

    const connect = () => {
      socket = openOverlaySocket(token, false);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerToOverlay;
        if (message.type === 'debug') {
          reporting = true;
          // The browser source's size decides how much the layout is scaled (see useFit).
          const { fit } = fitFor(screenRef.current?.layout ?? 'desktop', innerWidth, innerHeight);
          report('page size', { width: innerWidth, height: innerHeight, zoom: devicePixelRatio, fit: Math.round(fit * 1000) / 1000 });
        }
        if (message.type === 'screen') {
          // Turned off on this screen: alerts and sound stop now, not after what's waiting.
          const before = screenRef.current;
          if (before?.alerts && !message.screen.alerts) player.dropAlerts("this screen's alerts were turned off");
          if (before?.audio && !message.screen.audio) player.silence();
          screenRef.current = message.screen;
          player.audible = message.screen.audio && !SINGLE;
          setScreen(message.screen);
        }
        const shown = screenRef.current;
        if (message.type === 'live') {
          report(`stream ${message.state}`);
          setLive(message.state === 'started');
          if (message.state === 'started') (setStats(null), setChat([]));
          if (message.state === 'stopped') player.clear();
        }
        if (message.type === 'stats') setStats(message.stats);
        if (message.type === 'chat') setChat((lines) => [...lines, { id: nextId++, viewer: message.viewer, text: message.text, avatar: message.avatar }].slice(-CHAT_LINES));
        if (message.type === 'gift') bus.emit(message);
        if (message.type === 'levelUp') bus.emitLevelUp(message);
        if (message.type === 'mode') setMode({ state: message.state, clockOffset: Date.now() - message.serverNow, avatar: message.avatar });
        if (message.type === 'leaderboard') setLeaderboard({ entries: message.entries, progression: message.progression });
        const add = (item: FeedItem) => {
          setLive(true);
          setItems((current) => [item, ...current].slice(0, MAX_ITEMS));
          setTimeout(() => setItems((current) => current.filter((i) => i.id !== item.id)), ITEM_TTL_MS);
        };
        if (SINGLE) return; // the rest is alerts, speech and the feed
        if (shown?.feed) {
          if (message.type === 'command') add({ id: nextId++, viewer: message.viewer, avatar: message.avatar, keyword: message.keyword, level: message.level });
          // The level-ups widget takes these out of the feed.
          if (message.type === 'levelUp' && !shown.widgets.some((w) => w.type === 'level_ups')) add({ id: nextId++, viewer: message.viewer, avatar: message.avatar, levelUp: message.level });
          if (message.type === 'points') add({ id: nextId++, viewer: message.viewer, avatar: message.avatar, points: message.points });
        }
        // An alert for another screen isn't this one's to show.
        if (message.type === 'alert' && shown?.alerts && (!message.screen || message.screen === shown.id)) player.enqueue(message);
        if (message.type === 'effect' && shown?.alerts && (!message.screen || message.screen === shown.id)) bus.emitEffect(message);
        if (message.type === 'tts') (report('chat line received', { viewer: message.viewer, text: message.text }), player.say(message.speech, true));
        if (message.type === 'clearSpeech') player.clearSpeech(message.chatOnly);
        if (message.type === 'skipSpeech') player.skipSpeech();
        if (message.type === 'dropAlerts') player.dropAlerts('their action was turned off', message.actions);
        if (message.type === 'speechVolume') player.speechVolume(message.volume / 100);
      };
      // A bad token is permanent (4001); anything else is worth retrying.
      socket.onclose = (event) => {
        reporting = false;
        if (!closed) report('lost the server connection', { code: event.code });
        if (!closed && event.code !== 4001) retry = window.setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      socket.close();
      player.stop();
    };
  }, [token, player, bus]);

  // Alerts at the screen's top, middle or bottom step out of the way of widgets. Sizes change as a picture loads.
  const auto = alert && !alert.pos && !revealsInMiddle(alert.fx) && screen && !screen.alertPos ? screen : null;
  // An alert's size is its action's, times the screen's for its alerts.
  const alertScale = ((alert?.scale ?? 100) * (screen?.alertScale ?? 100)) / 100;
  const clear = useClearOfWidgets(alertBox, auto?.alertPosition ?? null, (auto?.scale ?? 100) / 100, alertScale / 100, [alert?.id]);

  // Next frame: the alert has stepped clear of the widgets by then, so the burst comes from where it really is.
  useEffect(() => {
    if (alert?.fx?.effect !== 'emoji_burst') return;
    const { emoji, amount, speed } = alert.fx;
    const next = requestAnimationFrame(() => {
      if (alertBox.current) bus.emitBurst({ box: alertBox.current.getBoundingClientRect(), emoji, amount, speed });
    });
    return () => cancelAnimationFrame(next);
  }, [alert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!screen) return null;
  if (SINGLE) {
    const widget = linkedWidget(screen, SINGLE);
    const shownStats = live ? stats : preview.stats;
    return (
      <div className="overlay-screen" style={{ '--overlay-scale': screen.scale / 100 } as CSSProperties}>
        {PREVIEW && !live && <div className="overlay-preview-note">Preview with sample numbers. Your stream shows real ones.</div>}
        {(live || PREVIEW) && (
          <div className="overlay-spot spot-top-left">
            <Widget widget={widget} stats={shownStats} chat={live ? chat : preview.chat} bus={bus} />
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      <div className={`overlay-fit ${PREVIEW && screen.layout === 'phone' ? 'phone-frame' : ''}`} style={fit}>
        <div className={`overlay-screen layout-${screen.layout} alerts-${screen.alertPosition}`} style={{ '--overlay-scale': screen.scale / 100, ...safeVars(screen.phoneSafe) } as CSSProperties}>
          {/* Alerts show even while offline, so the dashboard's Test button works before going live. */}
          <ScreenEffects bus={bus} />
          {alert && (
            <div
              key={alert.id}
              ref={alertBox}
              className={`overlay-alert ${alertLook(alert.style).className} ${alert.text ? '' : 'media-only'} ${alertFxClass(alert.fx)}`}
              style={{ ...alertLook(alert.style).style, ...alertPlace({ pos: alert.pos ?? (revealsInMiddle(alert.fx) ? MIDDLE : screen.alertPos), scale: alertScale }), ...clear, ...alertFxStyle(alert.fx, alert.durationMs, alert.style) }}
            >
              <AlertContent
                fx={alert.fx}
                text={alert.text}
                media={alert.media && (alert.media.kind === 'image' ? <img className="overlay-alert-media" src={alert.media.url} alt="" /> : <AlertVideo src={alert.media.url} audible={screen.audio} />)}
              />
            </div>
          )}
          {(live || PREVIEW) && (
            <LiveWidgets
              screen={screen}
              mode={screen.mode ? mode : null}
              leaderboard={screen.leaderboard ? (!live && leaderboard.entries.length === 0 ? { ...leaderboard, entries: SAMPLE_LEADERBOARD } : leaderboard) : { entries: [], progression: false }}
              items={!live && items.length === 0 ? SAMPLE_FEED : items}
              stats={live ? stats : preview.stats}
              chat={live ? chat : preview.chat}
              bus={bus}
            />
          )}
        </div>
      </div>
      {/* Notes for whoever has the page open, at the page's own size. */}
      {soundBlocked && screen.audio && (
        <button className="overlay-unblock" onClick={() => player.unblock()}>
          Click to enable alert sounds and voice (not needed in OBS or LIVE Studio)
        </button>
      )}
      {/* Not in the dashboard's preview window, which says so itself. */}
      {PREVIEW && !live && !FRAMED && <div className="overlay-preview-note">Preview with sample numbers. Your stream shows real ones.</div>}
    </>
  );
}

// What the feed, leaderboard and crowd mode panel show in a preview, before anyone has played: the dashboard's editor
// and ?preview both use these, so every part of a screen can be seen where it sits.
export const SAMPLE_FEED: FeedItem[] = [
  { id: -1, viewer: 'nightowl', keyword: 'jump' },
  { id: -2, viewer: 'pixelpanda', keyword: 'left', level: 4 },
  { id: -3, viewer: 'mapleleaf', keyword: 'right', level: 2 },
  { id: -4, viewer: 'riverstone', keyword: 'tnt' },
];
export const SAMPLE_LEADERBOARD: LeaderboardEntry[] = ['nightowl', 'pixelpanda', 'mapleleaf', 'riverstone', 'kitekid', 'sunnyside', 'quietfox', 'bluejay', 'pebble', 'moss'].map(
  (viewer, i) => ({ viewer, name: null, avatar: null, commands: 48 - i * 4, gifts: 0, coins: 0, points: 0, xp: 2400 - i * 220 }),
);
export function sampleMode(mode: Mode): ModeState {
  if (mode === 'democracy') return { mode, tally: [{ keyword: 'jump', votes: 6 }, { keyword: 'left', votes: 4 }, { keyword: 'tnt', votes: 2 }], endsAt: null, lastCommand: null, lastVotes: null, lastDrawAt: null };
  if (mode === 'queue') return { mode, viewer: 'nightowl', endsAt: null, queue: ['pixelpanda', 'mapleleaf'] };
  if (mode === 'raffle') return { mode, entrants: 0, endsAt: null, lastCommand: 'creeper', lastDrawAt: 1 };
  return { mode };
}

const ALERT_GAP = 12; // px of the layout's canvas
const CANVASES = '.overlay-fit, .pos-canvas'; // the overlay's, and the dashboard previews'
const WIDGET_BOXES = '.overlay-spot, .overlay-placed';

// `box` moved clear of the widgets, as an alert at `position` is on stream; null `position` leaves it where it is. The
// overlay and the dashboard's previews share this, so a preview shows the place the alert really gets.
// `paused`: while something's being dragged in an editor, the alert stays put rather than jumping past it as it goes by,
// and moves once it's let go.
export function useClearOfWidgets(box: RefObject<HTMLElement | null>, position: AlertPosition | null, zoom: number, alertScale: number, changes: unknown[], paused = false): CSSProperties {
  const [clear, setClear] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (paused) return;
    const alert = box.current;
    if (!alert || !position) return setClear({});
    // Placed at once, before the browser paints, so it never shows a frame at its usual place first.
    const place = () => setClear((old) => same(old, clearOfWidgets(alert, position, zoom, alertScale)));
    place();
    const resize = new ResizeObserver(place);
    resize.observe(alert);
    alert.closest(CANVASES)!.querySelectorAll(WIDGET_BOXES).forEach((w) => resize.observe(w));
    return () => resize.disconnect();
  }, [position, zoom, alertScale, paused, ...changes]);
  return clear;
}
const same = (old: CSSProperties, next: CSSProperties) => (JSON.stringify(old) === JSON.stringify(next) ? old : next);

// Where an alert at `position` goes to clear the widgets above and below it: from its usual place, it moves past
// each one it would touch, down the screen (up from the bottom). With no free space it stays put.
function clearOfWidgets(box: HTMLElement, position: AlertPosition, zoom: number, alertScale: number): CSSProperties {
  const canvas = box.closest<HTMLElement>(CANVASES)!;
  const page = canvas.getBoundingClientRect();
  const fit = page.width / parseFloat(canvas.style.width); // the browser source's size to the layout's canvas
  const toScreen = fit * zoom;
  const gap = ALERT_GAP * fit;
  const width = box.offsetWidth * alertScale * toScreen;
  const height = box.offsetHeight * alertScale * toScreen;
  const left = page.left + page.width / 2 - width / 2;
  const widgets = [...canvas.querySelectorAll(WIDGET_BOXES)]
    .map((w) => w.getBoundingClientRect())
    .filter((w) => w.height > 0 && w.left < left + width && w.right > left);
  const up = position === 'bottom';
  // Kept clear of the screen's edges (see LAYOUT_SAFE); in the middle, it's the middle of what's left.
  const phone = box.closest<HTMLElement>('.layout-phone');
  const css = phone && getComputedStyle(phone);
  const safe = css ? { top: (parseFloat(css.getPropertyValue('--safe-top')) || 13) / 100, bottom: (parseFloat(css.getPropertyValue('--safe-bottom')) || 30) / 100 } : LAYOUT_SAFE.desktop;
  const [above, below] = [page.height * safe.top, page.height * safe.bottom];
  const usual = position === 'middle' ? page.top + above + (page.height - above - below - height) / 2 : up ? page.bottom - below - height : page.top + above;
  let top = usual;
  for (const w of [...widgets].sort((a, b) => (up ? b.bottom - a.bottom : a.top - b.top))) {
    if (w.top < top + height + gap && w.bottom + gap > top) top = up ? w.top - gap - height : w.bottom + gap;
  }
  if (top === usual || top < page.top || top + height > page.bottom) return {};
  // The alert's scale grows it away from the edge it's kept at, and from its middle when in the middle.
  const edge = (px: number) => `${px / toScreen}px`;
  if (up) return { bottom: edge(page.bottom - top - height) };
  return { top: edge(top - page.top + (position === 'middle' ? height / 2 : 0)) };
}

// A Widget link's widget: the screen's own settings for it, if it has it (the coin jar's target, say), and its link look.
export function linkedWidget(screen: Pick<OverlayScreen, 'widgets' | 'linkStyles'>, w: Pick<ScreenWidget, 'type' | 'goalId'>): ScreenWidget {
  const key = widgetKey(w);
  const look = screen.linkStyles[key];
  return { ...screen.widgets.find((m) => widgetKey(m) === key), ...w, spot: 'top-left', ...(look && { style: look }) };
}

// An alert placed by hand sits with its middle at that point; its size multiplies the screen's.
export function alertPlace({ pos, scale }: { pos: { x: number; y: number } | null; scale: number }): CSSProperties {
  return {
    ...(pos && { top: `${pos.y}%`, left: `${pos.x}%`, bottom: 'auto', transformOrigin: '50% 50%', '--alert-shift': '-50%' }),
    '--alert-scale': scale / 100,
  } as CSSProperties;
}

// Each spot stacks its widgets. The feed, leaderboard and mode panel keep the corners they've always had.
function LiveWidgets({
  screen,
  mode,
  leaderboard,
  items,
  stats,
  chat,
  bus,
}: {
  screen: OverlayScreen;
  mode: { state: ModeState; clockOffset: number; avatar?: string } | null;
  leaderboard: { entries: LeaderboardEntry[]; progression: boolean };
  items: FeedItem[];
  stats: StreamStats | null;
  chat: ChatLine[];
  bus: GiftBus;
}) {
  const spots = Object.fromEntries(WIDGET_SPOTS.map((s) => [s, [] as ReactNode[]])) as Record<WidgetSpot, ReactNode[]>;
  // Widgets placed by hand sit where they were put; the rest stack in their spots.
  const placed: ReactNode[] = [];
  // The feed, leaderboard and mode panel go first in their corners, unless moved; sized by hand, they keep that size.
  const part = (key: OverlayPart, node: ReactNode) => {
    const place = screen.parts?.[key];
    const el = <PartBox key={key} size={place?.size}>{node}</PartBox>;
    if (place?.pos) placed.push(<div key={key} className="overlay-placed" style={{ left: `${place.pos.x}%`, top: `${place.pos.y}%` }}>{el}</div>);
    else spots[PART_SPOTS[key]].push(el);
  };
  if (mode) part('mode', <ModePanel state={mode.state} clockOffset={mode.clockOffset} avatar={mode.avatar} />);
  if (leaderboard.entries.length > 0) part('leaderboard', <Leaderboard leaderboard={leaderboard} size={screen.leaderboardSize} />);
  if (screen.feed) part('feed', <Feed items={items} />);
  // The grouped goals widget leaves out goals that have a widget of their own on this screen.
  const own = new Set(screen.widgets.map((w) => w.goalId).filter(Boolean));
  const grouped = stats && { ...stats, goals: stats.goals.filter((g) => !own.has(g.id)) };
  screen.widgets.forEach((w, i) => {
    const widget = <Widget key={`w${i}`} widget={w} stats={w.type === 'goals' && !w.goalId ? grouped : stats} chat={chat} bus={bus} />;
    if (w.pos) {
      placed.push(
        <div key={`w${i}`} className="overlay-placed" style={{ left: `${w.pos.x}%`, top: `${w.pos.y}%` }}>
          {widget}
        </div>,
      );
    } else spots[w.spot].push(widget);
  });
  return (
    <>
      {WIDGET_SPOTS.map((spot) => (
        <div key={spot} className={`overlay-spot spot-${spot}`}>
          {spots[spot]}
        </div>
      ))}
      {placed}
    </>
  );
}

// The corner each part keeps until it's moved.
export const PART_SPOTS: Record<OverlayPart, WidgetSpot> = { mode: 'top-left', leaderboard: 'top-right', feed: 'bottom-left' };

// A part at a size of its own, in place of the screen's (see .part-box); without one, just the part.
export function PartBox({ size, children }: { size?: number; children: ReactNode }) {
  if (!size) return <>{children}</>;
  return (
    <div className="part-box" style={{ '--p-size': size / 100 } as CSSProperties}>
      {children}
    </div>
  );
}

export function Leaderboard({ leaderboard, size }: { leaderboard: { entries: LeaderboardEntry[]; progression: boolean }; size: number }) {
  return (
    <div className="overlay-panel overlay-leaderboard tone-sky">
      <Title icon="trophy">Top players</Title>
      {leaderboard.entries.slice(0, size).map((entry, i) => (
        <div key={entry.viewer} className="overlay-row">
          {/* The top three get medals. */}
          <span className={`overlay-rank ${i < 3 ? `medal-${i + 1}` : ''}`}>{i + 1}</span>
          <ViewerAvatar name={entry.name ?? entry.viewer} src={entry.avatar} />
          <span className="overlay-name">{entry.name ?? entry.viewer}</span>
          <span className="overlay-score">{leaderboard.progression ? `Lv ${levelForXp(entry.xp)}` : entry.commands}</span>
        </div>
      ))}
    </div>
  );
}

// Who pressed what, level-ups and !points answers, newest at the bottom.
export function Feed({ items }: { items: FeedItem[] }) {
  return (
    <div className="overlay">
      {items.map((item) =>
        'levelUp' in item ? (
          <LevelUpLine key={item.id} viewer={item.viewer} level={item.levelUp} avatar={item.avatar} />
        ) : 'points' in item ? (
          <div key={item.id} className="overlay-item overlay-points">
            <Icon name="coin" size={18} strokeWidth={2.5} />
            <ViewerAvatar className="small" name={item.viewer} src={item.avatar} />
            <span className="overlay-viewer">{item.viewer}</span> has{' '}
            <span className="overlay-keyword">
              {item.points.toLocaleString()} point{item.points === 1 ? '' : 's'}
            </span>
          </div>
        ) : (
          <div key={item.id} className="overlay-item">
            <ViewerAvatar className="small" name={item.viewer} src={item.avatar} />
            <span className="overlay-viewer">{item.viewer}</span>
            {item.level !== undefined && <span className="overlay-level">Lv {item.level}</span>}
            <span className="overlay-keyword">{item.keyword}</span>
          </div>
        ),
      )}
    </div>
  );
}

// Plays with sound where it can. Browsers (not OBS) refuse unmuted autoplay until the page is clicked, so then it plays muted.
function AlertVideo({ src, audible }: { src: string; audible: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current!;
    element.muted = !audible;
    element.play().catch(() => {
      element.muted = true;
      void element.play();
    });
  }, [src, audible]);
  return <video ref={video} className="overlay-alert-media" src={src} playsInline />;
}

export function ModePanel({ state, clockOffset, avatar }: { state: ModeState; clockOffset: number; avatar?: string }) {
  const endsAt = 'endsAt' in state && state.endsAt !== null ? state.endsAt + clockOffset : null;
  const secondsLeft = useCountdown(endsAt);

  if (state.mode === 'democracy') {
    const total = state.tally.reduce((sum, t) => sum + t.votes, 0);
    return (
      <div className="overlay-panel overlay-mode tone-indigo">
        <Title icon="crowd" end={secondsLeft !== null && <span className="overlay-timer">{secondsLeft}s</span>}>
          Vote
        </Title>
        {state.tally.length === 0 && <div className="overlay-muted">Type a command to vote</div>}
        {state.tally.slice(0, MAX_TALLY).map((t) => (
          <div key={t.keyword} className="overlay-bar">
            <div className="overlay-bar-fill" style={{ width: `${(t.votes / total) * 100}%` }} />
            <span className="overlay-keyword">{t.keyword}</span>
            <span className="overlay-score">{t.votes}</span>
          </div>
        ))}
        {/* Between votes, the last winner. Keyed by the vote, so each new winner pops in. */}
        {state.tally.length === 0 && state.lastCommand && (
          <div key={state.lastDrawAt} className="overlay-win">
            <span className="overlay-win-label">Chat voted</span>
            <span className="overlay-win-command">{state.lastCommand}</span>
          </div>
        )}
      </div>
    );
  }

  if (state.mode === 'queue') {
    return (
      <div className="overlay-panel overlay-mode tone-indigo">
        <Title icon="crowd" end={secondsLeft !== null && <span className="overlay-timer">{secondsLeft}s</span>}>
          {state.viewer ? 'Now playing' : 'Nobody playing'}
        </Title>
        {state.viewer && (
          <div className="overlay-player">
            <ViewerAvatar name={state.viewer} src={avatar} />
            {state.viewer}
          </div>
        )}
        {state.queue.length > 0 && <div className="overlay-muted">Next: {state.queue.join(', ')}</div>}
        <div className="overlay-muted">
          Type <span className="overlay-keyword">{QUEUE_JOIN}</span> to play
        </div>
      </div>
    );
  }

  if (state.mode === 'raffle') {
    return (
      <div className="overlay-panel overlay-mode tone-violet">
        <Title icon="ticket" end={secondsLeft !== null && <span className="overlay-timer">{secondsLeft}s</span>}>
          Raffle
        </Title>
        <div className="overlay-muted">
          {state.entrants === 0
            ? 'Type a command to enter'
            : `${state.entrants} entered. One wins in ${secondsLeft ?? 0}s`}
        </div>
        {/* Keyed by the draw, so each new winner pops in, even the same command twice. */}
        {state.lastCommand && (
          <div key={state.lastDrawAt} className="overlay-win">
            <span className="overlay-win-label">Winning command</span>
            <span className="overlay-win-command">{state.lastCommand}</span>
          </div>
        )}
      </div>
    );
  }

  if (state.mode === 'gift') {
    return (
      <div className="overlay-panel overlay-mode tone-amber">
        <Title icon="gift">Send a gift to play!</Title>
      </div>
    );
  }

  return null;
}

// Whole seconds until `endsAt` (local clock), re-rendering as it counts down.
function useCountdown(endsAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [endsAt]);
  return endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
}
