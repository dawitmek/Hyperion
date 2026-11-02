import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { type ActionEffect, EFFECT_SPEEDS, ALERT_POSITIONS, DEFAULT_MESSAGE, MAX_MESSAGE_LENGTH, GOAL_METRICS, WIDGET_PRESETS, WIDGET_STYLE_LIMITS, widgetKey, MAX_LEADERBOARD_SIZE, MAX_WIDGETS, MIN_LEADERBOARD_SIZE, WIDGET_SPOTS, WIDGET_TYPES, type AlertStyle, type GoalMetric, type GoalRaise, type ScreenWidget, type StreamStats, type WidgetSpot, type WidgetStyle, type WidgetType } from '@hyperion/shared';
import { api, type AlertPosition, type Goal, type Screen } from '../api';
import { alertLook } from '../alert-style';
import { FontPicker } from './FontPicker';
import { alertPlace, linkedWidget, useClearOfWidgets } from '../Overlay';
import { dragAlert } from './alert-drag';
import { ColorField } from './AlertLookEditor';
import { Card, ConfirmButton, ErrorNotice, HueIcon, NumberCell, Scrubber, Seg, TextCell, useError, type Hue } from '../ui';
import { Icon, type IconName } from '../icons';
import { EFFECT_LABELS, ScreenEffects } from '../effects';
import { EffectOptions, speedLabel } from './EffectFields';
import { DEFAULT_FIREWORK_DIAMONDS, giftAnimation, GiftBus, usePreview, Widget, type ChatLine } from '../overlay-widgets';
import type { PageProps } from './Dashboard';

const effectName = (effect: ActionEffect) => (effect === 'random' ? 'Random animation' : EFFECT_LABELS[effect]);

const POSITION_LABELS: Record<AlertPosition, string> = { top: 'Top', middle: 'Middle', bottom: 'Bottom' };

export function OverlayPage({ host, refreshHost }: PageProps) {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  // A new overlay lands below the main one and the notes, likely out of view.
  useEffect(() => {
    if (added) document.getElementById(`screen-${added}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [added]);
  const { error, guard } = useError();
  const [goals, setGoals] = useState<Goal[]>([]);
  const load = useCallback(() => api<Screen[]>('GET', '/screens').then(setScreens), []);
  const loadGoals = useCallback(() => api<Goal[]>('GET', '/goals').then(setGoals), []);
  useEffect(() => void (load(), loadGoals()), [load, loadGoals]);
  const main = screens.find((s) => s.main);
  const card = (s: Screen) => <ScreenCard key={s.id} screen={s} goals={goals} alertStyle={host.alertStyle} reload={load} refreshHost={refreshHost} />;
  const add = (e: FormEvent) => {
    e.preventDefault();
    guard(async () => {
      const created = await api<Screen>('POST', '/screens', { name });
      await load();
      setName('');
      setAdding(false);
      setAdded(created.id);
    })();
  };

  return (
    <div className="stack">
      <div className="page-tools">
        {adding ? (
          <form className="row" onSubmit={add}>
            <input
              className="input"
              autoFocus
              placeholder="Overlay name, e.g. Alerts corner"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={40}
              aria-label="New overlay name"
            />
            <button className="btn btn-primary">Add</button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            Add overlay
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      {main && card(main)}
      {screens.filter((s) => !s.main).map(card)}
      {main && <WidgetLinksCard main={main} goals={goals} reload={load} />}
      {/* Deleting a goal also takes its widgets off the screens. */}
      <GoalsCard goals={goals} reload={() => Promise.all([loadGoals(), load()])} />
    </div>
  );
}

// Colored by what they show: gifts amber, followers sky, chat indigo, numbers teal, goals violet.
const WIDGETS: Record<WidgetType, { label: string; help: string; spot: WidgetSpot; icon: IconName; hue: Hue }> = {
  goals: { label: 'Goals (grouped)', help: "Goals together in one panel, except ones with a widget of their own.", spot: 'top', icon: 'target', hue: 'violet' },
  top_gift: { label: 'Top gift', help: "The stream's most valuable gift and who sent it.", spot: 'top-right', icon: 'trophy', hue: 'amber' },
  top_streak: { label: 'Longest streak', help: 'The biggest gift combo so far.', spot: 'top-right', icon: 'flame', hue: 'orange' },
  last_follower: { label: 'Latest follower', help: 'Who followed last.', spot: 'bottom-right', icon: 'follower', hue: 'sky' },
  last_gifter: { label: 'Latest gift', help: 'Who sent the last gift, and what.', spot: 'bottom-right', icon: 'gift', hue: 'amber' },
  stats: { label: 'Stream stats', help: 'Viewers, likes, follows and coins this stream.', spot: 'top', icon: 'analytics', hue: 'teal' },
  chat: { label: 'Chat', help: 'The last few chat messages.', spot: 'bottom-right', icon: 'chat', hue: 'indigo' },
  coin_jar: { label: 'Coin jar', help: 'Gifts drop coins into a jar that fills toward a target.', spot: 'bottom-right', icon: 'coin', hue: 'amber' },
  level_ups: { label: 'Level-ups', help: 'Level-up shout-outs in a spot of their own, instead of in the command feed.', spot: 'left', icon: 'star', hue: 'orange' },
  message: { label: 'Custom message', help: 'Your own text on the screen, like how to play.', spot: 'bottom-left', icon: 'chat', hue: 'indigo' },
  firework: { label: 'Gift screen animation', help: 'A screen animation for big gifts.', spot: 'top', icon: 'sparkle', hue: 'pink' },
};
const SPOT_LABELS: Record<WidgetSpot, string> = {
  'top-left': 'Top left',
  top: 'Top',
  'top-right': 'Top right',
  left: 'Left',
  right: 'Right',
  'bottom-left': 'Bottom left',
  bottom: 'Bottom',
  'bottom-right': 'Bottom right',
};

// A tiny map of the screen with the widget's spot lit; every spot for one that covers the whole screen.
// A widget placed by hand shows as a dot where it sits.
function SpotMap({ spot, pos, hue }: { spot: WidgetSpot | null; pos?: ScreenWidget['pos']; hue: Hue }) {
  return (
    <span className={`spot-map ${hue} ${pos ? 'placed' : ''}`} aria-hidden="true">
      {pos ? (
        <span className="spot-dot" style={{ left: `${pos.x}%`, top: `${pos.y}%` }} />
      ) : (
        WIDGET_SPOTS.map((s) => <span key={s} className={spot === null || spot === s ? 'lit' : ''} />)
      )}
    </span>
  );
}

// A widget's name and look. A goal's own widget is named after the goal and drawn like what it counts.
function widgetInfo(w: Pick<ScreenWidget, 'type' | 'goalId'>, goals: Goal[]) {
  if (!w.goalId) return WIDGETS[w.type];
  const goal = goals.find((g) => g.id === w.goalId);
  return { ...WIDGETS.goals, label: goal?.name ?? 'Goal', help: "Just this goal's progress bar.", ...(goal && METRIC_ICONS[goal.metric]) };
}
// Each widget once per screen: a type, or one goal's own.
const without = ({ style: _style, ...widget }: ScreenWidget): ScreenWidget => widget;
// Into a spot, below whatever is there already: a spot stacks its widgets in list order, so it moves to the end.
// The hand-placed position goes. Already in that spot, it stays where it is.
function moveToSpot(widgets: ScreenWidget[], i: number, spot: WidgetSpot): ScreenWidget[] {
  const { pos, ...widget } = widgets[i]!;
  if (!pos && widget.spot === spot) return widgets;
  return [...widgets.filter((_, j) => j !== i), { ...widget, spot }];
}

const HOVER_MS = 200;
const HOVER_HEIGHT = 200; // .widget-hover's height

// A small live preview by a widget's row, under it unless that runs off the window. The mouse can't reach it.
function HoverPreview({ widget, row }: { widget: ScreenWidget; row: DOMRect }) {
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(true, bus);
  const below = row.bottom + HOVER_HEIGHT + 8 < innerHeight;
  return (
    <div className="widget-hover" aria-hidden="true" style={{ top: below ? row.bottom + 4 : row.top - HOVER_HEIGHT - 4, right: innerWidth - row.right }}>
      <PreviewStage widget={widget} feed={{ stats, chat, bus }} compact />
    </div>
  );
}

// Where a widget is, for its row in the list.
function widgetPlace(w: ScreenWidget) {
  if (w.type === 'firework') return `${effectName(w.effect ?? 'fireworks')}, from ${giftAnimation(w).min.toLocaleString()} coins`;
  return w.pos ? 'Custom position' : SPOT_LABELS[w.spot];
}

type AlertSpot = Pick<Screen, 'alertPosition' | 'alertPos'>;

function WidgetsEditor({ widgets, goals, scale, alertSpot, alertStyle, onSave }: { widgets: ScreenWidget[]; goals: Goal[]; scale: number; alertSpot: AlertSpot | null; alertStyle: AlertStyle | null; onSave: (widgets: ScreenWidget[], alertSpot?: AlertSpot) => void }) {
  const [positioning, setPositioning] = useState<number | 'all' | null>(null); // one widget, or every one
  const [hovered, setHovered] = useState<{ widget: ScreenWidget; row: DOMRect } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const endHover = () => (clearTimeout(hoverTimer.current), setHovered(null));
  // A moment's wait, so moving the mouse across the list doesn't flash a preview for every row.
  const startHover = (widget: ScreenWidget, row: HTMLElement) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered({ widget, row: row.getBoundingClientRect() }), HOVER_MS);
  };
  useEffect(() => {
    if (!hovered) return;
    addEventListener('scroll', endHover, true); // it's placed by the row, which has moved
    return () => removeEventListener('scroll', endHover, true);
  }, [hovered]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const used = new Set(widgets.map(widgetKey));
  const types = WIDGET_TYPES.filter((t) => !used.has(t));
  const ownGoals = goals.filter((g) => !used.has(`goal:${g.id}`));
  const options: WidgetChoice[] = [...types.map((type) => ({ type })), ...ownGoals.map((g) => ({ type: 'goals' as const, goalId: g.id }))];
  const add = (w: WidgetChoice) => onSave([...widgets, { ...w, spot: w.goalId ? 'top' : WIDGETS[w.type].spot }]);

  return (
    <div className="stack">
      <div className="row">
        <h3>
          Widgets {widgets.length > 0 && <span className="tag">{widgets.length}</span>}
        </h3>
        {(alertSpot || widgets.some((w) => w.type !== 'firework')) && (
          <>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => setPositioning('all')} title="See your widgets and alerts on one screen and drag them into place">
              <Icon name="layout" />
              Arrange on screen
            </button>
          </>
        )}
      </div>
      {widgets.length === 0 ? (
        <p className="muted small">None yet. They show while you're live or in test mode, in the spot you pick. Widgets in the same spot stack.</p>
      ) : (
        <ul className="list">
          {widgets.map((w, i) => {
            const info = widgetInfo(w, goals);
            return (
              <li key={widgetKey(w)}>
                <button
                  className="widget-row"
                  onClick={() => (endHover(), setPositioning(i))}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && startHover(w, e.currentTarget)}
                  onPointerLeave={endHover}
                  aria-label={`Edit ${info.label}`}
                >
                  <HueIcon name={info.icon} hue={info.hue} />
                  <strong className="widget-row-name">{info.label}</strong>
                  <span className="muted small">{widgetPlace(w)}</span>
                  {w.style && (
                    <span className="widget-row-look muted small">
                      <i style={{ background: w.style.accent }} aria-hidden="true" />
                      Custom look
                    </span>
                  )}
                  <span className="spacer" />
                  <SpotMap spot={w.type === 'firework' ? null : w.spot} pos={w.type === 'firework' ? undefined : w.pos} hue={info.hue} />
                  <span className="widget-row-go" aria-hidden="true">
                    <Icon name="chevron" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hovered && <HoverPreview widget={hovered.widget} row={hovered.row} />}
      {options.length > 0 && widgets.length < MAX_WIDGETS && <WidgetPicker options={options} goals={goals} onAdd={add} />}
      {(positioning === 'all' || (positioning !== null && widgets[positioning])) && (
        <PositionDialog
          widgets={widgets}
          index={positioning === 'all' ? null : positioning}
          goals={goals}
          scale={scale}
          alertSpot={alertSpot}
          alertStyle={alertStyle}
          onSave={onSave}
          onClose={() => setPositioning(null)}
        />
      )}
    </div>
  );
}

const LINKS_SHOWN = 8; // four rows of two, then the rest behind Show more

// Every widget, and every goal on its own, as a browser source of its own: for a stream that wants just the chat, say.
// Laid out like the widget picker, each card showing its widget. One sample feed drives them all.
// A Widget link's look, apart from the widget on the Main screen. Default goes back to following that one.
function LinkLookDialog({ widget, label, value, feed, onSave, onClose }: { widget: ScreenWidget; label: string; value: WidgetStyle | undefined; feed: PreviewFeed; onSave: (style: WidgetStyle | undefined) => void; onClose: () => void }) {
  const [style, setStyle] = useState(value);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return (
    <dialog ref={dialog} className="pos-dialog" onClose={onClose} aria-labelledby="link-look-title">
      <div className="pos-head">
        <div>
          <h2 id="link-look-title">{label}: link look</h2>
          <p className="muted small">Only for this widget's link. On your Main overlay it keeps its own look.</p>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dialog.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div className="widget-look-grid">
        <PreviewStage widget={style ? { ...widget, style } : widget} feed={feed} />
        <WidgetLookControls value={style} onChange={setStyle} />
      </div>
      <div className="pos-foot">
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={() => dialog.current?.close()}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => onSave(style)}>
          Save look
        </button>
      </div>
    </dialog>
  );
}

function WidgetLinksCard({ main, goals, reload }: { main: Screen; goals: Goal[]; reload: () => Promise<unknown> }) {
  const [styling, setStyling] = useState<WidgetChoice | null>(null);
  const { error, guard } = useError();
  const saveLook = (key: string, style: WidgetStyle | undefined) =>
    guard(async () => {
      // Goals deleted since go too.
      const keep = all.map(widgetKey).filter((k) => k !== key && main.linkStyles[k]);
      const linkStyles = Object.fromEntries([...keep.map((k) => [k, main.linkStyles[k]!] as const), ...(style ? [[key, style] as const] : [])]);
      await api('PATCH', `/screens/${main.id}`, { linkStyles });
      await reload();
      setStyling(null);
    })();
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(true, bus);
  const help = (w: WidgetChoice) => (w.type === 'goals' && !w.goalId ? 'Every goal together in one panel.' : widgetInfo(w, goals).help);
  const link = (w: WidgetChoice) => `${location.origin}/overlay/${main.token}?widget=${w.type}${w.goalId ? `&goal=${w.goalId}` : ''}`;
  const all: WidgetChoice[] = [...WIDGET_TYPES.map((type) => ({ type })), ...goals.map((g) => ({ type: 'goals' as const, goalId: g.id }))];
  // Matches a widget's name or description; a goal's own widget also by what it counts. Every match shows.
  const query = search.trim().toLowerCase();
  const words = (w: WidgetChoice) => {
    const goal = w.goalId && goals.find((g) => g.id === w.goalId);
    return [widgetInfo(w, goals).label, help(w), goal ? METRIC_LABELS[goal.metric] : ''].join(' ').toLowerCase();
  };
  const found = query ? all.filter((w) => words(w).includes(query)) : all;
  const shown = query || expanded ? found : found.slice(0, LINKS_SHOWN);
  return (
    <Card
      title="Widget links"
      description="Each widget on its own, as a browser source of its own, without a whole screen. Customize gives a link its own look. Size and the coin jar and fireworks amounts follow your Main screen. Previews use sample viewers and gifts. Keep the links private."
    >
      <input
        className="input"
        type="search"
        placeholder="Find a widget, like chat or coins"
        aria-label="Find a widget"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ErrorNotice error={error} />
      {styling && (
        <LinkLookDialog
          widget={linkedWidget({ ...main, linkStyles: {} }, styling)}
          label={widgetInfo(styling, goals).label}
          value={main.linkStyles[widgetKey(styling)]}
          feed={{ stats, chat, bus }}
          onSave={(style) => saveLook(widgetKey(styling), style)}
          onClose={() => setStyling(null)}
        />
      )}
      {found.length === 0 && <p className="empty">No widget matches “{search.trim()}”.</p>}
      <div className="widget-picker">
        {shown.map((w) => {
          const info = widgetInfo(w, goals);
          const key = widgetKey(w);
          return (
            <div key={key} className="picker-card">
              <div className="picker-head">
                <HueIcon name={info.icon} hue={info.hue} />
                <span className="widget-name">
                  <strong>{info.label}</strong>
                  <span className="muted small">{help(w)}</span>
                </span>
                {w.type !== 'firework' && (
                  <button className="btn btn-ghost btn-sm" aria-label={`Customize ${info.label} link`} onClick={() => setStyling(w)}>
                    Customize
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(link(w)).then(() => setCopied(key))}>
                  {copied === key ? 'Copied' : 'Copy link'}
                </button>
              </div>
              {/* With the Main screen's settings for it and its link look, as the link uses them. */}
              <PreviewStage widget={linkedWidget(main, w)} feed={{ stats, chat, bus }} compact />
            </div>
          );
        })}
      </div>
      {!query && all.length > LINKS_SHOWN && (
        <button className="line-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show ${all.length - LINKS_SHOWN} more widget${all.length - LINKS_SHOWN === 1 ? '' : 's'}`}
          <Icon name="chevron" />
        </button>
      )}
    </Card>
  );
}

// The screen's widgets, faded, where they sit on stream: what something is placed against (see the Actions page).
export function FadedWidgets({ widgets, feed }: { widgets: ScreenWidget[]; feed: PreviewFeed }) {
  const own = new Set(widgets.map((w) => w.goalId).filter(Boolean));
  const spots = Object.fromEntries(WIDGET_SPOTS.map((s) => [s, [] as ReactNode[]])) as Record<WidgetSpot, ReactNode[]>;
  const placed: ReactNode[] = [];
  widgets.forEach((w, i) => {
    if (w.type === 'firework') return;
    const stats = w.type === 'goals' && !w.goalId && feed.stats ? { ...feed.stats, goals: feed.stats.goals.filter((g) => !own.has(g.id)) } : feed.stats;
    const el = (
      <div key={i} className="pos-other">
        <Widget widget={w} stats={stats} chat={feed.chat} bus={feed.bus} />
      </div>
    );
    if (w.pos) placed.push(<div key={i} className="overlay-placed" style={{ left: `${w.pos.x}%`, top: `${w.pos.y}%` }}>{el}</div>);
    else spots[w.spot].push(el);
  });
  return (
    <>
      {WIDGET_SPOTS.map((s) => (
        <div key={s} className={`overlay-spot spot-${s}`}>
          {spots[s]}
        </div>
      ))}
      {placed}
    </>
  );
}

// The screen as a 1920 by 1080 canvas, drawn smaller to fit. Widgets keep their real size against it.
export const CANVAS = { width: 1920, height: 1080 };

const ALERT_KEY = 'alerts'; // the sample alert, picked like a widget
const SAMPLE_ALERT = 'nightowl sent 5× Rose!'; // as wide as a real one: a wider alert has more widgets to clear

// With no index, every widget on the screen and its alerts: drag them anywhere, or snap the one picked to a spot. With one, everything
// about that widget: where it goes, with the screen's others faded behind it, how it looks, and removing it. Fireworks
// cover the whole screen, so they have no place or look of their own.
function PositionDialog({
  widgets,
  index,
  goals,
  scale,
  alertSpot,
  alertStyle,
  onSave,
  onClose,
}: {
  widgets: ScreenWidget[];
  index: number | null;
  goals: Goal[];
  scale: number;
  alertSpot: AlertSpot | null; // null when the screen doesn't show alerts
  alertStyle: AlertStyle | null;
  onSave: (widgets: ScreenWidget[], alertSpot?: AlertSpot) => void;
  onClose: () => void;
}) {
  // Saving keeps the window open, and a save can reorder the screen's list (snapping moves a widget to the end of its
  // spot), so `index` means the list as it was when the window opened.
  const [opened] = useState(widgets);
  const [draft, setDraft] = useState<ScreenWidget[]>(widgets);
  const [saved, setSaved] = useState<ScreenWidget[]>(widgets); // what the screen has now
  const [alertOpened] = useState(alertSpot);
  const [alertDraft, setAlertDraft] = useState(alertSpot);
  const [alertSaved, setAlertSaved] = useState(alertSpot);
  const changed = draft !== saved || alertDraft !== alertSaved;
  // By key, not place in the list: snapping to a spot moves a widget to the end.
  const movable = (w: ScreenWidget) => (index === null ? w.type !== 'firework' : widgetKey(w) === widgetKey(opened[index]!));
  const [picked, setPicked] = useState(() => {
    const first = opened[index ?? opened.findIndex((w) => w.type !== 'firework')];
    return first ? widgetKey(first) : ALERT_KEY;
  });
  const info = index === null ? { label: 'Every widget', icon: 'layout' as const, hue: 'indigo' as const } : widgetInfo(opened[index]!, goals);
  const fixedPlace = index !== null && opened[index]!.type === 'firework';
  const [tab, setTab] = useState<'position' | 'look'>('position');
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.4); // canvas pixels to stage pixels
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(true, bus);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useLayoutEffect(() => {
    const measure = () => stage.current && setFit(stage.current.clientWidth / CANVAS.width);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(stage.current!);
    return () => resize.disconnect();
  }, []);

  const place = (key: string, patch: Partial<ScreenWidget>) => setDraft((d) => d.map((w) => (widgetKey(w) === key ? { ...w, ...patch } : w)));
  // Dragging moves a widget's top-left corner, kept on the screen, and picks it. Listens on the window: the widget
  // moves out of its spot into a place of its own as the drag starts.
  const startDrag = (key: string, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setPicked(key);
    const box = stage.current!.getBoundingClientRect();
    const target = e.currentTarget.getBoundingClientRect();
    const grab = { x: e.clientX - target.left, y: e.clientY - target.top };
    const size = { x: (target.width / box.width) * 100, y: (target.height / box.height) * 100 };
    const clamp = (n: number, max: number) => Math.round(Math.min(Math.max(n, 0), Math.max(0, max)) * 10) / 10;
    const move = (m: PointerEvent) => {
      const x = clamp(((m.clientX - box.left - grab.x) / box.width) * 100, 100 - size.x);
      const y = clamp(((m.clientY - box.top - grab.y) / box.height) * 100, 100 - size.y);
      place(key, { pos: { x, y } });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  const snap = (spot: WidgetSpot) => setDraft((d) => moveToSpot(d, d.findIndex((w) => widgetKey(w) === picked), spot));

  const own = new Set(opened.map((w) => w.goalId).filter(Boolean));
  const statsFor = (w: ScreenWidget) => (w.type === 'goals' && !w.goalId && stats ? { ...stats, goals: stats.goals.filter((g) => !own.has(g.id)) } : stats);
  const draw = (w: ScreenWidget) => <Widget widget={w} stats={statsFor(w)} chat={chat} bus={bus} />;
  // The ones to move, outlined, the one picked brightest; anything else faded, where it sits on stream.
  const spots = Object.fromEntries(WIDGET_SPOTS.map((s) => [s, [] as ReactNode[]])) as Record<WidgetSpot, ReactNode[]>;
  const placed: ReactNode[] = [];
  draft.forEach((w) => {
    if (w.type === 'firework') return;
    const key = widgetKey(w);
    const el = movable(w) ? (
      <div key={key} className={`pos-target ${index === null && key !== picked ? 'unpicked' : ''}`} onPointerDown={(e) => startDrag(key, e)}>
        {draw(w)}
      </div>
    ) : (
      <div key={key} className="pos-other">
        {draw(w)}
      </div>
    );
    if (w.pos) placed.push(<div key={key} className="overlay-placed" style={{ left: `${w.pos.x}%`, top: `${w.pos.y}%` }}>{el}</div>);
    else spots[w.spot].push(el);
  });
  const current = draft.find((w) => widgetKey(w) === picked);
  const alertLooks = alertLook(alertStyle);
  const alertBox = useRef<HTMLDivElement>(null);
  const clear = useClearOfWidgets(alertBox, index === null && alertDraft && !alertDraft.alertPos ? alertDraft.alertPosition : null, scale / 100, 1, [draft, fit]);
  const alertMoved = Object.keys(clear).length > 0;
  const single = index !== null;
  const remove = () => {
    onSave(saved.filter((w) => widgetKey(w) !== picked));
    dialog.current?.close();
  };

  return (
    <dialog ref={dialog} className="pos-dialog" onClose={onClose} aria-labelledby="pos-title">
      <div className="pos-head">
        <HueIcon name={info.icon} hue={info.hue} />
        <div>
          <h2 id="pos-title">{info.label}</h2>
          <p className="muted small">
            {fixedPlace
              ? 'Gift animations cover the whole screen. Sample gifts set them off.'
              : index === null
                ? `Drag any widget${alertDraft ? ' or the sample alert' : ''} anywhere. The one you moved last is picked: snap it to a spot below. Sample viewers and gifts.`
                : tab === 'position'
                  ? 'Drag the widget anywhere, or snap it to a spot. Your other widgets show faded. Sample viewers and gifts.'
                  : 'Pick a preset, or any colors you like. Sample viewers and gifts.'}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dialog.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      {single && !fixedPlace && (
        <div className="widget-tabs" role="tablist" aria-label="Widget settings">
          {(
            [
              ['position', 'Position', 'Where it sits on the screen', 'layout'],
              ['look', 'Look', 'Colors, font and size', 'sparkle'],
            ] as const
          ).map(([id, name, hint, icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className="widget-tab" onClick={() => setTab(id)}>
              <Icon name={icon} size={18} />
              <span>
                <strong>{name}</strong>
                <span className="small">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {tab === 'look' && current && (
        <div className="widget-look-grid">
          <PreviewStage widget={current} feed={{ stats, chat, bus }} />
          <WidgetLookControls value={current.style} onChange={(style) => setDraft((d) => d.map((w) => (widgetKey(w) === picked ? (style ? { ...w, style } : without(w)) : w)))} />
        </div>
      )}
      <div className="pos-stage" ref={stage} hidden={tab === 'look'} style={{ aspectRatio: `${CANVAS.width} / ${CANVAS.height}` }}>
        <div className="pos-canvas" style={{ ...CANVAS, transform: `scale(${fit})` }}>
          <div className={`overlay-screen ${alertDraft ? `alerts-${alertDraft.alertPosition}` : ''}`} style={{ '--overlay-scale': scale / 100 } as CSSProperties}>
            {fixedPlace && <ScreenEffects gifts={giftAnimation(opened[index]!)} bus={bus} />}
            {WIDGET_SPOTS.map((s) => (
              <div key={s} className={`overlay-spot spot-${s}`}>
                {spots[s]}
              </div>
            ))}
            {placed}
            {index === null && alertDraft && (
              <div
                ref={alertBox}
                className={`overlay-alert alert-drag ${alertLooks.className} ${picked === ALERT_KEY ? '' : 'unpicked'}`}
                style={{ ...alertLooks.style, ...alertPlace({ pos: alertDraft.alertPos, scale: 100 }), ...clear }}
                onPointerDown={(e) => {
                  setPicked(ALERT_KEY);
                  dragAlert(e, stage.current!, (alertPos) => setAlertDraft((a) => ({ ...a!, alertPos })));
                }}
              >
                <span>{SAMPLE_ALERT}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      {(current || picked === ALERT_KEY) && (
        <div className="pos-foot">
          {picked === ALERT_KEY && alertDraft && (
            <>
              <div className="pos-spots" role="group" aria-label="Snap alerts to a spot">
                {ALERT_POSITIONS.map((p) => (
                  <button key={p} type="button" className={`btn btn-sm ${!alertDraft.alertPos && alertDraft.alertPosition === p ? 'on' : ''}`} aria-pressed={!alertDraft.alertPos && alertDraft.alertPosition === p} onClick={() => setAlertDraft({ alertPosition: p, alertPos: null })}>
                    {POSITION_LABELS[p]}
                  </button>
                ))}
              </div>
              <span className="muted small">
                <strong>Alerts: </strong>
                {alertDraft.alertPos ? `Custom: ${Math.round(alertDraft.alertPos.x)}% across, ${Math.round(alertDraft.alertPos.y)}% down` : `In the ${POSITION_LABELS[alertDraft.alertPosition].toLowerCase()} spot${alertMoved ? ', moved clear of your widgets' : ''}`}. Actions you placed by hand keep their own place.
              </span>
            </>
          )}
          {current && !fixedPlace && tab === 'position' && (
            <>
              <div className="pos-spots" role="group" aria-label={`Snap ${widgetInfo(current, goals).label} to a spot`}>
                {WIDGET_SPOTS.map((s) => (
                  <button key={s} type="button" className={`btn btn-sm ${!current.pos && current.spot === s ? 'on' : ''}`} aria-pressed={!current.pos && current.spot === s} onClick={() => snap(s)}>
                    {SPOT_LABELS[s]}
                  </button>
                ))}
              </div>
              <span className="muted small">
                {index === null && <strong>{widgetInfo(current, goals).label}: </strong>}
                {current.pos ? `Custom: ${Math.round(current.pos.x)}% across, ${Math.round(current.pos.y)}% down` : `In the ${SPOT_LABELS[current.spot].toLowerCase()} spot`}
              </span>
            </>
          )}
          {single && current?.type === 'message' && (
            <label className="field widget-message-field">
              Message
              <input
                className="input"
                value={current.text ?? DEFAULT_MESSAGE}
                required
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(e) => place(picked, { text: e.target.value })}
              />
            </label>
          )}
          {single && current?.type === 'firework' && (
            <>
            <label className="row" style={{ flexWrap: 'nowrap' }}>
              <span className="muted small">Screen animation</span>
              <select className="input" value={current.effect ?? 'fireworks'} onChange={(e) => place(picked, { effect: e.target.value as ActionEffect })}>
                <EffectOptions />
              </select>
            </label>
            <label className="row" style={{ flexWrap: 'nowrap' }}>
              <span className="muted small">Speed</span>
              <select className="input" value={current.effectSpeed ?? 100} onChange={(e) => place(picked, { effectSpeed: Number(e.target.value) })}>
                {EFFECT_SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speedLabel(speed)}
                  </option>
                ))}
              </select>
            </label>
            </>
          )}
          {single && (current?.type === 'firework' || current?.type === 'coin_jar') && (
            <label className="row" style={{ flexWrap: 'nowrap' }}>
              <span className="muted small">{current.type === 'firework' ? 'From' : 'Full at'}</span>
              <NumberCell
                value={current.minDiamonds ?? (current.type === 'firework' ? DEFAULT_FIREWORK_DIAMONDS : 1000)}
                min={1}
                max={10_000_000}
                label={current.type === 'firework' ? 'Animation for gifts worth at least, in coins' : 'Coins that fill the jar'}
                onSave={(minDiamonds) => place(picked, { minDiamonds })}
              />
              <span className="muted small">coins</span>
            </label>
          )}
          <span className="spacer" />
          {single && (
            <button className="btn btn-ghost btn-delete" onClick={remove}>
              Remove widget
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => dialog.current?.close()}>
            {changed ? 'Cancel' : 'Close'}
          </button>
          <button
            className="btn btn-primary"
            disabled={!single && !changed} // a coin amount only reaches the draft as focus leaves it, on the way to this button
            onClick={() => {
              onSave(draft.map((w) => (w.type === 'message' && !w.text?.trim() ? { ...w, text: DEFAULT_MESSAGE } : w)), alertDraft !== alertSaved && alertDraft ? alertDraft : undefined);
              if (single) dialog.current?.close();
              else (setSaved(draft), setAlertSaved(alertDraft));
            }}
          >
            {single ? 'Save' : !changed && (saved !== opened || alertSaved !== alertOpened) ? 'Saved' : 'Save positions'}
          </button>
        </div>
      )}
    </dialog>
  );
}

type WidgetChoice = Pick<ScreenWidget, 'type' | 'goalId'>;
export type PreviewFeed = { stats: StreamStats | null; chat: ChatLine[]; bus: GiftBus };

// The widget as it looks on stream, over a stand-in for the stream, fed sample viewers and gifts.
function PreviewStage({ widget, feed, compact }: { widget: ScreenWidget; feed: PreviewFeed; compact?: boolean }) {
  const goals = widget.goalId ? feed.stats?.goals.filter((g) => g.id === widget.goalId) : feed.stats?.goals;
  return (
    <div className={`widget-stage ${compact ? 'compact' : ''}`}>
      {widget.type === 'firework' ? (
        <ScreenEffects gifts={giftAnimation(widget)} bus={feed.bus} />
      ) : (
        <Widget widget={widget} stats={feed.stats} chat={feed.chat} bus={feed.bus} />
      )}
      {widget.type === 'goals' && goals?.length === 0 && <p className="widget-stage-empty">Add a goal in the Goals card to see it here.</p>}
      {widget.type === 'firework' && compact && <p className="widget-stage-empty">For gifts worth {(widget.minDiamonds ?? DEFAULT_FIREWORK_DIAMONDS).toLocaleString()}+ coins</p>}
      {!compact && (
        <span className="widget-stage-note">
          {widget.type === 'firework'
            ? `Sample gifts of up to 1,500 coins. Only those worth ${(widget.minDiamonds ?? DEFAULT_FIREWORK_DIAMONDS).toLocaleString()} or more play the animation.`
            : 'Sample viewers and gifts'}
        </span>
      )}
    </div>
  );
}

// A widget's colors, font and shape. Without a style it has its own colors; changing anything starts from the first preset.
function WidgetLookControls({ value, onChange }: { value: WidgetStyle | undefined; onChange: (style: WidgetStyle | undefined) => void }) {
  const style = value ?? WIDGET_PRESETS[0]!.style;
  const set = (patch: Partial<WidgetStyle>) => onChange({ ...style, ...patch });
  const range = (key: keyof typeof WIDGET_STYLE_LIMITS) => ({ min: WIDGET_STYLE_LIMITS[key][0], max: WIDGET_STYLE_LIMITS[key][1] });
  return (
    <div className="stack">
      <div className="row" role="group" aria-label="Preset">
        <button type="button" className={`btn btn-sm ${value ? '' : 'on'}`} aria-pressed={!value} onClick={() => onChange(undefined)}>
          Default
        </button>
        {WIDGET_PRESETS.map((p) => (
          <button key={p.id} type="button" className="btn btn-sm" onClick={() => onChange({ ...p.style, size: style.size })}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="look-colors">
        <ColorField label="Background" value={style.background} onChange={(background) => set({ background })} />
        <ColorField label="Text" value={style.textColor} onChange={(textColor) => set({ textColor })} />
        <ColorField label="Accent" value={style.accent} onChange={(accent) => set({ accent })} />
        <ColorField label="Border" value={style.borderColor} onChange={(borderColor) => set({ borderColor, ...(style.borderWidth === 0 && { borderWidth: 2 }) })} />
      </div>
      <div className="look-row">
        <div className="field">
          Background opacity
          <Scrubber value={style.opacity} {...range('opacity')} buttonStep={5} unit="%" label="Background opacity" onSave={(opacity) => set({ opacity })} />
        </div>
        <div className="field">
          Size
          <Scrubber value={style.size} {...range('size')} buttonStep={5} unit="%" label="Widget size" onSave={(size) => set({ size })} />
        </div>
        <div className="field">
          Corner roundness
          <Scrubber value={style.radius} {...range('radius')} buttonStep={2} unit="px" label="Corner roundness" onSave={(radius) => set({ radius })} />
        </div>
        <div className="field">
          Border thickness
          <Scrubber value={style.borderWidth} {...range('borderWidth')} unit="px" label="Border thickness" onSave={(borderWidth) => set({ borderWidth })} />
        </div>
      </div>
      <FontPicker value={style.font} onChange={(font) => set({ font })} />
    </div>
  );
}

// Adding a widget: every one you can add, two to a row, each showing itself. One sample feed drives them all.
function WidgetPicker({ options, goals, onAdd }: { options: WidgetChoice[]; goals: Goal[]; onAdd: (w: WidgetChoice) => void }) {
  const [open, setOpen] = useState(false);
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(open, bus);
  return (
    <div className="stack">
      <button className="btn picker-toggle" aria-expanded={open} aria-controls="widget-picker" onClick={() => setOpen(!open)}>
        <Icon name="plus" />
        Add a widget
        <Icon name="chevron" />
      </button>
      {open && (
        <div id="widget-picker" className="stack">
          <p className="muted small">Previews use sample viewers and gifts.</p>
          <div className="widget-picker">
            {options.map((w) => {
              const info = widgetInfo(w, goals);
              return (
                <div key={widgetKey(w)} className="picker-card">
                  <div className="picker-head">
                    <HueIcon name={info.icon} hue={info.hue} />
                    <span className="widget-name">
                      <strong>{info.label}</strong>
                      <span className="muted small">{info.help}</span>
                    </span>
                    <button className="btn btn-sm btn-primary" onClick={() => onAdd(w)} aria-label={`Add ${info.label}`}>
                      <Icon name="plus" />
                      Add
                    </button>
                  </div>
                  <PreviewStage widget={{ ...w, spot: 'top' }} feed={{ stats, chat, bus }} compact />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const METRIC_LABELS: Record<GoalMetric, string> = { likes: 'Likes', follows: 'Follows', shares: 'Shares', diamonds: 'Coins', subscriptions: 'Subscriptions' };
const METRIC_ICONS: Record<GoalMetric, { icon: IconName; hue: Hue }> = {
  likes: { icon: 'heart', hue: 'pink' },
  follows: { icon: 'follower', hue: 'sky' },
  shares: { icon: 'share', hue: 'green' },
  diamonds: { icon: 'coin', hue: 'amber' },
  subscriptions: { icon: 'star', hue: 'violet' },
};

const RAISE_MULTIPLES = [1.25, 1.5, 2, 3, 5, 10];

// What a goal does once it's reached.
function RaiseCell({ goal, onSave }: { goal: Goal; onSave: (raise: GoalRaise | null) => void }) {
  const { raise } = goal;
  const pick = (kind: string) => {
    if (kind === 'times') onSave({ kind, by: 2 });
    else if (kind === 'plus') onSave({ kind, by: goal.target });
    else if (kind === 'to') onSave({ kind, by: goal.target * 2 });
    else onSave(null);
  };
  return (
    <span className="goal-raise">
      <select className="input" value={raise?.kind ?? ''} aria-label={`What ${goal.name} does when reached`} onChange={(e) => pick(e.target.value)}>
        <option value="">Stay reached</option>
        <option value="times">Multiply by</option>
        <option value="plus">Add</option>
        <option value="to">Move once to</option>
      </select>
      {raise?.kind === 'times' && (
        <select className="input" value={raise.by} aria-label="Multiply the target by" onChange={(e) => onSave({ kind: 'times', by: Number(e.target.value) })}>
          {[...new Set([...RAISE_MULTIPLES, raise.by])].map((m) => (
            <option key={m} value={m}>
              ×{m}
            </option>
          ))}
        </select>
      )}
      {(raise?.kind === 'plus' || raise?.kind === 'to') && (
        <NumberCell value={raise.by} min={1} max={100_000_000} label={raise.kind === 'plus' ? 'Amount to add' : 'New target'} onSave={(by) => onSave({ kind: raise.kind, by })} />
      )}
    </span>
  );
}

function GoalsCard({ goals, reload: load }: { goals: Goal[]; reload: () => Promise<unknown> }) {
  const [draft, setDraft] = useState<{ name: string; metric: GoalMetric; target: number }>({ name: '', metric: 'likes', target: 1000 });
  const { error, guard } = useError();
  const update = (id: string, patch: Partial<Goal>) => guard(() => api('PATCH', `/goals/${id}`, patch).then(load))();
  const add = (e: FormEvent) => {
    e.preventDefault();
    guard(() => api('POST', '/goals', { ...draft, name: draft.name || `${METRIC_LABELS[draft.metric]} goal` }).then(() => (setDraft({ ...draft, name: '' }), load())))();
  };

  return (
    <Card
      title="Goals"
      description="Targets for each stream, counted from when you go live. Show them with the Goals widget, and use the Actions page's “Reaches a goal” trigger to celebrate. A goal that moves up when reached starts back at its target next stream."
    >
      <ErrorNotice error={error} />
      {goals.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>On</th>
                <th>Name</th>
                <th>Counts</th>
                <th>Target</th>
                <th>When reached</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {goals.map((g) => (
                <tr key={g.id}>
                  <td>
                    <label className="switch">
                      <input type="checkbox" checked={g.enabled} aria-label={`${g.name} on`} onChange={(e) => update(g.id, { enabled: e.target.checked })} />
                    </label>
                  </td>
                  <td>
                    <TextCell value={g.name} required label="Goal name" onSave={(name) => update(g.id, { name })} />
                  </td>
                  <td>
                    <span className="with-icon">
                      <HueIcon name={METRIC_ICONS[g.metric].icon} hue={METRIC_ICONS[g.metric].hue} size="sm" />
                      <select className="input" value={g.metric} aria-label="What it counts" onChange={(e) => update(g.id, { metric: e.target.value as GoalMetric })}>
                        {GOAL_METRICS.map((m) => (
                          <option key={m} value={m}>
                            {METRIC_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </span>
                  </td>
                  <td>
                    <NumberCell value={g.target} min={1} max={100_000_000} label="Target" onSave={(target) => update(g.id, { target })} />
                  </td>
                  <td>
                    <RaiseCell goal={g} onSave={(raise) => update(g.id, { raise })} />
                  </td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm btn-delete" onClick={guard(() => api('DELETE', `/goals/${g.id}`).then(load))}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="row add-row" onSubmit={add}>
        <input className="input" placeholder="Goal name, e.g. Like goal" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="New goal name" />
        <select className="input" value={draft.metric} onChange={(e) => setDraft({ ...draft, metric: e.target.value as GoalMetric })} aria-label="What the new goal counts">
          {GOAL_METRICS.map((m) => (
            <option key={m} value={m}>
              {METRIC_LABELS[m]}
            </option>
          ))}
        </select>
        <input
          className="input short"
          type="number"
          min={1}
          value={draft.target}
          onChange={(e) => setDraft({ ...draft, target: Number(e.target.value) })}
          aria-label="New goal target"
        />
        <button className="btn btn-primary">Add goal</button>
      </form>
    </Card>
  );
}

// Where this screen's alerts show: drag a sample alert. Actions placed by hand keep their own place.
function AlertSpotDialog({ screen, style, onDone, onClose }: { screen: Screen; style: AlertStyle | null; onDone: (pos: { x: number; y: number }) => void; onClose: () => void }) {
  const [pos, setPos] = useState(screen.alertPos ?? { x: 50, y: 50 });
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.4);
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(true, bus);
  const look = alertLook(style);
  useEffect(() => dialog.current?.showModal(), []);
  useLayoutEffect(() => {
    const measure = () => stage.current && setFit(stage.current.clientWidth / CANVAS.width);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(stage.current!);
    return () => resize.disconnect();
  }, []);
  return (
    <dialog ref={dialog} className="pos-dialog" onClose={onClose} aria-labelledby="alert-spot-title">
      <div className="pos-head">
        <div>
          <h2 id="alert-spot-title">Where alerts appear on {screen.name}</h2>
          <p className="muted small">Drag the sample alert anywhere. Actions you placed by hand keep their own place.</p>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dialog.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div className="pos-stage" ref={stage} style={{ aspectRatio: `${CANVAS.width} / ${CANVAS.height}` }}>
        <div className="pos-canvas" style={{ ...CANVAS, transform: `scale(${fit})` }}>
          <div className="overlay-screen" style={{ '--overlay-scale': screen.scale / 100 } as CSSProperties}>
            <FadedWidgets widgets={screen.widgets} feed={{ stats, chat, bus }} />
            <div className={`overlay-alert alert-drag ${look.className}`} style={{ ...look.style, ...alertPlace({ pos, scale: 100 }) }} onPointerDown={(e) => dragAlert(e, stage.current!, setPos)}>
              <span>Your alert</span>
            </div>
          </div>
        </div>
      </div>
      <div className="pos-foot">
        <span className="muted small">
          Middle at {Math.round(pos.x)}% across, {Math.round(pos.y)}% down
        </span>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={() => dialog.current?.close()}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => onDone(pos)}>
          Save position
        </button>
      </div>
    </dialog>
  );
}

function ScreenCard({ screen, goals, alertStyle, reload, refreshHost }: { screen: Screen; goals: Goal[]; alertStyle: AlertStyle | null; reload: () => Promise<unknown>; refreshHost: () => Promise<unknown> }) {
  const [placingAlerts, setPlacingAlerts] = useState(false);
  const url = `${location.origin}/overlay/${screen.token}`;
  const [copied, setCopied] = useState(false);
  const { error, guard } = useError();
  const save = (patch: Partial<Screen>) => guard(() => api('PATCH', `/screens/${screen.id}`, patch).then(reload))();
  const newLink = guard(async () => {
    await api('POST', `/screens/${screen.id}/new-link`);
    setCopied(false);
    await reload();
    // The dashboard's live feed uses the main screen's link.
    if (screen.main) await refreshHost();
  });

  return (
    <Card
      title={screen.name}
      id={`screen-${screen.id}`}
      icon={<HueIcon name="overlay" hue="indigo" />}
      description={screen.main ? 'Your original overlay address. It shows everything unless you change it.' : undefined}
      actions={
        !screen.main && (
          <button className="btn btn-ghost btn-sm btn-delete" onClick={guard(() => api('DELETE', `/screens/${screen.id}`).then(reload))}>
            Delete
          </button>
        )
      }
    >
      <ErrorNotice error={error} />
      <div className="row">
        <span className="link-field">
          <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label={`${screen.name} address`} />
          <ConfirmButton
            className="btn btn-ghost btn-sm btn-icon"
            label={`Get a new link for ${screen.name}`}
            title="New link. Use this if it leaked; your settings stay."
            message={`The old link stops working right away, so you'll need to paste the new one into OBS or LIVE Studio.${screen.main ? ' Your widget links change too.' : ''}`}
            confirmLabel="Get new link"
            onConfirm={newLink}
          >
            <Icon name="refresh" />
          </ConfirmButton>
        </span>
        <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a className="btn btn-try" href={`${url}?preview`} target="_blank" rel="noreferrer" title="Shows your widgets and goals with sample numbers until you go live">
          Open preview
        </a>
      </div>
      <div className="form-grid">
        <label className="field">
          Name
          <TextCell value={screen.name} required label="Screen name" onSave={(name) => save({ name })} />
        </label>
        <div className="field">
          Alerts appear at the
          <div className="alert-spots" role="radiogroup" aria-label="Alert position">
            {[...ALERT_POSITIONS, 'custom' as const].map((p) => {
              const on = (screen.alertPos ? 'custom' : screen.alertPosition) === p;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`alert-spot ${p}`}
                  onClick={() => (p === 'custom' ? setPlacingAlerts(true) : save({ alertPosition: p, alertPos: null }))}
                >
                  <span className="alert-spot-map" aria-hidden="true">
                    <i />
                  </span>
                  {p === 'custom' ? 'Custom' : POSITION_LABELS[p]}
                </button>
              );
            })}
          </div>
          {screen.alertPos && (
            <button type="button" className="link-button small" onClick={() => setPlacingAlerts(true)}>
              Move it
            </button>
          )}
          {placingAlerts && <AlertSpotDialog screen={screen} style={alertStyle} onDone={(alertPos) => (save({ alertPos }), setPlacingAlerts(false))} onClose={() => setPlacingAlerts(false)} />}
        </div>
        <div className="field">
          Size
          <span className="hint">Of everything on this screen. 100% is normal.</span>
          <Scrubber value={screen.scale} min={50} max={200} buttonStep={5} unit="%" label="Size" onSave={(scale) => save({ scale })} />
        </div>
        {screen.leaderboard && (
          <div className="field">
            Leaderboard players
            <span className="hint">How many it lists, once that many have played.</span>
            <Scrubber value={screen.leaderboardSize} min={MIN_LEADERBOARD_SIZE} max={MAX_LEADERBOARD_SIZE} buttonStep={1} label="Leaderboard players" onSave={(leaderboardSize) => save({ leaderboardSize })} />
          </div>
        )}
      </div>
      <div className="screen-switches">
        {SCREEN_PARTS.map((part) => (
          <PartToggle key={part.part} {...part} checked={screen[part.part]} onChange={(on) => save({ [part.part]: on })} />
        ))}
      </div>
      <WidgetsEditor widgets={screen.widgets} goals={goals} scale={screen.scale} alertSpot={screen.alerts ? { alertPosition: screen.alertPosition, alertPos: screen.alertPos } : null} alertStyle={alertStyle} onSave={(widgets, alertSpot) => save({ widgets, ...alertSpot })} />
    </Card>
  );
}

// What a screen shows, each in the color of the dashboard page it comes from (Actions pink, Commands indigo, and so on).
const SCREEN_PARTS: { part: 'alerts' | 'feed' | 'leaderboard' | 'mode' | 'audio'; label: string; hint?: string; icon: IconName; hue: Hue }[] = [
  { part: 'alerts', label: 'Alerts', hint: 'From your actions, unless an action picks another screen.', icon: 'bell', hue: 'pink' },
  { part: 'feed', label: 'Command feed', hint: 'Who pressed what, level-ups and !points answers.', icon: 'feed', hue: 'indigo' },
  { part: 'leaderboard', label: 'Leaderboard', hint: 'The top players, by level or commands.', icon: 'leaderboard', hue: 'sky' },
  { part: 'mode', label: 'Crowd mode panel', hint: 'Votes, the queue, or the gift-mode banner.', icon: 'crowd', hue: 'teal' },
  { part: 'audio', label: 'Sound', hint: 'Alert sounds, voices and read-aloud chat.', icon: 'voice', hue: 'violet' },
];

function PartToggle({ label, hint, icon, hue, checked, onChange }: (typeof SCREEN_PARTS)[number] & { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`part-toggle ${hue} ${checked ? 'on' : ''}`}>
      <HueIcon name={icon} hue={hue} />
      <span className="part-toggle-text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}
