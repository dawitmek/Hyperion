import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@hyperion/theme/theme.css";
import "./App.css";
import { Icon } from "./icons";
import { JumpBar, Section, SectionsProvider } from "./sections";
import { CommandLine, GAME_HUES, GAME_NAMES, GameBadge, type Game, type GameAction } from "./game";
import { ExportPack, ImportPack } from "./packs";
import { Appearance, applyLook, saveLook, savedLook, type Look } from "./appearance";

// Invisible codes (tabs, line breaks) never belong in a one-line field; they're dropped as typed or pasted.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

interface LogEntry {
  key: string;
  ok: boolean;
  reason: string | null;
}

interface Snapshot {
  paired: boolean;
  serverUrl: string | null;
  deviceName: string | null;
  connection: string;
  paused: boolean;
  pausedByHost: boolean; // paused with the button or the panic key; otherwise it hasn't been started yet
  targetProcess: string | null;
  profileName: string | null;
  profileGame: string | null;
  allowedKeys: string[];
  allKeys: string[];
  log: LogEntry[];
  platformSupported: boolean;
  permissionProblem: string | null;
  panicHotkey: string;
  commands: CommandView[];
  macros: MacroView[];
  macrosSupported: boolean;
  recording: string | null;
  recordingStarted: boolean;
  stopRecordingHotkey: string;
  gameActions: GameAction[];
  minecraftJava: MinecraftView | null;
  minecraftDefaultPort: number;
  minecraftBedrock: BedrockView;
  pendingApprovals: number;
  theme: string | null; // the account's dashboard theme, which this window follows
  themeStyle: string | null;
  themeMode: string | null; // "light", "dark" or "system"
  version: string;
  updatesSupported: boolean;
  autoUpdate: boolean | null; // null until the host answers the one-time question
  update: UpdateView;
}

interface UpdateView {
  status: "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready" | "installing" | "error";
  version: string | null;
  notesUrl: string | null;
  progress: number | null; // 0 to 1
  error: string | null;
  waiting: boolean; // downloaded, waiting for chat to leave this PC alone
  dismissed: boolean;
}

interface CommandView {
  keyword: string;
  key: string;
  label: string;
  enabled: boolean;
  combo: boolean;
  approved: boolean;
  problem: string | null;
}

interface MacroView {
  name: string;
  lengthMs: number;
  steps: number;
}


// Whether this PC listens for Minecraft Bedrock's /connect, and whether the game has joined.
interface BedrockView {
  on: boolean;
  connected: boolean;
  port: number;
  problem: string | null;
}

// The Minecraft server game actions go to. The password stays on the Rust side.
interface MinecraftView {
  host: string;
  port: number;
  player: string | null;
  hasPassword: boolean;
}

interface GameWindow {
  title: string;
  process: string;
  icon: string | null; // PNG data URL
}

type Run = (command: string, args?: Record<string, unknown>) => Promise<boolean>; // whether it worked

// Key codes as people know them: KeyA -> A, ArrowLeft -> ←, Digit1 -> 1, Control+Shift+KeyE -> Ctrl+Shift+E.
function keyLabel(code: string): string {
  if (code.includes("+")) return code.split("+").map(keyLabel).join("+");
  const names: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Control: "Ctrl" };
  return names[code] ?? code.replace(/^Key/, "").replace(/^Digit/, "").replace(/(Left|Right)$/, " $1");
}

export default function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Snapshot>("get_state").then(setState);
    const unlisten = listen<Snapshot>("state", (event) => setState(event.payload));
    return () => void unlisten.then((stop) => stop());
  }, []);

  // Runs a Rust command and shows its error, if any.
  const run: Run = (command, args) =>
    invoke(command, args)
      .then(() => (setError(null), true))
      .catch((e) => (setError(String(e)), false));

  // The look: the dashboard's (see @hyperion/theme), as the server last sent it, unless one was picked for this PC.
  const [ownLook, setOwnLook] = useState(savedLook);
  const [lookOpen, setLookOpen] = useState(false);
  const dashboardLook: Look = {
    theme: state?.theme ?? "default",
    style: state?.themeStyle === "full" ? "full" : "colors",
    mode: state?.themeMode === "light" || state?.themeMode === "dark" ? state.themeMode : "system",
  };
  const look = ownLook ?? dashboardLook;
  useEffect(() => applyLook(look), [look.theme, look.style, look.mode]);
  const changeLook = (next: Look | null) => (saveLook(next), setOwnLook(next));

  if (!state) return null;

  return (
    <main className="companion">
      <header className="top">
        <img className="logo-mark" src="/logo.png" alt="" />
        <h1>Hyperion Companion</h1>
        {state.paired && <ConnectionTag connection={state.connection} />}
        <button className="btn btn-ghost btn-sm btn-icon" aria-label="Appearance" title="Appearance" onClick={() => setLookOpen(true)}>
          <Icon name="palette" size={17} />
        </button>
      </header>
      {lookOpen && <Appearance dashboard={dashboardLook} own={ownLook} paired={state.paired} onChange={changeLook} onClose={() => setLookOpen(false)} />}
      <UpdateNotice state={state} run={run} />
      {!state.platformSupported && (
        <p className="notice warning">Key input only works on Windows and macOS so far. This build can pair and connect, but refuses every action.</p>
      )}
      {state.permissionProblem && (
        <div className="notice warning">
          <p>
            {state.permissionProblem}. Click below, then in System Settings → Privacy &amp; Security → Accessibility turn on
            Hyperion Companion.
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-sm" onClick={() => run("request_permission")}>
              Open Accessibility settings
            </button>
            <button className="btn btn-sm" onClick={() => run("restart_app")}>
              Restart companion
            </button>
          </div>
          <p className="small" style={{ marginTop: 10 }}>
            Already turned on? After an update or reinstall, macOS keeps the switch for the old copy. Reset it, then turn it
            on again.{" "}
            <button className="btn btn-sm btn-ghost" onClick={() => run("reset_permission")}>
              Reset permission
            </button>
          </p>
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {state.paired ? <Paired state={state} run={run} /> : <PairForm run={run} defaultServer={state.serverUrl} />}
      <AppFooter state={state} run={run} />
    </main>
  );
}

// New versions. The first one found asks once whether to update automatically; after that it either installs by
// itself (once chat leaves this PC alone) or asks each time, as chosen. The switch in the footer changes it any time.
function UpdateNotice({ state, run }: { state: Snapshot; run: Run }) {
  const u = state.update;
  const version = u.version ? `Version ${u.version}` : "A new version";
  const notes = u.notesUrl && (
    <a href="#" onClick={(e) => (e.preventDefault(), void openUrl(u.notesUrl!))}>
      What's new
    </a>
  );

  if (u.status === "available" && state.autoUpdate === null) {
    return (
      <section className="notice info update-notice" aria-label="Update">
        <p>
          <strong>{version} is out</strong> (you have {state.version}). {notes}
        </p>
        <p className="small">
          Keep the companion up to date automatically? Updates wait until your game has been out of focus for a minute, then
          the companion restarts by itself. You can change this at the bottom of the window.
        </p>
        <div className="row">
          <button className="btn btn-sm btn-primary" onClick={() => run("set_auto_update", { enabled: true })}>
            Update automatically
          </button>
          <button className="btn btn-sm" onClick={() => run("set_auto_update", { enabled: false })}>
            Ask me each time
          </button>
        </div>
      </section>
    );
  }
  if (u.status === "available" && state.autoUpdate === false && !u.dismissed) {
    return (
      <section className="notice info update-notice" aria-label="Update">
        <p>
          <strong>{version} is available</strong> (you have {state.version}). {notes}
        </p>
        <div className="row">
          <button className="btn btn-sm btn-primary" onClick={() => run("install_update")}>
            Update and restart
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => run("dismiss_update")}>
            Not now
          </button>
        </div>
      </section>
    );
  }
  if (u.status === "downloading") {
    const pct = Math.round((u.progress ?? 0) * 100);
    return (
      <section className="notice info update-notice" aria-label="Update" role="status">
        <p>
          Downloading {version.toLowerCase()}… {pct}%
        </p>
        <div className="update-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </section>
    );
  }
  if (u.status === "ready") {
    return (
      <section className="notice info update-notice" aria-label="Update" role="status">
        <p>
          <strong>{version} is ready.</strong>{" "}
          {u.waiting ? "It installs once your game has been out of focus for a minute." : "Install it whenever you like."}
        </p>
        <div className="row">
          <button className="btn btn-sm btn-primary" onClick={() => run("install_update")}>
            Install and restart now
          </button>
        </div>
      </section>
    );
  }
  if (u.status === "installing") {
    return (
      <p className="notice info" role="status">
        Installing {version.toLowerCase()}. The companion restarts by itself.
      </p>
    );
  }
  if (u.status === "error") {
    return (
      <div className="notice error update-notice" role="alert">
        <p>Couldn't update: {u.error}</p>
        <div className="row">
          <button className="btn btn-sm" onClick={() => run("check_update")}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  return null;
}

// The app's version and the update settings, at the bottom of every screen.
function AppFooter({ state, run }: { state: Snapshot; run: Run }) {
  const status = state.update.status;
  const busy = status === "checking" || status === "downloading" || status === "installing";
  return (
    <footer className="app-foot">
      <span>Version {state.version}</span>
      <span className="spacer" />
      {state.updatesSupported && (
        <>
          <label className="approve">
            <span className="small">Update automatically</span>
            <span className="switch">
              <input
                type="checkbox"
                checked={state.autoUpdate === true}
                aria-label="Update automatically"
                onChange={(e) => run("set_auto_update", { enabled: e.target.checked })}
              />
            </span>
          </label>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run("check_update")}>
            {status === "checking" ? "Checking…" : status === "upToDate" ? "Up to date" : "Check for updates"}
          </button>
        </>
      )}
    </footer>
  );
}

// The game picker: running programs with their icons, refreshed each time it opens. A game picked earlier that
// isn't running now stays listed, so it can still be seen and kept.
function GamePicker({
  value,
  windows,
  onOpen,
  onPick,
}: {
  value: string | null;
  windows: GameWindow[];
  onOpen: () => void;
  onPick: (process: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = windows.find((w) => w.process === value) ?? (value ? { process: value, title: "Not running", icon: null } : null);
  const choices = current && !windows.includes(current) ? [current, ...windows] : windows;
  const options = () => [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];

  useEffect(() => {
    if (!open) return;
    (options().find((o) => o.getAttribute("aria-selected") === "true") ?? options()[0])?.focus();
    const close = (e: MouseEvent) => box.current?.contains(e.target as Node) || setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (process: string | null) => {
    setOpen(false);
    onPick(process);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      box.current?.querySelector<HTMLButtonElement>(".picker-button")?.focus();
    }
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const all = options();
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
    }
  };

  return (
    <div className="picker" ref={box} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="input picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="game-label"
        onClick={() => {
          if (!open) onOpen();
          setOpen(!open);
        }}
      >
        {current ? <ProgramRow program={current} /> : <span className="muted">Select a game…</span>}
        <Icon name="chevron" />
      </button>
      {open && (
        <div className="picker-list" role="listbox" aria-labelledby="game-label">
          {choices.length === 0 && <p className="muted small picker-empty">No programs with a window are running.</p>}
          {choices.map((w) => (
            <button key={w.process} type="button" role="option" aria-selected={w.process === value} className="picker-option" onClick={() => pick(w.process)}>
              <ProgramRow program={w} />
              {w.process === value && <Icon name="check" />}
            </button>
          ))}
          {value && (
            <button type="button" role="option" aria-selected={false} className="picker-option picker-clear" onClick={() => pick(null)}>
              No game
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// A program's icon (or its first letter when it has none), its name and its process.
function ProgramRow({ program }: { program: GameWindow }) {
  return (
    <>
      <span className="app-icon">{program.icon ? <img src={program.icon} alt="" /> : program.process[0]!.toUpperCase()}</span>
      <span className="app-names">
        <strong>{program.title}</strong>
        <span className="muted small">{program.process}</span>
      </span>
    </>
  );
}

function ConnectionTag({ connection }: { connection: string }) {
  const hue = connection === "connected" ? "green" : connection === "connecting" ? "amber" : "red";
  return (
    <span className={`tag ${hue} connection`} title={connection}>
      <span className="dot" aria-hidden="true" />
      {connection[0]!.toUpperCase() + connection.slice(1)}
    </span>
  );
}

function PairForm({ run, defaultServer }: { run: Run; defaultServer: string | null }) {
  const [serverUrl, setServerUrl] = useState(defaultServer ?? "http://127.0.0.1:3000");
  const [code, setCode] = useState("");
  const [name, setName] = useState("My PC");
  // Suggest the PC's own name, unless the host has already typed one.
  useEffect(() => {
    invoke<string | null>("device_name").then((pc) => pc && setName((current) => (current === "My PC" ? pc : current)));
  }, []);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card pair stack"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        run("pair", { serverUrl, code, name }).finally(() => setBusy(false));
      }}
    >
      <div className="pair-intro">
        <h2>Pair this PC</h2>
        <p className="muted">Once paired, chat's commands on your stream press keys in your game, on this PC only.</p>
      </div>
      <ol className="pair-steps">
        <li>Open Companion on the Hyperion dashboard.</li>
        <li>Create a pairing code. The server address is shown with it.</li>
        <li>Enter both here.</li>
      </ol>
      <label className="field">
        Pairing code
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          maxLength={6}
          placeholder="••••••"
          autoFocus
          required
        />
      </label>
      <div className="pair-fields">
        <label className="field">
          Server address
          <input value={serverUrl} maxLength={200} onChange={(e) => setServerUrl(e.target.value.replace(/\s/g, ""))} required />
        </label>
        <label className="field">
          Device name
          <input value={name} maxLength={64} onChange={(e) => setName(e.target.value.replace(CONTROL_CHARS, ""))} required />
        </label>
      </div>
      <button className="btn btn-primary btn-lg" disabled={busy}>
        {busy ? "Pairing…" : "Pair this PC"}
      </button>
    </form>
  );
}

function Paired({ state, run }: { state: Snapshot; run: Run }) {
  const [windows, setWindows] = useState<GameWindow[]>([]);
  const refreshWindows = () => invoke<GameWindow[]>("list_windows").then(setWindows);
  useEffect(() => void refreshWindows(), []);

  const connected = state.connection === "connected";
  // One state for the whole PC, most pressing first: nothing arrives while disconnected, and nothing is pressed until
  // a game is picked and the host presses Play. The companion starts paused, but only a pause the host made says so.
  const status = !connected
    ? { hue: "red", title: state.connection === "connecting" ? "Connecting" : "Offline", text: "Not connected to the server, so chat's keys can't reach this PC." }
    : !state.targetProcess
      ? { hue: "amber", title: "Pick a game", text: "Pick the game chat plays below, then press Play." }
      : state.paused && !state.pausedByHost
        ? { hue: "amber", title: "Not started", text: `Press Play when you're ready. Keys will go to ${state.targetProcess}.` }
        : state.paused
          ? { hue: "amber", title: "Paused", text: `Nothing is pressed until you resume. Keys will go to ${state.targetProcess}.` }
          : { hue: "green", title: "Ready", text: `Chat's keys go to ${state.targetProcess} while its window is in focus.` };

  return (
    <SectionsProvider>
      <section className={`hero ${status.hue}`} aria-label="Input">
        <div className="hero-main">
          <span className={`orb ${status.hue === "green" ? "live" : ""}`} aria-hidden="true">
            <span />
          </span>
          <div className="hero-text">
            <h2 className="hero-state">{status.title}</h2>
            <p className="muted small">{status.text}</p>
          </div>
          {connected ? (
            <button
              className={`btn hero-toggle ${state.paused ? "btn-success" : "btn-danger"}`}
              disabled={state.paused && !state.targetProcess}
              title={state.paused && !state.targetProcess ? "Pick your game first" : undefined}
              onClick={() => run("set_paused", { paused: !state.paused })}
            >
              <Icon name={state.paused ? "play" : "pause"} />
              {!state.paused ? "Pause" : state.pausedByHost ? "Resume" : "Play"}
            </button>
          ) : (
            <button className="btn hero-toggle" onClick={() => run("reconnect")}>
              <Icon name="refresh" />
              Reconnect
            </button>
          )}
        </div>

        <div className="hero-game">
          <div className="field">
            <span className="hero-label">
              <span id="game-label">Game</span>
              {state.profileName && (
                <span className="tag teal" title="Switching profiles on the dashboard picks its game here when the profile names one.">
                  {state.profileName} profile
                </span>
              )}
            </span>
            <GamePicker value={state.targetProcess} windows={windows} onOpen={refreshWindows} onPick={(process) => run("set_target", { process })} />
          </div>
          {state.profileGame && state.targetProcess !== state.profileGame && (
            <p className="notice warning">
              The {state.profileName} profile is for {state.profileGame}, but this PC is targeting {state.targetProcess ?? "nothing"}.
            </p>
          )}
        </div>

        <footer className="hero-foot">
          <span className="panic">
            <Icon name="shield" size={14} />
            <kbd className="kbd">{state.panicHotkey}</kbd> pauses instantly and lets go of every held key
          </span>
          <span className="device" title={`${state.deviceName} on ${state.serverUrl}`}>
            {state.deviceName} on {state.serverUrl}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => run("unpair")}>
            Unpair
          </button>
        </footer>
      </section>

      <JumpBar />

      {state.pendingApprovals > 0 && (
        <p className="notice warning">
          {state.pendingApprovals} key combination{state.pendingApprovals === 1 ? " needs" : "s need"} your OK before this PC
          will press {state.pendingApprovals === 1 ? "it" : "them"}. See Commands below.
        </p>
      )}

      <AllowedKeys state={state} run={run} />

      <Commands state={state} run={run} />
      <Macros state={state} run={run} />
      <GameActions state={state} run={run} />

      <TiktokVoices serverUrl={state.serverUrl} />

      <Section
        id="activity"
        label="Activity"
        icon="feed"
        hue="sky"
        title="Activity"
        description="The latest keys chat pressed on this PC, and any it refused."
        summary={state.log.length === 0 ? "Nothing yet" : `Latest: ${keyLabel(state.log[0]!.key)}${state.log[0]!.ok ? "" : ", refused"}`}
      >
        {state.log.length === 0 ? (
          <p className="empty">Keys appear here as chat presses them.</p>
        ) : (
          <ul className="log">
            {state.log.map((entry, i) => (
              <li key={i} className={entry.ok ? "ok" : "refused"}>
                <span className="log-mark" aria-label={entry.ok ? "Pressed" : "Refused"}>
                  <Icon name={entry.ok ? "check" : "close"} size={13} strokeWidth={2.6} />
                </span>
                <kbd className="kbd">{keyLabel(entry.key)}</kbd>
                <span className="muted small">{entry.ok ? "Pressed" : entry.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </SectionsProvider>
  );
}

// Signs in to TikTok in a separate window so the server can use TikTok's own voices for text-to-speech.
function TiktokVoices({ serverUrl }: { serverUrl: string | null }) {
  // null until the server answers. `needed` is false while the server's own TikTok account works.
  const [status, setStatus] = useState<{ signedIn: boolean; needed: boolean } | null>(null);
  const signedIn = status?.signedIn ?? false;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // The dashboard can sign out too, so check again whenever this window comes back into focus.
  useEffect(() => {
    const check = () => invoke<{ signedIn: boolean; needed: boolean }>("tiktok_status").then(setStatus, () => {});
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

  const signIn = () => {
    setBusy(true);
    setMessage(null);
    invoke<boolean>("tiktok_sign_in")
      .then((done) => {
        if (done) {
          setStatus({ signedIn: true, needed: true });
          setMessage({ ok: true, text: "Signed in to TikTok." });
        }
      })
      .catch((e) => setMessage({ ok: false, text: String(e) }))
      .finally(() => setBusy(false));
  };

  // Nothing to show while the server's account covers TikTok voices (or before the server has answered),
  // unless a message from this sign-in is still on screen.
  if (!status?.needed && !message) return null;

  return (
    <Section
      id="tiktok"
      label="Voices"
      icon="voice"
      hue="pink"
      title="TikTok voices"
      description="Read chat aloud in TikTok's own voices. Sign in to TikTok here and Hyperion uses your account to make the speech."
      summary={signedIn ? "Signed in to TikTok" : "Not signed in"}
    >
      {message && (
        <div className={`notice ${message.ok ? "info" : "error"}`} role="status">
          {message.text}
          {message.ok && serverUrl && (
            <>
              {" "}
              <a href="#" onClick={(e) => (e.preventDefault(), void openUrl(`${serverUrl}/dashboard/voice`))}>
                Choose a TikTok voice on the dashboard
              </a>
            </>
          )}
        </div>
      )}
      <div className="row">
        {signedIn ? (
          <span className="tag green signed-in">
            <span className="dot" aria-hidden="true" />
            Signed in to TikTok
          </span>
        ) : (
          <button className="btn" disabled={busy} onClick={signIn}>
            {busy ? "Waiting for you to sign in…" : "Sign in to TikTok"}
          </button>
        )}
      </div>
    </Section>
  );
}

// Where each key sits on the keyboard drawn under Allowed keys: [code, row, first column, columns wide], on a grid of
// half-key columns so rows can be staggered like a real keyboard. Keys not placed here go in a row of their own below.
const row = (codes: string[], rowNumber: number, firstColumn: number): [string, number, number, number][] =>
  codes.map((code, i) => [code, rowNumber, firstColumn + i * 2, 2]);
const KEYBOARD: [string, number, number, number][] = [
  ...row(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d) => `Digit${d}`), 1, 1),
  ...row([..."QWERTYUIOP"].map((l) => `Key${l}`), 2, 2),
  ...row([..."ASDFGHJKL"].map((l) => `Key${l}`), 3, 3),
  ["Enter", 3, 21, 3],
  ["ShiftLeft", 4, 1, 2],
  ...row([..."ZXCVBNM"].map((l) => `Key${l}`), 4, 3),
  ["ShiftRight", 4, 17, 2],
  ["ArrowUp", 4, 19, 2],
  ["Space", 5, 5, 10],
  ...row(["ArrowLeft", "ArrowDown", "ArrowRight"], 5, 17),
];
// Shorter names where a key is narrow; the full name is its label for screen readers and its tooltip.
const CAP_NAMES: Record<string, string> = { ShiftLeft: "⇧", ShiftRight: "⇧", Enter: "Enter ↵" };

// The keys this PC lets the server press. A click allows or blocks one key. Clicking with Shift or Ctrl/Cmd held only
// selects, like a file list: Ctrl/Cmd-click picks single keys, Shift-click everything from the last key clicked to
// this one (in grid order), and Ctrl+Shift-click adds that range to the selection.
function AllowedKeys({ state, run }: { state: Snapshot; run: Run }) {
  const allowed = new Set(state.allowedKeys);
  // Keys in reading order of the drawn keyboard, which is the order a Shift-click range follows.
  const placed = KEYBOARD.filter(([code]) => state.allKeys.includes(code)).sort((a, b) => a[1] - b[1] || a[2] - b[2]);
  const order = [...placed.map(([code]) => code), ...state.allKeys.filter((k) => !KEYBOARD.some(([code]) => code === k))];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false); // Shift is held: clicks select instead of toggling
  const anchor = useRef<string | null>(null); // the last key clicked: where a Shift-click range starts

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setSelecting(e.shiftKey);
      if (e.type === "keydown" && e.key === "Escape") setSelected(new Set());
    };
    const onBlur = () => setSelecting(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const setAllowed = (keys: string[], allow: boolean) => {
    const next = allow ? [...new Set([...state.allowedKeys, ...keys])] : state.allowedKeys.filter((k) => !keys.includes(k));
    run("set_allowed_keys", { keys: next });
  };
  const select = (e: React.MouseEvent, key: string) => {
    if (e.shiftKey && anchor.current) {
      const from = order.indexOf(anchor.current);
      const to = order.indexOf(key);
      const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
      return setSelected(new Set([...(e.ctrlKey || e.metaKey ? selected : []), ...range]));
    }
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
    anchor.current = key;
  };
  const withModifier = (e: React.MouseEvent) => e.shiftKey || e.ctrlKey || e.metaKey;
  // Selecting happens on mouse down: a Ctrl-click on a Mac sends a click and a right-click in some webviews and only
  // a right-click in others, but always exactly one mouse down.
  const onMouseDown = (e: React.MouseEvent, key: string) => {
    if (!withModifier(e) || (e.button === 2 && !e.ctrlKey)) return;
    e.preventDefault();
    select(e, key);
  };
  const onClick = (e: React.MouseEvent, key: string) => {
    if (withModifier(e)) {
      if (e.detail === 0) select(e, key); // Shift+Enter or Shift+Space from the keyboard: no mouse down came first
      return;
    }
    anchor.current = key;
    setSelected(new Set());
    setAllowed([key], !allowed.has(key));
  };
  const apply = (allow: boolean) => {
    setAllowed([...selected], allow);
    setSelected(new Set());
  };

  return (
    <Section
      id="keys"
      label="Keys"
      icon="commands"
      hue="indigo"
      title="Allowed keys on this PC"
      description="The server can only press the keys lit up here. Click a key to allow or block it. Key combinations like Ctrl+E are allowed one by one under Commands."
      summary={`${state.allowedKeys.length} of ${state.allKeys.length} keys allowed`}
    >
      <div className={`keys ${selecting ? "selecting" : ""}`}>
        {order.map((key, i) => {
          // Keys not on the drawn keyboard fill the rows after it, eleven to a row.
          const extra = i - placed.length;
          const place = placed.find(([code]) => code === key) ?? [key, 6 + Math.floor(extra / 11), 1 + (extra % 11) * 2, 2];
          return (
            <button
              key={key}
              className={`keycap ${allowed.has(key) ? "on" : ""} ${selected.has(key) ? "selected" : ""}`}
              style={{ gridRow: place[1], gridColumn: `${place[2]} / span ${place[3]}` }}
              aria-pressed={allowed.has(key)}
              aria-label={`${keyLabel(key)}${selected.has(key) ? ", selected" : ""}`}
              title={keyLabel(key)}
              onMouseDown={(e) => onMouseDown(e, key)}
              onClick={(e) => onClick(e, key)}
              // macOS also sends a Ctrl-click as a right-click; it already selected on mouse down, so just skip the menu.
              onContextMenu={(e) => e.preventDefault()}
            >
              {CAP_NAMES[key] ?? keyLabel(key)}
            </button>
          );
        })}
      </div>
      <p className="muted small keys-legend">
        <span className="legend-cap on" aria-hidden="true" /> Allowed
        <span className="legend-cap" aria-hidden="true" /> Blocked
        <span className="spacer" />
        Shift-click selects a range, Ctrl-click (⌘ on a Mac) single keys.
      </p>
      {selected.size > 0 && (
        <div className="selection-bar" role="status">
          <span>
            {selected.size} key{selected.size === 1 ? "" : "s"} selected
          </span>
          <span className="spacer" />
          <button className="btn btn-sm btn-primary" onClick={() => apply(true)}>
            Allow
          </button>
          <button className="btn btn-sm" onClick={() => apply(false)}>
            Block
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}
    </Section>
  );
}

// The dashboard's commands for the active profile, and whether this PC will press each one. Single keys follow the
// allowed-keys grid; each key combination needs its own OK here, which the server can't give. Only what needs a look
// or a decision gets a row: commands that will just press their key are chips, and ones off on the dashboard a line.
function Commands({ state, run }: { state: Snapshot; run: Run }) {
  if (state.commands.length === 0) return null;
  const rows = state.commands.filter((c) => c.enabled && (c.problem || c.combo));
  const ready = state.commands.filter((c) => c.enabled && !c.problem && !c.combo);
  const off = state.commands.filter((c) => !c.enabled);
  return (
    <Section
      id="commands"
      label="Commands"
      icon="chat"
      hue="violet"
      title={`Commands${state.profileName ? ` for ${state.profileName}` : ""}`}
      description="What chat can trigger, from your dashboard. Key combinations are only pressed once you allow them here, so a change on the dashboard can't add one without your OK."
      summary={`${state.commands.length} ${state.commands.length === 1 ? "command" : "commands"}`}
      badge={state.pendingApprovals > 0 ? `${state.pendingApprovals} need${state.pendingApprovals === 1 ? "s" : ""} your OK` : undefined}
    >
      {rows.length > 0 && (
        <ul className="command-list">
          {rows.map((c) => (
            <li key={c.keyword}>
              <strong className="command-word">{c.keyword}</strong>
              <CommandKeys label={c.label} />
              <span className="command-status">
                {c.problem ? (
                  <span className="tag red" title={c.problem}>
                    {c.problem}
                  </span>
                ) : (
                  <label className="approve">
                    <span className={`small ${c.approved ? "" : "muted"}`}>{c.approved ? "Allowed" : "Needs your OK"}</span>
                    <span className="switch">
                      <input
                        type="checkbox"
                        checked={c.approved}
                        aria-label={`Allow ${c.label} for ${c.keyword}`}
                        onChange={(e) => run("set_combo_approved", { key: c.key, approved: e.target.checked })}
                      />
                    </span>
                  </label>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {ready.length > 0 && (
        <div className="command-group">
          <h3 className="command-group-title">
            <span className="dot" aria-hidden="true" />
            Ready to press <span className="muted">({ready.length})</span>
          </h3>
          <ul className="command-chips">
            {ready.map((c) => (
              <li key={c.keyword} className="command-chip">
                <span className="command-word">{c.keyword}</span>
                <CommandKeys label={c.label} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {off.length > 0 && (
        <p className="command-off muted small">
          Off on the dashboard: {off.map((c) => c.keyword).join(", ")}
        </p>
      )}
    </Section>
  );
}

// Keyboard and mouse input recorded here and kept on this PC. The dashboard can only ask for one by name.
function Macros({ state, run }: { state: Snapshot; run: Run }) {
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const replaces = state.macros.some((m) => m.name === name.trim());
  return (
    <Section
      id="macros"
      label="Macros"
      icon="record"
      hue="indigo"
      title="Macros"
      description="Record keys, clicks and mouse movement in your game, up to a minute, then run them from a command on the dashboard. They stay on this PC, and stop if the game loses focus or you pause."
      summary={state.macros.length === 0 ? "None yet" : `${state.macros.length} ${state.macros.length === 1 ? "macro" : "macros"}`}
    >
      {!state.macrosSupported ? (
        <p className="notice warning">Recording and playing macros only works on Windows so far.</p>
      ) : state.recording ? (
        <div className="notice recording" role="status">
          <p>
            <strong>{state.recording}: </strong>
            {state.recordingStarted ? `Recording. Press ${state.stopRecordingHotkey} when you're done.` : "Starting in 3 seconds. Click into your game now."}
          </p>
          <button className="btn btn-sm" onClick={() => run("cancel_recording")}>
            Cancel
          </button>
        </div>
      ) : (
        <form
          className="row macro-form"
          onSubmit={(e) => {
            e.preventDefault();
            run("start_recording", { name }).then(() => setName(""));
          }}
        >
          <input className="input" value={name} maxLength={64} required placeholder="Macro name, like spin" aria-label="Macro name" onChange={(e) => setName(e.target.value.replace(CONTROL_CHARS, ""))} />
          <button className="btn btn-primary" disabled={!state.targetProcess} title={state.targetProcess ? undefined : "Pick your game first: only input in the game is recorded"}>
            {replaces ? "Record over it" : "Record"}
          </button>
        </form>
      )}
      {state.macros.length > 0 && (
        <ul className="macro-list">
          {state.macros.map((m) => (
            <li key={m.name}>
              <strong className="command-word">{m.name}</strong>
              <span className="muted small">
                {(m.lengthMs / 1000).toFixed(1)} s, {m.steps.toLocaleString()} steps
              </span>
              <span className="macro-buttons">
                <button className="btn btn-sm" title="Plays in 3 seconds, so you can click into your game" onClick={() => run("try_macro", { name: m.name })}>
                  Try
                </button>
                {deleting === m.name ? (
                  <button className="btn btn-sm btn-danger" onClick={() => run("delete_macro", { name: m.name }).then(() => setDeleting(null))}>
                    Delete it
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(m.name)}>
                    Delete
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {state.macrosSupported && <p className="muted small">Some online games treat recorded input as cheating. Check the game's rules first.</p>}
    </Section>
  );
}

// Commands Hyperion sends straight into Minecraft (Java over RCON, Bedrock over /connect), set up and kept here. The
// dashboard can only ask for one by name, and a viewer's name only fills a blank in a command written here.
type Draft = GameAction & { editing: string | null };
// Step-by-step setup for both editions, with sample commands.
const MINECRAFT_GUIDE = "https://github.com/dawitmek/Hyperion/blob/main/docs/MINECRAFT.md";

function GameActions({ state, run }: { state: Snapshot; run: Run }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pack, setPack] = useState<"import" | "export" | null>(null);
  const [imported, setImported] = useState<string[] | null>(null);
  // Selecting several actions to share or delete at once. Null when not selecting.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [shareNames, setShareNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!imported) return;
    const timer = setTimeout(() => setImported(null), 6000);
    return () => clearTimeout(timer);
  }, [imported]);
  const actions = state.gameActions;
  const ready: Record<Game, boolean> = { minecraftJava: state.minecraftJava?.hasPassword ?? false, minecraftBedrock: state.minecraftBedrock.connected };
  const notReady: Record<Game, string> = { minecraftJava: "Set up Minecraft Java first", minecraftBedrock: "Connect Minecraft Bedrock first" };
  const firstGame: Game = state.minecraftBedrock.on && !state.minecraftJava ? "minecraftBedrock" : "minecraftJava";
  const editor = (d: Draft) => <ActionEditor key={d.editing ?? ""} draft={d} setDraft={setDraft} run={run} ready={ready} />;
  const toggle = (name: string) =>
    setSelected((set) => {
      const next = new Set(set);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  const share = (names: string[] | null) => (setShareNames(names), setPack("export"));

  return (
    <Section
      id="game-actions"
      label="Game actions"
      icon="cube"
      hue="green"
      title="Game actions"
      description={
        <>
          Commands sent straight into Minecraft when chat or a gift asks for them, like summoning a creeper. They're kept on
          this PC and stop if you pause.{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), void openUrl(MINECRAFT_GUIDE))}>
            Setup guide
          </a>
        </>
      }
      summary={actions.length === 0 ? "None yet" : `${actions.length} ${actions.length === 1 ? "action" : "actions"}`}
    >
      <Connections state={state} run={run} />
      {actions.length === 0 && !draft && (
        <p className="empty">No actions yet. Make one, or import a starter pack, then pick it for a command on the dashboard.</p>
      )}
      {imported && (
        <p className="notice info small" role="status">
          Imported {imported.length === 1 ? imported[0] : `${imported.length} game actions`}. Pick {imported.length === 1 ? "it" : "them"} for a
          command on the dashboard's Commands page.
        </p>
      )}
      {actions.length > 0 &&
        (selected ? (
          <SelectionBar
            actions={actions}
            selected={selected}
            setSelected={setSelected}
            onShare={() => share([...selected])}
            onDelete={() => run("delete_game_actions", { names: [...selected] }).then((ok) => ok && setSelected(null))}
          />
        ) : (
          <div className="actions-bar">
            <span className="muted small">
              {actions.length} {actions.length === 1 ? "action" : "actions"}
            </span>
            <button className="btn btn-ghost btn-sm" disabled={actions.length < 2 || draft !== null} onClick={() => setSelected(new Set())}>
              <Icon name="check" size={14} />
              Select
            </button>
          </div>
        ))}
      {actions.length > 0 && (
        <ul className={`actions ${selected ? "selecting" : ""}`}>
          {actions.map((a) => {
            if (draft?.editing === a.name) return <li key={a.name}>{editor(draft)}</li>;
            const picked = selected?.has(a.name) ?? false;
            const body = (
              <>
                <div className="action-head">
                  {selected && <input type="checkbox" className="check" checked={picked} onChange={() => toggle(a.name)} aria-label={`Select ${a.name}`} />}
                  <GameBadge game={a.game} />
                  <div className="action-title">
                    <strong className="action-name">{a.name}</strong>
                    <span className="action-meta">
                      {GAME_NAMES[a.game]}
                      {a.repeat > 1 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <Icon name="repeat" size={12} />
                          {a.repeat} times{a.delayMs > 0 ? `, ${a.delayMs / 1000} s apart` : ""}
                        </>
                      )}
                    </span>
                  </div>
                  {!selected && (
                    <>
                      <TryButton disabled={!ready[a.game]} title={ready[a.game] ? "Runs it now, as a viewer called Tester" : notReady[a.game]} onTry={() => run("try_game_action", { name: a.name })} />
                      <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Edit ${a.name}`} title="Edit" onClick={() => setDraft({ ...a, editing: a.name })}>
                        <Icon name="edit" size={15} />
                      </button>
                    </>
                  )}
                </div>
                <ol className="action-lines">
                  {a.commands.slice(0, 3).map((c, i) => (
                    <li key={i}>
                      <CommandLine text={c} />
                    </li>
                  ))}
                  {a.commands.length > 3 && <li className="more">and {a.commands.length - 3} more</li>}
                </ol>
              </>
            );
            return (
              <li key={a.name} className={`action ${GAME_HUES[a.game]} ${picked ? "picked" : ""}`}>
                {/* While selecting, the whole card ticks its box. */}
                {selected ? <label className="action-select">{body}</label> : body}
              </li>
            );
          })}
        </ul>
      )}
      {selected ? null : draft && draft.editing === null ? (
        editor(draft)
      ) : (
        <div className="action-buttons">
          <button className="btn new-action" onClick={() => setDraft({ editing: null, name: "", game: firstGame, commands: [], repeat: 1, delayMs: 0 })}>
            <Icon name="plus" size={15} />
            New game action
          </button>
          <button className="btn" onClick={() => setPack("import")}>
            <Icon name="import" size={15} />
            Import
          </button>
          <button className="btn" disabled={actions.length === 0} title={actions.length === 0 ? "Make or import an action first" : undefined} onClick={() => share(null)}>
            <Icon name="share" size={15} />
            Share
          </button>
        </div>
      )}
      {pack === "import" && <ImportPack onClose={() => setPack(null)} onImported={setImported} />}
      {pack === "export" && <ExportPack actions={actions} initial={shareNames} onClose={() => setPack(null)} />}
    </Section>
  );
}

// Selecting game actions: how many are picked, all or none, and what to do with them. Deleting asks once more here,
// in place of the button.
function SelectionBar({
  actions,
  selected,
  setSelected,
  onShare,
  onDelete,
}: {
  actions: GameAction[];
  selected: Set<string>;
  setSelected: (s: Set<string> | null) => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const count = selected.size;
  const all = count === actions.length;
  const label = `${count} ${count === 1 ? "action" : "actions"}`;
  useEffect(() => setConfirming(false), [count]);
  return (
    <div className="selection-bar actions-select-bar" role="toolbar" aria-label="Selected game actions">
      <input
        type="checkbox"
        className="check"
        aria-label={all ? "Select none" : "Select all"}
        checked={all}
        ref={(el) => void (el && (el.indeterminate = count > 0 && !all))}
        onChange={() => setSelected(all ? new Set() : new Set(actions.map((a) => a.name)))}
      />
      <span>{count === 0 ? "Pick actions" : `${count} selected`}</span>
      <span className="spacer" />
      {confirming ? (
        <>
          <button className="btn btn-sm btn-danger" onClick={onDelete}>
            Delete {label}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </>
      ) : (
        <>
          <button className="btn btn-sm" disabled={count === 0} onClick={onShare}>
            <Icon name="share" size={14} />
            Share
          </button>
          <button className="btn btn-sm btn-ghost danger-text" disabled={count === 0} onClick={() => setConfirming(true)}>
            <Icon name="trash" size={14} />
            Delete
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected(null)}>
            Done
          </button>
        </>
      )}
    </div>
  );
}

// Says "Sent" for a moment, since what happened shows in the game and the activity list rather than here.
function TryButton({ disabled, title, onTry }: { disabled: boolean; title: string; onTry: () => Promise<boolean> }) {
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(() => setSent(false), 1500);
    return () => clearTimeout(timer);
  }, [sent]);
  return (
    <button className="btn btn-sm try" disabled={disabled} title={title} onClick={() => onTry().then((ok) => ok && setSent(true))}>
      <Icon name={sent ? "check" : "play"} size={13} />
      {sent ? "Sent" : "Try"}
    </button>
  );
}

const BLANK_HINTS: { blank: string; hint: string }[] = [
  { blank: "viewer", hint: "who sent it" },
  { blank: "count", hint: "how many gifts" },
  { blank: "player", hint: "you" },
];


// Where actions go: a tile for each game, with what it needs below when it isn't ready.
function Connections({ state, run }: { state: Snapshot; run: Run }) {
  const java = state.minecraftJava;
  const bedrock = state.minecraftBedrock;
  const [javaOpen, setJavaOpen] = useState(false);
  // `asked`: the host pressed Test, so the answer is shown in full. Otherwise the tile alone shows it.
  const [test, setTest] = useState<{ ok: boolean; text: string; asked: boolean } | null>(null);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const connect = `/connect 127.0.0.1:${bedrock.port}`;

  const check = (asked: boolean) => {
    setTesting(true);
    setTest(null);
    invoke<string>("test_minecraft")
      .then((online) => setTest({ ok: true, text: online, asked }))
      .catch((e) => setTest({ ok: false, text: String(e), asked }))
      .finally(() => setTesting(false));
  };
  // Checked on opening and after the settings change, so the tile says whether Minecraft is there.
  const javaKey = java?.hasPassword ? `${java.host}:${java.port}:${java.player}` : null;
  useEffect(() => {
    if (javaKey) check(false);
  }, [javaKey]);
  const copy = () =>
    navigator.clipboard.writeText(connect).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  const javaState = !java?.hasPassword
    ? { hue: "off", text: "Not set up" }
    : testing
      ? { hue: "indigo", text: "Testing…" }
      : test
        ? test.ok
          ? { hue: "green", text: "Connected" }
          : { hue: "red", text: "Can't connect" }
        : { hue: "indigo", text: "Not checked" };
  const bedrockState = !bedrock.on
    ? { hue: "off", text: "Off" }
    : bedrock.problem
      ? { hue: "red", text: "Can't listen" }
      : bedrock.connected
        ? { hue: "green", text: "Connected" }
        : { hue: "amber", text: "Waiting" };

  return (
    <div className="stack">
      <div className="links">
        <div className={`link ${javaState.hue}`}>
          <span className="link-head">
            <span className="link-dot" aria-hidden="true" />
            Minecraft Java
          </span>
          <strong className="link-state" role="status">
            {javaState.text}
          </strong>
          {test && !test.ok ? (
            <span className="small link-detail link-problem" title={test.text}>
              {test.text}
            </span>
          ) : (
            <span className="muted small link-detail">
              {java?.hasPassword ? `${java.host}:${java.port}${java.player ? `, as ${java.player}` : ""}` : "Through your server's RCON"}
            </span>
          )}
          <span className="link-actions">
            {java?.hasPassword && (
              <button className="btn btn-sm" disabled={testing} onClick={() => check(true)}>
                {test ? "Test again" : "Test"}
              </button>
            )}
            <button className={`btn btn-sm ${java?.hasPassword ? "btn-ghost" : ""}`} aria-expanded={javaOpen} onClick={() => setJavaOpen(!javaOpen)}>
              {java ? "Change" : "Set up"}
            </button>
          </span>
        </div>
        <div className={`link ${bedrockState.hue}`}>
          <span className="link-head">
            <span className="link-dot" aria-hidden="true" />
            Minecraft Bedrock
          </span>
          <strong className="link-state" role="status">
            {bedrockState.text}
          </strong>
          <span className="muted small link-detail">{bedrock.connected ? "Your world is connected" : bedrock.on ? "For your world to connect" : "Your world connects to this PC"}</span>
          <span className="link-actions">
            <button className={`btn btn-sm ${bedrock.on ? "btn-ghost" : ""}`} onClick={() => run("set_bedrock", { on: !bedrock.on })}>
              {bedrock.on ? "Turn off" : "Turn on"}
            </button>
          </span>
        </div>
      </div>
      {test?.asked && (
        <p className={`notice ${test.ok ? "info" : "error"}`} role="status">
          {test.ok ? `Minecraft Java answered: ${test.text}` : test.text}
        </p>
      )}
      {javaOpen && <JavaForm state={state} run={run} onDone={() => setJavaOpen(false)} />}
      {bedrock.on && bedrock.problem && (
        <p className="notice error" role="status">
          {bedrock.problem}. Another program may be using that port.
        </p>
      )}
      {bedrock.on && !bedrock.problem && !bedrock.connected && (
        <div className="link-guide">
          <strong className="small">Connect Bedrock</strong>
          <ol className="pair-steps">
            <li>
              <span>
                In Settings, under General, turn off <strong>Require Encrypted Websockets</strong>
              </span>
            </li>
            <li>
              <span>
                Open a world with <strong>Allow cheats</strong> on
              </span>
            </li>
            <li>
              <span className="connect-line">
                Type <code>{connect}</code> in chat
                <button className="btn btn-ghost btn-sm" onClick={copy}>
                  <Icon name={copied ? "check" : "copy"} size={14} />
                  {copied ? "Copied" : "Copy"}
                </button>
              </span>
            </li>
          </ol>
          <p className="muted small">Type it again whenever you reopen the world.</p>
        </div>
      )}
    </div>
  );
}

// Where the Minecraft Java server is. Game actions use its RCON, which only servers have, so the host plays on one.
function JavaForm({ state, run, onDone }: { state: Snapshot; run: Run; onDone: () => void }) {
  const saved = state.minecraftJava;
  const [host, setHost] = useState(saved?.host ?? "localhost");
  const [port, setPort] = useState(saved?.port ?? state.minecraftDefaultPort);
  const [password, setPassword] = useState("");
  const [player, setPlayer] = useState(saved?.player ?? "");
  return (
    <form
      className="stack link-guide"
      onSubmit={(e) => {
        e.preventDefault();
        run("set_minecraft", { host, port, password: password || null, player }).then((ok) => ok && onDone());
      }}
    >
      <p className="muted small">
        Java game actions go through RCON, which Minecraft servers have and singleplayer doesn't, so play on a server, on this
        PC or hosted. In its <code>server.properties</code> set <code>enable-rcon=true</code>, an <code>rcon.password</code>{" "}
        and <code>rcon.port</code>, then restart it.
      </p>
      <div className="pair-fields">
        <label className="field">
          Server address
          <input value={host} required maxLength={253} onChange={(e) => setHost(e.target.value.replace(/\s/g, ""))} />
        </label>
        <label className="field">
          RCON port
          <input type="number" min={1} max={65535} value={port} required onChange={(e) => setPort(Number(e.target.value))} />
        </label>
        <label className="field">
          RCON password
          <input
            type="password"
            value={password}
            autoComplete="off"
            required={!saved?.hasPassword}
            placeholder={saved?.hasPassword ? "Saved. Type to change it" : ""}
            maxLength={128}
            onChange={(e) => setPassword(e.target.value.replace(CONTROL_CHARS, ""))}
          />
        </label>
        <label className="field">
          Your Minecraft name
          <input value={player} maxLength={16} placeholder="For {player}" onChange={(e) => setPlayer(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} />
        </label>
      </div>
      <div className="row">
        <button className="btn btn-primary">Save</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ActionEditor({ draft, setDraft, run, ready }: { draft: Draft; setDraft: (d: Draft | null) => void; run: Run; ready: Record<Game, boolean> }) {
  const [commands, setCommands] = useState(draft.commands.join("\n"));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const { editing, ...action } = draft;
  const java = draft.game === "minecraftJava";

  // Puts a blank where the cursor is, and the cursor after it.
  const insert = (blank: string) => {
    const el = box.current;
    if (!el) return;
    const text = `{${blank}}`;
    const at = el.selectionStart;
    setCommands(commands.slice(0, at) + text + commands.slice(el.selectionEnd));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at + text.length, at + text.length);
    });
  };

  return (
    <form
      className="stack action-editor"
      aria-label={editing ? `Edit ${editing}` : "New game action"}
      onSubmit={(e) => {
        e.preventDefault();
        setSaving(true);
        // A refused action keeps the editor open, with the reason shown at the top.
        run("save_game_action", { action: { ...action, commands: commands.split("\n") }, editing })
          .then((saved) => saved && setDraft(null))
          .finally(() => setSaving(false));
      }}
    >
      <h3 className="editor-title">{editing ? `Edit ${editing}` : "New game action"}</h3>
      <label className="field">
        Name
        <input value={draft.name} maxLength={64} required placeholder="creeper" autoFocus={!editing} onChange={(e) => setDraft({ ...draft, name: e.target.value.replace(CONTROL_CHARS, "") })} />
      </label>
      <div className="field">
        <span id="game-choice">Game</span>
        <div className="game-choices" role="radiogroup" aria-labelledby="game-choice">
          {(Object.keys(GAME_NAMES) as Game[]).map((g) => (
            <button key={g} type="button" role="radio" aria-checked={draft.game === g} className={`game-choice ${GAME_HUES[g]}`} onClick={() => setDraft({ ...draft, game: g })}>
              <GameBadge game={g} size={30} />
              <span className="game-choice-text">
                <strong>{GAME_NAMES[g]}</strong>
                <span className={ready[g] ? "ready" : ""}>{ready[g] ? "Connected" : g === "minecraftJava" ? "Not set up yet" : "Not connected"}</span>
              </span>
              <span className="game-choice-mark" aria-hidden="true">
                <Icon name="check" size={13} strokeWidth={3} />
              </span>
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Commands, one per line
        <textarea
          ref={box}
          rows={4}
          value={commands}
          spellCheck={false}
          placeholder={java ? "execute at {player} run summon creeper ~ ~ ~\nsay {viewer} sent a creeper!" : "summon creeper ~ ~ ~\nsay {viewer} sent a creeper!"}
          maxLength={20_020} // 20 commands of up to 1,000 characters; the app checks each
          onChange={(e) => setCommands(e.target.value)}
        />
      </label>
      <div className="blank-bar">
        {BLANK_HINTS.map(({ blank, hint }) => (
          <button key={blank} type="button" className="blank-add" title={`Add {${blank}} where the cursor is`} onClick={() => insert(blank)}>
            <span className={`blank ${blank}`}>{blank}</span>
            {hint}
          </button>
        ))}
      </div>
      <p className="hint">
        {java ? (
          <>
            Commands run as the server, so use <code>execute at {"{player}"} run …</code> for anything near you.
          </>
        ) : (
          <>
            Commands run as you, so <code>~ ~ ~</code> is where you stand.
          </>
        )}
      </p>
      <div className="repeat-row">
        <Icon name="repeat" size={15} />
        Run it
        <input
          className="input"
          type="number"
          min={1}
          max={100}
          aria-label="Times to run it"
          value={draft.repeat}
          onChange={(e) => setDraft({ ...draft, repeat: Number(e.target.value) })}
        />
        {draft.repeat === 1 ? "time" : "times"}
        {draft.repeat > 1 && (
          <>
            ,
            <input
              className="input"
              type="number"
              min={0}
              max={10}
              step={0.1}
              aria-label="Seconds between each time"
              value={draft.delayMs / 1000}
              onChange={(e) => setDraft({ ...draft, delayMs: Math.round(Number(e.target.value) * 1000) })}
            />
            seconds apart
          </>
        )}
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : editing ? "Save changes" : "Save action"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
          Cancel
        </button>
        <span className="spacer" />
        {editing &&
          (deleting ? (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => run("delete_game_actions", { names: [editing] }).then((ok) => ok && setDraft(null))}>
              Delete {editing}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(true)}>
              Delete
            </button>
          ))}
      </div>
    </form>
  );
}

function CommandKeys({ label }: { label: string }) {
  return (
    <span className="command-keys">
      {label.split("+").map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="plus">+</span>}
          <kbd className="kbd">{part}</kbd>
        </span>
      ))}
    </span>
  );
}
