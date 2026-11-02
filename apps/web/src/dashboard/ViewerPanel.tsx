import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ViewerHistoryEvent, ViewerProfile } from '@hyperion/shared';
import { api } from '../api';
import { Icon } from '../icons';
import { describeEvent, KindChips, KIND_TAGS, VIEWER_FILTERS, type Kind } from './ActivityFeed';
import { Stat } from './AnalyticsPage';
import { BarList } from './charts';

const PAGE = 50;
const LIVE_REFRESH_MS = 3000;

// Any viewer's name can open their profile; the dashboard shell provides the opener.
export const ViewerContext = createContext<(viewer: string) => void>(() => {});

// `name` is the viewer's id; `label` is their display name, shown instead when known.
export function ViewerLink({ name, label }: { name: string; label?: string | null }) {
  const open = useContext(ViewerContext);
  return (
    <button type="button" className="viewer-link" onClick={() => open(name)} title={`@${name}'s profile`}>
      {label ?? name}
    </button>
  );
}

const date = (at: number) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// A side panel with one viewer's history across all of the host's streams.
export function ViewerPanel({ viewer, live, onClose }: { viewer: string; live: boolean; onClose: () => void }) {
  const [profile, setProfile] = useState<ViewerProfile | null>(null);
  const [events, setEvents] = useState<ViewerHistoryEvent[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [kinds, setKinds] = useState<Kind[]>(() => VIEWER_FILTERS.map((f) => f.kind));
  const [stream, setStream] = useState(''); // '' is every stream
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState(''); // what's typed, applied after typing pauses
  const [closing, setClosing] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const history = useRef<HTMLElement>(null);
  // Slides out first; with reduced motion there's no animation to wait for.
  const dismiss = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? onClose() : setClosing(true));
  const path = `/analytics/viewers/${encodeURIComponent(viewer)}`;
  const activity = (extra = '') =>
    api<ViewerHistoryEvent[]>(
      'GET',
      `${path}/activity?limit=${PAGE}&kinds=${kinds.join(',')}${stream ? `&stream=${stream}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}${extra}`,
    );

  useEffect(() => {
    setProfile(null);
    api<ViewerProfile>('GET', path).then(setProfile);
  }, [path]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    if (kinds.length === 0) return;
    let cancelled = false;
    activity().then((e) => {
      if (cancelled) return;
      setEvents(e);
      setHasOlder(e.length === PAGE);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [path, kinds, stream, search]);

  // While live, keeps up: their numbers, and new activity on top without losing older pages. Once more as a stream
  // ends, for what happened last.
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setRefresh((n) => n + 1), LIVE_REFRESH_MS);
    return () => (clearInterval(timer), setRefresh((n) => n + 1));
  }, [live]);
  useEffect(() => {
    if (refresh === 0) return;
    let cancelled = false;
    api<ViewerProfile>('GET', path)
      .then((p) => !cancelled && setProfile(p))
      .catch(() => {}); // the next refresh tries again
    if (kinds.length > 0) {
      activity()
        .then((fresh) => {
          if (cancelled) return;
          setEvents((shown) => {
            const known = new Set(shown.map((e) => e.id));
            const added = fresh.filter((e) => !known.has(e.id));
            return added.length > 0 ? [...added, ...shown] : shown;
          });
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [refresh, path, kinds, stream, search]);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const seen = profile && profile.firstSeen !== null ? profile : null;
  const loadOlder = () => activity(`&before=${events[events.length - 1]!.id}`).then((older) => (setEvents([...events, ...older]), setHasOlder(older.length === PAGE)));
  const accounts = new Set(profile?.perStream.map((s) => s.tiktokUsername ?? '—'));
  const everyKind = kinds.length === VIEWER_FILTERS.length;
  const filtered = !everyKind || !!stream || !!typed;
  const clearFilters = () => (setKinds(VIEWER_FILTERS.map((f) => f.kind)), setStream(''), setTyped(''));
  const openStream = (id: string) => (setStream(id), history.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  return (
    <div className={`viewer-backdrop ${closing ? 'closing' : ''}`} onClick={dismiss} onAnimationEnd={(e) => closing && e.target === e.currentTarget && onClose()}>
      <aside className="viewer-panel" role="dialog" aria-modal="true" aria-labelledby="viewer-name" onClick={(e) => e.stopPropagation()}>
        <header className="viewer-top">
          <div className="viewer-head">
            <span className="viewer-avatar" aria-hidden="true">
              {(profile?.name ?? viewer)[0]?.toUpperCase()}
            </span>
            <div>
              <h2 id="viewer-name">{profile?.name ?? viewer}</h2>
              <p className="muted small">
                {profile?.name && `@${viewer}`}
                {profile?.name && profile.firstSeen !== null && ' · '}
                {profile && (profile.firstSeen === null ? 'No activity recorded yet' : `Last seen ${date(profile.lastSeen!)}`)}
              </p>
            </div>
            <button ref={close} className="btn btn-ghost btn-sm btn-icon" onClick={dismiss} aria-label="Close">
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>

        {seen && (
          <div className="stack viewer-body">
            <div className="viewer-stats">
              <Stat icon="star" hue="violet" label="Level" value={seen.level.toLocaleString()} note={`${seen.xp.toLocaleString()} XP`} />
              {seen.points > 0 && <Stat icon="coin" hue="green" label="Points" value={seen.points.toLocaleString()} note="to spend" />}
              <Stat icon="crowd" hue="teal" label="Streams" value={seen.streams.toLocaleString()} note={`Since ${date(seen.firstSeen!)}`} />
              <Stat icon="chat" hue="sky" label="Chat messages" value={seen.comments.toLocaleString()} />
              <Stat icon="commands" hue="indigo" label="Key presses" value={seen.commands.toLocaleString()} />
              <Stat icon="gift" hue="amber" label="Gifts" value={seen.gifts.toLocaleString()} note={`${seen.diamonds.toLocaleString()} coins`} />
            </div>
            {seen.topCommands.length > 0 && (
              <section>
                <h3>Favourite commands</h3>
                <BarList
                  caption={`${viewer}'s favourite commands`}
                  series={[{ name: 'Times used', slot: 1 }]}
                  rows={seen.topCommands.map((c) => ({ label: c.keyword, values: [c.count], value: `${c.count}×` }))}
                />
              </section>
            )}

            <section>
              <h3>Stream by stream</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Stream</th>
                      {accounts.size > 1 && <th>Account</th>}
                      <th className="num">Chat</th>
                      <th className="num">Presses</th>
                      <th className="num">Coins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seen.perStream.map((s) => (
                      <tr key={s.streamId}>
                        <td>
                          <button className="link-button" title="See what they did in this stream" onClick={() => openStream(s.streamId)}>
                            {dateTime(s.startedAt)}
                          </button>
                          {s.source === 'simulated' && <span className="tag amber">Test</span>}
                        </td>
                        {accounts.size > 1 && <td>{s.tiktokUsername ?? '—'}</td>}
                        <td className="num">{s.comments.toLocaleString()}</td>
                        <td className="num">{s.commands.toLocaleString()}</td>
                        <td className="num">{s.diamonds.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="stack viewer-activity" ref={history}>
              <h3>Activity history</h3>
              <div className="viewer-filters">
                <div className="viewer-filter-row">
                  <label className="viewer-search">
                    <Icon name="search" size={16} />
                    <input
                      className="input"
                      type="search"
                      placeholder="Search chat, gifts and commands"
                      aria-label="Search this viewer's activity"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                    />
                  </label>
                  {seen.perStream.length > 1 && (
                    <select className="input" aria-label="Stream" value={stream} onChange={(e) => setStream(e.target.value)}>
                      <option value="">All streams</option>
                      {seen.perStream.map((s) => (
                        <option key={s.streamId} value={s.streamId}>
                          {dateTime(s.startedAt)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <KindChips coded filters={VIEWER_FILTERS} kinds={kinds} onChange={setKinds} />
                {filtered && (
                  <div className="viewer-filter-foot">
                    <span className="muted small">
                      {events.length.toLocaleString()}
                      {hasOlder ? '+' : ''} match{events.length === 1 ? '' : 'es'}
                    </span>
                    <button className="link-button small" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
              {kinds.length === 0 ? (
                <p className="empty">Pick at least one kind of activity to show.</p>
              ) : (
                loaded && events.length === 0 && <p className="empty">Nothing matches these filters.</p>
              )}
              <ol className="activity-list viewer-history">
                {kinds.length > 0 && events.map((e, i) => {
                  const newStream = i === 0 || events[i - 1]!.streamId !== e.streamId;
                  const tag = KIND_TAGS[e.kind];
                  return (
                    <li key={e.id} className={newStream ? 'stream-start' : ''} data-stream={newStream ? `Stream on ${dateTime(e.streamStartedAt)}` : undefined}>
                      <time className="muted">{new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                      <span className={`tag ${tag?.hue ?? 'indigo'}`}>{tag?.label ?? 'Key'}</span>
                      <span className="activity-text">{e.kind === 'command' ? `pressed ${String(e.data.keyword)}` : describeEvent(e)}</span>
                    </li>
                  );
                })}
              </ol>
              {kinds.length > 0 && hasOlder && (
                <button className="btn btn-ghost" onClick={() => void loadOlder()}>
                  Load older
                </button>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
