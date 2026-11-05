import { MODES, QUEUE_JOIN, type Mode } from "@hyperion/shared";
import type { Host } from "../api";
import { Icon, type IconName } from "../icons";
import { Link } from "../router";
import { NumberCell, Switch } from "../ui";
import { MODE_INFO } from "./modes";

// Each mode keeps its icon, and its colour (app.css, .mode-is-*), wherever it's picked.
export const MODE_ICONS: Record<Mode, IconName> = {
  anarchy: "flame",
  democracy: "leaderboard",
  queue: "crowd",
  raffle: "ticket",
  gift: "gift",
};

// The modes as a row of tiles, the current one lit in its colour.
export function ModeTiles({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (mode: Mode) => void;
}) {
  return (
    <div className="mode-tiles-box">
      <div className="mode-tiles" role="radiogroup" aria-label="Crowd mode">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            className={`mode-tile mode-is-${m}`}
            onClick={() => onChange(m)}
          >
            <span className="mode-tile-icon">
              <Icon name={MODE_ICONS[m]} size={18} />
            </span>
            {MODE_INFO[m].label}
          </button>
        ))}
      </div>
    </div>
  );
}

const seconds = (ms: number) => `${ms / 1000} s`;

// How a mode plays, in order, with the host's own numbers.
function steps(mode: Mode, host: Host): string[] {
  switch (mode) {
    case "anarchy":
      return [
        "A viewer types a command",
        "It fires straight away",
        `Up to ${host.actionsPerSecond} a second, each viewer waiting out its cooldown`,
      ];
    case "democracy":
      return [
        "The first vote opens a window",
        `Votes count for ${seconds(host.voteWindowMs)}, one per viewer`,
        "The most-voted command fires",
      ];
    case "queue":
      return [
        `Viewers type "${QUEUE_JOIN}" to line up`,
        `Each gets ${seconds(host.turnMs)} at the controls`,
        "Then the next in line takes over",
      ];
    case "raffle":
      return [
        "Typing a command enters the draw",
        `Entries collect for ${seconds(host.raffleMs)}`,
        "One random entry fires, the rest don’t",
      ];
    case "gift":
      return [
        "Comments don’t press anything",
        "A gift runs its action",
        "Like a rose that jumps",
      ];
  }
}

// What a gift boost does in each mode that has one.
const BOOSTS: Partial<Record<Mode, string>> = {
  democracy: "A gift adds votes to the gifter’s vote.",
  queue: "A gift moves the gifter to the front of the line.",
  raffle: "Each gift adds an entry to the gifter’s.",
};

// The current mode in full: how it plays, and only the settings it uses.
export function ModeDetails({
  host,
  onSave,
}: {
  host: Host;
  onSave: (patch: Partial<Host>) => void;
}) {
  const mode = host.mode;
  const boost = BOOSTS[mode];
  return (
    <div className={`mode-details mode-is-${mode}`}>
      <div className="mode-details-head">
        <span className="mode-tile-icon">
          <Icon name={MODE_ICONS[mode]} size={20} />
        </span>
        <div>
          <h3>{MODE_INFO[mode].label}</h3>
          <p className="muted small">{MODE_INFO[mode].help}</p>
        </div>
      </div>
      <ol className="mode-steps">
        {steps(mode, host).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {mode === "democracy" && (
        <label className="field mode-setting">
          Voting window, in seconds
          <NumberCell
            value={host.voteWindowMs / 1000}
            min={1}
            max={30}
            onSave={(s) => onSave({ voteWindowMs: Math.round(s * 1000) })}
          />
        </label>
      )}
      {mode === "queue" && (
        <label className="field mode-setting">
          Turn length, in seconds
          <NumberCell
            value={host.turnMs / 1000}
            min={5}
            max={300}
            onSave={(s) => onSave({ turnMs: Math.round(s * 1000) })}
          />
        </label>
      )}
      {mode === "raffle" && (
        <label className="field mode-setting">
          Draw every, in seconds
          <NumberCell
            value={host.raffleMs / 1000}
            min={2}
            max={300}
            onSave={(s) => onSave({ raffleMs: Math.round(s * 1000) })}
          />
        </label>
      )}
      {boost && (
        <Switch
          checked={host.giftBoosts}
          onChange={(giftBoosts) => onSave({ giftBoosts })}
          hint={boost}
        >
          Gift boosts
        </Switch>
      )}
      {mode === "anarchy" && (
        <p className="muted small">
          Cooldowns are set on each command above. The rate limit is in{" "}
          <Link href="/dashboard/settings">Settings</Link>.
        </p>
      )}
      {mode === "gift" && (
        <p className="muted small">
          Tie gifts to commands on the{" "}
          <Link href="/dashboard/actions">Actions</Link> page.
        </p>
      )}
    </div>
  );
}
