import { createContext, useCallback, useContext, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ACTION_TRIGGERS, ALERT_SOUNDS, BUILT_IN_MEDIA, AUDIENCES, DEFAULT_ALERT_STYLE, GOAL_METRICS, type GoalMetric, MAX_KEY_REPEATS, MAX_MEDIA_TOTAL_BYTES, type AlertFx, type AlertSound, type AlertStyle, type ServerToOverlay } from '@hyperion/shared';
import { api, uploadMedia, type Action, type ActionTrigger, type Audience, type Command, type Goal, type Host, type MediaItem, type Screen } from '../api';
import { playSound } from '../sounds';
import { Card, cleanTyped, closeOnBackdrop, ConfirmButton, ErrorNotice, HueIcon, Scrubber, useError, type Hue } from '../ui';
import { Icon, type IconName } from '../icons';
import { alertPlace, useClearOfWidgets } from '../Overlay';
import { coinCount, findGift, GiftPicker, useGifts } from './GiftPicker';
import { alertLook } from '../alert-style';
import { EFFECT_LABELS, ScreenEffects } from '../effects';
import { ALERT_EFFECT_LABELS, AlertContent, alertFxClass, alertFxStyle } from '../alert-fx';
import { AlertEffectFields, EffectFields } from './EffectFields';
import { AlertLookEditor } from './AlertLookEditor';
import { GiftBus, usePreview } from '../overlay-widgets';
import { canvasStyle, FadedWidgets, METRIC_LABELS, stageProps, useStageFit } from './OverlayPage';
import { alertHandleCorner, dragAlert, dragAlertSize } from './alert-drag';
import { playAlertPreview, previewAudio } from './audio';
import { Link } from '../router';
import type { PageProps } from './Dashboard';

// The host's two pop-up looks, for the previews of actions that don't have their own.
const HostLooks = createContext({ main: DEFAULT_ALERT_STYLE, second: DEFAULT_ALERT_STYLE });
const useLook = (draft: Pick<Action, 'alertStyle' | 'useAlertStyle2'>) => {
  const { main, second } = useContext(HostLooks);
  return draft.alertStyle ?? (draft.useAlertStyle2 ? second : main);
};

export function ActionsPage({ host, refreshHost }: PageProps) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const loadMedia = useCallback(() => api<MediaItem[]>('GET', '/media').then(setMedia), []);
  useEffect(() => void loadMedia(), [loadMedia]);
  const [actions, setActions] = useState<Action[]>([]);
  const main = host.alertStyle ?? DEFAULT_ALERT_STYLE;
  return (
    <HostLooks.Provider value={{ main, second: host.alertStyle2 ?? main }}>
      <div className="stack">
        <DefaultLookCard host={host} refreshHost={refreshHost} actions={actions} media={media} />
        <ActionsCard host={host} media={media} actions={actions} setActions={setActions} />
        <MediaCard media={media} reload={loadMedia} actions={actions} setActions={setActions} />
        <SoundsCard host={host} refreshHost={refreshHost} actions={actions} setActions={setActions} media={media} reload={loadMedia} />
      </div>
    </HostLooks.Provider>
  );
}

const usedBy = (count: number) => `Used by ${count} action${count === 1 ? '' : 's'}`;

// Picks one of the host's looks. Each is its own button, showing that look, with a number and color to tell them apart.
function LookSlots<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; mark: string; hue: Hue; label: string; note: string; style: AlertStyle }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="look-slots" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const look = alertLook(o.style);
        return (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={`look-slot ${o.hue}`} onClick={() => onChange(o.id)}>
            <span className="look-slot-mark" aria-hidden="true">
              {o.mark}
            </span>
            <span className="look-preset-stage">
              <span className={`overlay-alert ${look.className}`} style={look.style}>
                Aa
              </span>
            </span>
            <span className="look-slot-text">
              <strong>{o.label}</strong>
              <span className="muted small">{o.note}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// How every alert looks unless its action has a look of its own. Edited here and saved together, so dragging
// through colors doesn't reload a live stream at every step.
function DefaultLookCard({ host, refreshHost, actions, media }: Pick<PageProps, 'host' | 'refreshHost'> & { actions: Action[]; media: MediaItem[] }) {
  const looks = useContext(HostLooks);
  const [slot, setSlot] = useState<'main' | 'second'>('main');
  const [edits, setEdits] = useState<{ main?: AlertStyle; second?: AlertStyle }>({}); // kept while switching between the two
  const saved = looks[slot];
  const draft = edits[slot] ?? saved;
  const setDraft = (style: AlertStyle | undefined) => setEdits((e) => ({ ...e, [slot]: style }));
  const [previewed, setPreviewed] = useState(''); // an action's id; '' is the sample
  const [replays, setReplays] = useState(0);
  const { error, guard } = useError();
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = guard(() => api('PATCH', '/settings', { [slot === 'main' ? 'alertStyle' : 'alertStyle2']: draft }).then(refreshHost).then(() => setDraft(undefined)));
  const previewable = actions.filter((a) => a.text || a.mediaId);
  const action = previewable.find((a) => a.id === previewed) ?? { ...newDraft(), text: '{viewer} followed!' };
  return (
    <Card
      badge="sparkle"
      hue="pink"
      title="Pop-up style"
      description="How your alerts look on stream: colors, font, shape and animation. Every action uses your main style unless you pick your second style or give it its own."
    >
      <ErrorNotice error={error} />
      <div className="stack">
        <LookSlots
          label="Style to edit"
          value={slot}
          options={[
            { id: 'main', mark: '1', hue: 'indigo', label: 'Main style', note: usedBy(actions.filter((a) => !a.alertStyle && !a.useAlertStyle2).length), style: edits.main ?? looks.main },
            { id: 'second', mark: '2', hue: 'pink', label: 'Second style', note: usedBy(actions.filter((a) => !a.alertStyle && a.useAlertStyle2).length), style: edits.second ?? looks.second },
          ]}
          onChange={setSlot}
        />
        <div className="default-look">
          <div className="look-preview stack">
            {previewable.length > 0 && (
              <label className="field">
                Preview with
                <select className="input" value={previewed} onChange={(e) => (setPreviewed(e.target.value), setReplays((n) => n + 1))}>
                  <option value="">A sample follow</option>
                  {previewable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <AlertPreview key={replays} draft={{ ...action, alertStyle: draft }} media={media} />
          </div>
          <div className="stack">
            {slot === 'second' && (
              <button type="button" className="btn" onClick={() => setDraft({ ...looks.main })}>
                Copy my main style
              </button>
            )}
            <AlertLookEditor value={draft} onChange={setDraft} onReplay={() => setReplays((n) => n + 1)} />
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" disabled={!changed} onClick={() => void save()}>
          {changed ? `Save ${slot} style` : 'Saved'}
        </button>
        {changed && (
          <button className="btn btn-ghost" onClick={() => setDraft(undefined)}>
            Undo changes
          </button>
        )}
      </div>
    </Card>
  );
}

// Each trigger's icon and color match the same thing elsewhere: followers sky, gifts amber, goals violet.
const TRIGGERS: Record<ActionTrigger, { label: string; placeholders: string; icon: IconName; hue: Hue }> = {
  follow: { label: 'Follows you', placeholders: '{viewer}', icon: 'follower', hue: 'sky' },
  share: { label: 'Shares the stream', placeholders: '{viewer}', icon: 'share', hue: 'green' },
  gift: { label: 'Sends a gift', placeholders: '{viewer}, {gift}, {count}, {coins}', icon: 'gift', hue: 'amber' },
  likes: { label: 'Likes reach a number', placeholders: '{viewer}, {total}, {count}', icon: 'heart', hue: 'pink' },
  viewer_likes: { label: 'One viewer likes a number of times', placeholders: '{viewer}, {total}, {count}', icon: 'heart', hue: 'pink' },
  join: { label: 'Joins the stream', placeholders: '{viewer}', icon: 'crowd', hue: 'teal' },
  subscribe: { label: 'Subscribes', placeholders: '{viewer}, {months}', icon: 'star', hue: 'violet' },
  emote: { label: 'Sends a subscriber sticker', placeholders: '{viewer}', icon: 'sparkle', hue: 'orange' },
  command: { label: 'Types a chat command', placeholders: '{viewer}, {text} (what they typed after the command)', icon: 'chat', hue: 'indigo' },
  first_activity: { label: 'Does anything for the first time this stream', placeholders: '{viewer}', icon: 'bell', hue: 'teal' },
  goal: { label: 'Reaches a goal', placeholders: '{viewer} (who reached it), {goal}, {target}', icon: 'target', hue: 'violet' },
};

const AUDIENCE_LABELS: Record<Audience, string> = {
  everyone: 'Everyone',
  followers: 'Followers',
  subscribers: 'Subscribers',
  moderators: 'Moderators',
  top_gifters: 'Top 3 gifters',
  viewer: 'One viewer',
};

// What a new action says, until the host writes their own.
const TRIGGER_TEXT: Record<ActionTrigger, string> = {
  follow: '{viewer} followed!',
  share: '{viewer} shared the stream!',
  gift: '{viewer} sent {count}× {gift}!',
  likes: '{total} likes! Thanks {viewer}',
  viewer_likes: '{viewer} sent {total} likes!',
  join: '{viewer} joined!',
  subscribe: '{viewer} subscribed for {months} months!',
  emote: '{viewer} sent a sticker!',
  command: '{viewer} used a command!',
  first_activity: 'Welcome, {viewer}!',
  goal: '{goal} reached!',
};

// The sound each trigger starts with, matching the starter actions new hosts get (server actions/defaults.ts).
const TRIGGER_SOUND: Partial<Record<ActionTrigger, Draft['sound']>> = {
  share: 'whoosh',
  gift: 'coin',
  likes: 'pop',
  viewer_likes: 'pop',
  subscribe: 'fanfare',
  goal: 'fanfare',
};

// A built-in sound the host removed isn't put in by default.
const unlessHidden = (sound: Draft['sound'], hidden: readonly AlertSound[]) => (sound && hidden.includes(sound) ? null : sound);

// What resetting an action to its trigger's defaults puts back: what it's called, what it says and plays, and the
// trigger's own settings. Its look, effects, key press, points and placement aren't about the trigger, so they stay.
const triggerDefaults = (trigger: ActionTrigger, hidden: readonly AlertSound[]): Partial<Draft> => {
  const fresh = newDraft();
  return {
    name: '',
    text: TRIGGER_TEXT[trigger],
    sound: unlessHidden(TRIGGER_SOUND[trigger] ?? fresh.sound, hidden),
    soundMediaId: null,
    giftName: fresh.giftName,
    minDiamonds: fresh.minDiamonds,
    likeStep: fresh.likeStep,
    likeGrowth: fresh.likeGrowth,
    command: fresh.command,
    goalId: fresh.goalId,
  };
};
// A name the editor filled in for its trigger counts as no name.
const atDefaults = (d: Draft, hidden: readonly AlertSound[]) =>
  Object.entries(triggerDefaults(d.trigger, hidden)).every(([k, v]) => (k === 'name' ? d.name === '' || d.name === TRIGGERS[d.trigger].label : d[k as keyof Draft] === v));

const ACTION_TABS = [
  ['when', 'When', 'bell'],
  ['alert', 'Alert', 'chat'],
  ['look', 'Look', 'sparkle'],
  ['also', 'Keys and points', 'commands'],
] as const satisfies readonly (readonly [string, string, IconName])[];
const EDITOR_LAYOUT_KEY = 'hyperion-action-editor';
function storedEditorLayout() {
  try {
    return localStorage.getItem(EDITOR_LAYOUT_KEY) !== 'stacked';
  } catch {
    return true;
  }
}

type Draft = Omit<Action, 'id'>;
const newDraft = (): Draft => ({
  profileId: null,
  name: '',
  enabled: true,
  trigger: 'follow',
  giftName: null,
  minDiamonds: null,
  likeStep: 1000,
  likeGrowth: null,
  command: null,
  goalId: null,
  audience: 'everyone',
  audienceViewer: null,
  cooldownMs: 0,
  viewerCooldownMs: 0,
  random: false,
  text: TRIGGER_TEXT.follow,
  sound: 'chime',
  soundMediaId: null,
  mediaId: null,
  speak: false,
  durationMs: 5000,
  effect: null,
  effectAmount: 3,
  effectColor: null,
  effectSpeed: 100,
  alertEffect: null,
  alertEmoji: '🎉',
  alertShape: 'star',
  alertEffectColor: null,
  alertEffectAmount: 3,
  alertEffectSpeed: 100,
  alertX: null,
  alertY: null,
  alertScale: 100,
  alertStyle: null,
  useAlertStyle2: false,
  keyCommandId: null,
  repeatWithCount: true, // a gift streak presses its key once per gift: a streak of 5 roses is 5 presses
  points: 0,
  screenId: null,
});

function ActionsCard({ host, media, actions, setActions }: { host: Host; media: MediaItem[]; actions: Action[]; setActions: (actions: Action[]) => void }) {
  const [commands, setCommands] = useState<Command[]>([]);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [tested, setTested] = useState<{ id: string; overlays: number } | null>(null);
  const { error, guard } = useError();
  // Test runs on the overlay. With none open it plays here instead, so it's still heard; either way it says where it went.
  const test = (id: string) =>
    guard(async () => {
      const result = await api<{ alert: Extract<ServerToOverlay, { type: 'alert' }> | null; overlays: number }>('POST', `/actions/${id}/test`);
      if (result.overlays === 0 && result.alert) playAlertPreview(result.alert);
      setTested({ id, overlays: result.overlays });
    })();
  const load = useCallback(
    () =>
      Promise.all([api<Action[]>('GET', '/actions'), api<Command[]>('GET', '/commands'), api<Screen[]>('GET', '/screens'), api<Goal[]>('GET', '/goals')]).then(
        ([a, c, s, g]) => {
          setActions(a);
          setCommands(c);
          setScreens(s);
          setGoals(g);
        },
      ),
    [],
  );
  // Switching profiles changes which actions and commands apply.
  useEffect(() => void load(), [load, host.profileId]);

  const save = (id: string | null, draft: Draft) => {
    // Only the editable fields: a loaded action also carries its id and bookkeeping.
    const body = Object.fromEntries(Object.keys(newDraft()).map((k) => [k, draft[k as keyof Draft]]));
    return (id ? api('PATCH', `/actions/${id}`, body) : api('POST', '/actions', body)).then(() => (setEditing(null), load()));
  };
  const update = (id: string, patch: Partial<Action>) => guard(() => api('PATCH', `/actions/${id}`, patch).then(load))();
  const addGoal = (goal: Goal) => setGoals((now) => [...now, goal]);
  const context = { host, commands, media, screens, goals, addGoal };

  return (
    <Card
      badge="flow"
      hue="indigo"
      title="Alerts"
      description="What happens when viewers do something: an alert on your overlay, a sound, a picture or video, a voice, a key press, or points. Test sends an alert to your open overlays, live or not."
      actions={
        <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={editing === 'new'}>
          New alert
        </button>
      }
    >
      <ErrorNotice error={error} />
      {editing === 'new' && (
        <ActionEditor title="New alert" initial={{ ...newDraft(), sound: unlessHidden(newDraft().sound, host.hiddenSounds) }} {...context} onSave={(d) => save(null, d)} onCancel={() => setEditing(null)} />
      )}
      {actions.length === 0 && editing !== 'new' && <p className="empty">No alerts yet. Add one to thank followers, react to gifts, or let chat trigger something.</p>}
      <ul className="action-list">
        {actions.map((a) => (
          <li key={a.id} className={a.enabled ? '' : 'off'}>
            <div className="action-row">
              <label className="switch">
                <input type="checkbox" checked={a.enabled} aria-label={`${a.name} on`} onChange={(e) => update(a.id, { enabled: e.target.checked })} />
              </label>
              <HueIcon name={TRIGGERS[a.trigger].icon} hue={TRIGGERS[a.trigger].hue} />
              <div className="action-summary">
                <strong>{a.name}</strong>
                <span className="muted small">{describeWhen(a, goals)}</span>
                <span className="action-does">
                  {describeDoes(a, commands, media, host).map(([d, hue]) => (
                    <span key={d} className={`tag ${hue}`}>
                      {d}
                    </span>
                  ))}
                </span>
              </div>
              <AlertPreview draft={a} media={media} compact />
              <span className="action-buttons">
                <button className="btn btn-sm btn-try" onClick={() => test(a.id)} title="Show this alert on your open overlays">
                  Test
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(editing === a.id ? null : a.id)} aria-expanded={editing === a.id}>
                  Edit
                </button>
                <button className="btn btn-ghost btn-sm btn-delete" onClick={guard(() => api('DELETE', `/actions/${a.id}`).then(load))}>
                  Delete
                </button>
              </span>
            </div>
            {tested?.id === a.id && (
              <p className="notice info test-result" role="status">
                {tested.overlays > 0 ? (
                  `Sent to ${tested.overlays} open overlay${tested.overlays === 1 ? '' : 's'}. The sound plays there, not on this page.`
                ) : (
                  <>
                    No overlay is open, so the sound played on this page instead. To see the alert itself, open a preview on the <Link href="/dashboard/overlay">Stream overlay</Link> page and test again.
                  </>
                )}
              </p>
            )}
            {editing === a.id && <ActionEditor title="Editing" initial={a} {...context} onSave={(d) => save(a.id, d)} onCancel={() => setEditing(null)} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// One gift or any.
function GiftField({ value, onChange }: { value: string | null; onChange: (gift: string | null) => void }) {
  const gifts = useGifts();
  const picked = findGift(gifts, value);
  return (
    <div className="field gift-field">
      Gift
      <span className="hint">An alert for one gift replaces the any-gift alert for it.</span>
      <div className="gift-picked">
        {picked?.image && <img src={picked.image} alt="" referrerPolicy="no-referrer" />}
        <span>
          <strong>{value ?? 'Any gift'}</strong>
          {picked && picked.coins > 0 && <span className="muted small">{coinCount(picked.coins)}</span>}
        </span>
        <span className="spacer" />
        {value && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
            Use any gift
          </button>
        )}
      </div>
      <GiftPicker gifts={gifts} picked={value ? [value] : []} onPick={onChange} />
    </div>
  );
}

const LIKE_GROWTH = [1.5, 2, 3, 5, 10];
// The next few targets after the first, for the hint.
function likeTargets({ likeStep, likeGrowth }: Pick<Action, 'likeStep' | 'likeGrowth'>) {
  const targets = [likeStep ?? 0];
  for (let i = 0; i < 2; i++) targets.push(Math.ceil(targets.at(-1)! * likeGrowth!));
  return targets.slice(1).map((t) => t.toLocaleString());
}

const likeWhen = (a: Action, what: string) =>
  a.likeGrowth ? `At ${a.likeStep?.toLocaleString()} ${what}, then ×${a.likeGrowth} each time` : `Every ${a.likeStep?.toLocaleString()} ${what}`;

function describeWhen(a: Action, goals: Goal[]): string {
  const who = a.audience === 'viewer' ? `only ${a.audienceViewer}` : a.audience === 'everyone' ? '' : `${AUDIENCE_LABELS[a.audience].toLowerCase()} only`;
  const what =
    a.trigger === 'gift'
      ? `Sends ${a.giftName ?? 'any gift'}${a.minDiamonds ? ` worth ${a.minDiamonds}+ coins` : ''}`
      : a.trigger === 'likes'
        ? likeWhen(a, 'likes')
        : a.trigger === 'viewer_likes'
          ? likeWhen(a, 'likes from one viewer')
        : a.trigger === 'command'
          ? `Types ${a.command}`
          : a.trigger === 'goal'
            ? `${goals.find((g) => g.id === a.goalId)?.name ?? 'A goal'} is reached`
            : TRIGGERS[a.trigger].label;
  return [what, who, a.random ? 'random pick' : '', a.profileId ? 'this profile' : ''].filter(Boolean).join(', ');
}

// What an action does, each with its color: alerts pink, sounds violet, pictures sky, voice teal, key presses amber
// (like the keycaps on the Live page), points green.
function describeDoes(a: Action, commands: Command[], media: MediaItem[], host: Host): [string, Hue][] {
  const does: [string, Hue][] = [];
  if (a.text) does.push(['Alert', 'pink']);
  if (a.sound) does.push([`Sound: ${a.sound}`, 'violet']);
  if (a.soundMediaId) does.push([`Sound: ${media.find((m) => m.id === a.soundMediaId)?.name ?? 'file'}`, 'violet']);
  if (a.mediaId) does.push([media.find((m) => m.id === a.mediaId)?.kind === 'video' ? 'Video' : 'Picture', 'sky']);
  if (a.speak && a.text) does.push(['Read aloud', 'teal']);
  if (a.alertEffect) does.push([`Alert animation: ${ALERT_EFFECT_LABELS[a.alertEffect]}`, 'orange']);
  if (a.effect) does.push([`Screen animation: ${a.effect === 'random' ? 'random' : EFFECT_LABELS[a.effect]}`, 'orange']);
  const command = commands.find((c) => c.id === a.keyCommandId);
  if (command) does.push([`Presses ${command.keyword}`, 'amber']);
  if (a.points > 0 && host.points) does.push([`+${a.points.toLocaleString()} points`, 'green']);
  return does;
}

// A goal made from an action's editor, for when the one it should run on doesn't exist yet. Like one made on the Stream
// overlay page, it gets its own widget on the main screen.
function NewGoal({ onAdded }: { onAdded: (goal: Goal) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ name: string; metric: GoalMetric; target: number }>({ name: '', metric: 'likes', target: 1000 });
  const [busy, setBusy] = useState(false);
  const { error, guard } = useError();
  if (!open) {
    return (
      <div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          <Icon name="plus" size={14} />
          New goal
        </button>
      </div>
    );
  }
  // Not a <form>: it sits inside the action's form, and Enter here shouldn't save the action.
  const create = guard(async () => {
    setBusy(true);
    try {
      const goal = await api<Goal>('POST', '/goals', { ...draft, name: draft.name.trim() || `${METRIC_LABELS[draft.metric]} goal` });
      onAdded(goal);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  });
  return (
    <div className="new-goal">
      <input
        className="input"
        autoFocus
        placeholder={`${METRIC_LABELS[draft.metric]} goal`}
        aria-label="New goal name"
        maxLength={40}
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: cleanTyped(e.target.value) })}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), create())}
      />
      <div className="row">
        <select className="input" aria-label="What the new goal counts" value={draft.metric} onChange={(e) => setDraft({ ...draft, metric: e.target.value as GoalMetric })}>
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
          max={100_000_000}
          aria-label="New goal target"
          value={draft.target}
          onChange={(e) => setDraft({ ...draft, target: Math.max(1, Number(e.target.value) || 1) })}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), create())}
        />
      </div>
      <ErrorNotice error={error} />
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={create}>
          {busy ? 'Adding…' : 'Add goal'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ActionEditor({
  title,
  initial,
  host,
  commands,
  media,
  screens,
  goals,
  addGoal,
  onSave,
  onCancel,
}: {
  title: string;
  initial: Draft;
  host: Host;
  commands: Command[];
  media: MediaItem[];
  screens: Screen[];
  goals: Goal[];
  addGoal: (goal: Goal) => void;
  onSave: (draft: Draft) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [replays, setReplays] = useState(0); // a new count shows the preview's entrance again
  const [sideBySide, setSideBySide] = useState(storedEditorLayout);
  const [tab, setTab] = useState<(typeof ACTION_TABS)[number][0]>('when');
  const switchLayout = () => {
    setSideBySide(!sideBySide);
    try {
      localStorage.setItem(EDITOR_LAYOUT_KEY, sideBySide ? 'stacked' : 'tabs');
    } catch {} // only means it isn't remembered
  };
  // Each trigger keeps its own name, text, sound and settings while the editor is open: switching shows the new one's
  // (its defaults, or what was written for it earlier), so the preview follows, and switching back finds the writing
  // still there. Reset puts back the current trigger's defaults.
  const perTrigger = useRef(new Map<ActionTrigger, Partial<Draft>>());
  const triggerFields = (d: Draft) => Object.fromEntries(Object.keys(triggerDefaults(d.trigger, host.hiddenSounds)).map((k) => [k, d[k as keyof Draft]])) as Partial<Draft>;
  const pickTrigger = (trigger: ActionTrigger) =>
    setDraft((d) => {
      if (trigger === d.trigger) return d;
      perTrigger.current.set(d.trigger, triggerFields(d));
      return { ...d, ...(perTrigger.current.get(trigger) ?? triggerDefaults(trigger, host.hiddenSounds)), trigger };
    });
  const resetToTrigger = () => setDraft((d) => ({ ...d, ...triggerDefaults(d.trigger, host.hiddenSounds) }));
  const look = useLook(draft);
  const { main, second } = useContext(HostLooks);
  const { error, guard } = useError();
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const text = (value: string) => value.trim() || null;
  const sounds = media.filter((m) => m.kind === 'audio' && !m.builtIn);
  const builtInSounds = media.filter((m) => m.kind === 'audio' && m.builtIn);
  const visuals = media.filter((m) => m.kind !== 'audio');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = draft.name.trim() || TRIGGERS[draft.trigger].label;
    guard(() => onSave({ ...draft, name }))();
  };
  const actionLook = useLook(draft);
  const soundValue = draft.soundMediaId ? `file:${draft.soundMediaId}` : (draft.sound ?? '');
  const setSound = (value: string) =>
    set(value.startsWith('file:') ? { sound: null, soundMediaId: value.slice(5) } : { sound: (value || null) as Draft['sound'], soundMediaId: null });


  // Puts back the current trigger's own name, text, sound and settings; beside Save, since it's about the whole draft.
  const reset = !atDefaults(draft, host.hiddenSounds) && (
    <ConfirmButton
      className="btn btn-ghost"
      label="Reset to this trigger's defaults"
      title={`Reset to the defaults for “${TRIGGERS[draft.trigger].label}”`}
      message={`Put back the name, alert text, sound and trigger settings for “${TRIGGERS[draft.trigger].label}”? The look, effects and key press stay. Nothing is saved until you save the action.`}
      confirmLabel="Reset"
      onConfirm={resetToTrigger}
    >
      <Icon name="refresh" size={14} />
      Reset to defaults
    </ConfirmButton>
  );
  const preview = (
        <div className="look-preview">
          <AlertPreview key={replays} draft={draft} media={media} />
        </div>
  );
  const when = (
      <Section title="When a viewer" icon={TRIGGERS[draft.trigger].icon} hue={TRIGGERS[draft.trigger].hue}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="action-trigger">Does this</label>
            <select id="action-trigger" className="input" value={draft.trigger} onChange={(e) => pickTrigger(e.target.value as ActionTrigger)}>
              {ACTION_TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {TRIGGERS[t].label}
                </option>
              ))}
            </select>
          </div>
          {draft.trigger === 'gift' && (
            <>
              {/* One gift is that gift, whatever it's worth: a coin amount is only for any gift. */}
              <GiftField value={draft.giftName} onChange={(giftName) => set({ giftName, ...(giftName && { minDiamonds: null }) })} />
              {!draft.giftName && (
                <label className="field">
                  Worth at least
                  <span className="hint">In coins, counting the whole streak. Empty for any amount.</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={draft.minDiamonds ?? ''}
                    placeholder="Any"
                    onChange={(e) => set({ minDiamonds: e.target.value ? Number(e.target.value) : null })}
                  />
                </label>
              )}
            </>
          )}
          {(draft.trigger === 'likes' || draft.trigger === 'viewer_likes') && (
            <>
              <label className="field">
                Run it
                <span className="hint">{draft.likeGrowth ? `${(draft.likeStep ?? 0).toLocaleString()}, then ${likeTargets(draft).join(', ')} and so on.` : 'At the same gap each time.'}</span>
                <select className="input" value={draft.likeGrowth ?? ''} onChange={(e) => set({ likeGrowth: Number(e.target.value) || null })}>
                  <option value="">Every same number of likes</option>
                  {LIKE_GROWTH.map((g) => (
                    <option key={g} value={g}>
                      Multiply the target by {g} each time
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {draft.likeGrowth ? 'First target, in likes' : 'Every this many likes'}
                <span className="hint">{draft.trigger === 'likes' ? 'Counted across the whole stream.' : "Each viewer's own likes, counted from zero each stream."}</span>
                <input className="input" type="number" min={1} required value={draft.likeStep ?? ''} onChange={(e) => set({ likeStep: Number(e.target.value) || null })} />
              </label>
            </>
          )}
          {draft.trigger === 'goal' && (
            <div className="field">
              <label htmlFor="action-goal">Goal</label>
              <span className="hint">{goals.length === 0 ? 'You have no goals yet. Make one here.' : "Runs once a stream, when it's reached."}</span>
              {goals.length > 0 && (
                <select id="action-goal" className="input" required value={draft.goalId ?? ''} onChange={(e) => set({ goalId: e.target.value || null })}>
                  <option value="">Pick a goal</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
              {!draft.goalId && <NewGoal onAdded={(goal) => (addGoal(goal), set({ goalId: goal.id }))} />}
            </div>
          )}
          {draft.trigger === 'command' && (
            <label className="field">
              Command
              <span className="hint">The start of their message, like !dance. Any capitalization.</span>
              <input
                className="input"
                required
                maxLength={32}
                value={draft.command ?? ''}
                placeholder="!dance"
                onChange={(e) => set({ command: cleanTyped(e.target.value, /\S/) || null })}
              />
            </label>
          )}
        </div>
      </Section>
  );
  const limits = (
      <>
        <div className="form-grid">
          <label className="field">
            Who
            <span className="hint">TikTok says who follows, subscribes or moderates when they chat or gift.</span>
            <select className="input" value={draft.audience} onChange={(e) => set({ audience: e.target.value as Audience })}>
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {AUDIENCE_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          {draft.audience === 'viewer' && (
            <label className="field">
              Viewer
              <span className="hint">Their TikTok username.</span>
              <input
                className="input"
                required
                maxLength={64}
                value={draft.audienceViewer ?? ''}
                onChange={(e) => set({ audienceViewer: text(cleanTyped(e.target.value, /[A-Za-z0-9_.@]/)) })}
              />
            </label>
          )}
          <label className="field">
            Wait between runs, in seconds
            <span className="hint">For everyone. 0 means no wait.</span>
            <input className="input" type="number" min={0} max={3600} value={draft.cooldownMs / 1000} onChange={(e) => set({ cooldownMs: Math.round(Number(e.target.value) * 1000) })} />
          </label>
          <label className="field">
            Wait per viewer, in seconds
            <span className="hint">Before the same viewer can run it again.</span>
            <input
              className="input"
              type="number"
              min={0}
              max={3600}
              value={draft.viewerCooldownMs / 1000}
              onChange={(e) => set({ viewerCooldownMs: Math.round(Number(e.target.value) * 1000) })}
            />
          </label>
        </div>
        <label className="switch">
          <input type="checkbox" checked={draft.random} onChange={(e) => set({ random: e.target.checked })} />
          <span>
            Random pick
            <small>When something matches several random actions, only one of them runs. Use it for a set of sounds or reactions.</small>
          </span>
        </label>
      </>
  );
  const alert = (
      <Section title="Show on stream" icon="bell" hue="pink">
        <label className="field">
          Alert text
          <span className="hint">Placeholders: {TRIGGERS[draft.trigger].placeholders}. Empty shows no text.</span>
          <input className="input" maxLength={200} value={draft.text ?? ''} onChange={(e) => set({ text: cleanTyped(e.target.value) || null })} />
        </label>
{!sideBySide && preview}
        <div className="form-grid">
          <label className="field">
            Sound
            <span className="row" style={{ flexWrap: 'nowrap' }}>
              <select className="input" value={soundValue} onChange={(e) => setSound(e.target.value)}>
                <option value="">None</option>
                <optgroup label="Built in">
                  {ALERT_SOUNDS.filter((s) => s === draft.sound || !host.hiddenSounds.includes(s)).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                {builtInSounds.map((m) => (
                  <option key={m.id} value={`file:${m.id}`}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
                {sounds.length > 0 && (
                  <optgroup label="Your uploads">
                    {sounds.map((m) => (
                      <option key={m.id} value={`file:${m.id}`}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <PreviewSound value={soundValue} volumes={host.soundVolumes} />
            </span>
          </label>
          <label className="field">
            Picture or video
            <span className="hint">{visuals.length === 0 ? 'Upload one below first.' : 'Shown above the text.'}</span>
            <select className="input" value={draft.mediaId ?? ''} disabled={visuals.length === 0} onChange={(e) => set({ mediaId: e.target.value || null })}>
              <option value="">None</option>
              {visuals.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.kind})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Show for, in seconds
            <input className="input" type="number" min={1} max={60} value={draft.durationMs / 1000} onChange={(e) => set({ durationMs: Math.round(Number(e.target.value) * 1000) })} />
          </label>
        </div>
        <label className="switch">
          <input type="checkbox" checked={draft.speak} disabled={!draft.text} onChange={(e) => set({ speak: e.target.checked })} />
          <span>
            Read the text aloud
            <small>With your voice settings.</small>
          </span>
        </label>
        <AlertEffectFields value={draft} hasMedia={!!draft.mediaId} look={actionLook} onChange={set} />
        <EffectFields value={draft} onChange={set} />
      </Section>
  );
  const appearance = (
      <Section title="Look and place" icon="sparkle" hue="violet">
        <div className="field">
          Pop-up style
          <LookSlots
            label="Pop-up style"
            value={draft.alertStyle ? 'own' : draft.useAlertStyle2 ? 'second' : 'main'}
            options={[
              { id: 'main', mark: '1', hue: 'indigo', label: 'Main style', note: 'Shared', style: main },
              { id: 'second', mark: '2', hue: 'pink', label: 'Second style', note: 'Shared', style: second },
              { id: 'own', mark: '★', hue: 'teal', label: 'Just this action', note: 'Its own look', style: draft.alertStyle ?? look },
            ]}
            // Its own style starts as a copy of the current one, so nothing jumps until something is changed.
            onChange={(choice) => set({ alertStyle: choice === 'own' ? { ...look } : null, useAlertStyle2: choice === 'second' })}
          />
          {!draft.alertStyle && <span className="hint">Change it at the top of this page, under Pop-up style. Every action using it changes too.</span>}
        </div>
        {draft.alertStyle && <AlertLookEditor value={draft.alertStyle} onChange={(alertStyle) => set({ alertStyle })} onReplay={() => setReplays((n) => n + 1)} />}
        <div className="form-grid">
          <AlertPlaceField draft={draft} screens={screens} media={media} onChange={set} />
          {screens.length > 1 && (
            <label className="field">
              Screen
              <span className="hint">Every screen showing alerts, or just one.</span>
              <select className="input" value={draft.screenId ?? ''} onChange={(e) => set({ screenId: e.target.value || null })}>
                <option value="">Every screen</option>
                {screens.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Section>
  );
  const also = (
      <Section title="Do" icon="commands" hue="indigo">
        <div className="form-grid">
          <label className="field">
            Run a command
            <span className="hint">Its key, macro, chain or game action. Skips crowd-mode limits. Ties the action to the {host.profileName} profile.</span>
            <select className="input" value={draft.keyCommandId ?? ''} onChange={(e) => set({ keyCommandId: e.target.value || null })}>
              <option value="">No command</option>
              {commands.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.keyword}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Give points
            <span className="hint">{host.points ? 'To the viewer who did it.' : 'Turn on points on the Leaderboard page first.'}</span>
            <input className="input" type="number" min={0} disabled={!host.points} value={draft.points} onChange={(e) => set({ points: Math.max(0, Number(e.target.value)) })} />
          </label>
        </div>
        {draft.trigger === 'gift' && draft.keyCommandId && (
          <label className="switch">
            <input type="checkbox" checked={draft.repeatWithCount} onChange={(e) => set({ repeatWithCount: e.target.checked })} />
            <span>
              Once per gift in a streak
              <small>A streak of 5 roses runs it 5 times, up to {MAX_KEY_REPEATS}.</small>
            </span>
          </label>
        )}
        {!draft.keyCommandId && (
          <label className="switch">
            <input type="checkbox" checked={draft.profileId !== null} onChange={(e) => set({ profileId: e.target.checked ? host.profileId : null })} />
            <span>
              Only with the {host.profileName} profile
              <small>Otherwise it runs whichever game profile is active.</small>
            </span>
          </label>
        )}
      </Section>
  );

  return (
    <form className="action-editor stack" onSubmit={submit} aria-label={title}>
      <div className="action-editor-head">
        <HueIcon name={TRIGGERS[draft.trigger].icon} hue={TRIGGERS[draft.trigger].hue} />
        <div className="action-editor-title">
          <h3>{draft.name.trim() || TRIGGERS[draft.trigger].label}</h3>
          <span className="muted small">{title}</span>
        </div>
        <span className="spacer" />
        <button type="button" className="link-button small" onClick={switchLayout}>
          {sideBySide ? 'Use the stacked layout' : 'Use the side-by-side layout'}
        </button>
      </div>
      <ErrorNotice error={error} />
      <label className="field">
        Name
        <input className="input" value={draft.name} maxLength={60} placeholder={TRIGGERS[draft.trigger].label} onChange={(e) => set({ name: cleanTyped(e.target.value) })} />
      </label>

      {sideBySide ? (
        <div className="action-split">
          <div className="stack">
            <div className="action-tabs" role="tablist" aria-label="Action settings">
              {ACTION_TABS.map(([id, label, icon]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className="action-tab" onClick={() => setTab(id)}>
                  <Icon name={icon} size={16} />
                  {label}
                </button>
              ))}
            </div>
            {tab === 'when' && (
              <>
                {when}
                <details className="action-more">
                  <summary>Who and how often</summary>
                  <div className="stack">{limits}</div>
                </details>
              </>
            )}
            {tab === 'alert' && alert}
            {tab === 'look' && appearance}
            {tab === 'also' && also}
          </div>
          <aside className="action-side stack" aria-label="This action at a glance">
            {preview}
            <div className="action-summary">
              <strong>{describeWhen({ ...draft, id: '' }, goals)}</strong>
              <div className="row">
                {describeDoes({ ...draft, id: '' }, commands, media, host).map(([what, hue]) => (
                  <span key={what} className={`tag ${hue}`}>
                    {what}
                  </span>
                ))}
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <>
          {when}
          <Section title="Who and how often" icon="crowd" hue="teal">
            {limits}
          </Section>
          {alert}
          {appearance}
          {also}
        </>
      )}

      <div className="action-editor-foot">
        {reset}
        <span className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary">Save action</button>
      </div>
    </form>
  );
}

function Section({ title, icon, hue, children }: { title: string; icon: IconName; hue: Hue; children: ReactNode }) {
  const id = `action-section-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section className="action-section stack" role="group" aria-labelledby={id}>
      <h4 id={id} className="action-section-title">
        <HueIcon name={icon} hue={hue} size="sm" />
        {title}
      </h4>
      {children}
    </section>
  );
}

// The alert as it looks on stream, with sample names in its placeholders, over a stand-in for the stream. Its place
// and size are set with Place and size. Compact is the small one on each row of the list.
const PREVIEW_HOLD_MS = 600_000; // stays up to be looked at, until Play again

function AlertPreview({ draft, media, compact }: { draft: Draft; media: MediaItem[]; compact?: boolean }) {
  const file = media.find((m) => m.id === draft.mediaId);
  const text = draft.text ? sampleText(draft.text) : '';
  const lookStyle = useLook(draft);
  const look = alertLook(lookStyle);
  const fx: AlertFx | null = draft.alertEffect && !compact ? { effect: draft.alertEffect, emoji: draft.alertEmoji, shape: draft.alertShape, color: draft.alertEffectColor, amount: draft.alertEffectAmount, speed: draft.alertEffectSpeed } : null;
  const box = useRef<HTMLDivElement>(null);
  const [bus] = useState(() => new GiftBus());
  const [plays, setPlays] = useState(0);
  // Changing the animation plays it again: the alert remounts, and a burst fires from its middle.
  const take = `${fx?.effect}${fx?.emoji}${fx?.shape}${fx?.color}${fx?.amount}${fx?.speed}${plays}`;
  useEffect(() => {
    if (fx?.effect === 'emoji_burst' && box.current) bus.emitBurst({ box: box.current.getBoundingClientRect(), emoji: fx.emoji, amount: fx.amount, speed: fx.speed });
  }, [take]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`alert-preview ${compact ? 'compact' : ''}`} aria-label={compact ? `${draft.name} alert preview` : 'Alert preview'}>
      {!compact && fx && <ScreenEffects bus={bus} />}
      {text || file || fx ? (
        <div key={take} ref={box} className={`overlay-alert ${look.className} ${text ? '' : 'media-only'} ${alertFxClass(fx)}`} style={{ ...look.style, ...alertFxStyle(fx, PREVIEW_HOLD_MS, lookStyle) }}>
          <AlertContent
            fx={fx}
            text={text}
            media={
              file && (file.kind === 'image' ? <img className="overlay-alert-media" src={`/media/${file.id}`} alt="" /> : <video className="overlay-alert-media" src={`/media/${file.id}`} muted autoPlay loop playsInline />)
            }
          />
        </div>
      ) : (
        <span className="alert-preview-empty">{compact ? 'No pop-up' : 'No text or picture, so nothing shows. A sound or voice still plays.'}</span>
      )}
      {!compact && fx && (
        <button type="button" className="btn btn-sm effect-replay" onClick={() => setPlays((n) => n + 1)}>
          Play again
        </button>
      )}
      {!compact && !fx && <span className="alert-preview-note">Preview, with sample names</span>}
    </div>
  );
}

function PreviewSound({ value, volumes }: { value: string; volumes: Host['soundVolumes'] }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  if (!value) return null;
  const play = () => {
    if (value.startsWith('file:')) {
      audio.current?.pause();
      audio.current = new Audio(`/media/${value.slice(5)}`);
      audio.current.volume = (volumes[value.slice(5)] ?? 100) / 100;
      void audio.current.play();
    } else playSound(previewAudio(), value as AlertSound, (volumes[value as AlertSound] ?? 100) / 100);
  };
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={play} aria-label="Play sound">
      ▶
    </button>
  );
}

const megabytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${Number((bytes / 1024 / 1024).toFixed(1))} MB`;

const MEDIA_KINDS = [
  ['image', 'Pictures'],
  ['video', 'Videos'],
  ['audio', 'Sounds'],
] as const satisfies readonly (readonly [MediaItem['kind'], string])[];
const MEDIA_SORTS = {
  newest: ['Newest first', (a: MediaItem, b: MediaItem) => b.createdAt - a.createdAt],
  oldest: ['Oldest first', (a: MediaItem, b: MediaItem) => a.createdAt - b.createdAt],
  name: ['Name, A to Z', (a: MediaItem, b: MediaItem) => a.name.localeCompare(b.name, undefined, { numeric: true })],
  size: ['Largest first', (a: MediaItem, b: MediaItem) => b.size - a.size],
} as const;
type MediaSort = keyof typeof MEDIA_SORTS;

function MediaCard({ media: all, reload, actions, setActions }: { media: MediaItem[]; reload: () => Promise<unknown>; actions: Action[]; setActions: (actions: Action[]) => void }) {
  const media = all.filter((m) => !(m.builtIn && m.kind === 'audio')); // those are in Built-in sounds
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<MediaItem['kind'] | null>(null); // null: every kind, in sections
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<MediaSort>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null); // the last file clicked, where a shift-click range starts
  const { error, guard } = useError();
  const used = media.reduce((sum, m) => sum + (m.builtIn ? 0 : m.size), 0);
  const removed = BUILT_IN_MEDIA.filter((m) => m.kind !== 'audio').length - media.filter((m) => m.builtIn).length;
  const usedCount = (id: string) => actions.filter((a) => a.mediaId === id || a.soundMediaId === id).length;
  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    setUploading(true);
    guard(async () => {
      for (const file of files) await uploadMedia(file);
    })().finally(() => (setUploading(false), void reload()));
  };
  // Actions let go of a deleted or removed file, on the server and here.
  const remove = (ids: string[]) =>
    guard(async () => {
      try {
        for (const id of ids) await api('DELETE', `/media/${id}`);
      } finally {
        const gone = new Set(ids);
        setActions(
          actions.map((a) => ({
            ...a,
            mediaId: a.mediaId && gone.has(a.mediaId) ? null : a.mediaId,
            soundMediaId: a.soundMediaId && gone.has(a.soundMediaId) ? null : a.soundMediaId,
          })),
        );
        setSelected((s) => new Set([...s].filter((id) => !gone.has(id))));
        await reload();
      }
    })();
  const rename = (m: MediaItem, name: string) => guard(() => api('PATCH', `/media/${m.id}`, { name }).then(reload))();
  // A shift-click sets every file from the last one clicked to this one, as shown, the way this one turns.
  const toggle = (id: string, range: boolean) => {
    const order = groups.flatMap(([, items]) => items.map((m) => m.id));
    const from = range && anchor.current ? order.indexOf(anchor.current) : -1;
    const to = order.indexOf(id);
    const ids = from < 0 ? [id] : order.slice(Math.min(from, to), Math.max(from, to) + 1);
    const on = !selected.has(id);
    setSelected((s) => {
      const next = new Set(s);
      for (const i of ids) on ? next.add(i) : next.delete(i);
      return next;
    });
    anchor.current = id;
  };

  const query = search.trim().toLowerCase();
  // The host's own files first, then the built-in ones, each in the chosen order.
  const shown = media.filter((m) => (!kind || m.kind === kind) && (!query || m.name.toLowerCase().includes(query))).sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || MEDIA_SORTS[sort][1](a, b));
  const groups = MEDIA_KINDS.filter(([k]) => !kind || k === kind)
    .map(([k, label]) => [label, shown.filter((m) => m.kind === k)] as const)
    .filter(([, items]) => items.length > 0);
  const picked = media.filter((m) => selected.has(m.id));
  const pickedUses = actions.filter((a) => (a.mediaId && selected.has(a.mediaId)) || (a.soundMediaId && selected.has(a.soundMediaId))).length;

  return (
    <Card
      badge="download"
      hue="orange"
      title="Uploads"
      description={`Built-in pictures and sounds are free to use and don't count toward your space; only your own uploads do. Your own pictures (PNG, JPEG, GIF, WebP), videos (MP4, WebM) and sounds (MP3, OGG, WAV, M4A) for your actions. Up to 10 MB each, ${megabytes(MAX_MEDIA_TOTAL_BYTES)} in all.`}
      actions={
        <label className={`btn btn-primary ${uploading ? 'disabled' : ''}`} data-tour="uploads">
          {uploading ? 'Uploading…' : 'Upload files'}
          <input type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,audio/*" onChange={upload} disabled={uploading} />
        </label>
      }
    >
      <ErrorNotice error={error} />
      <div className="meter" role="meter" aria-label="Upload space used" aria-valuemin={0} aria-valuemax={MAX_MEDIA_TOTAL_BYTES} aria-valuenow={used}>
        <span style={{ width: `${Math.min(100, (used / MAX_MEDIA_TOTAL_BYTES) * 100)}%` }} />
      </div>
      <p className="muted small">
        {megabytes(used)} of {megabytes(MAX_MEDIA_TOTAL_BYTES)} used.
      </p>
      {media.length === 0 ? (
        <p className="empty">No files yet.</p>
      ) : (
        <>
          <div className="media-tools">
            <div className="chips" role="group" aria-label="Show">
              <button className={`chip ${kind === null ? 'on' : ''}`} aria-pressed={kind === null} onClick={() => setKind(null)}>
                All {media.length}
              </button>
              {MEDIA_KINDS.map(([k, label]) => {
                const count = media.filter((m) => m.kind === k).length;
                return (
                  count > 0 && (
                    <button key={k} className={`chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                      {label} {count}
                    </button>
                  )
                );
              })}
            </div>
            <input className="input media-search" type="search" placeholder="Find a file" aria-label="Find a file by name" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
            <select className="input media-sort" aria-label="Sort files" value={sort} onChange={(e) => setSort(e.target.value as MediaSort)}>
              {Object.entries(MEDIA_SORTS).map(([id, [label]]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {picked.length > 0 && (
            <div className="media-selection" role="status">
              <strong>{picked.length} selected</strong>
              <ConfirmButton
                className="btn btn-sm btn-danger"
                message={`Delete ${picked.length} file${picked.length === 1 ? '' : 's'}?${picked.some((m) => m.builtIn) ? ' Built-in pictures are only removed for you.' : ''}${pickedUses ? ` ${usedBy(pickedUses).replace('Used by', 'They are used by')}, which will go without them.` : ''}`}
                confirmLabel="Delete"
                onConfirm={() => remove(picked.map((m) => m.id))}
              >
                Delete
              </ConfirmButton>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set(shown.map((m) => m.id)))}>
                Select all {shown.length}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          )}
          {groups.length === 0 && <p className="empty">No files match.</p>}
          {groups.map(([label, items]) => (
            <section key={label} className="media-group" aria-label={label}>
              {!kind && <h3 className="media-group-title">{label}</h3>}
              <ul className="media-grid">
                {items.map((m) => (
                  <MediaTile
                    key={m.id}
                    file={m}
                    uses={usedCount(m.id)}
                    selected={selected.has(m.id)}
                    onToggle={(range) => toggle(m.id, range)}
                    onRename={(name) => rename(m, name)}
                    onRemove={() => remove([m.id])}
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      {removed > 0 && (
        <button className="link-button small" onClick={guard(() => api('DELETE', '/media/hidden?kind=image').then(reload))}>
          Bring back {removed} built-in picture{removed === 1 ? '' : 's'}
        </button>
      )}
    </Card>
  );
}

function MediaTile({
  file: m,
  uses,
  selected,
  onToggle,
  onRename,
  onRemove,
}: {
  file: MediaItem;
  uses: number;
  selected: boolean;
  onToggle: (range: boolean) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [naming, setNaming] = useState<string | null>(null); // the name being typed
  const finish = () => {
    const name = naming?.trim();
    setNaming(null);
    if (name && name !== m.name) onRename(name);
  };
  const label = m.builtIn ? 'Remove' : 'Delete';
  return (
    <li className={selected ? 'selected' : ''}>
      <div className="media-preview">
        {m.kind === 'image' && <img src={`/media/${m.id}`} alt="" loading="lazy" />}
        {m.kind === 'video' && <video src={`/media/${m.id}`} muted loop playsInline onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />}
        {m.kind === 'audio' && <audio src={`/media/${m.id}`} controls preload="none" />}
        <input
          className="media-check"
          type="checkbox"
          checked={selected}
          onChange={() => {}}
          onClick={(e) => onToggle(e.shiftKey)}
          aria-label={`Select ${m.name}`}
          title="Shift-click to select a range"
        />
      </div>
      <div className="media-meta">
        {naming !== null ? (
          <input
            className="input media-rename"
            autoFocus
            maxLength={100}
            aria-label="File name"
            value={naming}
            onChange={(e) => setNaming(cleanTyped(e.target.value))}
            onBlur={finish}
            onKeyDown={(e) => (e.key === 'Enter' ? finish() : e.key === 'Escape' && setNaming(null))}
          />
        ) : m.builtIn ? (
          <strong title={m.name}>{m.name}</strong>
        ) : (
          <button type="button" className="media-name" title={`${m.name}. Click to rename`} onClick={() => setNaming(m.name)}>
            {m.name}
          </button>
        )}
        <span className="muted small">{m.builtIn ? `Built in, ${m.kind}` : `${m.kind}, ${megabytes(m.size)}`}</span>
        <span className="muted small">{uses > 0 ? usedBy(uses) : 'Not used yet'}</span>
      </div>
      {uses > 0 ? (
        <ConfirmButton className="btn btn-ghost btn-sm btn-delete" message={`${label} “${m.name}”? ${usedBy(uses)}, which will go without it.`} confirmLabel={label} onConfirm={onRemove}>
          {label}
        </ConfirmButton>
      ) : (
        <button className="btn btn-ghost btn-sm btn-delete" onClick={onRemove}>
          {label}
        </button>
      )}
    </li>
  );
}

const soundName = (s: AlertSound) => s[0]!.toUpperCase() + s.slice(1);

// The built-in sounds, made here or shipped as files: each one's volume, and removing the ones the host doesn't
// want in the Sound menu. Synthesized ones are hidden in the host's settings; files the way built-in pictures are.
function SoundsCard({
  host,
  refreshHost,
  actions,
  setActions,
  media,
  reload,
}: Pick<PageProps, 'host' | 'refreshHost'> & {
  actions: Action[];
  setActions: (actions: Action[]) => void;
  media: MediaItem[];
  reload: () => Promise<unknown>;
}) {
  const { error, guard } = useError();
  const files = media.filter((m) => m.builtIn && m.kind === 'audio');
  const rows = [
    ...ALERT_SOUNDS.filter((s) => !host.hiddenSounds.includes(s)).map((s) => ({
      key: s,
      value: s,
      name: soundName(s),
      uses: (a: Action) => a.sound === s,
    })),
    ...files.map((m) => ({
      key: m.id,
      value: `file:${m.id}`,
      name: m.name,
      uses: (a: Action) => a.soundMediaId === m.id,
    })),
  ];
  const removed = host.hiddenSounds.length + BUILT_IN_MEDIA.filter((m) => m.kind === 'audio').length - files.length;
  const hide = (key: string) =>
    guard(async () => {
      const synth = (ALERT_SOUNDS as readonly string[]).includes(key);
      if (synth) await api('PATCH', '/settings', { hiddenSounds: [...host.hiddenSounds, key] });
      else await api('DELETE', `/media/${key}`);
      // the server let go of it too
      setActions(actions.map((a) => (synth ? (a.sound === key ? { ...a, sound: null } : a) : a.soundMediaId === key ? { ...a, soundMediaId: null } : a)));
      await Promise.all([refreshHost(), reload()]);
    })();
  const bringBack = guard(async () => {
    await Promise.all([api('PATCH', '/settings', { hiddenSounds: [] }), api('DELETE', '/media/hidden?kind=audio')]);
    await Promise.all([refreshHost(), reload()]);
  });
  const volume = (key: string, percent: number) => guard(() => api('PATCH', '/settings', { soundVolumes: { [key]: percent } }).then(refreshHost))();

  return (
    <Card badge="bell" hue="sky" title="Built-in sounds" description="The sounds that come with Hyperion. Turn each one up or down on your overlays, or remove the ones you don't use from the Sound menu.">
      <ErrorNotice error={error} />
      {rows.length === 0 ? (
        <p className="empty">All built-in sounds are removed.</p>
      ) : (
        <ul className="sound-list">
          {rows.map((r) => {
            const used = actions.filter(r.uses).length;
            return (
              <li key={r.key}>
                <PreviewSound value={r.value} volumes={host.soundVolumes} />
                <span className="sound-name">
                  <strong>{r.name}</strong>
                  {used > 0 && <span className="muted small">{usedBy(used)}</span>}
                </span>
                <Scrubber value={host.soundVolumes[r.key] ?? 100} min={0} max={100} buttonStep={5} unit="%" label={`${r.name} volume`} onSave={(n) => volume(r.key, n)} />
                {used > 0 ? (
                  <ConfirmButton
                    className="btn btn-ghost btn-sm btn-delete"
                    message={`Remove ${r.name}? ${used === 1 ? 'The action that plays it' : `The ${used} actions that play it`} will have no sound.`}
                    confirmLabel="Remove"
                    onConfirm={() => hide(r.key)}
                  >
                    Remove
                  </ConfirmButton>
                ) : (
                  <button className="btn btn-ghost btn-sm btn-delete" onClick={() => hide(r.key)}>
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {removed > 0 && (
        <button className="link-button small" onClick={bringBack}>
          Bring back {removed} built-in sound{removed === 1 ? '' : 's'}
        </button>
      )}
    </Card>
  );
}

// Where an alert shows, and how big: the screen's own alert position unless placed by hand.
// The placeholders get sample values in the preview.
const SAMPLE_VALUES: Record<string, string> = {
  viewer: 'nightowl', gift: 'Rose', count: '5', coins: '5', diamonds: '5', likes: '1,000', total: '1,000', months: '3', text: 'hello', goal: 'Like goal', target: '1,000',
};
const sampleText = (text: string) => text.replace(/\{(\w+)\}/g, (all, key: string) => SAMPLE_VALUES[key] ?? all);
// Where the screen's top, middle and bottom alert positions put an alert's middle, roughly, for the little map.
const DEFAULT_PLACE = { top: 12, middle: 50, bottom: 88 } as const;

type Place = Pick<Draft, 'alertX' | 'alertY' | 'alertScale'>;

function AlertPlaceField({ draft, screens, media, onChange }: { draft: Draft; screens: Screen[]; media: MediaItem[]; onChange: (patch: Place) => void }) {
  const [open, setOpen] = useState(false);
  const screen = screens.find((s) => s.id === draft.screenId) ?? screens.find((s) => s.main);
  const placed = draft.alertX !== null && draft.alertY !== null;
  const dot = placed ? { x: draft.alertX!, y: draft.alertY! } : screen?.alertPos ?? { x: 50, y: DEFAULT_PLACE[screen?.alertPosition ?? 'top'] };
  return (
    <div className="field">
      Place and size
      <span className="hint">Drag it where you want it on the screen.</span>
      <button type="button" className="btn alert-place-btn" onClick={() => setOpen(true)} disabled={!screen}>
        <span className="spot-map placed indigo" aria-hidden="true">
          <span className="spot-dot" style={{ left: `calc(${dot.x}% - 3px)`, top: `calc(${dot.y}% - 3px)` }} />
        </span>
        {placed ? 'Placed by hand' : "Screen's position"}, {draft.alertScale}%
      </button>
      {open && screen && <AlertPlaceDialog draft={draft} screen={screen} media={media} onDone={(place) => (onChange(place), setOpen(false))} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AlertPlaceDialog({ draft, screen, media, onDone, onClose }: { draft: Draft; screen: Screen; media: MediaItem[]; onDone: (place: Place) => void; onClose: () => void }) {
  const [place, setPlace] = useState<Place>({ alertX: draft.alertX, alertY: draft.alertY, alertScale: draft.alertScale });
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const fit = useStageFit(stage, screen.layout);
  const [bus] = useState(() => new GiftBus());
  const { stats, chat } = usePreview(true, bus);
  const file = media.find((m) => m.id === draft.mediaId);
  const look = alertLook(useLook(draft));
  const alertBox = useRef<HTMLDivElement>(null);

  useEffect(() => dialog.current?.showModal(), []);

  const startDrag = (e: ReactPointerEvent<HTMLElement>) => dragAlert(e, stage.current!, ({ x, y }) => setPlace((p) => ({ ...p, alertX: x, alertY: y })));

  const placed = place.alertX !== null && place.alertY !== null;
  // Shown at the size it gets on stream: the action's, times the screen's for its alerts.
  const shownScale = (place.alertScale * screen.alertScale) / 100;
  const clear = useClearOfWidgets(alertBox, placed || screen.alertPos ? null : screen.alertPosition, screen.scale / 100, shownScale / 100, [fit]);
  const [resizing, setResizing] = useState(false);
  const text = draft.text ? sampleText(draft.text) : '';
  return (
    <dialog ref={dialog} className={`pos-dialog ${screen.layout}`} onClose={onClose} {...closeOnBackdrop()} aria-labelledby="alert-place-title">
      <div className="pos-head">
        <div>
          <h2 id="alert-place-title">{draft.name.trim() || 'Alert'}: place and size</h2>
          <p className="muted small">
            Drag the alert anywhere on {screen.name}, or its corner handle to resize it. Your widgets show faded, with sample viewers and gifts. Save the action to keep it.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dialog.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div {...stageProps(screen.layout, screen.phoneSafe)} ref={stage}>
        <div className="pos-canvas" style={canvasStyle(screen.layout, fit)}>
          <div className={`overlay-screen layout-${screen.layout} alerts-${screen.alertPosition}`} style={{ '--overlay-scale': screen.scale / 100 } as CSSProperties}>
            <FadedWidgets widgets={screen.widgets} feed={{ stats, chat, bus }} />
            <div
              ref={alertBox}
              className={`overlay-alert alert-drag ${look.className} ${text ? '' : 'media-only'}`}
              style={{ ...look.style, ...alertPlace({ pos: placed ? { x: place.alertX!, y: place.alertY! } : screen.alertPos, scale: shownScale }), ...clear }}
              onPointerDown={startDrag}
            >
              {file?.kind === 'image' && <img className="overlay-alert-media" src={`/media/${file.id}`} alt="" draggable={false} />}
              {file?.kind === 'video' && <video className="overlay-alert-media" src={`/media/${file.id}`} muted autoPlay loop playsInline />}
              {text ? <span>{text}</span> : !file && <span>Your alert</span>}
              <span
                className={`pos-resize alert-handle at-${alertHandleCorner(!placed && !screen.alertPos && screen.alertPosition === 'bottom')}`}
                title="Drag to resize"
                onPointerDown={(e) => (setResizing(true), dragAlertSize(e, place.alertScale, (alertScale) => setPlace((p) => ({ ...p, alertScale })), () => setResizing(false)))}
              />
              {resizing && <span className="pos-size">{place.alertScale}%</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="pos-foot">
        <div className="field alert-size">
          Size, in percent
          <Scrubber value={place.alertScale} min={50} max={200} buttonStep={10} unit="%" label="Alert size" onSave={(alertScale) => setPlace((p) => ({ ...p, alertScale }))} />
        </div>
        <span className="muted small">{placed ? `Middle at ${Math.round(place.alertX!)}% across, ${Math.round(place.alertY!)}% down` : screen.alertPos ? "The screen's custom position" : `The screen's ${screen.alertPosition} position`}</span>
        <span className="spacer" />
        {placed && (
          <button className="btn btn-ghost" onClick={() => setPlace((p) => ({ ...p, alertX: null, alertY: null }))}>
            Use the screen's position
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => dialog.current?.close()}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => onDone(place)}>
          Done
        </button>
      </div>
    </dialog>
  );
}
