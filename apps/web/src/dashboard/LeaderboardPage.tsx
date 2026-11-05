import { useCallback, useContext, useEffect, useState } from 'react';
import { levelForXp, MAX_LEVEL, POINTS_CHECK, xpForLevel } from '@hyperion/shared';
import { api, type Host, type LeaderboardEntry } from '../api';
import { Card, ConfirmButton, ErrorNotice, NumberCell, Seg, Switch, useError, ViewerAvatar } from '../ui';
import type { PageProps } from './Dashboard';
import { ViewerContext, ViewerLink } from './ViewerPanel';

export function LeaderboardPage({ host, refreshHost, feed }: PageProps) {
  return (
    <div className="stack">
      <LeaderboardCard host={host} live={feed.leaderboard} />
      <PointsCard host={host} refreshHost={refreshHost} />
      <ProgressionCard host={host} refreshHost={refreshHost} />
    </div>
  );
}

function LeaderboardCard({ host, live }: { host: Host; live: LeaderboardEntry[] | null }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const { error, guard } = useError();
  const load = useCallback(() => api<LeaderboardEntry[]>('GET', '/leaderboard').then(setEntries), []);
  useEffect(() => void load(), [load]);
  // The live feed only carries the top few, so take it as a cue to reload the full list.
  useEffect(() => {
    if (live) void load();
  }, [live, load]);

  return (
    <Card
      title="Leaderboard"
      description={`${host.tiktokUsername ? `For @${host.tiktokUsername.replace(/^@/, '')}. Each TikTok account you set has its own leaderboard and points. ` : ''}Your most active viewers, ranked by XP. Updates every few seconds.`}
      actions={
        <ConfirmButton
          className="btn btn-ghost"
          message="Reset the leaderboard? Viewers keep their points. This cannot be undone."
          confirmLabel="Reset"
          onConfirm={guard(() => api('DELETE', '/leaderboard').then(load))}
        >
          Reset
        </ConfirmButton>
      }
    >
      <ErrorNotice error={error} />
      <XpExplainer />
      {entries.length === 0 ? (
        <p className="empty">No activity yet. Viewers appear here once they press a key or send a gift.</p>
      ) : (
        <Ranking host={host} entries={entries} />
      )}
    </Card>
  );
}

// A short, closed-by-default explanation of what earns XP and how it turns into levels.
function XpExplainer() {
  return (
    <details className="xp-explainer">
      <summary>How XP works</summary>
      <ul>
        <li>
          <strong>Commands:</strong> 1 XP each time a viewer's command presses a key. In Democracy, everyone who voted for the winning command gets it.
        </li>
        <li>
          <strong>Gifts:</strong> 1 XP per coin. 10 Roses (1 coin each) are 10 XP; 10 Galaxies (200 coins each) are 2,000 XP. Gifts counts how many were sent; Coins is what they were worth.
        </li>
        <li>
          <strong>Nothing else earns XP.</strong> Chat, likes, follows and shares can earn points (below), but not XP. XP never goes down.
        </li>
        <li>
          <strong>Levels:</strong> level 2 at {xpForLevel(2)} XP, 3 at {xpForLevel(3)}, 5 at {xpForLevel(5)}, 10 at {xpForLevel(10).toLocaleString()}. Each level takes more than the last, up to {MAX_LEVEL}.
        </li>
      </ul>
    </details>
  );
}

type SortKey = 'xp' | 'commands' | 'gifts' | 'coins' | 'points';
const SORT_LABELS: Record<SortKey, string> = { xp: 'XP', commands: 'Commands', gifts: 'Gifts', coins: 'Coins', points: 'Points' };
const UNITS: Record<SortKey, string> = { xp: 'XP', commands: 'commands', gifts: 'gifts', coins: 'coins', points: 'points' };
const MEDALS = ['gold', 'silver', 'bronze'];
// The podium puts first in the middle, second on its left and third on its right.
const PODIUM_ORDER = [1, 0, 2];

function Ranking({ host, entries }: { host: Host; entries: LeaderboardEntry[] }) {
  const sorts = (['xp', 'commands', 'gifts', 'coins', 'points'] as const).filter((k) => (k === 'xp' ? host.progression : k === 'points' ? host.points : true));
  const [sortBy, setSortBy] = useState<SortKey>(sorts[0]);
  const sort = sorts.includes(sortBy) ? sortBy : sorts[0];
  const [query, setQuery] = useState('');

  // Ties keep the server's order (by XP), so ranks don't shuffle between reloads.
  const ranked = entries.map((e, i) => ({ e, i })).sort((a, b) => b.e[sort] - a.e[sort] || a.i - b.i).map(({ e }) => e);
  const best = Math.max(1, ranked[0]?.[sort] ?? 0);
  const q = query.trim().replace(/^@/, '').toLowerCase();
  const matches = (e: LeaderboardEntry) => !q || e.viewer.toLowerCase().includes(q) || !!e.name?.toLowerCase().includes(q);
  const podium = q ? [] : ranked.slice(0, 3);
  const rest = ranked.map((e, rank) => ({ e, rank })).filter(({ e, rank }) => (q ? matches(e) : rank >= 3));

  return (
    <div className="stack">
      <div className="leaderboard-tools">
        {sorts.length > 1 && <Seg label="Rank by" value={sort} options={sorts.map((k) => [k, SORT_LABELS[k]] as const)} onChange={setSortBy} />}
        <input className="input" type="search" placeholder="Find a viewer" aria-label="Find a viewer" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {podium.length > 0 && (
        <ol className="podium">
          {PODIUM_ORDER.filter((rank) => podium[rank]).map((rank) => {
            const e = podium[rank];
            return (
              <li key={e.viewer} className={`podium-spot ${MEDALS[rank]}`}>
                <span className="podium-avatar">
                  <AvatarLink e={e} />
                  <span className="podium-medal" aria-label={`Rank ${rank + 1}`}>
                    {rank + 1}
                  </span>
                </span>
                <span className="podium-name">
                  <ViewerLink name={e.viewer} label={e.name} />
                </span>
                {e.name && <span className="muted small podium-handle">@{e.viewer}</span>}
                <span className="podium-score num">
                  {e[sort].toLocaleString()} <span className="muted">{UNITS[sort]}</span>
                </span>
                {host.progression && <LevelMeter xp={e.xp} />}
                <EntryStats e={e} shown={sorts} hide={sort} />
              </li>
            );
          })}
        </ol>
      )}
      {rest.length > 0 && (
        <ol className="ranking">
          {rest.map(({ e, rank }) => (
            <li key={e.viewer} className="ranking-row">
              <span className={`rank ${rank < 3 ? MEDALS[rank] : ''}`}>{rank + 1}</span>
              <AvatarLink e={e} />
              <span className="ranking-who">
                <span className="ranking-name">
                  <ViewerLink name={e.viewer} label={e.name} />
                  {host.progression && <span className="tag level-tag">Lv {levelForXp(e.xp)}</span>}
                </span>
                <EntryStats e={e} shown={sorts} hide={sort} />
              </span>
              <span className="ranking-score">
                <span className="num">
                  <strong>{e[sort].toLocaleString()}</strong> <span className="muted small">{UNITS[sort]}</span>
                </span>
                <span className="meter ranking-meter" aria-hidden="true">
                  <span style={{ width: `${(e[sort] / best) * 100}%` }} />
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {q && rest.length === 0 && <p className="empty">Nobody here matches “{query.trim()}”.</p>}
    </div>
  );
}

// The viewer's picture, opening their profile like their name does. The name is the one keyboards and screen readers reach.
function AvatarLink({ e }: { e: LeaderboardEntry }) {
  const open = useContext(ViewerContext);
  return (
    <button type="button" className="avatar-link" tabIndex={-1} aria-hidden="true" title={`@${e.viewer}'s profile`} onClick={() => open(e.viewer)}>
      <ViewerAvatar name={e.name ?? e.viewer} src={e.avatar} />
    </button>
  );
}

// The numbers the ranking isn't sorted by, in a quiet line.
function EntryStats({ e, shown, hide }: { e: LeaderboardEntry; shown: readonly SortKey[]; hide: SortKey }) {
  const parts = shown.filter((k) => k !== hide).map((k) => `${e[k].toLocaleString()} ${UNITS[k]}`);
  return <span className="muted small entry-stats">{parts.join(' · ')}</span>;
}

// A viewer's level and how far they are towards the next one.
function LevelMeter({ xp }: { xp: number }) {
  const level = levelForXp(xp);
  const from = xpForLevel(level);
  const to = level >= MAX_LEVEL ? from : xpForLevel(level + 1);
  const progress = to > from ? (xp - from) / (to - from) : 1;
  return (
    <span className="level-meter" title={to > from ? `${(to - xp).toLocaleString()} XP to level ${level + 1}` : 'Top level'}>
      <span className="tag level-tag">Lv {level}</span>
      <span className="meter" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </span>
    </span>
  );
}

const EARNING = [
  ['pointsPerChat', 'For chatting', 'At most once a minute per viewer.'],
  ['pointsPerDiamond', 'Per gift coin', 'A 5-coin gift at 10 is 50 points.'],
  ['pointsPerFollow', 'For following', 'Each time TikTok reports a follow.'],
  ['pointsPerShare', 'For sharing', 'Each time they share the stream.'],
] as const;

function PointsCard({ host, refreshHost }: { host: Host; refreshHost: () => Promise<unknown> }) {
  const { error, guard } = useError();
  const save = (patch: Partial<Host>) => guard(() => api('PATCH', '/settings', patch).then(refreshHost))();
  return (
    <Card
      title="Points"
      description="A balance viewers earn on your streams and spend on commands. Set what each command costs on the Commands page. Unlike XP, points go down when spent."
      actions={
        <ConfirmButton
          className="btn btn-ghost"
          message="Set every viewer's points back to 0? This cannot be undone."
          confirmLabel="Reset points"
          onConfirm={guard(() => api('DELETE', '/leaderboard/points'))}
        >
          Reset points
        </ConfirmButton>
      }
    >
      <ErrorNotice error={error} />
      <Switch
        checked={host.points}
        onChange={(points) => save({ points })}
        hint="A command a viewer can't afford is ignored. Losing votes cost nothing, and key presses from actions are always free."
      >
        Points
      </Switch>
      <fieldset className="stack" disabled={!host.points}>
        <div className="form-grid">
          {EARNING.map(([field, label, hint]) => (
            <label key={field} className="field">
              {label}
              <span className="hint">{hint}</span>
              <NumberCell value={host[field]} min={0} max={10000} onSave={(value) => save({ [field]: value })} />
            </label>
          ))}
        </div>
        <Switch
          checked={host.pointsCheck}
          onChange={(pointsCheck) => save({ pointsCheck })}
          hint={`Typing ${POINTS_CHECK} in chat shows that viewer's points on the overlay, once every 10 seconds per viewer.`}
        >
          Let viewers check their points
        </Switch>
      </fieldset>
    </Card>
  );
}

function ProgressionCard({ host, refreshHost }: { host: Host; refreshHost: () => Promise<unknown> }) {
  const { error, guard } = useError();
  const save = (patch: Partial<Host>) => guard(() => api('PATCH', '/settings', patch).then(refreshHost))();
  return (
    <Card
      title="Viewer levels"
      description={`Viewers earn XP on your streams: 1 per command that presses a key, plus each gift's value in coins. Level 2 takes ${xpForLevel(2)} XP, level 3 ${xpForLevel(3)}, level 5 ${xpForLevel(5)}, level 10 ${xpForLevel(10)}.`}
    >
      <ErrorNotice error={error} />
      <Switch checked={host.progression} onChange={(progression) => save({ progression })} hint="Levels show on the overlay, with a shout-out when someone levels up.">
        Show XP and levels
      </Switch>
      <Switch
        checked={host.levelGating}
        disabled={!host.progression}
        onChange={(levelGating) => save({ levelGating })}
        hint="Commands can require a minimum level, set per command. Key presses from actions are never gated."
      >
        Level requirements
      </Switch>
    </Card>
  );
}
