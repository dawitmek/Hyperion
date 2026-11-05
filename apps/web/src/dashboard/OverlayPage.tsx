import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { GOAL_WIDGET_SPOT, ALERT_POSITIONS, DEFAULT_MESSAGE, MAX_MESSAGE_LENGTH, GOAL_METRICS, WIDGET_PRESETS, WIDGET_STYLE_LIMITS, widgetKey, MAX_LEADERBOARD_SIZE, MAX_WIDGETS, MIN_LEADERBOARD_SIZE, SCREEN_LAYOUTS, WIDGET_SPOTS, WIDGET_TYPES, type AlertStyle, type GoalMetric, type GoalRaise, type ScreenLayout, type ScreenWidget, type StreamStats, type WidgetSpot, type WidgetStyle, type WidgetType } from '@hyperion/shared';
import { api, type AlertPosition, type Goal, type Screen } from '../api';
import { alertLook } from '../alert-style';
import { FontPicker } from './FontPicker';
import { alertPlace, LAYOUT_CANVAS, LAYOUT_SAFE, linkedWidget, useClearOfWidgets } from '../Overlay';
import { alertHandleCorner, dragAlert, dragAlertSize, dragResize } from './alert-drag';
import { ColorField } from './AlertLookEditor';
import { SpotPad, type PadSpot } from './SpotPad';
import { AmountField, Card, Switch, ConfirmButton, ErrorNotice, HueIcon, NumberCell, Scrubber, TextCell, useError, type Hue } from '../ui';
import { Icon, type IconName } from '../icons';
import { DEFAULT_JAR_DIAMONDS, GiftBus, usePreview, Widget, type ChatLine } from '../overlay-widgets';
import type { PageProps } from './Dashboard';


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
  top_gift: { label: 'Top gift', help: "The stream's most valuable gift and who sent it.", spot: 'top', icon: 'trophy', hue: 'amber' },
  top_streak: { label: 'Longest streak', help: 'The biggest gift combo so far.', spot: 'top-right', icon: 'flame', hue: 'orange' },
  last_follower: { label: 'Latest follower', help: 'Who followed last.', spot: 'bottom-left', icon: 'follower', hue: 'sky' },
  last_gifter: { label: 'Latest gift', help: 'Who sent the last gift, and what.', spot: 'bottom-right', icon: 'gift', hue: 'amber' },
  stats: { label: 'Stream stats', help: 'Viewers, likes, follows and coins this stream.', spot: 'bottom', icon: 'analytics', hue: 'teal' },
  chat: { label: 'Chat', help: 'The last few chat messages.', spot: 'bottom-right', icon: 'chat', hue: 'indigo' },
  coin_jar: { label: 'Coin jar', help: 'Gifts drop coins into a jar that fills toward a target.', spot: 'top-left', icon: 'coin', hue: 'amber' },
  level_ups: { label: 'Level-ups', help: 'Level-up shout-outs in a spot of their own, instead of in the command feed.', spot: 'bottom-left', icon: 'star', hue: 'orange' },
  message: { label: 'Custom message', help: 'Your own text on the screen, like how to play.', spot: 'bottom-left', icon: 'chat', hue: 'indigo' },
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

// The spots on the position pad, where each sits on the screen.
const WIDGET_PAD: PadSpot<WidgetSpot>[] = WIDGET_SPOTS.map((spot) => ({
  id: spot,
  x: spot.endsWith('left') ? 0 : spot.endsWith('right') ? 1 : 0.5,
  y: spot.startsWith('top') ? 0 : spot.startsWith('bottom') ? 1 : 0.5,
  label: SPOT_LABELS[spot],
}));
const ALERT_PAD: PadSpot<AlertPosition>[] = ALERT_POSITIONS.map((p) => ({ id: p, x: 0.5, y: p === 'top' ? 0 : p === 'middle' ? 0.5 : 1, label: POSITION_LABELS[p] }));

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

// The point of a widget that stays put as it grows, across and down it: its spot's corner or edge, or its top-left
// corner once placed by hand.
function anchorOf(w: ScreenWidget): [number, number] {
  if (w.pos) return [0, 0];
  return [w.spot.endsWith('left') ? 0 : w.spot.endsWith('right') ? 1 : 0.5, w.spot.startsWith('top') ? 0 : w.spot.startsWith('bottom') ? 1 : 0.5];
}
// Its resize handle: the corner away from that point.
function handleCorner(w: ScreenWidget) {
  const [ax, ay] = anchorOf(w);
  return `${ay > 0.5 ? 't' : 'b'}${ax > 0.5 ? 'l' : 'r'}`;
}

// Where a widget is, for its row in the list.
function widgetPlace(w: ScreenWidget) {
  return w.pos ? 'Custom position' : SPOT_LABELS[w.spot];
}

type AlertSpot = Pick<Screen, 'alertPosition' | 'alertPos' | 'alertScale'>;

function WidgetsEditor({ widgets, goals, scale, layout, alertSpot, alertStyle, onSave }: { widgets: ScreenWidget[]; goals: Goal[]; scale: number; layout: ScreenLayout; alertSpot: AlertSpot | null; alertStyle: AlertStyle | null; onSave: (widgets: ScreenWidget[], alertSpot?: AlertSpot) => void }) {
  const [positioning, setPositioning] = useState<number | 'all' | null>(null); // one widget, or every one
  // One set of sample viewers and gifts for every card's preview.
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(widgets.length > 0, bus);
  const own = new Set(widgets.map((w) => w.goalId).filter(Boolean));
  // The grouped goals widget leaves out goals with a widget of their own, as on stream.
  const feedFor = (w: ScreenWidget): PreviewFeed => ({ stats: w.type === 'goals' && !w.goalId && stats ? { ...stats, goals: stats.goals.filter((g) => !own.has(g.id)) } : stats, chat, bus });
  const used = new Set(widgets.map(widgetKey));
  const types = WIDGET_TYPES.filter((t) => !used.has(t));
  const ownGoals = goals.filter((g) => !used.has(`goal:${g.id}`));
  const options: WidgetChoice[] = [...types.map((type) => ({ type })), ...ownGoals.map((g) => ({ type: 'goals' as const, goalId: g.id }))];
  const add = (w: WidgetChoice) => onSave([...widgets, { ...w, spot: w.goalId ? GOAL_WIDGET_SPOT : WIDGETS[w.type].spot }]);

  return (
    <div className="stack">
      <div className="row">
        <h3>
          Widgets {widgets.length > 0 && <span className="tag">{widgets.length}</span>}
        </h3>
        {(alertSpot || widgets.length > 0) && (
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
        <ul className={`widget-grid ${layout}`}>
          {widgets.map((w, i) => {
            const info = widgetInfo(w, goals);
            return (
              <li key={widgetKey(w)}>
                <button className="widget-card" onClick={() => setPositioning(i)} aria-label={`Edit ${info.label}, ${widgetPlace(w)}`}>
                  <span className="widget-card-stage" aria-hidden="true">
                    <PreviewStage widget={w} feed={feedFor(w)} compact />
                  </span>
                  <span className="widget-card-foot">
                    <HueIcon name={info.icon} hue={info.hue} size="sm" />
                    <span className="widget-name">
                      <strong>{info.label}</strong>
                      <span className="muted small">
                        {widgetPlace(w)}
                        {w.style && (
                          <span className="widget-card-look">
                            <i style={{ background: w.style.accent }} aria-hidden="true" />
                            Custom look
                          </span>
                        )}
                      </span>
                    </span>
                    <SpotMap spot={w.spot} pos={w.pos} hue={info.hue} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {options.length > 0 && widgets.length < MAX_WIDGETS && <WidgetPicker options={options} goals={goals} onAdd={add} />}
      {(positioning === 'all' || (positioning !== null && widgets[positioning])) && (
        <PositionDialog
          widgets={widgets}
          index={positioning === 'all' ? null : positioning}
          goals={goals}
          scale={scale}
          layout={layout}
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
      description="Each widget on its own, as a browser source of its own, without a whole screen. Customize gives a link its own look. Size and the coin jar's settings follow your Main screen. Previews use sample viewers and gifts. Keep the links private."
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
                <button className="btn btn-ghost btn-sm" aria-label={`Customize ${info.label} link`} onClick={() => setStyling(w)}>
                  Customize
                </button>
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

// The screen as its layout's canvas (see LAYOUT_CANVAS), drawn smaller to fit the stage. Widgets keep their real size
// against it. A phone screen's stage is kept to a height that fits the window.
export const stageProps = (layout: ScreenLayout) => ({ className: `pos-stage ${layout}`, style: { aspectRatio: `${LAYOUT_CANVAS[layout].width} / ${LAYOUT_CANVAS[layout].height}` } });
export function canvasStyle(layout: ScreenLayout, fit: number): CSSProperties {
  const { width, height } = LAYOUT_CANVAS[layout];
  return { width, height, transform: `scale(${fit})`, '--canvas-w': `${width}px`, '--canvas-h': `${height}px`, '--stage-fit': fit } as CSSProperties;
}
// Canvas pixels to stage pixels, kept up to date as the stage resizes.
export function useStageFit(stage: RefObject<HTMLDivElement | null>, layout: ScreenLayout) {
  const [fit, setFit] = useState(0.4);
  useLayoutEffect(() => {
    const measure = () => stage.current && setFit(stage.current.clientWidth / LAYOUT_CANVAS[layout].width);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(stage.current!);
    return () => resize.disconnect();
  }, [stage, layout]);
  return fit;
}

const ALERT_KEY = 'alerts'; // the sample alert, picked like a widget
const SAMPLE_ALERT = 'nightowl sent 5× Rose!'; // as wide as a real one: a wider alert has more widgets to clear

// With no index, every widget on the screen and its alerts: drag them anywhere, or snap the one picked to a spot. With one, everything
// about that widget: where it goes, with the screen's others faded behind it, how it looks, and removing it.
function PositionDialog({
  widgets,
  index,
  goals,
  scale,
  layout,
  alertSpot,
  alertStyle,
  onSave,
  onClose,
}: {
  widgets: ScreenWidget[];
  index: number | null;
  goals: Goal[];
  scale: number;
  layout: ScreenLayout;
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
  const movable = (w: ScreenWidget) => index === null || widgetKey(w) === widgetKey(opened[index]!);
  const [picked, setPicked] = useState(() => {
    const first = opened[index ?? 0];
    return first ? widgetKey(first) : ALERT_KEY;
  });
  const info = index === null ? { label: 'Every widget', icon: 'layout' as const, hue: 'indigo' as const } : widgetInfo(opened[index]!, goals);
  const [tab, setTab] = useState<'position' | 'look'>('position');
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const fit = useStageFit(stage, layout);
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(true, bus);

  useEffect(() => {
    dialog.current?.showModal();
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
  // The corner handle resizes the widget about the point that stays put as it grows: its spot's corner or edge, or
  // its top-left corner once placed by hand. It grows as the pointer gets farther from that point.
  const [resizing, setResizing] = useState<string | null>(null);
  const startResize = (key: string, e: ReactPointerEvent<HTMLElement>) => {
    setPicked(key);
    setResizing(key);
    const widget = draft.find((w) => widgetKey(w) === key)!;
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const [ax, ay] = anchorOf(widget);
    const anchor = { x: box.left + ax * box.width, y: box.top + ay * box.height };
    dragResize(e, anchor, widget.size ?? 100, (size) => place(key, { size: size === 100 ? undefined : size }), () => setResizing(null));
  };
  const snap = (spot: WidgetSpot) => setDraft((d) => moveToSpot(d, d.findIndex((w) => widgetKey(w) === picked), spot));

  const own = new Set(opened.map((w) => w.goalId).filter(Boolean));
  const statsFor = (w: ScreenWidget) => (w.type === 'goals' && !w.goalId && stats ? { ...stats, goals: stats.goals.filter((g) => !own.has(g.id)) } : stats);
  const draw = (w: ScreenWidget) => <Widget widget={w} stats={statsFor(w)} chat={chat} bus={bus} />;
  // The ones to move, outlined, the one picked brightest; anything else faded, where it sits on stream.
  const spots = Object.fromEntries(WIDGET_SPOTS.map((s) => [s, [] as ReactNode[]])) as Record<WidgetSpot, ReactNode[]>;
  const placed: ReactNode[] = [];
  draft.forEach((w) => {
    const key = widgetKey(w);
    const el = movable(w) ? (
      <div key={key} data-key={key} className={`pos-target ${index === null && key !== picked ? 'unpicked' : ''}`} onPointerDown={(e) => startDrag(key, e)}>
        {draw(w)}
        {key === picked && (
          <span className={`pos-resize at-${handleCorner(w)}`} title="Drag to resize" onPointerDown={(e) => startResize(key, e)} />
        )}
        {key === resizing && <span className="pos-size">{w.size ?? 100}%</span>}
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
  // The picked widget's size, as a fraction of the screen, for where the pad shows it once placed by hand.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = stage.current?.querySelector(`[data-key="${CSS.escape(picked)}"]`);
    if (!el || !stage.current) return setSize(null);
    const box = el.getBoundingClientRect();
    const screen = stage.current.getBoundingClientRect();
    if (screen.width === 0 || box.width === 0) return; // hidden (the Look tab), or not drawn yet
    const next = { w: box.width / screen.width, h: box.height / screen.height };
    setSize((s) => (s && Math.abs(s.w - next.w) < 0.001 && Math.abs(s.h - next.h) < 0.001 ? s : next));
  });
  // The pad's dots cover where the spots are: the whole screen on desktop, and on phone the part between TikTok's
  // buttons and chat, which the pad shades above and below in proportion.
  const band = layout === 'phone' ? { top: LAYOUT_SAFE.phone.top, bottom: 1 - LAYOUT_SAFE.phone.bottom } : { top: 0, bottom: 1 };
  // How far across the room it has, from `from` to `to`, something `length` long starting at `at` is: pushed to an
  // edge, it's on that edge's dots, the way a spot's widgets sit. Past an edge (under TikTok's buttons or chat), it's
  // out past the dots by as much, into the shading.
  const along = (at: number, from: number, to: number, length: number) => {
    if (at < from) return (at - from) / (to - from);
    if (at + length > to) return 1 + (at + length - to) / (to - from);
    return to - from - length > 0.001 ? (at - from) / (to - from - length) : 0.5;
  };
  const widgetKnob = (pos: { x: number; y: number }) => size && { x: along(pos.x / 100, 0, 1, size.w), y: along(pos.y / 100, band.top, band.bottom, size.h) };
  // An alert's place is its middle.
  const alertKnob = (pos: { x: number; y: number }) => ({ x: pos.x / 100, y: (pos.y / 100 - band.top) / (band.bottom - band.top) });
  const alertLooks = alertLook(alertStyle);
  const alertBox = useRef<HTMLDivElement>(null);
  const clear = useClearOfWidgets(alertBox, index === null && alertDraft && !alertDraft.alertPos ? alertDraft.alertPosition : null, scale / 100, (alertDraft?.alertScale ?? 100) / 100, [draft, fit]);
  const single = index !== null;
  const remove = () => {
    onSave(saved.filter((w) => widgetKey(w) !== picked));
    dialog.current?.close();
  };

  return (
    <dialog ref={dialog} className={`pos-dialog ${layout}`} onClose={onClose} aria-labelledby="pos-title">
      <div className="pos-head">
        <HueIcon name={info.icon} hue={info.hue} />
        <div>
          <h2 id="pos-title">{info.label}</h2>
          <p className="muted small">
            {index === null
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
      {single && (
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
          <WidgetLookControls
            value={current.style}
            size={{ value: current.size ?? 100, onChange: (size) => place(picked, { size: size === 100 ? undefined : size }) }}
            onChange={(style) => setDraft((d) => d.map((w) => (widgetKey(w) === picked ? (style ? { ...w, style } : without(w)) : w)))}
          />
        </div>
      )}
      <div {...stageProps(layout)} ref={stage} hidden={tab === 'look'}>
        <div className="pos-canvas" style={canvasStyle(layout, fit)}>
          <div className={`overlay-screen layout-${layout} ${alertDraft ? `alerts-${alertDraft.alertPosition}` : ''}`} style={{ '--overlay-scale': scale / 100 } as CSSProperties}>
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
                style={{ ...alertLooks.style, ...alertPlace({ pos: alertDraft.alertPos, scale: alertDraft.alertScale }), ...clear }}
                onPointerDown={(e) => {
                  setPicked(ALERT_KEY);
                  dragAlert(e, stage.current!, (alertPos) => setAlertDraft((a) => ({ ...a!, alertPos })));
                }}
              >
                <span>{SAMPLE_ALERT}</span>
                {picked === ALERT_KEY && (
                  <span
                    className={`pos-resize alert-handle at-${alertHandleCorner(!alertDraft.alertPos && alertDraft.alertPosition === 'bottom')}`}
                    title="Drag to resize this screen's alerts"
                    onPointerDown={(e) => {
                      setResizing(ALERT_KEY);
                      dragAlertSize(e, alertDraft.alertScale, (alertScale) => setAlertDraft((a) => ({ ...a!, alertScale })), () => setResizing(null));
                    }}
                  />
                )}
                {resizing === ALERT_KEY && <span className="pos-size">{alertDraft.alertScale}%</span>}
              </div>
            )}
          </div>
        </div>
      </div>
      {(current || picked === ALERT_KEY) && (
        <div className="pos-foot">
          {picked === ALERT_KEY && alertDraft && (
            <div className="pos-place">
              <SpotPad
                spots={ALERT_PAD}
                portrait={layout === 'phone'}
                value={alertDraft.alertPosition}
                custom={alertDraft.alertPos && alertKnob(alertDraft.alertPos)}
                label="Snap alerts to a spot"
                onPick={(p) => setAlertDraft((a) => ({ ...a!, alertPosition: p, alertPos: null }))}
              />
              <span className="muted small">Actions you placed by hand keep their own place.</span>
            </div>
          )}
          {current && tab === 'position' && (
            <div className="pos-place">
              <SpotPad
                spots={WIDGET_PAD}
                portrait={layout === 'phone'}
                value={current.spot}
                custom={current.pos && widgetKnob(current.pos)}
                label={`Snap ${widgetInfo(current, goals).label} to a spot`}
                onPick={snap}
              />
            </div>
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
          {single && current?.type === 'coin_jar' && (
            <div className="widget-settings">
              <div className="setting">
                <span className="setting-label">Full at</span>
                <AmountField
                  value={current.minDiamonds ?? DEFAULT_JAR_DIAMONDS}
                  min={1}
                  max={10_000_000}
                  unit="coins"
                  label="Coins that fill the jar"
                  presets={[100, 500, 1000, 5000, 10_000]}
                  onSave={(minDiamonds) => place(picked, { minDiamonds })}
                />
              </div>
              <div className="setting">
                <span className="setting-label">When full</span>
                <RaiseCell
                  raise={current.raise ?? null}
                  target={current.minDiamonds ?? DEFAULT_JAR_DIAMONDS}
                  label="What the jar does when it's full"
                  stay="Stay full"
                  unit="coins"
                  onSave={(raise) => place(picked, { raise: raise ?? undefined })}
                />
              </div>
              <div className="setting">
                <span className="setting-label">Glass</span>
                <Switch checked={current.shine !== false} onChange={(on) => place(picked, { shine: on ? undefined : false })}>
                  Shine
                </Switch>
              </div>
            </div>
          )}
          {/* On a row of their own, so the settings above can wrap however they need to. */}
          <div className="pos-actions">
            {single && (
              <button className="btn btn-ghost btn-delete" onClick={remove}>
                Remove widget
              </button>
            )}
            <span className="spacer" />
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
      <Widget widget={widget} stats={feed.stats} chat={feed.chat} bus={feed.bus} />
      {widget.type === 'goals' && goals?.length === 0 && <p className="widget-stage-empty">Add a goal in the Goals card to see it here.</p>}
      {!compact && <span className="widget-stage-note">Sample viewers and gifts</span>}
    </div>
  );
}

// A widget's colors, font and shape. Without a style it has its own colors; changing anything starts from the first preset.
// `size`, for a widget on a screen: its own size, kept apart from its look so resizing doesn't need custom colors.
function WidgetLookControls({ value, size, onChange }: { value: WidgetStyle | undefined; size?: { value: number; onChange: (size: number) => void }; onChange: (style: WidgetStyle | undefined) => void }) {
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
          <Scrubber value={size?.value ?? style.size} {...range('size')} buttonStep={5} unit="%" label="Widget size" onSave={(n) => (size ? size.onChange(n) : set({ size: n }))} />
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

// What a goal, or a coin jar, does once it's reached.
// With `unit`, amounts get a stepper (see AmountField) rather than a plain box.
function RaiseCell({ raise, target, label, stay = 'Stay reached', unit, onSave }: { raise: GoalRaise | null; target: number; label: string; stay?: string; unit?: string; onSave: (raise: GoalRaise | null) => void }) {
  const pick = (kind: string) => {
    if (kind === 'times') onSave({ kind, by: 2 });
    else if (kind === 'plus') onSave({ kind, by: target });
    else if (kind === 'to') onSave({ kind, by: target * 2 });
    else onSave(null);
  };
  return (
    <span className="goal-raise">
      <select className="input" value={raise?.kind ?? ''} aria-label={label} onChange={(e) => pick(e.target.value)}>
        <option value="">{stay}</option>
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
      {(raise?.kind === 'plus' || raise?.kind === 'to') &&
        (unit ? (
          <AmountField value={raise.by} min={1} max={100_000_000} unit={unit} label={raise.kind === 'plus' ? 'Amount to add' : 'New target'} onSave={(by) => onSave({ kind: raise.kind, by })} />
        ) : (
          <NumberCell value={raise.by} min={1} max={100_000_000} label={raise.kind === 'plus' ? 'Amount to add' : 'New target'} onSave={(by) => onSave({ kind: raise.kind, by })} />
        ))}
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
                    <RaiseCell raise={g.raise} target={g.target} label={`What ${g.name} does when reached`} onSave={(raise) => update(g.id, { raise })} />
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
function AlertSpotDialog({ screen, style, onDone, onClose }: { screen: Screen; style: AlertStyle | null; onDone: (spot: { alertPos: { x: number; y: number }; alertScale: number }) => void; onClose: () => void }) {
  const [pos, setPos] = useState(screen.alertPos ?? { x: 50, y: 50 });
  const [size, setSize] = useState(screen.alertScale);
  const [resizing, setResizing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const fit = useStageFit(stage, screen.layout);
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(true, bus);
  const look = alertLook(style);
  useEffect(() => dialog.current?.showModal(), []);
  return (
    <dialog ref={dialog} className={`pos-dialog ${screen.layout}`} onClose={onClose} aria-labelledby="alert-spot-title">
      <div className="pos-head">
        <div>
          <h2 id="alert-spot-title">Where alerts appear on {screen.name}</h2>
          <p className="muted small">Drag the sample alert anywhere, or its corner handle to resize this screen's alerts. Actions you placed by hand keep their own place.</p>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dialog.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div {...stageProps(screen.layout)} ref={stage}>
        <div className="pos-canvas" style={canvasStyle(screen.layout, fit)}>
          <div className={`overlay-screen layout-${screen.layout}`} style={{ '--overlay-scale': screen.scale / 100 } as CSSProperties}>
            <FadedWidgets widgets={screen.widgets} feed={{ stats, chat, bus }} />
            <div className={`overlay-alert alert-drag ${look.className}`} style={{ ...look.style, ...alertPlace({ pos, scale: size }) }} onPointerDown={(e) => dragAlert(e, stage.current!, setPos)}>
              <span>Your alert</span>
              <span
                className={`pos-resize alert-handle at-${alertHandleCorner(false)}`}
                title="Drag to resize this screen's alerts"
                onPointerDown={(e) => (setResizing(true), dragAlertSize(e, size, setSize, () => setResizing(false)))}
              />
              {resizing && <span className="pos-size">{size}%</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="pos-foot">
        <span className="muted small">
          Middle at {Math.round(pos.x)}% across, {Math.round(pos.y)}% down, {size}% size
        </span>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={() => dialog.current?.close()}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => onDone({ alertPos: pos, alertScale: size })}>
          Save position
        </button>
      </div>
    </dialog>
  );
}

// The screen's own overlay page in a frame the size of its browser source, drawn smaller to fit: exactly what OBS or
// LIVE Studio shows, alerts and all, with sample numbers until you go live.
function PreviewDialog({ screen, url, onClose }: { screen: Screen; url: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const source = LAYOUT_CANVAS[screen.layout]; // the browser source size it's made for
  const [fit, setFit] = useState(0.4);
  useEffect(() => dialog.current?.showModal(), []);
  useLayoutEffect(() => {
    const measure = () => stage.current && setFit(stage.current.clientWidth / source.width);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(stage.current!);
    return () => resize.disconnect();
  }, [source.width]);
  return (
    <dialog ref={dialog} className={`pos-dialog preview-dialog ${screen.layout}`} onClose={onClose} aria-labelledby="preview-title">
      <div className="pos-head">
        <div>
          <h2 id="preview-title">{screen.name} preview</h2>
          <p className="muted small">
            As your stream shows it, at {source.width} × {source.height}. Sample numbers until you go live; alerts you test show here too.
          </p>
        </div>
        <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer">
          Open in new tab
        </a>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dialog.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div className={`pos-stage ${screen.layout}`} ref={stage} style={{ aspectRatio: `${source.width} / ${source.height}` }}>
        <iframe className="preview-frame" src={url} title={`${screen.name} preview`} style={{ width: source.width, height: source.height, transform: `scale(${fit})` }} />
      </div>
    </dialog>
  );
}

function ScreenCard({ screen, goals, alertStyle, reload, refreshHost }: { screen: Screen; goals: Goal[]; alertStyle: AlertStyle | null; reload: () => Promise<unknown>; refreshHost: () => Promise<unknown> }) {
  const [placingAlerts, setPlacingAlerts] = useState(false);
  const [previewing, setPreviewing] = useState(false);
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
        <button className="btn btn-try" onClick={() => setPreviewing(true)} title="Shows your widgets and goals with sample numbers until you go live">
          Preview
        </button>
      </div>
      {previewing && <PreviewDialog screen={screen} url={`${url}?preview`} onClose={() => setPreviewing(false)} />}
      <div className="form-grid">
        <label className="field">
          Name
          <TextCell value={screen.name} required label="Screen name" onSave={(name) => save({ name })} />
        </label>
        <div className="field">
          Made for
          <span className="hint">{LAYOUTS[screen.layout]}</span>
          <div className="layout-pick" role="radiogroup" aria-label="Made for">
            {SCREEN_LAYOUTS.map((layout) => (
              <button key={layout} type="button" role="radio" aria-checked={screen.layout === layout} className={`layout-option ${LAYOUT_LOOKS[layout].hue}`} onClick={() => save({ layout })}>
                <Icon name={layout} size={18} />
                {LAYOUT_LOOKS[layout].label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          Size
          <span className="hint">Of everything on this screen.</span>
          <Scrubber value={screen.scale} min={50} max={200} buttonStep={5} unit="%" label="Size" onSave={(scale) => save({ scale })} />
        </div>
      </div>
      <div className="stack">
        <h3>What it shows</h3>
        <ul className="screen-parts">
          {SCREEN_PARTS.map(({ part, label, hint, icon, hue }) => (
            <li key={part} className={`screen-part ${screen[part] ? 'on' : ''}`}>
              <label className="screen-part-head">
                <HueIcon name={icon} hue={hue} />
                <span className="screen-part-text">
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
                <span className="switch">
                  <input type="checkbox" checked={screen[part]} onChange={(e) => save({ [part]: e.target.checked })} />
                </span>
              </label>
              {/* A part's own settings, while it's on. */}
              {part === 'alerts' && screen.alerts && (
                <div className="screen-part-settings">
                  <div className="setting">
                    <span className="setting-label">Appear at</span>
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
                    {placingAlerts && <AlertSpotDialog screen={screen} style={alertStyle} onDone={(spot) => (save(spot), setPlacingAlerts(false))} onClose={() => setPlacingAlerts(false)} />}
                  </div>
                  <div className="setting">
                    <span className="setting-label">Size</span>
                    <Scrubber value={screen.alertScale} min={50} max={200} buttonStep={5} unit="%" label="Alert size" onSave={(alertScale) => save({ alertScale })} />
                    <span className="muted small">Each action&apos;s own size goes on top.</span>
                  </div>
                </div>
              )}
              {part === 'leaderboard' && screen.leaderboard && (
                <div className="screen-part-settings">
                  <div className="setting">
                    <span className="setting-label">Players</span>
                    <Scrubber value={screen.leaderboardSize} min={MIN_LEADERBOARD_SIZE} max={MAX_LEADERBOARD_SIZE} buttonStep={1} label="Leaderboard players" onSave={(leaderboardSize) => save({ leaderboardSize })} />
                    <span className="muted small">How many it lists, once that many have played.</span>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      <WidgetsEditor widgets={screen.widgets} goals={goals} scale={screen.scale} layout={screen.layout} alertSpot={screen.alerts ? { alertPosition: screen.alertPosition, alertPos: screen.alertPos, alertScale: screen.alertScale } : null} alertStyle={alertStyle} onSave={(widgets, alertSpot) => save({ widgets, ...alertSpot })} />
    </Card>
  );
}

// What each layout is for, and the browser source size it's made for.
const LAYOUTS: Record<ScreenLayout, string> = {
  desktop: 'Landscape. Browser source 1920 × 1080.',
  phone: "Portrait, clear of TikTok's buttons and chat. Browser source 1080 × 1920.",
};
// Each layout's name and color on its button (its icon is named after it).
const LAYOUT_LOOKS: Record<ScreenLayout, { label: string; hue: Hue }> = { desktop: { label: 'Desktop', hue: 'sky' }, phone: { label: 'Phone', hue: 'violet' } };

// What a screen shows, each in the color of the dashboard page it comes from (Actions pink, Commands indigo, and so on).
const SCREEN_PARTS: { part: 'alerts' | 'feed' | 'leaderboard' | 'mode' | 'audio'; label: string; hint: string; icon: IconName; hue: Hue }[] = [
  { part: 'alerts', label: 'Alerts', hint: 'From your actions, unless an action picks another screen.', icon: 'bell', hue: 'pink' },
  { part: 'feed', label: 'Command feed', hint: 'Who pressed what, level-ups and !points answers.', icon: 'feed', hue: 'indigo' },
  { part: 'leaderboard', label: 'Leaderboard', hint: 'The top players, by level or commands.', icon: 'leaderboard', hue: 'sky' },
  { part: 'mode', label: 'Crowd mode panel', hint: 'Votes, the queue, or the gift-mode banner.', icon: 'crowd', hue: 'teal' },
  { part: 'audio', label: 'Sound', hint: 'Alert sounds, voices and read-aloud chat.', icon: 'voice', hue: 'violet' },
];
