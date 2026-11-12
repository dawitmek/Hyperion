import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { BLOCKED_COMBOS, DEFAULT_COMMAND, MAX_CHAIN_DELAY_MS, MAX_CHAIN_STEPS, MAX_LEVEL, type ChainStep } from '@hyperion/shared';
import { api, type Command, type Host } from '../api';
import { Icon, type IconName } from '../icons';
import { Card, cleanTyped, closeOnBackdrop, ConfirmButton, ErrorNotice, KeyCapture, keyLabel, NumberCell, Seg, useError } from '../ui';
import type { PageProps } from './Dashboard';
import { ModeDetails, ModeTiles } from './ModePicker';

export function CommandsPage({ host, refreshHost }: PageProps) {
  return (
    <div className="stack">
      <CommandsCard host={host} refreshHost={refreshHost} />
      <ModeCard host={host} refreshHost={refreshHost} />
    </div>
  );
}

type Editable = Pick<Command, 'keyword' | 'key' | 'macro' | 'gameAction' | 'chain' | 'holdMs' | 'cooldownMs' | 'minLevel' | 'cost'> & { id?: string };

// A new command: a key press, with the host's defaults for the rest.
const emptyCommand = (host: Host): Editable => ({ keyword: '', key: 'KeyA', macro: null, gameAction: null, chain: null, ...(host.commandDefaults ?? DEFAULT_COMMAND) });

// The map is the default; the tiles were the first look, kept for those who like them.
type View = 'map' | 'deck' | 'list';
const VIEWS: readonly View[] = ['map', 'deck', 'list'];
const VIEW_KEY = 'hyperion.commands-view-v2';

function savedView(): View {
  try {
    const saved = localStorage.getItem(VIEW_KEY) as View | null;
    return saved && VIEWS.includes(saved) ? saved : 'map';
  } catch {
    return 'map';
  }
}

const HOLD_MS = 450; // pressing a command this long picks it, for batch editing
const SEARCH_FROM = 9; // a shorter list is quicker to scan than to search

function CommandsCard({ host, refreshHost }: { host: Host; refreshHost: () => Promise<unknown> }) {
  const gated = host.progression && host.levelGating;
  const [commands, setCommands] = useState<Command[]>([]);
  const [open, setOpen] = useState<string | null>(null); // a command's id, or 'new' while adding one
  const [draft, setDraft] = useState(() => emptyCommand(host));
  const [editingDefaults, setEditingDefaults] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState(savedView);
  const { error, guard } = useError();
  const load = useCallback(() => api<Command[]>('GET', '/commands').then(setCommands), []);
  useEffect(() => void load(), [load]);
  const [macros, setMacros] = useState<string[]>([]);
  useEffect(() => void api<string[]>('GET', '/commands/macros').then(setMacros), []);
  const [gameActions, setGameActions] = useState<string[]>([]);
  useEffect(() => void api<string[]>('GET', '/commands/game-actions').then(setGameActions), []);

  const update = (id: string, patch: Partial<Command>) => guard(() => api('PATCH', `/commands/${id}`, patch).then(load))();
  // Batch editing: commands picked with a long press, Shift-click (a run of them) or Ctrl/Cmd-click (one more).
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null); // where a Shift-click run starts
  useEffect(() => setPicked((old) => (old.size ? new Set([...old].filter((id) => commands.some((c) => c.id === id))) : old)), [commands]);
  const updateMany = (ids: string[], patch: Partial<Command>) => guard(() => Promise.all(ids.map((id) => api('PATCH', `/commands/${id}`, patch))).then(load))();
  const removeMany = (ids: string[]) => guard(() => Promise.all(ids.map((id) => api('DELETE', `/commands/${id}`))).then(() => (setPicked(new Set()), load())))();
  const remove = (id: string) => guard(() => api('DELETE', `/commands/${id}`).then(() => (setOpen(null), load())))();
  const add = (e: FormEvent) => {
    e.preventDefault();
    guard(() => api('POST', '/commands', draft).then(() => (setOpen(null), setDraft(emptyCommand(host)), load())))();
  };
  const startAdding = () => {
    setPicked(new Set());
    setDraft(emptyCommand(host));
    setOpen('new');
  };

  const chooseView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Not remembered in this browser; the view still changes.
    }
  };

  // Shown beside what's being edited, since the top of the list can be a long way up.
  const notice = <ErrorNotice error={error} />;
  const shown = commands.filter((c) => c.keyword.includes(search.trim().toLowerCase()));
  const mapOrder = useMemo(() => groupByTargets(shown, commands), [shown, commands]);
  const selected = commands.find((c) => c.id === open);
  const toggle = (id: string) => setOpen(open === id ? null : id);

  // A plain click opens a command, or, once some are picked, picks or unpicks it, so touch screens can pick too.
  const pick = (id: string, how: 'hold' | 'range' | 'add' | 'click') => {
    if (how === 'click' && picked.size === 0) {
      anchor.current = id;
      return toggle(id);
    }
    const order = (view === 'map' ? mapOrder : shown).map((c) => c.id);
    setPicked((old) => {
      const next = new Set(old);
      // Ctrl-clicking a second command while one is open picks both.
      if (!old.size && open && open !== 'new' && open !== id && how !== 'hold') next.add(open);
      if (how === 'range') {
        const to = order.indexOf(id);
        const start = order.indexOf(anchor.current ?? (open && open !== 'new' ? open : id));
        const from = start < 0 ? to : start; // the start may be hidden by a search
        for (const c of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(c);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (how !== 'range') anchor.current = id;
    setOpen(null);
  };
  useEffect(() => {
    if (!picked.size) return;
    const leave = (e: KeyboardEvent) => e.key === 'Escape' && setPicked(new Set());
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [picked.size]);
  // Ctrl+A (Cmd+A on a Mac) picks every command shown, except while typing, where it still selects the text.
  useEffect(() => {
    const all = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'a') return;
      const target = e.target as HTMLElement;
      if (target.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"], dialog')) return;
      e.preventDefault();
      setOpen(null);
      setPicked(new Set(shown.map((c) => c.id)));
    };
    window.addEventListener('keydown', all);
    return () => window.removeEventListener('keydown', all);
  }, [shown]);
  // What every view's command button gets: click, Shift- and Ctrl-click, and a long press.
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);
  const pressStart = useRef({ x: 0, y: 0 });
  const press = (id: string) => ({
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      held.current = false;
      pressStart.current = { x: e.clientX, y: e.clientY };
      clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        held.current = true;
        pick(id, 'hold');
        navigator.vibrate?.(15);
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      if (Math.hypot(e.clientX - pressStart.current.x, e.clientY - pressStart.current.y) > 8) clearTimeout(holdTimer.current);
    },
    onPointerUp: () => clearTimeout(holdTimer.current),
    onPointerLeave: () => clearTimeout(holdTimer.current),
    // On a Mac, Ctrl-click opens the right-click menu instead of clicking; take it as a pick there too.
    onContextMenu: (e: MouseEvent) => {
      if (held.current) return e.preventDefault();
      if (e.ctrlKey && e.button === 0) {
        e.preventDefault();
        pick(id, 'add');
      }
    },
    onMouseDown: (e: MouseEvent) => e.shiftKey && e.preventDefault(), // no text selection on Shift-click
    onClick: (e: MouseEvent) => {
      if (held.current) return void (held.current = false);
      pick(id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'add' : 'click');
    },
  });
  const pickedIds = [...picked];
  const batch = picked.size > 0 && (
    <BatchPanel
      picked={commands.filter((c) => picked.has(c.id))}
      total={shown.length}
      gated={gated}
      points={host.points}
      onPatch={(list, patch) => updateMany(list.map((c) => c.id), patch)}
      onDelete={() => removeMany(pickedIds)}
      onSelectAll={() => setPicked(new Set(shown.map((c) => c.id)))}
      onClear={() => setPicked(new Set())}
      notice={notice}
    />
  );

  // What the views share, so they can't drift apart.
  const onSwitch = (c: Command) => (
    <label className="switch">
      <input type="checkbox" checked={c.enabled} aria-label={`${c.keyword} on`} onChange={(e) => update(c.id, { enabled: e.target.checked })} />
    </label>
  );
  const facts = (c: Command) => (
    <>
      {c.cooldownMs > 0 && <span>{c.cooldownMs / 1000}s cooldown</span>}
      {gated && c.minLevel > 1 && <span>Lv {c.minLevel}+</span>}
      {host.points && c.cost > 0 && <span>{c.cost} pts</span>}
    </>
  );
  const nothing = (
    <>
      {commands.length === 0 && open !== 'new' && <p className="empty">No commands yet. Add one so chat can start playing.</p>}
      {commands.length > 0 && shown.length === 0 && <p className="empty">No command matches "{search.trim()}".</p>}
    </>
  );
  const newForm = (
    <form className="command-editor" onSubmit={add}>
      <PanelTitle title="New command" onClose={() => setOpen(null)} />
      <label className="field">
        Keyword
        <span className="hint">What viewers type in chat.</span>
        <input
          className="input"
          placeholder="jump"
          value={draft.keyword}
          onChange={(e) => setDraft({ ...draft, keyword: cleanTyped(e.target.value, /\S/) })}
          required
          maxLength={32}
          autoFocus
        />
      </label>
      <CommandEditor command={draft} commands={commands} macros={macros} gameActions={gameActions} gated={gated} points={host.points} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
      {notice}
      <button className="btn btn-primary">Add command</button>
    </form>
  );
  const rename = (c: Command) => <KeywordName command={c} commands={commands} onRename={(keyword) => update(c.id, { keyword })} />;
  const details = (c: Command) => (
    <>
      <CommandEditor key={c.id} command={c} commands={commands} macros={macros} gameActions={gameActions} gated={gated} points={host.points} onChange={(patch) => update(c.id, patch)} />
      {notice}
      <div className="row">
        <ConfirmButton
          className="btn btn-ghost btn-sm btn-delete"
          message={commands.some((other) => other.chain?.some((step) => step.keyword === c.keyword)) ? `Chains that use ${c.keyword} will skip it.` : `Viewers won't be able to use ${c.keyword}.`}
          confirmLabel="Delete command"
          onConfirm={() => remove(c.id)}
        >
          Delete
        </ConfirmButton>
      </div>
    </>
  );

  return (
    <Card
      badge="commands"
      hue="indigo"
      title="Commands"
      description={`For the ${host.profileName} profile. A comment runs a command when it is exactly the keyword, in any capitalization.`}
    >
      {/* Stays in view while scrolling a long list. */}
      <div className="command-toolbar">
        {commands.length >= SEARCH_FROM && (
          <input className="input command-search" type="search" maxLength={100} placeholder="Find a command" aria-label="Find a command" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        <span className="spacer" />
        <Seg
          label="Commands view"
          value={view}
          options={[
            ['map', 'Map', 'flow'],
            ['deck', 'Tiles', 'grid'],
            ['list', 'List', 'feed'],
          ]}
          onChange={chooseView}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingDefaults(true)} title="What new commands start with">
          <Icon name="settings" size={14} />
          Defaults
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={startAdding}>
          <Icon name="plus" size={14} />
          Add command
        </button>
      </div>
      {editingDefaults && <DefaultsDialog host={host} gated={gated} refreshHost={refreshHost} onClose={() => setEditingDefaults(false)} />}
      {view !== 'list' ? (
        <div className="deck-layout">
          <div>
            {view === 'map' && shown.length > 0 && <CommandMap ordered={mapOrder} commands={commands} open={open} picked={picked} press={press} facts={facts} onSwitch={onSwitch} />}
            {view === 'deck' && (
              <ul className="deck">
                {shown.map((c) => (
                  <li key={c.id} className={`deck-tile ${c.enabled ? '' : 'off'} ${open === c.id ? 'selected' : ''} ${picked.has(c.id) ? 'picked' : ''}`}>
                    <button type="button" className="deck-tile-open" aria-pressed={open === c.id || picked.has(c.id)} {...press(c.id)}>
                      <strong className="deck-tile-keyword">{c.keyword}</strong>
                      <TileFace command={c} commands={commands} />
                      <span className="deck-tile-meta">{facts(c)}</span>
                    </button>
                    <span className="deck-tile-switch">{onSwitch(c)}</span>
                  </li>
                ))}
              </ul>
            )}
            {nothing}
          </div>
          <aside className={`deck-panel ${open === null && !picked.size ? 'idle' : ''}`} aria-label="Command details">
            {batch}
            {open === null && !picked.size && (
              <>
                {notice}
                <p className="muted small deck-hint">Pick a command to change what it does. To change several at once, hold one down, Shift- or Ctrl-click them, or press Ctrl+A for all.</p>
              </>
            )}
            {open === 'new' && newForm}
            {selected && (
              <div className="command-editor">
                <PanelTitle title={rename(selected)} onClose={() => setOpen(null)} />
                {details(selected)}
              </div>
            )}
          </aside>
        </div>
      ) : (
        <>
          {open === null && !picked.size && notice}
          {open === 'new' && <div className="command-list-new">{newForm}</div>}
          {batch && <div className="command-list-new">{batch}</div>}
          <ul className="commands">
            {shown.map((c) => (
              <li key={c.id} className={`command ${c.enabled ? '' : 'off'} ${picked.has(c.id) ? 'picked' : ''}`}>
                <div className="command-row">
                  {onSwitch(c)}
                  {/* Open, its name moves out of the row's button, so the pencil beside it can be a button of its own. */}
                  {open === c.id && rename(c)}
                  <button type="button" className={`command-open ${open === c.id ? 'renaming' : ''}`} aria-expanded={open === c.id} aria-controls={`command-${c.id}`} {...press(c.id)}>
                    {open !== c.id && <strong className="command-keyword">{c.keyword}</strong>}
                    <span className="command-does">
                      <CommandSummary command={c} commands={commands} />
                    </span>
                    <span className="command-meta">{facts(c)}</span>
                    <Icon name="chevron" size={16} />
                  </button>
                </div>
                {open === c.id && (
                  <div id={`command-${c.id}`} className="command-editor">
                    {details(c)}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {nothing}
        </>
      )}
      <BlockedCombos />
    </Card>
  );
}

// What a new command starts with. Each field saves as it changes; commands already made keep their own values.
function DefaultsDialog({ host, gated, refreshHost, onClose }: { host: Host; gated: boolean; refreshHost: () => Promise<unknown>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { error, guard } = useError();
  useEffect(() => dialog.current?.showModal(), []);
  const defaults = host.commandDefaults ?? DEFAULT_COMMAND;
  const save = (commandDefaults: typeof defaults | null) => guard(() => api('PATCH', '/settings', { commandDefaults }).then(refreshHost))();
  const set = (patch: Partial<typeof defaults>) => save({ ...defaults, ...patch });
  const changed = (Object.keys(DEFAULT_COMMAND) as (keyof typeof defaults)[]).some((k) => defaults[k] !== DEFAULT_COMMAND[k]);
  return (
    <dialog ref={dialog} className="game-dialog" onClose={onClose} {...closeOnBackdrop()} aria-labelledby="defaults-title">
      <div className="pos-head">
        <div>
          <h2 id="defaults-title">Defaults for new commands</h2>
          <p className="muted small">What each command you add starts with. Commands you already have keep their own. To change those, press Ctrl+A to pick them all.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => dialog.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div className="form-grid">
        <label className="field">
          Hold, in ms
          <span className="hint">How long a key stays down.</span>
          <NumberCell value={defaults.holdMs} min={10} max={5000} onSave={(holdMs) => set({ holdMs })} />
        </label>
        <label className="field">
          Cooldown per viewer, in ms
          <span className="hint">How long each viewer waits to use it again.</span>
          <NumberCell value={defaults.cooldownMs} min={0} max={600000} onSave={(cooldownMs) => set({ cooldownMs })} />
        </label>
        {gated && (
          <label className="field">
            Minimum level
            <span className="hint">Viewers below this level can't use it.</span>
            <NumberCell value={defaults.minLevel} min={1} max={MAX_LEVEL} onSave={(minLevel) => set({ minLevel })} />
          </label>
        )}
        {host.points && (
          <label className="field">
            Cost in points
            <span className="hint">What each use takes from the viewer.</span>
            <NumberCell value={defaults.cost} min={0} max={1000000} onSave={(cost) => set({ cost })} />
          </label>
        )}
      </div>
      <ErrorNotice error={error} />
      {changed && (
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => save(null)}>
            <Icon name="refresh" size={14} />
            Back to the built-in defaults
          </button>
        </div>
      )}
    </dialog>
  );
}

function PanelTitle({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div className="deck-panel-title">
      {typeof title === 'string' ? <strong>{title}</strong> : title}
      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

// A command's name, with a pencil beside it on hover to rename it. Chains that run it follow the new name.
function KeywordName({ command, commands, onRename }: { command: Command; commands: Command[]; onRename: (keyword: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const start = () => {
    setText(command.keyword);
    setProblem(null);
    setEditing(true);
  };
  const finish = () => {
    const next = text.trim().toLowerCase();
    if (!next || next === command.keyword) return setEditing(false);
    if (commands.some((o) => o.id !== command.id && o.keyword === next)) return setProblem(`There's already a command called ${next}`);
    setEditing(false);
    onRename(next);
  };
  if (editing) {
    return (
      <span className="keyword-name editing">
        <input
          className="input"
          autoFocus
          value={text}
          maxLength={32}
          aria-label={`New name for ${command.keyword}`}
          aria-invalid={problem ? true : undefined}
          onFocus={(e) => e.target.select()}
          onChange={(e) => (setText(cleanTyped(e.target.value, /\S/)), setProblem(null))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.preventDefault(), finish());
            if (e.key === 'Escape') (e.preventDefault(), setEditing(false));
          }}
          onBlur={finish}
        />
        {problem && (
          <span className="field-problem" role="alert">
            {problem}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="keyword-name">
      <strong className="command-keyword">{command.keyword}</strong>
      <button type="button" className="btn btn-ghost btn-sm btn-icon keyword-edit" aria-label={`Rename ${command.keyword}`} title="Rename" onClick={start}>
        <Icon name="pencil" size={14} />
      </button>
    </span>
  );
}

// Changes for every picked command at once. A field shows the value they share, or "Mixed" where they differ, and
// leaving it as it is changes nothing. Hold only applies to commands that press a key.
function BatchPanel({
  picked,
  total,
  gated,
  points,
  onPatch,
  onDelete,
  onSelectAll,
  onClear,
  notice,
}: {
  picked: Command[];
  total: number;
  gated: boolean;
  points: boolean;
  onPatch: (list: Command[], patch: Partial<Command>) => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  notice: ReactNode;
}) {
  const n = picked.length;
  const keyed = picked.filter((c) => kindOf(c) === 'key');
  const shared = (list: Command[], field: 'holdMs' | 'cooldownMs' | 'minLevel' | 'cost') => (list.every((c) => c[field] === list[0]![field]) ? list[0]![field] : null);
  const onCount = picked.filter((c) => c.enabled).length;
  return (
    <div
      className="command-editor"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.target.blur();
      }}
    >
      <PanelTitle title={n === 1 ? '1 command picked' : `${n} commands picked`} onClose={onClear} />
      <p className="muted small batch-names">{picked.map((c) => c.keyword).join(', ')}</p>
      <div className="row">
        <button type="button" className="btn btn-sm" disabled={onCount === n} onClick={() => onPatch(picked, { enabled: true })}>
          Turn on
        </button>
        <button type="button" className="btn btn-sm" disabled={onCount === 0} onClick={() => onPatch(picked, { enabled: false })}>
          Turn off
        </button>
        {n < total && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSelectAll}>
            Pick all {total}
          </button>
        )}
      </div>
      <div className="form-grid">
        {keyed.length > 0 && (
          <label className="field">
            Hold, in ms
            <span className="hint">{keyed.length < n ? `For the ${keyed.length} that press a key.` : 'How long the key stays down.'}</span>
            <BatchNumber value={shared(keyed, 'holdMs')} min={10} max={5000} onSave={(holdMs) => onPatch(keyed, { holdMs })} />
          </label>
        )}
        <label className="field">
          Cooldown per viewer, in ms
          <span className="hint">How long each viewer waits to use it again.</span>
          <BatchNumber value={shared(picked, 'cooldownMs')} min={0} max={600000} onSave={(cooldownMs) => onPatch(picked, { cooldownMs })} />
        </label>
        {gated && (
          <label className="field">
            Minimum level
            <span className="hint">Viewers below this level can't use them.</span>
            <BatchNumber value={shared(picked, 'minLevel')} min={1} max={MAX_LEVEL} onSave={(minLevel) => onPatch(picked, { minLevel })} />
          </label>
        )}
        {points && (
          <label className="field">
            Cost in points
            <span className="hint">What each use takes from the viewer.</span>
            <BatchNumber value={shared(picked, 'cost')} min={0} max={1000000} onSave={(cost) => onPatch(picked, { cost })} />
          </label>
        )}
      </div>
      {notice}
      <div className="row">
        <ConfirmButton
          className="btn btn-ghost btn-sm btn-delete"
          message={n === 1 ? `Viewers won't be able to use ${picked[0]!.keyword}.` : `Viewers won't be able to use these ${n} commands.`}
          confirmLabel={n === 1 ? 'Delete command' : `Delete ${n} commands`}
          onConfirm={onDelete}
        >
          Delete {n === 1 ? '' : `all ${n}`}
        </ConfirmButton>
        <span className="muted small">Esc to stop picking</span>
      </div>
    </div>
  );
}

// A number for several commands: empty with "Mixed" when theirs differ. Saves when you leave it with a valid value.
function BatchNumber({ value, min, max, onSave }: { value: number | null; min: number; max: number; onSave: (n: number) => void }) {
  const shown = value === null ? '' : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <input
      className="input short"
      type="number"
      min={min}
      max={max}
      placeholder={value === null ? 'Mixed' : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Number(text);
        if (text.trim() === '' || !Number.isInteger(n) || n < min || n > max) return setText(shown);
        if (n !== value) onSave(n);
      }}
    />
  );
}

// A macro or game action by name, marked with its kind's icon and colour so the two can't be mistaken.
function NamedChip({ kind, name }: { kind: 'macro' | 'gameAction'; name: string }) {
  const { icon, title } = KINDS.find((k) => k.id === kind)!;
  return (
    <span className={`does-chip kind-${kind}`} title={`${title}: ${name}`}>
      <Icon name={icon} size={13} />
      <span>{name}</span>
    </span>
  );
}

// The list's version of a tile: a command's key, its macro or game action, or its steps in the order they start.
function CommandSummary({ command, commands }: { command: Command; commands: Command[] }) {
  if (command.macro) return <NamedChip kind="macro" name={command.macro} />;
  if (command.gameAction) return <NamedChip kind="gameAction" name={command.gameAction} />;
  if (!command.chain) return <kbd className="kbd">{keyLabel(command.key)}</kbd>;
  if (command.chain.length === 0) return <span className="muted small">No steps yet</span>;
  const times = [...new Set(command.chain.map((s) => s.delayMs))].sort((a, b) => a - b);
  return (
    <>
      {times.map((time, i) => (
        <Fragment key={time}>
          {i > 0 && <span className="muted small">then</span>}
          {command.chain!
            .filter((s) => s.delayMs === time)
            .map((s, n) => {
              const skipped = !commands.some((c) => c.enabled && !c.chain && c.keyword === s.keyword);
              return (
                <Fragment key={s.keyword + n}>
                  {n > 0 && <span className="muted small">+</span>}
                  <span className={`step-chip ${skipped ? 'skipped' : ''}`} title={skipped ? 'Skipped: this command is off or deleted' : undefined}>
                    {s.keyword}
                  </span>
                </Fragment>
              );
            })}
        </Fragment>
      ))}
    </>
  );
}

// What a command does, at a glance: its key, its macro or game action, or a small picture of its chain's timing.
function TileFace({ command, commands }: { command: Command; commands: Command[] }) {
  if (command.macro) return <NamedChip kind="macro" name={command.macro} />;
  if (command.gameAction) return <NamedChip kind="gameAction" name={command.gameAction} />;
  if (!command.chain) return <kbd className="kbd">{keyLabel(command.key)}</kbd>;
  const steps = command.chain.map((s) => {
    const step = commands.find((c) => c.enabled && !c.chain && c.keyword === s.keyword);
    return { ...s, hold: step?.holdMs ?? 0, skipped: !step };
  });
  const end = Math.max(1, ...steps.map((s) => s.delayMs + s.hold));
  return (
    <span className="deck-tile-chain">
      <span className="muted small">
        {steps.length === 0 ? 'No steps yet' : `Chain of ${steps.length}: ${steps.map((s) => s.keyword).join(', ')}`}
      </span>
      {steps.length > 0 && (
        <span className="deck-tile-bars" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={i} className={s.skipped ? 'skipped' : ''} style={{ marginLeft: `${(s.delayMs / end) * 100}%`, width: `${(s.hold / end) * 100}%` }} />
          ))}
        </span>
      )}
    </span>
  );
}

// The map view: commands on the left, what they press on the right, joined by wires. A key that several commands
// press is one node with several wires, so overlaps show at a glance. A chain's wires are dashed and go to the keys
// its steps press. Pointing at a command or a key lights up everything it's wired to.
type Target = { id: string; kind: 'key' | 'macro' | 'gameAction'; name: string };
type Wire = { from: string; to: string; viaChain: boolean; off: boolean };

function targetsOf(command: Command, commands: Command[], viaChain = false): { target: Target; viaChain: boolean }[] {
  if (command.macro) return [{ target: { id: `macro:${command.macro}`, kind: 'macro', name: command.macro }, viaChain }];
  if (command.gameAction) return [{ target: { id: `game:${command.gameAction}`, kind: 'gameAction', name: command.gameAction }, viaChain }];
  if (command.chain) {
    if (viaChain) return []; // chains can't hold chains, but don't loop if one ever does
    return command.chain.flatMap((s) => {
      const step = commands.find((c) => c.enabled && !c.chain && c.keyword === s.keyword);
      return step ? targetsOf(step, commands, true) : [];
    });
  }
  return command.key.split('+').map((key) => ({ target: { id: `key:${key}`, kind: 'key', name: key }, viaChain }));
}

// Puts commands that press the same keys next to each other, so their wires stay short and rarely cross. It starts
// with the first command, keeps taking the one sharing the most keys with the last few placed, then evens things out
// with a few rounds of placing each command at the average height of its keys and each key at that of its commands.
// Ties keep the order the host made them in.
function groupByTargets(shown: Command[], commands: Command[]): Command[] {
  const keys = new Map(shown.map((c) => [c.id, new Set(targetsOf(c, commands).map((t) => t.target.id))]));
  const shared = (a: Command, b: Command) => [...keys.get(a.id)!].filter((k) => keys.get(b.id)!.has(k)).length;
  const left = [...shown];
  let order: Command[] = [];
  while (left.length) {
    const recent = order.slice(-3);
    let best = 0;
    let bestScore = 0;
    left.forEach((c, i) => {
      const score = recent.reduce((sum, r, n) => sum + shared(c, r) * (n + 1), 0);
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    order.push(left.splice(best, 1)[0]!);
  }
  for (let round = 0; round < 4; round++) {
    const keyAt = new Map<string, number[]>();
    order.forEach((c, i) => keys.get(c.id)!.forEach((k) => keyAt.set(k, [...(keyAt.get(k) ?? []), i])));
    const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
    const at = (c: Command, i: number) => (keys.get(c.id)!.size ? mean([...keys.get(c.id)!].map((k) => mean(keyAt.get(k)!))) : i);
    order = order.map((c, i) => ({ c, i, at: at(c, i) })).sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.c);
  }
  return order;
}

const TARGET_HEIGHT = 36;
const TARGET_GAP = 8;

interface MapLayout {
  ys: Record<string, number>; // each command's middle
  tops: Record<string, number>; // each target's top, in the targets column
  x1: number;
  x2: number;
  colTop: number;
  height: number;
}

function CommandMap({
  ordered,
  commands,
  open,
  picked,
  press,
  facts,
  onSwitch,
}: {
  ordered: Command[]; // already grouped (groupByTargets)
  commands: Command[];
  open: string | null;
  picked: ReadonlySet<string>;
  press: (id: string) => object;
  facts: (c: Command) => ReactNode;
  onSwitch: (c: Command) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLUListElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const [hover, setHover] = useState<string | null>(null); // 'c:' and a command's id, or 't:' and a target's
  const [layout, setLayout] = useState<MapLayout | null>(null);

  const { targets, wires } = useMemo(() => {
    const byId = new Map<string, Target & { rows: number[] }>();
    const wires: Wire[] = [];
    ordered.forEach((c, row) => {
      for (const { target, viaChain } of targetsOf(c, commands)) {
        if (wires.some((w) => w.from === c.id && w.to === target.id)) continue;
        const t = byId.get(target.id) ?? { ...target, rows: [] };
        t.rows.push(row);
        byId.set(target.id, t);
        wires.push({ from: c.id, to: target.id, viaChain, off: !c.enabled });
      }
    });
    return { targets: [...byId.values()], wires };
  }, [ordered, commands]);

  useLayoutEffect(() => {
    const el = root.current;
    const col = column.current;
    if (!el || !col) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const colBox = col.getBoundingClientRect();
      const colTop = colBox.top - box.top;
      const ys: Record<string, number> = {};
      let x1 = 0;
      for (const c of ordered) {
        const r = nodes.current.get(c.id)?.getBoundingClientRect();
        if (!r) continue;
        ys[c.id] = r.top - box.top + r.height / 2;
        x1 = Math.max(x1, r.right - box.left);
      }
      // Each target sits level with the commands wired to it, pushed down where it would overlap the one above.
      const wanted = targets
        .map((t) => ({ id: t.id, y: t.rows.reduce((sum, row) => sum + (ys[ordered[row]!.id] ?? 0), 0) / t.rows.length - colTop - TARGET_HEIGHT / 2 }))
        .sort((a, b) => a.y - b.y);
      const tops: Record<string, number> = {};
      let next = 0;
      for (const w of wanted) {
        tops[w.id] = Math.max(w.y, next);
        next = tops[w.id]! + TARGET_HEIGHT + TARGET_GAP;
      }
      const measured = { ys, tops, x1, x2: colBox.left - box.left, colTop, height: Math.max(0, next - TARGET_GAP) };
      setLayout((old) => (JSON.stringify(old) === JSON.stringify(measured) ? old : measured));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ordered, targets]);

  const lit = hover ?? (open && open !== 'new' ? `c:${open}` : null);
  const isLit = (w: Wire) => lit === `c:${w.from}` || lit === `t:${w.to}`;
  const litWires = wires.filter(isLit);
  const offTarget = (id: string) => wires.every((w) => w.to !== id || w.off);

  return (
    <div className="cmap-wrap">
      <div className={`cmap ${lit ? 'lighting' : ''}`} ref={root} onMouseLeave={() => setHover(null)}>
        {layout && (
          <svg className="cmap-wires" aria-hidden="true">
            {[...wires.filter((w) => !isLit(w)), ...litWires].map((w) => {
              const y1 = layout.ys[w.from];
              const top = layout.tops[w.to];
              if (y1 === undefined || top === undefined) return null;
              const y2 = layout.colTop + top + TARGET_HEIGHT / 2;
              const bend = (layout.x2 - layout.x1) / 2;
              const d = `M${layout.x1} ${y1} C${layout.x1 + bend} ${y1} ${layout.x2 - bend} ${y2} ${layout.x2} ${y2}`;
              return <path key={`${w.from} ${w.to}`} d={d} className={`cmap-wire ${w.viaChain ? 'via' : ''} ${w.off ? 'off' : ''} ${isLit(w) ? 'lit' : ''}`} />;
            })}
          </svg>
        )}
        <ul className="cmap-commands">
          {ordered.map((c) => (
            <li
              key={c.id}
              ref={(n) => void (n ? nodes.current.set(c.id, n) : nodes.current.delete(c.id))}
              className={`cmap-node ${c.enabled ? '' : 'off'} ${open === c.id ? 'selected' : ''} ${picked.has(c.id) ? 'picked' : ''} ${litWires.some((w) => w.from === c.id) || lit === `c:${c.id}` ? 'lit' : ''}`}
              onMouseEnter={() => setHover(`c:${c.id}`)}
            >
              <button type="button" className="cmap-open" aria-pressed={open === c.id || picked.has(c.id)} {...press(c.id)} onFocus={() => setHover(`c:${c.id}`)} onBlur={() => setHover(null)}>
                <strong className="cmap-keyword">{c.keyword}</strong>
                <span className={c.chain ? 'cmap-chain' : 'cmap-inline'}>
                  <CommandSummary command={c} commands={commands} />
                </span>
                <span className="cmap-meta">{facts(c)}</span>
              </button>
              <span className="cmap-switch">{onSwitch(c)}</span>
            </li>
          ))}
        </ul>
        <ul className="cmap-targets" ref={column} style={{ height: layout?.height }} aria-label="Keys and actions">
          {targets.map((t) => (
            <li
              key={t.id}
              className={`cmap-target ${offTarget(t.id) ? 'off' : ''} ${litWires.some((w) => w.to === t.id) ? 'lit' : ''}`}
              style={{ top: layout?.tops[t.id] ?? 0 }}
              onMouseEnter={() => setHover(`t:${t.id}`)}
            >
              {t.kind === 'key' ? <kbd className="kbd">{keyLabel(t.name)}</kbd> : <NamedChip kind={t.kind} name={t.name} />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type Does = 'key' | 'macro' | 'gameAction' | 'chain';
// What a command can do. `missing` says what to do first when there's nothing of that kind to pick yet.
const KINDS: { id: Does; title: string; help: string; missing?: string; icon: IconName }[] = [
  { id: 'key', title: 'Key', help: 'Presses a key or combination', icon: 'commands' },
  { id: 'macro', title: 'Macro', help: 'Plays input you recorded', missing: 'Record one in the companion', icon: 'record' },
  { id: 'gameAction', title: 'Game action', help: 'Sends game commands', missing: 'Set one up in the companion', icon: 'cube' },
  { id: 'chain', title: 'Chain', help: 'Times other commands', icon: 'chain' },
];
type Doing = Pick<Command, 'key' | 'macro' | 'gameAction' | 'chain'>;
const kindOf = (command: Pick<Command, 'macro' | 'gameAction' | 'chain'>): Does =>
  command.chain ? 'chain' : command.macro ? 'macro' : command.gameAction ? 'gameAction' : 'key';

// Everything about a command but its keyword. The same for a saved command, which saves as it changes, and a new one.
function CommandEditor({
  command,
  commands,
  macros,
  gameActions,
  gated,
  points,
  onChange,
}: {
  command: Editable;
  commands: Command[];
  macros: string[];
  gameActions: string[];
  gated: boolean;
  points: boolean;
  onChange: (patch: Partial<Command>) => void;
}) {
  const name = command.keyword || 'the new command';
  const kind = kindOf(command);
  // The saved macro or game action stays listed while the PC holding it is offline.
  const names = command.macro && !macros.includes(command.macro) ? [command.macro, ...macros] : macros;
  const actionNames = command.gameAction && !gameActions.includes(command.gameAction) ? [command.gameAction, ...gameActions] : gameActions;
  const available: Record<Does, boolean> = { key: true, macro: names.length > 0, gameAction: actionNames.length > 0, chain: true };
  // What each kind was set to before switching away, so switching back by mistake loses nothing.
  const before = useRef<Partial<Record<Does, Doing>>>({});
  const change = (next: Does) => {
    if (next === kind) return;
    before.current[kind] = { key: command.key, macro: command.macro, gameAction: command.gameAction, chain: command.chain };
    const none = { key: '', macro: null, gameAction: null, chain: null };
    const fresh: Record<Does, Doing> = {
      key: { ...none, key: 'KeyA' },
      macro: { ...none, macro: names[0] ?? null },
      gameAction: { ...none, gameAction: actionNames[0] ?? null },
      chain: { ...none, chain: [] },
    };
    onChange(before.current[next] ?? fresh[next]);
  };
  return (
    <div
      className="command-fields"
      // Enter saves a number, rather than submitting the add form around it with the old value.
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          e.target.blur();
        }
      }}
    >
      <span className="kinds-label" id="kinds-label">
        What it does
      </span>
      <div className="kinds" role="radiogroup" aria-labelledby="kinds-label">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            className={`kind kind-${k.id}`}
            aria-checked={kind === k.id}
            disabled={!available[k.id]}
            onClick={() => change(k.id)}
          >
            <span className="kind-icon">
              <Icon name={k.icon} size={16} />
            </span>
            <strong>{k.title}</strong>
            <span className="kind-help">{available[k.id] ? k.help : k.missing}</span>
          </button>
        ))}
      </div>
      {kind === 'key' && (
        <div className="command-key">
          <KeyCapture value={command.key} label={`Key for ${name}`} onChange={(key) => onChange({ key })} />
          <span className="muted small">Click it, then press the key or combination, like Ctrl+Shift+E.</span>
        </div>
      )}
      {kind === 'macro' && (
        <label className="field command-keyword-field">
          Macro
          <select className="input" value={command.macro!} onChange={(e) => onChange({ macro: e.target.value })}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
                {macros.includes(n) ? '' : ' (PC offline)'}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'gameAction' && (
        <label className="field command-keyword-field">
          Game action
          <span className="hint">Its commands are set up in the companion. A gift's count and the viewer's name fill its blanks.</span>
          <select className="input" value={command.gameAction!} onChange={(e) => onChange({ gameAction: e.target.value })}>
            {actionNames.map((n) => (
              <option key={n} value={n}>
                {n}
                {gameActions.includes(n) ? '' : ' (PC offline)'}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'chain' && <ChainEditor command={command} name={name} commands={commands} onChange={(chain) => onChange({ chain })} />}
      <div className="form-grid">
        {kind === 'key' && (
          <label className="field">
            Hold, in ms
            <span className="hint">How long the key stays down.</span>
            <NumberCell value={command.holdMs} min={10} max={5000} onSave={(holdMs) => onChange({ holdMs })} />
          </label>
        )}
        <label className="field">
          Cooldown per viewer, in ms
          <span className="hint">How long each viewer waits to use it again.</span>
          <NumberCell value={command.cooldownMs} min={0} max={600000} onSave={(cooldownMs) => onChange({ cooldownMs })} />
        </label>
        {gated && (
          <label className="field">
            Minimum level
            <span className="hint">Viewers below this level can't use it.</span>
            <NumberCell value={command.minLevel} min={1} max={MAX_LEVEL} onSave={(minLevel) => onChange({ minLevel })} />
          </label>
        )}
        {points && (
          <label className="field">
            Cost in points
            <span className="hint">What each use takes from the viewer.</span>
            <NumberCell value={command.cost} min={0} max={1000000} onSave={(cost) => onChange({ cost })} />
          </label>
        )}
      </div>
    </div>
  );
}

// A chain's steps, each drawn on one shared timeline: bars that overlap are held at the same time.
function ChainEditor({ command, name, commands, onChange }: { command: Editable; name: string; commands: Command[]; onChange: (chain: ChainStep[]) => void }) {
  const steps = command.chain ?? [];
  const choices = commands.filter((c) => !c.chain && c.id !== command.id && c.keyword !== command.keyword.toLowerCase());
  const change = (i: number, patch: Partial<ChainStep>) => onChange(steps.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const holdOf = (keyword: string) => commands.find((c) => c.keyword === keyword)?.holdMs ?? 0;
  const end = Math.max(0, ...steps.map((s) => s.delayMs + holdOf(s.keyword)));
  const percent = (ms: number) => `${(ms / Math.max(end, 1)) * 100}%`;
  return (
    <div className="chain">
      {steps.length > 0 && (
        <p className="chain-head muted small">
          <span>Steps with the same start are held together.</span>
          <span>Takes {end} ms</span>
        </p>
      )}
      {steps.map((step, i) => (
        <div key={i} className="chain-step">
          <select className="input" value={step.keyword} aria-label={`Step ${i + 1} of ${name}`} onChange={(e) => change(i, { keyword: e.target.value })}>
            {!choices.some((c) => c.keyword === step.keyword) && <option value={step.keyword}>{step.keyword} (deleted)</option>}
            {choices.map((c) => (
              <option key={c.id} value={c.keyword}>
                {c.keyword}
                {c.enabled ? '' : ' (off)'}
              </option>
            ))}
          </select>
          <span className="chain-start">
            <span className="muted small">at</span>
            <NumberCell value={step.delayMs} min={0} max={MAX_CHAIN_DELAY_MS} label={`Start time of step ${i + 1}, in ms`} onSave={(delayMs) => change(i, { delayMs })} />
            <span className="muted small">ms</span>
          </span>
          <span className="chain-track" aria-hidden="true">
            <span className="chain-bar" style={{ left: percent(step.delayMs), width: percent(holdOf(step.keyword)) }} />
          </span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remove step ${i + 1}`} onClick={() => onChange(steps.filter((_, n) => n !== i))}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      {choices.length === 0 ? (
        <p className="muted small">Add a key or macro command first, then run it from here.</p>
      ) : steps.length < MAX_CHAIN_STEPS ? (
        // A new step starts when the others finish, the usual next thing in a sequence.
        <button type="button" className="btn btn-sm" onClick={() => onChange([...steps, { keyword: choices[0]!.keyword, delayMs: Math.min(end, MAX_CHAIN_DELAY_MS) }])}>
          <Icon name="plus" size={14} />
          Add step
        </button>
      ) : (
        <p className="muted small">A chain can have {MAX_CHAIN_STEPS} steps.</p>
      )}
    </div>
  );
}

// Combinations Hyperion refuses, so hosts know before they try one. The companion refuses them too.
function BlockedCombos() {
  return (
    <details className="blocked-combos">
      <summary>Blocked key combinations</summary>
      <p className="muted small">
        These do something outside the game, so Hyperion never presses them, even with extra modifiers. Win and Cmd are never
        pressed either, so shortcuts like Win+R can't happen. Your browser may act on some of them, like Ctrl+W, before
        Hyperion sees the keys.
      </p>
      <ul>
        {BLOCKED_COMBOS.map((c) => (
          <li key={c.label}>
            <kbd className="kbd">{c.label}</kbd> <span className="muted">{c.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ModeCard({ host, refreshHost }: { host: Host; refreshHost: () => Promise<unknown> }) {
  const { error, guard } = useError();
  const save = (patch: Partial<Host>) => guard(() => api('PATCH', '/settings', patch).then(refreshHost))();

  return (
    <Card badge="crowd" hue="orange" title="Crowd mode" description="How chat shares control. Saved with the active profile, and you can switch while live.">
      <ErrorNotice error={error} />
      <ModeTiles value={host.mode} onChange={(mode) => save({ mode })} />
      <ModeDetails host={host} onSave={save} />
    </Card>
  );
}
