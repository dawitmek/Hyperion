import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { GAME_TEMPLATES, type ProfileGame } from '@hyperion/shared';
import { GAME_TEMPLATE_ICONS } from '@hyperion/shared/game-icons';
import { api, type Profile } from '../api';
import { Icon } from '../icons';
import { Card, cleanTyped, ConfirmButton, ErrorNotice, ProfileBadge, TextCell, useError } from '../ui';
import type { PageProps } from './Dashboard';
import { ProfileGames } from './ProfileGames';

const templateGames = (id: string): ProfileGame[] => GAME_TEMPLATES.find((t) => t.id === id)?.processes.map((process) => ({ process, icon: GAME_TEMPLATE_ICONS[id] ?? null })) ?? [];
const sameGames = (a: ProfileGame[], b: ProfileGame[]) => a.length === b.length && a.every((g, i) => g.process === b[i]!.process);

export function ProfilesPage({ host, refreshHost }: PageProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  const [games, setGames] = useState<ProfileGame[]>([]);
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
        games,
        ...(template && { template }),
      }).then(() => {
        setName('');
        setGames([]);
        setTemplate('');
        return load().then(refreshHost);
      }),
    )();
  };

  // Picking a game fills in its name and programs, unless they've been changed by hand.
  const pick = (id: string) => {
    const before = GAME_TEMPLATES.find((t) => t.id === template);
    const game = GAME_TEMPLATES.find((t) => t.id === id);
    if (!name || name === before?.name) setName(game?.name ?? '');
    if (games.length === 0 || sameGames(games, templateGames(template))) setGames(templateGames(id));
    setTemplate(id);
  };

  return (
    <div className="stack">
      <Card
        badge="profiles"
        hue="indigo"
        title="Your profiles"
        description={
          <>
            Each profile has its own commands, key-press actions and crowd mode. Switching applies at once, even while live. A profile's games are the
            programs keys may go to: pick them from what's open on your PC, and the companion switches to them with the profile. Any of them counts, so one
            profile can cover Minecraft Java and Bedrock.
          </>
        }
      >
        <ErrorNotice error={error} />
        <ul className="profile-cards">
          {profiles.map((p) => (
            <li key={p.id} className={`profile-card ${p.active ? 'active' : ''}`}>
              <div className="profile-card-head">
                <ProfileBadge name={p.name} size="lg" games={p.games} />
                <div className="profile-card-name">
                  <TextCell value={p.name} required maxLength={48} onSave={(v) => patch(p.id, { name: v })} label="Profile name" />
                </div>
                {p.active && <span className="tag teal">Active</span>}
              </div>
              <div className="profile-card-field">
                <span className="muted small">Games</span>
                <ProfileGames games={p.games} onChange={(games) => patch(p.id, { games })} />
              </div>
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
        badge="plus"
        hue="teal"
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
                <ProfileBadge name={t.name} games={[{ icon: GAME_TEMPLATE_ICONS[t.id] ?? null }]} />
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
            <div className="field">
              Games
              <span className="hint">Optional. The companion switches to them with this profile.</span>
              <ProfileGames games={games} onChange={setGames} />
            </div>
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
