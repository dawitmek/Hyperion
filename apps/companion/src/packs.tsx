// Packs: game actions shared as text. Import shows every command in a pack before anything is saved, and flags the
// ones that can do lasting harm; export copies or saves the chosen actions for someone else to import.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./icons";
import { CommandLine, GAME_HUES, GAME_NAMES, GameBadge, type Game, type GameAction } from "./game";
import { Modal } from "./modal";

interface Starter {
  name: string;
  description: string;
  text: string;
}

// What a starter pack's card shows besides its name: its game and how many actions it has.
function starterFacts(text: string): { game: Game | null; count: number } {
  try {
    const actions = (JSON.parse(text) as { actions?: { game?: Game }[] }).actions ?? [];
    return { game: actions[0]?.game ?? null, count: actions.length };
  } catch {
    return { game: null, count: 0 };
  }
}

interface Preview {
  builtIn: boolean; // a starter pack as it comes with the companion; any other pack is whatever whoever shared it wrote
  name: string;
  author: string | null;
  description: string | null;
  actions: PreviewAction[];
}

interface PreviewAction {
  name: string;
  action: GameAction | null; // as it would be saved; null when it can't be imported
  problem: string | null;
  risks: { line: number; reason: string }[];
  exists: boolean;
}

type OnClash = "keepBoth" | "replace";
interface Choice {
  picked: boolean;
  onClash: OnClash;
}

const MAX_PACK_BYTES = 512 * 1024; // as packs.rs checks

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ImportPack({ onClose, onImported }: { onClose: () => void; onImported: (names: string[]) => void }) {
  const [source, setSource] = useState<"starter" | "paste" | "file">("starter");
  const [starters, setStarters] = useState<Starter[]>([]);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => void invoke<Starter[]>("starter_packs").then(setStarters), []);

  const open = (packText: string) => {
    setError(null);
    invoke<Preview>("preview_pack", { text: packText })
      .then((p) => {
        setPreview(p);
        // Risky actions start unticked, so taking one is always a choice.
        setChoices(p.actions.map((a) => ({ picked: a.action !== null && a.risks.length === 0, onClash: "keepBoth" })));
      })
      .catch((e) => setError(String(e)));
  };
  const openFile = (file: File | undefined) => {
    if (!file) return;
    // Packs are small, so a big file is refused before it's read rather than after.
    if (file.size > MAX_PACK_BYTES) return setError(`That's too big for a pack. Packs can be up to ${MAX_PACK_BYTES / 1024} KB`);
    file.text().then(open, () => setError("Couldn't read that file"));
  };
  const choose = (i: number, change: Partial<Choice>) => setChoices((list) => list.map((c, j) => (j === i ? { ...c, ...change } : c)));

  if (preview) {
    const picked = preview.actions.filter((a, i) => a.action && choices[i]?.picked);
    const indexed = preview.actions.map((a, i) => ({ a, i }));
    const groups = [
      { key: "ready", title: "Ready to import", hint: null, items: indexed.filter(({ a }) => a.action && a.risks.length === 0) },
      {
        key: "risky",
        title: "Check these first",
        hint: "These can do lasting harm, so they start unticked. Only tick one if you trust whoever made the pack.",
        items: indexed.filter(({ a }) => a.risks.length > 0),
      },
      { key: "broken", title: "Can't be imported", hint: null, items: indexed.filter(({ a }) => !a.action) },
    ].filter((g) => g.items.length > 0);
    const clashes = preview.actions.filter((a) => a.exists).length;
    const save = () => {
      setBusy(true);
      setError(null);
      const chosen = preview.actions.flatMap((a, i) => (a.action && choices[i]!.picked ? [{ action: a.action, onClash: choices[i]!.onClash }] : []));
      invoke<string[]>("import_pack", { chosen })
        .then((names) => (onImported(names), onClose()))
        .catch((e) => setError(String(e)))
        .finally(() => setBusy(false));
    };
    return (
      <Modal
        title="Import game actions"
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={() => (setPreview(null), setError(null))}>
              Back
            </button>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={picked.length === 0 || busy} onClick={save}>
              {picked.length === 0 ? "Pick an action to import" : `Import ${plural(picked.length, "game action")}`}
            </button>
          </>
        }
      >
        <div className="pack-hero">
          <div className="pack-hero-top">
            <span className="pack-hero-icon">
              <Icon name="cube" size={22} />
            </span>
            {preview.builtIn && (
              <span className="tag green pack-built-in">
                <Icon name="shield" size={12} /> Built in
              </span>
            )}
            <div className="pack-hero-name">
              <h3>{preview.name}</h3>
              <span className="muted small">
                {preview.builtIn ? "Comes with the companion" : preview.author ? `Shared pack, says it's by ${preview.author}` : "Shared pack"}
              </span>
            </div>
          </div>
          {preview.description && <p className="pack-hero-about">{preview.description}</p>}
          <dl className="pack-stats">
            <div>
              <dt>Actions</dt>
              <dd>{preview.actions.length}</dd>
            </div>
            <div className="picked">
              <dt>Picked</dt>
              <dd>{picked.length}</dd>
            </div>
            {clashes > 0 && (
              <div className="clash">
                <dt>Already here</dt>
                <dd>{clashes}</dd>
              </div>
            )}
          </dl>
          <p className="pack-hero-note">
            <Icon name="shield" size={14} />
            Nothing is saved until you press Import. Commands run in your world with operator rights, so read each one.
          </p>
        </div>
        {error && <p className="notice error small">{error}</p>}
        {groups.map((group) => (
          <section key={group.key} className={`pack-group ${group.key}`}>
            <h4 className="pack-group-title">
              {group.key === "ready" && <Icon name="check" size={14} strokeWidth={2.5} />}
              {group.key === "risky" && <Icon name="warning" size={14} />}
              {group.key === "broken" && <Icon name="close" size={14} strokeWidth={2.5} />}
              {group.title}
              <span className="pack-group-count">{group.items.length}</span>
            </h4>
            {group.hint && <p className="pack-group-hint">{group.hint}</p>}
            <ul className="pack-list">
              {group.items.map(({ a, i }) => {
                const choice = choices[i]!;
                const shown = a.action;
                return (
                  <li key={i} className={`pack-item ${shown ? "" : "broken"} ${choice.picked ? "picked" : ""}`}>
                    <label className="pack-pick">
                      {shown && <input type="checkbox" className="check" checked={choice.picked} onChange={(e) => choose(i, { picked: e.target.checked })} />}
                      {shown && <GameBadge game={shown.game} size={28} />}
                      <span className="pack-pick-name">
                        <strong className="action-name">{a.name}</strong>
                        {shown && (
                          <span className="action-meta">
                            {GAME_NAMES[shown.game]}
                            {shown.repeat > 1 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <Icon name="repeat" size={12} />
                                {shown.repeat} times{shown.delayMs > 0 ? `, ${shown.delayMs / 1000} s apart` : ""}
                              </>
                            )}
                          </span>
                        )}
                      </span>
                      {a.exists && shown && <span className="tag indigo">Already here</span>}
                    </label>
                    {a.problem && <p className="pack-problem small">{a.problem}.</p>}
                    {shown && (
                      <ol className="action-lines">
                        {shown.commands.map((c, line) => {
                          const risk = a.risks.find((r) => r.line === line);
                          return (
                            <li key={line} className={risk ? "risk" : ""}>
                              <CommandLine text={c} />
                              {risk && (
                                <span className="risk-reason">
                                  <Icon name="warning" size={12} /> {risk.reason}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                    {a.exists && shown && choice.picked && (
                      <div className="pack-clash small">
                        <span>You already have an action called {a.name}.</span>
                        <span className="seg" role="radiogroup" aria-label={`What to do with ${a.name}`}>
                          {(
                            [
                              ["keepBoth", "Keep both"],
                              ["replace", "Replace mine"],
                            ] as const
                          ).map(([value, label]) => (
                            <button key={value} type="button" role="radio" aria-checked={choice.onClash === value} onClick={() => choose(i, { onClash: value })}>
                              {label}
                            </button>
                          ))}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </Modal>
    );
  }

  const tabs = [
    ["starter", "Starter packs", "cube"],
    ["paste", "Paste", "copy"],
    ["file", "File", "file"],
  ] as const;
  return (
    <Modal
      title="Import game actions"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <span className="spacer" />
          {source === "paste" && (
            <button className="btn btn-primary" disabled={!text.trim()} onClick={() => open(text)}>
              See what's in it
            </button>
          )}
        </>
      }
    >
      <p className="muted small">Pick where the actions come from. You'll see every command before anything is added.</p>
      <div className="pack-tabs" role="tablist" aria-label="Where from">
        {tabs.map(([value, label, icon]) => (
          <button key={value} role="tab" aria-selected={source === value} onClick={() => (setSource(value), setError(null))}>
            <Icon name={icon} size={16} />
            {label}
          </button>
        ))}
      </div>
      {error && <p className="notice error small">{error}</p>}
      {source === "starter" && (
        <ul className="pack-starters">
          {starters.map((s) => {
            const { game, count } = starterFacts(s.text);
            return (
              <li key={s.name}>
                <button className={`pack-starter ${game ? GAME_HUES[game] : ""}`} onClick={() => open(s.text)}>
                  {game ? <GameBadge game={game} size={40} /> : <Icon name="cube" size={20} />}
                  <span className="pack-starter-text">
                    <strong>{s.name}</strong>
                    <span className="muted small">{s.description}</span>
                    <span className="tag">{plural(count, "action")}</span>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {source === "paste" && (
        <label className="field">
          Pack
          <textarea
            className="pack-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Paste a pack someone shared. It starts with {"hyperion": "game-actions"'}
            spellCheck={false}
            autoFocus
          />
        </label>
      )}
      {source === "file" && (
        <div
          className={`pack-drop ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => (e.preventDefault(), setDragging(false), openFile(e.dataTransfer.files[0]))}
        >
          <span className="pack-drop-icon">
            <Icon name="file" size={24} />
          </span>
          <strong>{dragging ? "Drop it to see what's inside" : "Drop a pack file here"}</strong>
          <p className="muted small">A .hyperion.json file someone shared with you</p>
          <button className="btn btn-sm" onClick={() => fileInput.current?.click()}>
            Choose a file
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => (openFile(e.target.files?.[0]), (e.target.value = ""))} />
        </div>
      )}
    </Modal>
  );
}

export function ExportPack({ actions, initial, onClose }: { actions: GameAction[]; initial: string[] | null; onClose: () => void }) {
  const [picked, setPicked] = useState(() => new Set(initial ?? actions.map((a) => a.name)));
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const args = () => ({ names: actions.filter((a) => picked.has(a.name)).map((a) => a.name), name, author });
  const finish = (message: string) => (setError(null), setDone(message));
  const fail = (e: unknown) => (setDone(null), setError(String(e)));
  const copy = () =>
    invoke<string>("export_pack", args())
      .then((text) => navigator.clipboard.writeText(text))
      .then(() => finish("Copied. Paste it anywhere, like Discord or a message, and the other streamer pastes it into Import."), fail);
  const save = () => invoke<string>("save_pack", args()).then((path) => finish(`Saved to ${path}`), fail);
  const toggle = (actionName: string) =>
    setPicked((set) => {
      const next = new Set(set);
      if (!next.delete(actionName)) next.add(actionName);
      return next;
    });
  const all = picked.size === actions.length;

  return (
    <Modal
      title="Share game actions"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Done
          </button>
          <span className="spacer" />
          <button className="btn" disabled={picked.size === 0} onClick={() => void save()}>
            <Icon name="file" size={15} /> Save file
          </button>
          <button className="btn btn-primary" disabled={picked.size === 0} onClick={() => void copy()}>
            <Icon name="copy" size={15} /> Copy
          </button>
        </>
      }
    >
      <p className="muted small">
        Makes a pack others can import. It holds the commands only: your Minecraft server, password and everything else
        stay on this PC.
      </p>
      <div className="pack-fields">
        <label className="field">
          Pack name
          <input className="input" value={name} maxLength={80} placeholder="My game actions" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Made by
          <input className="input" value={author} maxLength={80} placeholder="Your name (optional)" onChange={(e) => setAuthor(e.target.value)} />
        </label>
      </div>
      <div className="pack-pick-head">
        <strong>{plural(picked.size, "action")} picked</strong>
        <button className="btn btn-ghost btn-sm" onClick={() => setPicked(all ? new Set() : new Set(actions.map((a) => a.name)))}>
          {all ? "Pick none" : "Pick all"}
        </button>
      </div>
      <ul className="pack-list compact">
        {actions.map((a) => (
          <li key={a.name} className={`pack-item ${picked.has(a.name) ? "picked" : ""}`}>
            <label className="pack-pick">
              <input type="checkbox" className="check" checked={picked.has(a.name)} onChange={() => toggle(a.name)} />
              <GameBadge game={a.game} size={26} />
              <strong className="action-name">{a.name}</strong>
              <span className="muted small pack-meta">{plural(a.commands.length, "command")}</span>
            </label>
          </li>
        ))}
      </ul>
      {done && <p className="notice info small" role="status">{done}</p>}
      {error && <p className="notice error small">{error}</p>}
    </Modal>
  );
}
