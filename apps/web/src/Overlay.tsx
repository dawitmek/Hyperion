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
  type ModeState,
  type AlertPosition,
  type OverlayScreen,
  type ScreenWidget,
  type OverlayToServer,
  type ServerToOverlay,
  type StreamStats,
  type WidgetSpot,
} from '@hyperion/shared';
import { giftAnimation, GiftBus, LevelUpLine, Title, usePreview, Widget, type ChatLine } from './overlay-widgets';
import { ScreenEffects } from './effects';
import { Icon } from './icons';
import { AlertContent, alertFxClass, alertFxStyle, MIDDLE, revealsInMiddle } from './alert-fx';
import { alertLook } from './alert-style';

// A command, a level-up shout-out, or a viewer's points when they ask.
type FeedItem = { id: number; viewer: string; avatar?: string } & ({ keyword: string; level?: number } | { levelUp: number } | { points: number });

const MAX_ITEMS = 6;
const ITEM_TTL_MS = 8000;
const MAX_TALLY = 4;
const CHAT_LINES = 6;

// ?preview (the dashboard's Open preview link) fills the widgets with sample numbers while offline.
const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview');
// ?widget=chat (with &goal=<id> for one goal): just that widget, as a browser source of its own. No alerts, feed or sound.
const SINGLE = (WIDGET_TYPES as readonly string[]).includes(params.get('widget') ?? '')
  ? { type: params.get('widget') as ScreenWidget['type'], goalId: params.get('goal') ?? undefined }
  : null;

// The overlay is laid out on a 1920 by 1080 screen and scaled down to fit a smaller browser source: OBS makes new
// browser sources 800 by 600 and stretches them, which at full size would crowd the corners together. A bigger source
// isn't scaled up: it gets more room, with widgets at their normal size (the screen's Size setting makes them bigger).
const REFERENCE = { width: 1920, height: 1080 };
function useFit() {
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight });
  useEffect(() => {
    const resize = () => setSize({ width: innerWidth, height: innerHeight });
    addEventListener('resize', resize);
    return () => removeEventListener('resize', resize);
  }, []);
  const fit = Math.min(size.width / REFERENCE.width, size.height / REFERENCE.height, 1) || 1;
  const width = size.width / fit;
  const height = size.height / fit;
  // The canvas size goes to CSS too, for sizes that would otherwise be in vw and vh of the unscaled page.
  return { width, height, transform: `scale(${fit})`, '--canvas-w': `${width}px`, '--canvas-h': `${height}px` } as CSSProperties;
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
  const fit = useFit();

  useEffect(() => {
    let socket: WebSocket;
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
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${location.host}/ws/overlay?token=${encodeURIComponent(token)}`);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerToOverlay;
        if (message.type === 'debug') {
          reporting = true;
          // The browser source's size decides how much the 1920 by 1080 layout is scaled (see useFit).
          const fit = Math.min(innerWidth / REFERENCE.width, innerHeight / REFERENCE.height, 1);
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
  const clear = useClearOfWidgets(alertBox, auto?.alertPosition ?? null, (auto?.scale ?? 100) / 100, (alert?.scale ?? 100) / 100, [alert?.id]);

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
        {(live || PREVIEW) &&
          (widget.type === 'firework' ? (
            <ScreenEffects gifts={giftAnimation(widget)} bus={bus} />
          ) : (
            <div className="overlay-spot spot-top-left">
              <Widget widget={widget} stats={shownStats} chat={live ? chat : preview.chat} bus={bus} />
            </div>
          ))}
      </div>
    );
  }
  return (
    <>
      <div className="overlay-fit" style={fit}>
        <div className={`overlay-screen alerts-${screen.alertPosition}`} style={{ '--overlay-scale': screen.scale / 100 } as CSSProperties}>
          {/* Alerts show even while offline, so the dashboard's Test button works before going live. */}
          <ScreenEffects bus={bus} />
          {alert && (
            <div
              key={alert.id}
              ref={alertBox}
              className={`overlay-alert ${alertLook(alert.style).className} ${alert.text ? '' : 'media-only'} ${alertFxClass(alert.fx)}`}
              style={{ ...alertLook(alert.style).style, ...alertPlace({ pos: alert.pos ?? (revealsInMiddle(alert.fx) ? MIDDLE : screen.alertPos), scale: alert.scale }), ...clear, ...alertFxStyle(alert.fx, alert.durationMs, alert.style) }}
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
              leaderboard={screen.leaderboard ? leaderboard : { entries: [], progression: false }}
              items={items}
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
      {PREVIEW && !live && <div className="overlay-preview-note">Preview with sample numbers. Your stream shows real ones.</div>}
    </>
  );
}

const ALERT_GAP = 12; // px of the 1920 by 1080 layout
const CANVASES = '.overlay-fit, .pos-canvas'; // the overlay's, and the dashboard previews'
const WIDGET_BOXES = '.overlay-spot, .overlay-placed';

// `box` moved clear of the widgets, as an alert at `position` is on stream; null `position` leaves it where it is. The
// overlay and the dashboard's previews share this, so a preview shows the place the alert really gets.
export function useClearOfWidgets(box: RefObject<HTMLElement | null>, position: AlertPosition | null, zoom: number, alertScale: number, changes: unknown[]): CSSProperties {
  const [clear, setClear] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    setClear({});
    const alert = box.current;
    if (!alert || !position) return;
    const place = () => setClear(clearOfWidgets(alert, position, zoom, alertScale));
    const resize = new ResizeObserver(place);
    resize.observe(alert);
    alert.closest(CANVASES)!.querySelectorAll(WIDGET_BOXES).forEach((w) => resize.observe(w));
    return () => resize.disconnect();
  }, [position, zoom, alertScale, ...changes]);
  return clear;
}

// Where an alert at `position` goes to clear the widgets above and below it: from its usual place, it moves past
// each one it would touch, down the screen (up from the bottom). With no free space it stays put.
function clearOfWidgets(box: HTMLElement, position: AlertPosition, zoom: number, alertScale: number): CSSProperties {
  const canvas = box.closest<HTMLElement>(CANVASES)!;
  const page = canvas.getBoundingClientRect();
  const fit = page.width / parseFloat(canvas.style.width); // the browser source's size to the 1920 by 1080 layout
  const toScreen = fit * zoom;
  const gap = ALERT_GAP * fit;
  const width = box.offsetWidth * alertScale * toScreen;
  const height = box.offsetHeight * alertScale * toScreen;
  const left = page.left + page.width / 2 - width / 2;
  const widgets = [...canvas.querySelectorAll(WIDGET_BOXES)]
    .map((w) => w.getBoundingClientRect())
    .filter((w) => w.height > 0 && w.left < left + width && w.right > left);
  const up = position === 'bottom';
  const margin = page.height * 0.05;
  const usual = position === 'middle' ? page.top + (page.height - height) / 2 : up ? page.bottom - margin - height : page.top + margin;
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
  if (mode) spots['top-left'].push(<ModePanel key="mode" state={mode.state} clockOffset={mode.clockOffset} avatar={mode.avatar} />);
  if (leaderboard.entries.length > 0) spots['top-right'].push(<Leaderboard key="leaderboard" leaderboard={leaderboard} size={screen.leaderboardSize} />);
  if (screen.feed) spots['bottom-left'].push(<Feed key="feed" items={items} />);
  // The grouped goals widget leaves out goals that have a widget of their own on this screen.
  const own = new Set(screen.widgets.map((w) => w.goalId).filter(Boolean));
  const grouped = stats && { ...stats, goals: stats.goals.filter((g) => !own.has(g.id)) };
  // Widgets placed by hand sit where they were put; the rest stack in their spots.
  const placed: ReactNode[] = [];
  screen.widgets.forEach((w, i) => {
    const widget = <Widget key={`w${i}`} widget={w} stats={w.type === 'goals' && !w.goalId ? grouped : stats} chat={chat} bus={bus} />;
    if (w.pos && w.type !== 'firework') {
      placed.push(
        <div key={`w${i}`} className="overlay-placed" style={{ left: `${w.pos.x}%`, top: `${w.pos.y}%` }}>
          {widget}
        </div>,
      );
    } else spots[w.spot].push(widget);
  });
  const firework = screen.widgets.find((w) => w.type === 'firework');
  return (
    <>
      {firework && <ScreenEffects gifts={giftAnimation(firework)} bus={bus} />}
      {WIDGET_SPOTS.map((spot) => (
        <div key={spot} className={`overlay-spot spot-${spot}`}>
          {spots[spot]}
        </div>
      ))}
      {placed}
    </>
  );
}

function Leaderboard({ leaderboard, size }: { leaderboard: { entries: LeaderboardEntry[]; progression: boolean }; size: number }) {
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
function Feed({ items }: { items: FeedItem[] }) {
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

function ModePanel({ state, clockOffset, avatar }: { state: ModeState; clockOffset: number; avatar?: string }) {
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
