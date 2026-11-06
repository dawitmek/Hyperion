import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BLOCKED_COMBOS, MAX_CHAIN_DELAY_MS, MAX_CHAIN_STEPS, MAX_LEVEL, type ChainStep } from '@hyperion/shared';
import { api, type Command, type Host } from '../api';
import { Icon, type IconName } from '../icons';
import { Card, cleanTyped, ConfirmButton, ErrorNotice, KeyCapture, keyLabel, NumberCell, Seg, useError } from '../ui';
import type { PageProps } from './Dashboard';
import { ModeDetails, ModeTiles } from './ModePicker';

export function CommandsPage({ host, refreshHost }: PageProps) {
  return (
    <div className="stack">
      <CommandsCard host={host} />
      <ModeCard host={host} refreshHost={refreshHost} />
    </div>
  );
}

type Editable = Pick<Command, 'keyword' | 'key' | 'macro' | 'gameAction' | 'chain' | 'holdMs' | 'cooldownMs' | 'minLevel' | 'cost'> & { id?: string };

const emptyCommand: Editable = { keyword: '', key: 'KeyA', macro: null, gameAction: null, chain: null, holdMs: 300, cooldownMs: 1000, minLevel: 1, cost: 0 };

type View = 'deck' | 'list';
const VIEW_KEY = 'hyperion.commands-view';

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'deck';
  } catch {
    return 'deck';
  }
}

const SEARCH_FROM = 9; // a shorter list is quicker to scan than to search

function CommandsCard({ host }: { host: Host }) {
  const gated = host.progression && host.levelGating;
  const [commands, setCommands] = useState<Command[]>([]);
  const [open, setOpen] = useState<string | null>(null); // a command's id, or 'new' while adding one
  const [draft, setDraft] = useState(emptyCommand);
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
  const remove = (id: string) => guard(() => api('DELETE', `/commands/${id}`).then(() => (setOpen(null), load())))();
  const add = (e: FormEvent) => {
    e.preventDefault();
    guard(() => api('POST', '/commands', draft).then(() => (setOpen(null), setDraft(emptyCommand), load())))();
  };
  const startAdding = () => {
    setDraft(emptyCommand);
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
  const selected = commands.find((c) => c.id === open);
  const toggle = (id: string) => setOpen(open === id ? null : id);

  // What the deck and the list share, so the two views can't drift apart.
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
      title="Commands"
      description={`For the ${host.profileName} profile. A comment runs a command when it is exactly the keyword, in any capitalization.`}
      actions={
        <div className="row">
          <Seg
            label="Commands view"
            value={view}
            options={[
              ['deck', 'Deck'],
              ['list', 'List'],
            ]}
            onChange={chooseView}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={startAdding}>
            <Icon name="plus" size={14} />
            Add command
          </button>
        </div>
      }
    >
      {commands.length >= SEARCH_FROM && (
        <input className="input command-search" type="search" maxLength={100} placeholder="Find a command" aria-label="Find a command" value={search} onChange={(e) => setSearch(e.target.value)} />
      )}
      {view === 'deck' ? (
        <div className="deck-layout">
          <div>
            <ul className="deck">
              {shown.map((c) => (
                <li key={c.id} className={`deck-tile ${c.enabled ? '' : 'off'} ${open === c.id ? 'selected' : ''}`}>
                  <button type="button" className="deck-tile-open" aria-pressed={open === c.id} onClick={() => toggle(c.id)}>
                    <strong className="deck-tile-keyword">{c.keyword}</strong>
                    <TileFace command={c} commands={commands} />
                    <span className="deck-tile-meta">{facts(c)}</span>
                  </button>
                  <span className="deck-tile-switch">{onSwitch(c)}</span>
                </li>
              ))}
            </ul>
            {nothing}
          </div>
          <aside className={`deck-panel ${open === null ? 'idle' : ''}`} aria-label="Command details">
            {open === null && (
              <>
                {notice}
                <p className="muted small deck-hint">Pick a tile to change what it does.</p>
              </>
            )}
            {open === 'new' && newForm}
            {selected && (
              <div className="command-editor">
                <PanelTitle title={selected.keyword} onClose={() => setOpen(null)} />
                {details(selected)}
              </div>
            )}
          </aside>
        </div>
      ) : (
        <>
          {open === null && notice}
          {open === 'new' && <div className="command-list-new">{newForm}</div>}
          <ul className="commands">
            {shown.map((c) => (
              <li key={c.id} className={`command ${c.enabled ? '' : 'off'}`}>
                <div className="command-row">
                  {onSwitch(c)}
                  <button type="button" className="command-open" aria-expanded={open === c.id} aria-controls={`command-${c.id}`} onClick={() => toggle(c.id)}>
                    <strong className="command-keyword">{c.keyword}</strong>
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

function PanelTitle({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="deck-panel-title">
      <strong>{title}</strong>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
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
    <Card title="Crowd mode" description="How chat shares control. Saved with the active profile, and you can switch while live.">
      <ErrorNotice error={error} />
      <ModeTiles value={host.mode} onChange={(mode) => save({ mode })} />
      <ModeDetails host={host} onSave={save} />
    </Card>
  );
}
