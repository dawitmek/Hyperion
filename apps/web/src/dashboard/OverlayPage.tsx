import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_PHONE_SAFE, GOAL_WIDGET_SPOT, ALERT_POSITIONS, MIN_PHONE_ROOM, PHONE_SAFE_LIMITS, type PhoneSafe, DEFAULT_MESSAGE, MAX_MESSAGE_LENGTH, GOAL_METRICS, WIDGET_PRESETS, WIDGET_STYLE_LIMITS, widgetKey, MAX_LEADERBOARD_SIZE, MAX_WIDGETS, MIN_LEADERBOARD_SIZE, SCREEN_LAYOUTS, WIDGET_SPOTS, WIDGET_TYPES, type AlertStyle, type GoalMetric, type Mode, type OverlayPart, type PartPlace, type GoalRaise, type ScreenLayout, type ScreenWidget, type StreamStats, type WidgetSpot, type WidgetStyle, type WidgetType } from '@hyperion/shared';
import { api, type AlertPosition, type Goal, type Screen } from '../api';
import { alertLook } from '../alert-style';
import { FontPicker } from './FontPicker';
import { alertPlace, Feed, LAYOUT_CANVAS, Leaderboard, linkedWidget, ModePanel, PART_SPOTS, PartBox, safeVars, SAMPLE_FEED, SAMPLE_LEADERBOARD, sampleMode, useClearOfWidgets } from '../Overlay';
import { MODE_INFO } from './modes';
import { alertHandleCorner, dragAlert, dragAlertSize, dragResize } from './alert-drag';
import { ColorField } from './AlertLookEditor';
import { SpotPad, type PadSpot } from './SpotPad';
import { AmountField, Card, cleanTyped, closeOnBackdrop, Switch, ConfirmButton, ErrorNotice, HueIcon, hueStyle, NumberCell, Scrubber, Seg, TextCell, useError, type Hue } from '../ui';
import { Icon, type IconName } from '../icons';
import { DEFAULT_JAR_DIAMONDS, GiftBus, usePreview, Widget, type ChatLine } from '../overlay-widgets';
import type { PageProps } from './Dashboard';


const POSITION_LABELS: Record<AlertPosition, string> = { top: 'Top', middle: 'Middle', bottom: 'Bottom' };

type OverlayTab = 'overlays' | 'goals' | 'links';

// The overlays as tabs over one editor; goals and widget links, which every overlay shares, in tabs of their own.
export function OverlayPage({ host, refreshHost }: PageProps) {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [tab, setTab] = useState<OverlayTab>('overlays');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const load = useCallback(() => api<Screen[]>('GET', '/screens').then(setScreens), []);
  const loadGoals = useCallback(() => api<Goal[]>('GET', '/goals').then(setGoals), []);
  useEffect(() => void (load(), loadGoals()), [load, loadGoals]);
  const main = screens.find((s) => s.main);
  const ordered = [...screens.filter((s) => s.main), ...screens.filter((s) => !s.main)];
  // The one picked, or Main, also once the picked one is deleted.
  const screen = ordered.find((s) => s.id === currentId) ?? ordered[0];
  const open = (id: string) => void load().then(() => setCurrentId(id));

  return (
    <div className="stack">
      <div className="page-tools">
        <Seg
          label="Stream overlay"
          value={tab}
          options={[
            ['overlays', 'Overlays'],
            ['goals', 'Goals'],
            ['links', 'Widget links'],
          ]}
          onChange={setTab}
        />
      </div>
      {tab === 'overlays' && screen && (
        <div className="overlay-workspace">
          <OverlayTabs screens={ordered} current={screen.id} onPick={setCurrentId} reload={load} onOpen={open} />
          <OverlayEditor key={screen.id} screen={screen} goals={goals} mode={host.mode} progression={host.progression} alertStyle={host.alertStyle} reload={load} refreshHost={refreshHost} onOpen={open} />
        </div>
      )}
      {/* Deleting a goal also takes its widgets off the overlays. */}
      {tab === 'goals' && <GoalsCard goals={goals} reload={() => Promise.all([loadGoals(), load()])} />}
      {tab === 'links' && main && <WidgetLinksCard main={main} goals={goals} reload={load} />}
    </div>
  );
}

// One tab per overlay, Main first. Double-click a tab to rename it; right-click it to rename, duplicate or delete it.
function OverlayTabs({ screens, current, onPick, reload, onOpen }: { screens: Screen[]; current: string; onPick: (id: string) => void; reload: () => Promise<unknown>; onOpen: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; screen: Screen } | null>(null);
  const [duplicating, setDuplicating] = useState<Screen | null>(null);
  const { error, guard } = useError();
  const add = (e: FormEvent) => {
    e.preventDefault();
    guard(async () => {
      const created = await api<Screen>('POST', '/screens', { name: name.trim() });
      setName('');
      setAdding(false);
      onOpen(created.id);
    })();
  };
  const rename = (s: Screen, typed: string) => {
    setRenaming(null);
    const next = typed.trim();
    if (next && next !== s.name) void guard(() => api('PATCH', `/screens/${s.id}`, { name: next }).then(reload))();
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <div className="overlay-tabs-bar">
      <div className="overlay-tabs" role="tablist" aria-label="Overlays">
        {screens.map((s) =>
          renaming === s.id ? (
            <input
              key={s.id}
              className="input overlay-tab-rename"
              autoFocus
              defaultValue={s.name}
              maxLength={40}
              aria-label={`New name for ${s.name}`}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={(e) => rename(s, cleanTyped(e.target.value))}
            />
          ) : (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === current}
              className="overlay-tab"
              title="Double-click to rename. Right-click for more."
              onClick={() => onPick(s.id)}
              onDoubleClick={() => setRenaming(s.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, screen: s });
              }}
            >
              <Icon name={s.layout} size={15} />
              {s.name}
            </button>
          ),
        )}
        {adding ? (
          <form className="overlay-tab-new" onSubmit={add}>
            <input
              className="input"
              autoFocus
              placeholder="Name, e.g. Alerts corner"
              value={name}
              onChange={(e) => setName(cleanTyped(e.target.value))}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
              required
              maxLength={40}
              aria-label="New overlay name"
            />
            <button className="btn btn-primary btn-sm">Add</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="overlay-tab add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />
            New overlay
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} title={menu.screen.name} onClose={closeMenu}>
          <button type="button" role="menuitem" className="context-item" onClick={() => (setRenaming(menu.screen.id), setMenu(null))}>
            <Icon name="pencil" size={16} />
            Rename
          </button>
          <button type="button" role="menuitem" className="context-item" onClick={() => (setDuplicating(menu.screen), setMenu(null))}>
            <Icon name="copy" size={16} />
            Duplicate
          </button>
          {!menu.screen.main && (
            <ConfirmButton
              className="context-item btn-delete"
              message={`Delete ${menu.screen.name}? Its link stops working.`}
              confirmLabel="Delete"
              onConfirm={() => {
                const gone = menu.screen;
                setMenu(null);
                void guard(() => api('DELETE', `/screens/${gone.id}`).then(reload))();
              }}
            >
              <Icon name="close" size={16} />
              Delete
            </ConfirmButton>
          )}
        </ContextMenu>
      )}
      {duplicating && <DuplicateDialog screen={duplicating} onDone={onOpen} onClose={() => setDuplicating(null)} />}
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
function anchorOf(w: Pick<ScreenWidget, 'spot' | 'pos'>): [number, number] {
  if (w.pos) return [0, 0];
  return [w.spot.endsWith('left') ? 0 : w.spot.endsWith('right') ? 1 : 0.5, w.spot.startsWith('top') ? 0 : w.spot.startsWith('bottom') ? 1 : 0.5];
}
// Its resize handle: the corner away from that point.
function handleCorner(w: Pick<ScreenWidget, 'spot' | 'pos'>) {
  const [ax, ay] = anchorOf(w);
  return `${ay > 0.5 ? 't' : 'b'}${ax > 0.5 ? 'l' : 'r'}`;
}

// Where a widget is, for its row in the list.
function widgetPlace(w: ScreenWidget) {
  return w.pos ? 'Custom position' : SPOT_LABELS[w.spot];
}

type AlertSpot = Pick<Screen, 'alertPosition' | 'alertPos' | 'alertScale'>;

const LINKS_SHOWN = 8; // four rows of two, then the rest behind Show more

// Every widget, and every goal on its own, as a browser source of its own: for a stream that wants just the chat, say.
// Laid out like the widget picker, each card showing its widget. One sample feed drives them all.
// A Widget link's look, apart from the widget on the Main screen. Default goes back to following that one.
function LinkLookDialog({ widget, label, value, feed, onSave, onClose }: { widget: ScreenWidget; label: string; value: WidgetStyle | undefined; feed: PreviewFeed; onSave: (style: WidgetStyle | undefined) => void; onClose: () => void }) {
  const [style, setStyle] = useState(value);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return (
    <dialog ref={dialog} className="pos-dialog" onClose={onClose} {...closeOnBackdrop()} aria-labelledby="link-look-title">
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
      badge="chain"
      hue="sky"
      title="Widget links"
      description="Each widget on its own, as a browser source of its own, without a whole screen. Customize gives a link its own look. Size and the coin jar's settings follow your Main screen. Previews use sample viewers and gifts. Keep the links private."
    >
      <label className="viewer-search widget-search">
        <Icon name="search" size={16} />
        <input
          className="input"
          type="search"
          maxLength={100}
          placeholder={`Search ${all.length} widgets, like chat or coins`}
          aria-label="Search widget links"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
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
export const stageProps = (layout: ScreenLayout, safe?: PhoneSafe) => ({
  className: `pos-stage ${layout}`,
  style: { aspectRatio: `${LAYOUT_CANVAS[layout].width} / ${LAYOUT_CANVAS[layout].height}`, ...safeVars(layout === 'phone' ? safe : undefined) },
});
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

type WidgetChoice = Pick<ScreenWidget, 'type' | 'goalId'>;
export type PreviewFeed = { stats: StreamStats | null; chat: ChatLine[]; bus: GiftBus };

// The widget as it looks on stream, over a stand-in for the stream, fed sample viewers and gifts.
function PreviewStage({ widget, feed, compact }: { widget: ScreenWidget; feed: PreviewFeed; compact?: boolean }) {
  const goals = widget.goalId ? feed.stats?.goals.filter((g) => g.id === widget.goalId) : feed.stats?.goals;
  return (
    <div className={`widget-stage ${compact ? 'compact' : ''}`}>
      <Widget widget={widget} stats={feed.stats} chat={feed.chat} bus={feed.bus} />
      {widget.type === 'goals' && goals?.length === 0 && <p className="widget-stage-empty">Add a goal in the Goals tab to see it here.</p>}
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

// What can change for several widgets at once: their spot, their look, or removing them.
function WidgetBatchActions({ count, onMove, onLook, onRemove }: { count: number; onMove: (spot: WidgetSpot) => void; onLook: (style: WidgetStyle | undefined) => void; onRemove: () => void }) {
  const which = count > 1 ? `these ${count} widgets` : 'this widget';
  return (
    <div className="widget-actions">
      <div className="widget-actions-part">
        <span className="small muted">Move to</span>
        <div className="spot-grid" role="group" aria-label="Move to">
          {(['top-left', 'top', 'top-right', 'left', null, 'right', 'bottom-left', 'bottom', 'bottom-right'] as const).map((spot, i) =>
            spot ? (
              <button key={spot} type="button" className="spot-grid-cell" title={SPOT_LABELS[spot]} aria-label={`Move ${which} to ${SPOT_LABELS[spot]}`} onClick={() => onMove(spot)} />
            ) : (
              <span key={i} />
            ),
          )}
        </div>
      </div>
      <div className="widget-actions-part">
        <span className="small muted">Look</span>
        <div className="look-swatches" role="group" aria-label="Look">
          <button type="button" className="look-swatch own" title="Their own colors" aria-label={`Give ${which} their own colors`} onClick={() => onLook(undefined)}>
            Aa
          </button>
          {WIDGET_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="look-swatch"
              title={p.label}
              aria-label={`Give ${which} the ${p.label} look`}
              style={{ background: p.style.background, color: p.style.accent, borderColor: p.style.borderWidth ? p.style.borderColor : undefined }}
              onClick={() => onLook(p.style)}
            >
              Aa
            </button>
          ))}
        </div>
      </div>
      {count > 1 ? (
        <ConfirmButton className="btn btn-ghost btn-sm btn-delete" message={`Take ${which} off this screen?`} confirmLabel="Remove" onConfirm={onRemove}>
          Remove {count}
        </ConfirmButton>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm btn-delete" onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
  );
}

// A menu at the pointer, kept on screen. A click outside, Escape or scrolling closes it.
function ContextMenu({ x, y, title, onClose, children }: { x: number; y: number; title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (r) setAt({ x: Math.max(8, Math.min(x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: Event) => box.current?.contains(e.target as Node) || onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  // On the page itself, so no card around it can trap it under the live dock.
  return createPortal(
    <div ref={box} className="context-menu" role="menu" aria-label={title} style={{ left: at.x, top: at.y }} onContextMenu={(e) => e.preventDefault()}>
      <div className="context-title">{title}</div>
      {children}
    </div>,
    document.body,
  );
}

// Every widget this overlay can still add, in a grid over the widget list: tick as many as there's room for, then add
// them together. Searchable, each showing itself; one sample feed drives them all.
function WidgetLibrary({ options, goals, room, onAdd, onClose }: { options: WidgetChoice[]; goals: Goal[]; room: number; onAdd: (choices: WidgetChoice[]) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<string[]>([]); // keys, in the order ticked
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(true, bus);
  // By name or description, and a goal's own widget also by what it counts.
  const query = search.trim().toLowerCase();
  const words = (w: WidgetChoice) => {
    const goal = w.goalId && goals.find((g) => g.id === w.goalId);
    const info = widgetInfo(w, goals);
    return [info.label, info.help, goal ? METRIC_LABELS[goal.metric] : ''].join(' ').toLowerCase();
  };
  const shown = query ? options.filter((w) => words(w).includes(query)) : options;
  const full = chosen.length >= room;
  const flip = (key: string) => setChosen((list) => (list.includes(key) ? list.filter((k) => k !== key) : full ? list : [...list, key]));
  const add = () => onAdd(chosen.map((key) => options.find((w) => widgetKey(w) === key)!));
  return (
    <section className="panel-part" aria-label="Add widgets">
      <div className="panel-head">
        <HueIcon name="plus" hue="indigo" />
        <div>
          <h3>Add widgets</h3>
          <span className="muted small">
            Tick the ones you want{room < options.length ? `, up to ${room}` : ''}. Previews use sample viewers and gifts.
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!chosen.length} onClick={add}>
          {chosen.length > 1 ? `Add ${chosen.length} widgets` : 'Add widget'}
        </button>
      </div>
      {options.length === 0 ? (
        <p className="muted small">Every widget is on this overlay already. Add a goal in the Goals tab to give it a widget of its own.</p>
      ) : (
        <>
          <label className="viewer-search widget-search">
            <Icon name="search" size={16} />
            <input
              className="input"
              type="search"
              maxLength={100}
              placeholder={`Search ${options.length} widgets, like chat or coins`}
              aria-label="Search widgets to add"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </label>
          {shown.length === 0 && <p className="empty">No widget to add matches "{search.trim()}".</p>}
          <ul className="widget-library">
            {shown.map((w) => {
              const key = widgetKey(w);
              const info = widgetInfo(w, goals);
              const on = chosen.includes(key);
              return (
                <li key={key}>
                  <label className={`library-card ${on ? 'on' : ''} ${full && !on ? 'disabled' : ''}`}>
                    <span className="picker-head">
                      <HueIcon name={info.icon} hue={info.hue} />
                      <span className="widget-name">
                        <strong>{info.label}</strong>
                        <span className="muted small">{info.help}</span>
                      </span>
                      <input type="checkbox" checked={on} disabled={full && !on} onChange={() => flip(key)} aria-label={`Add ${info.label}`} />
                    </span>
                    <PreviewStage widget={{ ...w, spot: 'top' }} feed={{ stats, chat, bus }} compact />
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

export const METRIC_LABELS: Record<GoalMetric, string> = { likes: 'Likes', follows: 'Follows', shares: 'Shares', diamonds: 'Coins', subscriptions: 'Subscriptions' };
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
      badge="target"
      hue="green"
      title="Goals"
      description="Targets for each stream, counted from when you go live. Show them with the Goals widget, and use the Alerts page's “Reaches a goal” trigger to celebrate. A goal that moves up when reached starts back at its target next stream."
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
                    <TextCell value={g.name} required maxLength={40} label="Goal name" onSave={(name) => update(g.id, { name })} />
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
        <input className="input" placeholder="Goal name, e.g. Like goal" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: cleanTyped(e.target.value) })} aria-label="New goal name" />
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
    <dialog ref={dialog} className={`pos-dialog preview-dialog ${screen.layout}`} onClose={onClose} {...closeOnBackdrop()} aria-labelledby="preview-title">
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

// Copies an overlay under a new name. The copy gets a link of its own, to add to OBS or LIVE Studio separately.
function DuplicateDialog({ screen, onDone, onClose }: { screen: Screen; onDone: (id: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(`${screen.name} copy`.slice(0, 40));
  const { error, guard } = useError();
  useEffect(() => dialog.current?.showModal(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    guard(async () => {
      const created = await api<Screen>('POST', `/screens/${screen.id}/duplicate`, { name: name.trim() });
      dialog.current?.close();
      onDone(created.id);
    })();
  };
  return (
    <dialog ref={dialog} className="game-dialog" onClose={onClose} {...closeOnBackdrop()} aria-labelledby={`duplicate-${screen.id}`}>
      <form className="stack" onSubmit={submit}>
        <div className="pos-head">
          <div>
            <h2 id={`duplicate-${screen.id}`}>Duplicate {screen.name}</h2>
            <p className="muted small">Same widgets and settings, with a link of its own. Changing one won't change the other.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => dialog.current?.close()} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <label className="field">
          Name of the copy
          <input className="input" autoFocus required maxLength={40} value={name} onFocus={(e) => e.target.select()} onChange={(e) => setName(cleanTyped(e.target.value))} />
        </label>
        <ErrorNotice error={error} />
        <div className="row">
          <button className="btn btn-primary" disabled={!name.trim()}>
            Duplicate
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

// Saves a moment after the last change, so a drag or a color slider is one save rather than dozens. What the server
// sends back takes over again once nothing is waiting to be saved. Switching overlays saves what's waiting first.
function useAutosave<T>(value: T, save: (value: T) => Promise<unknown> | void) {
  const [draft, setDraft] = useState(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (waiting.current) return;
    latest.current = value;
    setDraft(value);
  }, [value]);
  const flush = useRef(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    void Promise.resolve(saveRef.current(latest.current)).finally(() => {
      if (!timer.current) waiting.current = false;
    });
  }).current;
  useEffect(() => flush, [flush]);
  const change = (next: T | ((old: T) => T)) => {
    const value = typeof next === 'function' ? (next as (old: T) => T)(latest.current) : next;
    latest.current = value;
    setDraft(value);
    waiting.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 400);
  };
  return [draft, change] as const;
}

// One overlay: its link up top, a live preview of it, and under the preview what's on it: the built-in parts, then the
// widgets in a grid. Adding widgets, or editing one, opens a layer over that grid, so the preview stays in view above
// it. The overlay's settings, and the built-in parts', are on the right.
function OverlayEditor({
  screen,
  goals,
  mode,
  progression,
  alertStyle,
  reload,
  refreshHost,
  onOpen,
}: {
  screen: Screen;
  goals: Goal[];
  mode: Mode; // the profile's crowd mode, for the sample mode panel
  progression: boolean; // whether the leaderboard ranks by level
  alertStyle: AlertStyle | null;
  reload: () => Promise<unknown>;
  refreshHost: () => Promise<unknown>;
  onOpen: (id: string) => void;
}) {
  const { error, guard } = useError();
  const save = (patch: Partial<Screen>) => guard(() => api('PATCH', `/screens/${screen.id}`, patch).then(reload))();
  const [widgets, setWidgets] = useAutosave(screen.widgets, (list) => save({ widgets: list.map((w) => (w.type === 'message' && !w.text?.trim() ? { ...w, text: DEFAULT_MESSAGE } : w)) }));
  const savedAlert = useMemo<AlertSpot>(() => ({ alertPosition: screen.alertPosition, alertPos: screen.alertPos, alertScale: screen.alertScale }), [screen.alertPosition, screen.alertPos, screen.alertScale]);
  const [alert, setAlert] = useAutosave(savedAlert, save);
  const savedParts = useMemo(() => screen.parts ?? {}, [screen.parts]);
  const [parts, setParts] = useAutosave(savedParts, (list) => save({ parts: list }));
  const savedSafe = useMemo(() => screen.phoneSafe ?? DEFAULT_PHONE_SAFE, [screen.phoneSafe]);
  const [safe, setSafe] = useAutosave(savedSafe, (phoneSafe) => save({ phoneSafe }));

  // Ctrl+Z (Cmd+Z) undoes moving, sizing, adding and removing on this overlay; Ctrl+Shift+Z or Ctrl+Y redoes. Each
  // change remembers how things were just before it.
  type Snapshot = { widgets: ScreenWidget[]; parts: Screen['parts']; alert: AlertSpot; safe: PhoneSafe };
  const now: Snapshot = { widgets, parts, alert, safe };
  const nowRef = useRef(now);
  nowRef.current = now;
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const remember = () => {
    past.current = [...past.current.slice(-49), nowRef.current];
    future.current = [];
  };
  const restore = useRef((snap: Snapshot) => {});
  restore.current = (snap) => {
    setWidgets(snap.widgets);
    setParts(snap.parts);
    setAlert(snap.alert);
    setSafe(snap.safe);
  };
  useEffect(() => {
    const same = (a: Snapshot, b: Snapshot) => JSON.stringify(a) === JSON.stringify(b);
    const undo = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || e.altKey || (key !== 'z' && key !== 'y')) return;
      // Typing keeps its own undo.
      if ((e.target as HTMLElement).closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
      const [from, to] = key === 'y' || e.shiftKey ? [future, past] : [past, future];
      while (from.current.length) {
        const snap = from.current.pop()!;
        if (same(snap, nowRef.current)) continue; // a press that changed nothing
        to.current.push(nowRef.current);
        restore.current(snap);
        e.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', undo);
    return () => window.removeEventListener('keydown', undo);
  }, []);

  const url = `${location.origin}/overlay/${screen.token}`;
  const [copied, setCopied] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const newLink = guard(async () => {
    await api('POST', `/screens/${screen.id}/new-link`);
    setCopied(false);
    await reload();
    // The dashboard's live feed uses the main overlay's link.
    if (screen.main) await refreshHost();
  });

  // `active`: the one thing picked on the preview, a widget (whose editor opens over the grid), the sample alert or a
  // built-in part. `picked`: widgets ticked to change together. `adding`: the layer of widgets to add.
  const [active, setActive] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [hover, setHover] = useState<string | null>(null); // a card or row under the pointer, lit on the preview
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  // The built-in parts' settings on the right: folded but for alerts, until one is opened there or picked.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set([ALERT_KEY]));
  const fold = (key: string) =>
    setUnfolded((old) => {
      const next = new Set(old);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  useEffect(() => {
    if (active && BUILT_IN.some((b) => b.key === active)) setUnfolded((old) => (old.has(active) ? old : new Set(old).add(active)));
  }, [active]);
  const pickedKeys = widgets.map(widgetKey).filter((k) => picked.has(k));
  const editing = widgets.find((w) => widgetKey(w) === active);
  const opened = useRef<ScreenWidget[]>(widgets); // as they were when a widget's editor opened, for its Cancel
  const focus = (key: string) => {
    if (key !== active) opened.current = nowRef.current.widgets;
    setActive(key);
    setPicked(new Set());
    setAdding(false);
  };
  const toggle = (key: string) => {
    setActive(null);
    setAdding(false);
    setPicked((old) => {
      const next = new Set(old);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const clear = () => {
    setActive(null);
    setPicked(new Set());
    setAdding(false);
  };
  useEffect(() => {
    const leave = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open], .context-menu, .confirm-bubble')) return;
      setActive(null);
      setPicked(new Set());
      setAdding(false);
    };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, []);

  const place = (key: string, patch: Partial<ScreenWidget>) => setWidgets((list) => list.map((w) => (widgetKey(w) === key ? { ...w, ...patch } : w)));
  // Widgets by their key; the feed, leaderboard and mode panel by `part:` and their name.
  const partOf = (key: string) => (key.startsWith('part:') ? (key.slice(5) as OverlayPart) : null);
  const placeOf = (key: string): Pick<ScreenWidget, 'spot' | 'pos' | 'size'> => {
    const part = partOf(key);
    return part ? { spot: PART_SPOTS[part], ...parts[part] } : widgets.find((w) => widgetKey(w) === key)!;
  };
  const setPart = (part: OverlayPart, patch: PartPlace) =>
    setParts((all) => {
      const next = { ...all[part], ...patch };
      for (const k of Object.keys(next) as (keyof PartPlace)[]) if (next[k] === undefined) delete next[k];
      return { ...all, [part]: next };
    });
  const setPlace = (key: string, patch: PartPlace) => {
    const part = partOf(key);
    if (part) setPart(part, patch);
    else place(key, patch);
  };
  const moveMany = (keys: string[], spot: WidgetSpot) => {
    remember();
    setWidgets((list) =>
      keys.reduce((all, key) => {
        const i = all.findIndex((w) => widgetKey(w) === key);
        return i < 0 ? all : moveToSpot(all, i, spot);
      }, list),
    );
  };
  const lookMany = (keys: string[], style: WidgetStyle | undefined) => {
    remember();
    setWidgets((list) => list.map((w) => (keys.includes(widgetKey(w)) ? (style ? { ...w, style } : without(w)) : w)));
  };
  const removeMany = (keys: string[]) => {
    remember();
    setWidgets((list) => list.filter((w) => !keys.includes(widgetKey(w))));
    setPicked(new Set());
    setActive(null);
  };
  const used = new Set(widgets.map(widgetKey));
  const options: WidgetChoice[] = [...WIDGET_TYPES.filter((t) => !used.has(t)).map((type) => ({ type })), ...goals.filter((g) => !used.has(`goal:${g.id}`)).map((g) => ({ type: 'goals' as const, goalId: g.id }))];
  const room = MAX_WIDGETS - widgets.length;
  const canAdd = options.length > 0 && room > 0;
  const addMany = (choices: WidgetChoice[]) => {
    remember();
    setWidgets((list) => [...list, ...choices.map((w) => ({ ...w, spot: w.goalId ? GOAL_WIDGET_SPOT : WIDGETS[w.type].spot }))]);
    setAdding(false);
  };
  const startAdding = () => {
    setActive(null);
    setPicked(new Set());
    setAdding(true);
  };

  // The preview: the overlay's canvas drawn smaller, fed sample viewers and gifts.
  const stage = useRef<HTMLDivElement>(null);
  const fit = useStageFit(stage, screen.layout);
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(true, bus);
  const own = new Set(widgets.map((w) => w.goalId).filter(Boolean));
  // The grouped goals widget leaves out goals with a widget of their own, as on stream.
  const statsFor = (w: ScreenWidget) => (w.type === 'goals' && !w.goalId && stats ? { ...stats, goals: stats.goals.filter((g) => !own.has(g.id)) } : stats);
  const [resizing, setResizing] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false); // while something's dragged, the alert stays where it is
  // A press picks a widget (with Shift, Ctrl or Cmd, ticks it); moving a few pixels drags its top-left corner, kept on
  // the screen, into a place of its own.
  const startDrag = (key: string, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const more = e.shiftKey || e.ctrlKey || e.metaKey;
    const box = stage.current!.getBoundingClientRect();
    const target = e.currentTarget.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY };
    const grab = { x: e.clientX - target.left, y: e.clientY - target.top };
    const size = { x: (target.width / box.width) * 100, y: (target.height / box.height) * 100 };
    const clamp = (n: number, max: number) => Math.round(Math.min(Math.max(n, 0), Math.max(0, max)) * 10) / 10;
    let moved = false;
    const move = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - from.x, m.clientY - from.y) < 4) return;
      if (!moved) (remember(), focus(key), setDragging(true));
      moved = true;
      const x = clamp(((m.clientX - box.left - grab.x) / box.width) * 100, 100 - size.x);
      const y = clamp(((m.clientY - box.top - grab.y) / box.height) * 100, 100 - size.y);
      setPlace(key, { pos: { x, y } });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      setDragging(false);
      if (!moved) (more && !partOf(key) ? toggle : focus)(key);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  // The corner handle resizes about the point that stays put as it grows: its spot's corner or edge, or its top-left
  // corner once placed by hand.
  const startResize = (key: string, e: ReactPointerEvent<HTMLElement>) => {
    const at = placeOf(key);
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const [ax, ay] = anchorOf(at);
    remember();
    setResizing(key);
    dragResize(e, { x: box.left + ax * box.width, y: box.top + ay * box.height }, at.size ?? screen.scale, (size) => setPlace(key, { size }), () => setResizing(null));
  };
  const openMenu = (key: string, e: ReactMouseEvent) => {
    e.preventDefault();
    // On a Mac, Ctrl-click arrives as a right-click: it ticks, as it does elsewhere.
    if (e.ctrlKey && e.button === 0) return;
    setMenu({ x: e.clientX, y: e.clientY, key });
  };
  const lit = (key: string) => `${active === key || picked.has(key) ? 'picked' : ''} ${hover === key ? 'hovered' : ''}`;
  const spots = Object.fromEntries(WIDGET_SPOTS.map((s) => [s, [] as ReactNode[]])) as Record<WidgetSpot, ReactNode[]>;
  const placed: ReactNode[] = [];
  // The feed, leaderboard and mode panel, with sample players: first in their corners, as on stream, until moved.
  const modeState = sampleMode(mode);
  const part = (name: OverlayPart, label: string, node: ReactNode) => {
    const key = `part:${name}`;
    const at = placeOf(key);
    const el = (
      <div key={key} data-key={key} className={`pos-target pos-part ${lit(key)}`} title={label} onPointerDown={(e) => startDrag(key, e)}>
        <PartBox size={at.size}>{node}</PartBox>
        {active === key && <span className={`pos-resize at-${handleCorner(at)}`} title="Drag to resize" onPointerDown={(e) => startResize(key, e)} />}
        {resizing === key && <span className="pos-size">{at.size ?? screen.scale}%</span>}
      </div>
    );
    if (at.pos) placed.push(<div key={key} className="overlay-placed" style={{ left: `${at.pos.x}%`, top: `${at.pos.y}%` }}>{el}</div>);
    else spots[at.spot].push(el);
  };
  if (screen.mode && modeState.mode !== 'anarchy') part('mode', 'Crowd mode panel', <ModePanel state={modeState} clockOffset={0} />);
  if (screen.leaderboard) part('leaderboard', 'Leaderboard', <Leaderboard leaderboard={{ entries: SAMPLE_LEADERBOARD, progression }} size={screen.leaderboardSize} />);
  if (screen.feed) part('feed', 'Command feed', <Feed items={SAMPLE_FEED} />);
  widgets.forEach((w) => {
    const key = widgetKey(w);
    const el = (
      <div key={key} data-key={key} className={`pos-target ${lit(key)}`} onPointerDown={(e) => startDrag(key, e)} onContextMenu={(e) => (e.ctrlKey && e.button === 0 ? e.preventDefault() : openMenu(key, e))}>
        <Widget widget={w} stats={statsFor(w)} chat={chat} bus={bus} />
        {editing === w && <span className={`pos-resize at-${handleCorner(w)}`} title="Drag to resize" onPointerDown={(e) => startResize(key, e)} />}
        {resizing === key && <span className="pos-size">{w.size ?? screen.scale}%</span>}
      </div>
    );
    if (w.pos) placed.push(<div key={key} className="overlay-placed" style={{ left: `${w.pos.x}%`, top: `${w.pos.y}%` }}>{el}</div>);
    else spots[w.spot].push(el);
  });
  const alertLooks = alertLook(alertStyle);
  const alertBox = useRef<HTMLDivElement>(null);
  const clearOf = useClearOfWidgets(alertBox, screen.alerts && !alert.alertPos ? alert.alertPosition : null, screen.scale / 100, alert.alertScale / 100, [widgets, parts, safe, fit], dragging || resizing !== null);
  const alertActive = screen.alerts && active === ALERT_KEY;

  // The edited widget's size, as a fraction of the screen, for where the spot pad shows it once placed by hand.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = editing && stage.current?.querySelector(`[data-key="${CSS.escape(widgetKey(editing))}"]`);
    if (!el || !stage.current) return setSize(null);
    const box = el.getBoundingClientRect();
    const screenBox = stage.current.getBoundingClientRect();
    if (screenBox.width === 0 || box.width === 0) return;
    const next = { w: box.width / screenBox.width, h: box.height / screenBox.height };
    setSize((s) => (s && Math.abs(s.w - next.w) < 0.001 && Math.abs(s.h - next.h) < 0.001 ? s : next));
  });
  // The pad's dots cover where the spots are: the whole screen on desktop, and on phone the part between TikTok's
  // buttons and chat, which the pad shades above and below in proportion.
  const band = screen.layout === 'phone' ? { top: safe.top / 100, bottom: 1 - safe.bottom / 100 } : { top: 0, bottom: 1 };
  // On a phone, the edges of what TikTok covers are dragged to give widgets more room, or less.
  const startEdge = (edge: keyof PhoneSafe, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const box = stage.current!.getBoundingClientRect();
    let moved = false;
    const move = (m: PointerEvent) => {
      if (!moved) (remember(), setDragging(true));
      moved = true;
      const down = ((m.clientY - box.top) / box.height) * 100;
      const want = Math.round(edge === 'top' ? down : 100 - down);
      setSafe((old) => {
        const [min, max] = PHONE_SAFE_LIMITS[edge];
        const other = edge === 'top' ? old.bottom : old.top;
        return { ...old, [edge]: Math.max(min, Math.min(max, 100 - MIN_PHONE_ROOM - other, want)) };
      });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  // How far across the room it has something `length` long starting at `at` is: pushed to an edge, it's on that
  // edge's dots, the way a spot's widgets sit. Past an edge, it's out past the dots by as much, into the shading.
  const along = (at: number, from: number, to: number, length: number) => {
    if (at < from) return (at - from) / (to - from);
    if (at + length > to) return 1 + (at + length - to) / (to - from);
    return to - from - length > 0.001 ? (at - from) / (to - from - length) : 0.5;
  };
  const widgetKnob = (pos: { x: number; y: number }) => size && { x: along(pos.x / 100, 0, 1, size.w), y: along(pos.y / 100, band.top, band.bottom, size.h) };
  const alertKnob = (pos: { x: number; y: number }) => ({ x: pos.x / 100, y: (pos.y / 100 - band.top) / (band.bottom - band.top) });

  const batch = (keys: string[], done = () => {}) => (
    <WidgetBatchActions count={keys.length} onMove={(spot) => (moveMany(keys, spot), done())} onLook={(style) => (lookMany(keys, style), done())} onRemove={() => (removeMany(keys), done())} />
  );
  // A right-click acts on everything ticked when it's on one of them, or else on that one widget.
  const menuKeys = menu ? (picked.has(menu.key) && pickedKeys.length > 1 ? pickedKeys : [menu.key]) : [];
  const menuWidget = menu ? widgets.find((w) => widgetKey(w) === menu.key) : undefined;
  const closeMenu = useCallback(() => setMenu(null), []);
  const hoverProps = (key: string) => ({
    onPointerEnter: () => setHover(key),
    onPointerLeave: () => setHover(null),
    onFocus: () => setHover(key),
    onBlur: () => setHover(null),
  });

  // Over the grid: the widgets to add, or the one being edited.
  const layer = adding ? (
    <WidgetLibrary options={options} goals={goals} room={room} onAdd={addMany} onClose={() => setAdding(false)} />
  ) : editing ? (
    <WidgetInspector
      widget={editing}
      goals={goals}
      layout={screen.layout}
      band={safe}
      overlaySize={screen.scale}
      custom={editing.pos ? widgetKnob(editing.pos) : null}
      onPlace={(patch) => place(widgetKey(editing), patch)}
      // Not an undo step per tick of a color: Cancel puts the whole look back.
      onLook={(style) => setWidgets((list) => list.map((w) => (w === editing ? (style ? { ...w, style } : without(w)) : w)))}
      onSnap={(spot) => moveMany([widgetKey(editing)], spot)}
      onRemove={() => removeMany([widgetKey(editing)])}
      onCancel={() => {
        setWidgets(opened.current);
        clear();
      }}
      onDone={clear}
    />
  ) : null;

  return (
    <section className="overlay-editor-card" aria-label={`${screen.name} overlay`}>
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
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button className="btn btn-try" onClick={() => setPreviewing(true)} title="The overlay itself, alerts and all, with sample numbers until you go live">
          Preview
        </button>
      </div>
      <ErrorNotice error={error} />
      {previewing && <PreviewDialog screen={screen} url={`${url}?preview`} onClose={() => setPreviewing(false)} />}
      {duplicating && <DuplicateDialog screen={screen} onDone={onOpen} onClose={() => setDuplicating(false)} />}
      <div className="overlay-editor">
        <div className="overlay-stage-col">
          <div {...stageProps(screen.layout, safe)} className={`pos-stage overlay-stage ${screen.layout}`} ref={stage} onPointerDown={(e) => e.button === 0 && clear()}>
            <div className="pos-canvas" style={canvasStyle(screen.layout, fit)}>
              <div className={`overlay-screen layout-${screen.layout} ${screen.alerts ? `alerts-${alert.alertPosition}` : ''}`} style={{ '--overlay-scale': screen.scale / 100 } as CSSProperties}>
                {WIDGET_SPOTS.map((s) => (
                  <div key={s} className={`overlay-spot spot-${s}`}>
                    {spots[s]}
                  </div>
                ))}
                {placed}
                {screen.alerts && (
                  <div
                    ref={alertBox}
                    className={`overlay-alert alert-drag ${alertLooks.className} ${lit(ALERT_KEY)}`}
                    style={{ ...alertLooks.style, ...alertPlace({ pos: alert.alertPos, scale: alert.alertScale }), ...clearOf }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      focus(ALERT_KEY);
                      remember();
                      dragAlert(e, stage.current!, (alertPos) => setAlert((a) => ({ ...a, alertPos })));
                    }}
                  >
                    <span>{SAMPLE_ALERT}</span>
                    {alertActive && (
                      <span
                        className={`pos-resize alert-handle at-${alertHandleCorner(!alert.alertPos && alert.alertPosition === 'bottom')}`}
                        title="Drag to resize this overlay's alerts"
                        onPointerDown={(e) => {
                          setResizing(ALERT_KEY);
                          remember();
                          dragAlertSize(e, alert.alertScale, (alertScale) => setAlert((a) => ({ ...a, alertScale })), () => setResizing(null));
                        }}
                      />
                    )}
                    {resizing === ALERT_KEY && <span className="pos-size">{alert.alertScale}%</span>}
                  </div>
                )}
              </div>
            </div>
            {screen.layout === 'phone' &&
              (['top', 'bottom'] as const).map((edge) => (
                <div
                  key={edge}
                  className={`safe-edge ${edge}`}
                  role="slider"
                  aria-label={edge === 'top' ? "Where TikTok's buttons end" : "Where TikTok's chat and gifts start"}
                  aria-valuenow={safe[edge]}
                  aria-valuemin={PHONE_SAFE_LIMITS[edge][0]}
                  aria-valuemax={PHONE_SAFE_LIMITS[edge][1]}
                  aria-valuetext={`${safe[edge]}% of the screen`}
                  tabIndex={0}
                  title="Drag to give widgets more room, or less"
                  onPointerDown={(e) => startEdge(edge, e)}
                  onKeyDown={(e) => {
                    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
                    if (!step) return;
                    e.preventDefault();
                    remember();
                    setSafe((old) => {
                      const [min, max] = PHONE_SAFE_LIMITS[edge];
                      const other = edge === 'top' ? old.bottom : old.top;
                      return { ...old, [edge]: Math.max(min, Math.min(max, 100 - MIN_PHONE_ROOM - other, old[edge] + (edge === 'top' ? step : -step))) };
                    });
                  }}
                >
                  <span>{safe[edge]}%</span>
                </div>
              ))}
          </div>
          <p className="muted small">
            Drag a widget or the sample alert to move it, or its corner to resize it.{screen.layout === 'phone' && " Drag the edges of the shaded parts to fit TikTok's buttons and chat on your stream."} Shift-click to tick several, right-click for more. Sample viewers and gifts.
          </p>

          {/* The grid of what's on the overlay, and the layer that opens over it. Both share one grid cell, so the
              area is as tall as whichever is taller. */}
          <div className={`overlay-below ${layer ? 'layered' : ''}`}>
            <div className="overlay-contents" inert={!!layer}>
              <section className="panel-part" aria-label="Built in">
                <h3 className="contents-title">Built in</h3>
                <ul className="built-in-grid">
                  {BUILT_IN.map(({ part, key, spot }) => {
                    const info = SCREEN_PARTS.find((p) => p.part === part)!;
                    const where = !screen[part]
                      ? 'Off'
                      : part === 'alerts'
                        ? alert.alertPos
                          ? 'Custom position'
                          : POSITION_LABELS[alert.alertPosition]
                        : part === 'mode' && modeState.mode === 'anarchy'
                          ? 'Nothing to show in Anarchy'
                          : parts[part as OverlayPart]?.pos
                            ? 'Custom position'
                            : SPOT_LABELS[spot!];
                    return (
                      <li key={key} className={`built-in ${screen[part] ? '' : 'off'} ${active === key ? 'picked' : ''}`}>
                        <button type="button" className="built-in-name" onClick={() => focus(key)} {...hoverProps(key)}>
                          <HueIcon name={info.icon} hue={info.hue} size="sm" />
                          <span className="widget-name">
                            <strong>{info.label}</strong>
                            <span className="muted small">{where}</span>
                          </span>
                        </button>
                        <label className="switch" title={`${info.label} on this overlay`}>
                          <input type="checkbox" checked={screen[part]} aria-label={`${info.label} on`} onChange={(e) => save({ [part]: e.target.checked })} />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
              <section className="panel-part" aria-label="Widgets">
                <div className="contents-head">
                  <h3 className="contents-title">
                    Widgets {widgets.length > 0 && <span className="tag">{widgets.length}</span>}
                  </h3>
                  {canAdd && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={startAdding}>
                      <Icon name="plus" size={14} />
                      Add widgets
                    </button>
                  )}
                </div>
                {pickedKeys.length > 0 && (
                  <div className="widget-batch" role="region" aria-label="Ticked widgets">
                    <div className="row">
                      <strong>
                        {pickedKeys.length} of {widgets.length} ticked
                      </strong>
                      <span className="spacer" />
                      {pickedKeys.length < widgets.length && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(widgets.map(widgetKey)))}>
                          Tick all
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>
                        Done
                      </button>
                    </div>
                    {batch(pickedKeys)}
                  </div>
                )}
                {widgets.length === 0 ? (
                  <p className="muted small">No widgets yet. Add some, then drag them into place on the preview.</p>
                ) : (
                  <ul className={`widget-cards ${screen.layout} ${pickedKeys.length ? 'ticking' : ''}`}>
                    {widgets.map((w) => {
                      const key = widgetKey(w);
                      const info = widgetInfo(w, goals);
                      return (
                        <li key={key} className={picked.has(key) ? 'ticked' : ''}>
                          <label className="widget-tick" title="Tick, to change several at once">
                            <input type="checkbox" checked={picked.has(key)} onChange={() => toggle(key)} aria-label={`Tick ${info.label}`} />
                          </label>
                          <button
                            type="button"
                            className="widget-tile"
                            onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey || pickedKeys.length ? toggle(key) : focus(key))}
                            onContextMenu={(e) => openMenu(key, e)}
                            {...hoverProps(key)}
                            aria-label={`Edit ${info.label}, ${widgetPlace(w)}`}
                          >
                            <HueIcon name={info.icon} hue={info.hue} size="sm" />
                            <span className="widget-name">
                              <strong>{info.label}</strong>
                              <span className="muted small">
                                {widgetPlace(w)}
                                {w.style && ' · Custom look'}
                              </span>
                            </span>
                            <SpotMap spot={w.spot} pos={w.pos} hue={info.hue} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
            {layer && <div className="overlay-layer">{layer}</div>}
          </div>
        </div>
        <aside className="oe-panel" aria-label={`${screen.name} settings`}>
          <OverlaySettings
            screen={screen}
            save={save}
            safe={safe}
            onSafe={(next) => (remember(), setSafe(next))}
            onDuplicate={() => setDuplicating(true)}
            onDelete={() => void guard(() => api('DELETE', `/screens/${screen.id}`).then(reload))()}
          />
          <section className="panel-part" aria-label="Built in settings">
            <div className="panel-head">
              <div>
                <h3>Built in</h3>
                <span className="muted small">Switch them on or off under the preview.</span>
              </div>
            </div>
            {screen.alerts && (
              <BuiltInCard part="alerts" lit={active === ALERT_KEY} open={unfolded.has(ALERT_KEY)} onToggle={() => fold(ALERT_KEY)} where={alert.alertPos ? 'Custom position' : POSITION_LABELS[alert.alertPosition]}>
                <div className="pos-place">
                  <SpotPad
                    spots={ALERT_PAD}
                    portrait={screen.layout === 'phone'}
                    band={safe}
                    value={alert.alertPosition}
                    custom={alert.alertPos && alertKnob(alert.alertPos)}
                    label="Snap alerts to a spot"
                    onPick={(alertPosition) => setAlert((a) => ({ ...a, alertPosition, alertPos: null }))}
                  />
                </div>
                <span className="muted small">Snap them to a spot, or drag the sample alert. Actions you placed by hand keep their own place.</span>
                <div className="field">
                  Size
                  <span className="hint">On top of the overlay's size. Each action's own size goes on top of this.</span>
                  <Scrubber value={alert.alertScale} min={50} max={200} buttonStep={5} unit="%" label="Alert size" onSave={(alertScale) => setAlert((a) => ({ ...a, alertScale }))} />
                </div>
              </BuiltInCard>
            )}
            {screen.leaderboard && (
              <BuiltInCard part="leaderboard" lit={active === 'part:leaderboard'} open={unfolded.has('part:leaderboard')} onToggle={() => fold('part:leaderboard')} where={parts.leaderboard?.pos ? 'Custom position' : 'Top right'}>
                <PartSize part="leaderboard" place={parts.leaderboard} overlaySize={screen.scale} onChange={(patch) => (remember(), setPart('leaderboard', patch))} />
                <div className="field">
                  Players
                  <span className="hint">How many it lists, once that many have played.</span>
                  <Scrubber value={screen.leaderboardSize} min={MIN_LEADERBOARD_SIZE} max={MAX_LEADERBOARD_SIZE} buttonStep={1} label="Leaderboard players" onSave={(leaderboardSize) => save({ leaderboardSize })} />
                </div>
              </BuiltInCard>
            )}
            {screen.feed && (
              <BuiltInCard part="feed" lit={active === 'part:feed'} open={unfolded.has('part:feed')} onToggle={() => fold('part:feed')} where={parts.feed?.pos ? 'Custom position' : 'Bottom left'}>
                <PartSize part="feed" place={parts.feed} overlaySize={screen.scale} onChange={(patch) => (remember(), setPart('feed', patch))} />
                <span className="muted small">Who pressed what, as they do it. Level-ups show here too, unless the overlay has a Level-ups widget.</span>
              </BuiltInCard>
            )}
            {screen.mode && (
              <BuiltInCard part="mode" lit={active === 'part:mode'} open={unfolded.has('part:mode')} onToggle={() => fold('part:mode')} where={parts.mode?.pos ? 'Custom position' : 'Top left'}>
                <PartSize part="mode" place={parts.mode} overlaySize={screen.scale} onChange={(patch) => (remember(), setPart('mode', patch))} />
                <span className="muted small">
                  Shows your crowd mode, {MODE_INFO[mode].label}, which you change on the Commands page.{mode === 'anarchy' && ' Anarchy has no panel, so nothing shows.'}
                </span>
              </BuiltInCard>
            )}
            {!screen.alerts && !screen.leaderboard && !screen.feed && !screen.mode && <p className="muted small">Turn on a built-in part under the preview to set it up here.</p>}
          </section>
        </aside>
      </div>
      {menu && menuWidget && (
        <ContextMenu x={menu.x} y={menu.y} title={menuKeys.length > 1 ? `${menuKeys.length} widgets` : widgetInfo(menuWidget, goals).label} onClose={closeMenu}>
          {menuKeys.length === 1 && (
            <button type="button" role="menuitem" className="context-item" onClick={() => (focus(menu.key), setMenu(null))}>
              <Icon name="settings" size={16} />
              Edit position and look
            </button>
          )}
          <button type="button" role="menuitem" className="context-item" onClick={() => (menuKeys.length > 1 ? setPicked(new Set()) : toggle(menu.key), setMenu(null))}>
            <Icon name="grid" size={16} />
            {menuKeys.length > 1 ? 'Untick all' : picked.has(menu.key) ? 'Untick' : 'Tick, to change several at once'}
          </button>
          {batch(menuKeys, closeMenu)}
        </ContextMenu>
      )}
    </section>
  );
}

// A built-in part's size, and getting it back to its corner once moved. Drag it, or its corner, on the preview.
function PartSize({ part, place, overlaySize, onChange }: { part: OverlayPart; place: PartPlace | undefined; overlaySize: number; onChange: (patch: PartPlace) => void }) {
  return (
    <>
      <div className="field">
        Size
        <Scrubber value={place?.size ?? overlaySize} {...{ min: WIDGET_STYLE_LIMITS.size[0], max: WIDGET_STYLE_LIMITS.size[1] }} buttonStep={5} unit="%" label={`${part} size`} onSave={(size) => onChange({ size })} />
      </div>
      <span className="muted small">
        {place?.size === undefined ? (
          `Follows the widget size, ${overlaySize}%. Drag it or its corner on the preview.`
        ) : (
          <>
            Its own size.{' '}
            <button type="button" className="link-button small" onClick={() => onChange({ size: undefined })}>
              Follow the widget size
            </button>
          </>
        )}
        {place?.pos && (
          <>
            {' '}
            <button type="button" className="link-button small" onClick={() => onChange({ pos: undefined })}>
              Back to its corner
            </button>
          </>
        )}
      </span>
    </>
  );
}

// One built-in part's settings on the right, in its own color, lit while it's picked on the preview.
// Folded to its name until opened.
function BuiltInCard({ part, lit, open, where, onToggle, children }: { part: 'alerts' | 'leaderboard' | 'feed' | 'mode'; lit: boolean; open: boolean; where: string; onToggle: () => void; children: ReactNode }) {
  const info = SCREEN_PARTS.find((p) => p.part === part)!;
  return (
    <section className={`built-in-card ${lit ? 'lit' : ''} ${open ? 'open' : ''}`} style={hueStyle(info.hue)} aria-label={info.label}>
      <button type="button" className="built-in-card-head" aria-expanded={open} onClick={onToggle}>
        <HueIcon name={info.icon} hue={info.hue} size="sm" />
        <strong>{info.label}</strong>
        <span className="muted small">{where}</span>
        <Icon name="chevron" size={16} />
      </button>
      {open && children}
    </section>
  );
}

// Everything about one widget, in the layer over the grid: where it goes and its own settings beside how it looks.
function WidgetInspector({
  widget,
  goals,
  layout,
  band,
  overlaySize,
  custom,
  onPlace,
  onLook,
  onSnap,
  onRemove,
  onCancel,
  onDone,
}: {
  widget: ScreenWidget;
  goals: Goal[];
  layout: ScreenLayout;
  band: PhoneSafe;
  overlaySize: number; // what it shows at without a size of its own
  custom: { x: number; y: number } | null;
  onPlace: (patch: Partial<ScreenWidget>) => void;
  onLook: (style: WidgetStyle | undefined) => void;
  onSnap: (spot: WidgetSpot) => void;
  onRemove: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const info = widgetInfo(widget, goals);
  return (
    <section className="panel-part" aria-label={`${info.label} settings`}>
      <div className="panel-head">
        <HueIcon name={info.icon} hue={info.hue} />
        <div>
          <h3>{info.label}</h3>
          <span className="muted small">{widgetPlace(widget)}</span>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone}>
          Done
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} title="Put it back as it was when you opened it">
          Cancel
        </button>
        <button type="button" className="btn btn-ghost btn-sm btn-delete" onClick={onRemove}>
          Remove
        </button>
      </div>
      <div className="layer-cols">
        <div className="panel-block">
          <span className="panel-label">Position</span>
          <div className="pos-place">
            <SpotPad spots={WIDGET_PAD} portrait={layout === 'phone'} band={band} value={widget.spot} custom={custom} label={`Snap ${info.label} to a spot`} onPick={onSnap} />
            <span className="muted small">Snap it to a spot, or drag it anywhere on the preview. Drag its corner to resize it.</span>
          </div>
          {widget.type === 'message' && (
            <label className="field">
              Message
              <input className="input" value={widget.text ?? DEFAULT_MESSAGE} required maxLength={MAX_MESSAGE_LENGTH} onChange={(e) => onPlace({ text: cleanTyped(e.target.value) })} />
            </label>
          )}
          {widget.type === 'coin_jar' && (
            <>
              <div className="field">
                Full at
                <AmountField
                  value={widget.minDiamonds ?? DEFAULT_JAR_DIAMONDS}
                  min={1}
                  max={10_000_000}
                  unit="coins"
                  label="Coins that fill the jar"
                  presets={[100, 500, 1000, 5000, 10_000]}
                  onSave={(minDiamonds) => onPlace({ minDiamonds })}
                />
              </div>
              <div className="field">
                When full
                <RaiseCell
                  raise={widget.raise ?? null}
                  target={widget.minDiamonds ?? DEFAULT_JAR_DIAMONDS}
                  label="What the jar does when it's full"
                  stay="Stay full"
                  unit="coins"
                  onSave={(raise) => onPlace({ raise: raise ?? undefined })}
                />
              </div>
              <Switch checked={widget.shine !== false} onChange={(on) => onPlace({ shine: on ? undefined : false })}>
                Shiny glass
              </Switch>
            </>
          )}
        </div>
        <div className="panel-block">
          <span className="panel-label">Look</span>
          <WidgetLookControls value={widget.style} size={{ value: widget.size ?? overlaySize, onChange: (size) => onPlace({ size }) }} onChange={onLook} />
          {widget.size === undefined ? (
            <span className="muted small">Its size follows the widget size, {overlaySize}%, set on the right.</span>
          ) : (
            <span className="muted small">
              Its own size, in place of the widget size.{' '}
              <button type="button" className="link-button small" onClick={() => onPlace({ size: undefined })}>
                Follow the widget size, {overlaySize}%
              </button>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

// The overlay's own settings: its name, the screen it's made for, its size and its sound. What it shows is switched
// under the preview.
function OverlaySettings({
  screen,
  save,
  safe,
  onSafe,
  onDuplicate,
  onDelete,
}: {
  screen: Screen;
  save: (patch: Partial<Screen>) => void;
  safe: PhoneSafe;
  onSafe: (safe: PhoneSafe) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const usualSafe = safe.top === DEFAULT_PHONE_SAFE.top && safe.bottom === DEFAULT_PHONE_SAFE.bottom;
  return (
    <section className="panel-part" aria-label="Overlay settings">
      <div className="panel-head">
        <div>
          <h3>Settings</h3>
          {screen.main && <span className="muted small">Your original overlay address. It shows everything unless you change it.</span>}
        </div>
      </div>
      <label className="field">
        Name
        <TextCell value={screen.name} required maxLength={40} label="Overlay name" onSave={(name) => save({ name })} />
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
        {screen.layout === 'phone' && (
          <span className="hint">
            TikTok covers the top {safe.top}% and bottom {safe.bottom}%. Drag the shaded edges on the preview to change it.{' '}
            {!usualSafe && (
              <button type="button" className="link-button small" onClick={() => onSafe(DEFAULT_PHONE_SAFE)}>
                Back to {DEFAULT_PHONE_SAFE.top}% and {DEFAULT_PHONE_SAFE.bottom}%
              </button>
            )}
          </span>
        )}
      </div>
      <div className="field">
        Widget size
        <span className="hint">Scales everything here, except what has its own size.</span>
        <Scrubber value={screen.scale} min={50} max={200} buttonStep={5} unit="%" label="Size" onSave={(scale) => save({ scale })} />
      </div>
      <Switch checked={screen.audio} onChange={(audio) => save({ audio })} hint="Alert sounds, voices and read-aloud chat.">
        Sound
      </Switch>
      <div className="overlay-actions" role="group" aria-label={`${screen.name} overlay`}>
        <button type="button" className="btn" onClick={onDuplicate} title="A copy of this overlay's setup, with a link of its own">
          <Icon name="copy" size={16} />
          Duplicate
        </button>
        {screen.main ? (
          <button type="button" className="btn btn-delete-overlay" disabled title="Your main overlay can't be deleted">
            <Icon name="trash" size={16} />
            Delete
          </button>
        ) : (
          <ConfirmButton className="btn btn-delete-overlay" message={`Delete ${screen.name}? Its link stops working.`} confirmLabel="Delete" onConfirm={onDelete}>
            <Icon name="trash" size={16} />
            Delete
          </ConfirmButton>
        )}
      </div>
    </section>
  );
}

// The parts of a screen that aren't widgets, each in the corner it always has, ahead of any widgets there (see
// LiveWidgets in Overlay.tsx).
// Alerts have no spot of their own: they go where the overlay's alert position says.
const BUILT_IN: { part: 'alerts' | 'mode' | 'leaderboard' | 'feed'; key: string; spot: WidgetSpot | null }[] = [
  { part: 'alerts', key: ALERT_KEY, spot: null },
  { part: 'feed', key: 'part:feed', spot: 'bottom-left' },
  { part: 'leaderboard', key: 'part:leaderboard', spot: 'top-right' },
  { part: 'mode', key: 'part:mode', spot: 'top-left' },
];

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
