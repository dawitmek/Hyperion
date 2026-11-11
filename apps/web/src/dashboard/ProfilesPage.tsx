import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { GAME_TEMPLATES } from '@hyperion/shared';
import { api, type Profile } from '../api';
import { Icon } from '../icons';
import { Card, cleanTyped, ConfirmButton, ErrorNotice, ProfileBadge, TextCell, useError } from '../ui';
import type { PageProps } from './Dashboard';

// A program's file name, as the companion lists it: no folders, and none of the characters file names can't have.
const GAME_PROCESS_CHAR = /[^\\/:*?"<>|]/;

export function ProfilesPage({ host, refreshHost }: PageProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  const [gameProcess, setGameProcess] = useState('');
  const [template, setTemplate] = useState(''); // '' copies the active profile
  const { error, guard } = useError();
  const load = useCallback(() => api<Profile[]>('GET', '/profiles').then(setProfiles), []);
  useEffect(() => void load(), [load]);

  // refreshHost too, so the header's profile list and name follow.
  const patch = (id: string, body: Partial<Profile>) => guard(() => api('PATCH', `/profiles/${id}`, body).then(load).then(refreshHost))();
  const activate = (id: string) => guard(() => api('POST', `/profiles/${id}/activate`).then(load).then(refreshHost))();
  const remove = (id: string) => guard(() => api('DELETE', `/profiles/${id}`).then(load).then(refreshHost))();
  const add = (e: FormEvent) => {
    e.preventDefault();
    guard(() =>
      api('POST', '/profiles', {
        name,
        gameProcess: gameProcess.trim() || null,
        ...(template && { template }),
      }).then(() => {
        setName('');
        setGameProcess('');
        setTemplate('');
        return load().then(refreshHost);
      }),
    )();
  };

  // Picking a game fills in its name and process, unless they've been typed over.
  const pick = (id: string) => {
    const before = GAME_TEMPLATES.find((t) => t.id === template);
    const game = GAME_TEMPLATES.find((t) => t.id === id);
    if (!name || name === before?.name) setName(game?.name ?? '');
    if (!gameProcess || gameProcess === before?.process) setGameProcess(game?.process ?? '');
    setTemplate(id);
  };

  return (
    <div className="stack">
      <Card
        title="Your profiles"
        description={
          <>
            Each profile has its own commands, key-press actions and crowd mode. Switching applies at once, even while live. If a profile names its game's
            program as the companion lists it (e.g. <code>gta5.exe</code> on Windows or <code>minecraft</code> on macOS), the companion switches to that game
            too.
          </>
        }
      >
        <ErrorNotice error={error} />
        <ul className="profile-cards">
          {profiles.map((p) => (
            <li key={p.id} className={`profile-card ${p.active ? 'active' : ''}`}>
              <div className="profile-card-head">
                <ProfileBadge name={p.name} size="lg" />
                <div className="profile-card-name">
                  <TextCell value={p.name} required maxLength={48} onSave={(v) => patch(p.id, { name: v })} label="Profile name" />
                </div>
                {p.active && <span className="tag teal">Active</span>}
              </div>
              <label className="profile-card-field">
                <span className="muted small">Game program</span>
                <TextCell
                  value={p.gameProcess ?? ''}
                  placeholder="Any game"
                  maxLength={64}
                  allowed={GAME_PROCESS_CHAR}
                  onSave={(v) => patch(p.id, { gameProcess: v || null })}
                  label="Game program"
                />
              </label>
              <div className="profile-card-foot">
                {p.active ? (
                  <span className="muted small">In use now. Switch to another profile to delete this one.</span>
                ) : (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => activate(p.id)}>
                      Switch to
                    </button>
                    <ConfirmButton
                      className="btn btn-ghost btn-sm btn-delete"
                      message={`Delete ${p.name}, with its commands, actions and crowd mode?`}
                      confirmLabel="Delete"
                      onConfirm={() => remove(p.id)}
                    >
                      Delete
                    </ConfirmButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        className="card-new"
        icon={
          <span className="card-new-badge" aria-hidden="true">
            <Icon name="plus" size={18} />
          </span>
        }
        title="New profile"
        description="Start from a copy of the profile you're using, or from a game's usual keyboard controls."
      >
        <form className="stack" onSubmit={add}>
          <div className="profile-starts" role="radiogroup" aria-label="Start from">
            <button type="button" role="radio" aria-checked={template === ''} className="profile-start" onClick={() => pick('')}>
              <span className="profile-start-copy" aria-hidden="true">
                <Icon name="profiles" size={18} />
              </span>
              <span className="profile-start-text">
                <strong>A copy of {host.profileName}</strong>
                <span className="muted small">Its commands, actions and mode</span>
              </span>
            </button>
            {GAME_TEMPLATES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={template === t.id} className="profile-start" onClick={() => pick(t.id)}>
                <ProfileBadge name={t.name} />
                <span className="profile-start-text">
                  <strong>{t.name}</strong>
                  <span className="muted small">{t.commands.length} commands, ready to go</span>
                </span>
              </button>
            ))}
          </div>
          <div className="form-grid">
            <label className="field">
              Name
              <input
                className="input"
                placeholder="New profile name"
                value={name}
                onChange={(e) => setName(cleanTyped(e.target.value))}
                required
                maxLength={48}
              />
            </label>
            <label className="field">
              Game program
              <span className="hint">Optional. The companion switches to it with this profile.</span>
              <input
                className="input"
                placeholder="e.g. gta5.exe"
                value={gameProcess}
                maxLength={64}
                onChange={(e) => setGameProcess(cleanTyped(e.target.value, GAME_PROCESS_CHAR))}
              />
            </label>
          </div>
          <div className="row">
            <button className="btn btn-primary">
              <Icon name="plus" size={16} />
              Add profile
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
