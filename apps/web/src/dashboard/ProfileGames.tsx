import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_PROFILE_GAMES, type ProfileGame, type RunningGame } from '@hyperion/shared';
import { api } from '../api';
import { Icon } from '../icons';
import { cleanTyped, closeOnBackdrop, ErrorNotice, Spinner, useError } from '../ui';

// A program's file name, as the companion lists it: no folders, and none of the characters file names can't have.
const GAME_PROCESS_CHAR = /[^\\/:*?"<>|]/;

// A game's icon, or its first letter when there's no icon.
export function GameIcon({ game, size = 'sm' }: { game: { process: string; icon: string | null }; size?: 'sm' | 'md' }) {
  return (
    <span className={`game-icon ${size}`} aria-hidden="true">
      {game.icon ? <img src={game.icon} alt="" /> : [...game.process][0]?.toUpperCase()}
    </span>
  );
}

// The programs a profile follows. Any of them counts as the game: keys go to it while it's in front.
export function ProfileGames({ games, onChange }: { games: ProfileGame[]; onChange: (games: ProfileGame[]) => void }) {
  const [picking, setPicking] = useState(false);
  // Picking a game that's already there fills in its icon, for one added by name or from a template.
  const add = (game: ProfileGame) => {
    const found = games.find((g) => g.process === game.process);
    if (!found) onChange([...games, game]);
    else if (!found.icon && game.icon) onChange(games.map((g) => (g === found ? game : g)));
  };
  return (
    <div className="profile-games">
      {games.length === 0 ? (
        <span className="muted small">Any game: this PC's own pick</span>
      ) : (
        <ul className="game-chips">
          {games.map((g) => (
            <li key={g.process} className="game-chip">
              <GameIcon game={g} />
              <span className="game-chip-name">{g.process}</span>
              <button type="button" className="game-chip-remove" aria-label={`Remove ${g.process}`} onClick={() => onChange(games.filter((x) => x !== g))}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {games.length < MAX_PROFILE_GAMES && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>
          <Icon name="plus" size={14} />
          Add game
        </button>
      )}
      {picking && <GamePicker added={games} onAdd={add} onClose={() => setPicking(false)} />}
    </div>
  );
}

type Running = { companions: number; answered: number; games: RunningGame[] };

// Picks a game from what's open on the host's PCs, or by typing its program's name.
function GamePicker({ added, onAdd, onClose }: { added: ProfileGame[]; onAdd: (game: ProfileGame) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [running, setRunning] = useState<Running | null>(null);
  const [typed, setTyped] = useState('');
  const { error, guard } = useError();
  const load = () => {
    setRunning(null);
    guard(() => api<Running>('GET', '/profiles/running-games').then(setRunning))();
  };
  useEffect(() => {
    dialog.current?.showModal();
    load();
  }, []);

  const pick = (game: ProfileGame) => {
    onAdd(game);
    dialog.current?.close();
  };
  const addTyped = (e: FormEvent) => {
    e.preventDefault();
    const process = typed.trim().toLowerCase();
    if (process) pick({ process, icon: null });
  };
  const isAdded = (process: string) => added.some((g) => g.process === process);
  // Already there, and nothing to add: an icon is the one thing picking it again can bring.
  const done = (g: RunningGame) => added.some((a) => a.process === g.process && (a.icon || !g.icon));

  return (
    <dialog ref={dialog} className="game-dialog" onClose={onClose} {...closeOnBackdrop()} aria-labelledby="game-dialog-title">
      <div className="pos-head">
        <div>
          <h2 id="game-dialog-title">Add a game</h2>
          <p className="muted small">Keys from chat only go to this profile's games, while one of them is in front.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={load} aria-label="Refresh" title="Refresh">
          <Icon name="refresh" />
        </button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => dialog.current?.close()} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>

      <section className="game-dialog-part">
        <h3 className="game-dialog-sub">Open on your PC</h3>
        <ErrorNotice error={error} />
        {!running ? (
          !error && <Spinner label="Asking the companion" />
        ) : running.companions === 0 ? (
          <p className="muted small">Open the companion on the PC you play on to pick from what's running there.</p>
        ) : running.answered === 0 ? (
          <p className="muted small">Your companion is too old to list what's running. Update it, or type the program's name below.</p>
        ) : running.games.length === 0 ? (
          <p className="muted small">No windows found. Start your game, then refresh.</p>
        ) : (
          <ul className="running-games">
            {running.games.map((g) => (
              <li key={g.process}>
                <button type="button" className="running-game" disabled={done(g)} onClick={() => pick({ process: g.process, icon: g.icon })}>
                  <GameIcon game={g} size="md" />
                  <span className="running-game-text">
                    <strong>{g.title || g.process}</strong>
                    <span className="muted small">{g.process}</span>
                  </span>
                  {isAdded(g.process) && <span className="tag">{done(g) ? 'Added' : 'Add its icon'}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="game-dialog-part" onSubmit={addTyped}>
        <h3 className="game-dialog-sub">Or type its program's name</h3>
        <div className="row">
          <input
            className="input"
            placeholder="e.g. gta5.exe"
            aria-label="Program name"
            value={typed}
            maxLength={64}
            onChange={(e) => setTyped(cleanTyped(e.target.value, GAME_PROCESS_CHAR))}
          />
          <button className="btn btn-primary btn-sm" disabled={!typed.trim() || isAdded(typed.trim().toLowerCase())}>
            Add
          </button>
        </div>
      </form>
    </dialog>
  );
}
