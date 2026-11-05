import { useState } from 'react';
import { MODES, type Mode } from '@hyperion/shared';
import { api, type LiveStatus } from '../api';
import { Icon } from '../icons';
import { Link } from '../router';
import { ErrorNotice, useError } from '../ui';
import type { PageProps } from './Dashboard';
import { elapsed, useNow } from './LivePage';
import { MODE_INFO } from './modes';

const OPEN_KEY = 'hyperion-live-dock-open';
const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
};

// The stream's controls in a corner of every page but Live, so going live, switching crowd mode or stopping doesn't
// mean going back there. Collapses to a pill; which one is remembered.
export function LiveDock({ host, refreshHost, status, setStatus, feed }: PageProps) {
  const [open, setOpen] = useState(readOpen);
  const [closing, setClosing] = useState(false); // the panel shrinks into the corner before the pill comes back
  const [animate, setAnimate] = useState(false); // only after a click, so a page load doesn't play it
  const [busy, setBusy] = useState(false);
  const { error, guard } = useError();
  const now = useNow(1000);

  const remember = (value: boolean) => {
    try {
      localStorage.setItem(OPEN_KEY, value ? '1' : '0');
    } catch {
      // not remembered, that's all
    }
  };
  const expand = () => (setAnimate(true), setOpen(true), remember(true));
  const collapse = () => {
    remember(false);
    setAnimate(true);
    // Without motion there's nothing to wait for, so it closes at once.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setOpen(false);
    else setClosing(true);
  };
  const closed = () => {
    if (!closing) return;
    setClosing(false);
    setOpen(false);
  };
  const start = (source: 'tiktok' | 'simulated') =>
    guard(async () => {
      setBusy(true);
      try {
        setStatus(await api<LiveStatus>('POST', '/live/start', { source }));
      } finally {
        setBusy(false);
      }
    });
  const stop = guard(async () => setStatus(await api<LiveStatus>('POST', '/live/stop')));
  const setMode = (mode: Mode) => guard(() => api('PATCH', '/settings', { mode }).then(refreshHost))();

  const test = status.source === 'simulated';
  const label = status.live ? (test ? 'Test mode' : 'Live') : 'Offline';
  const time = status.live && status.startedAt ? elapsed(now - status.startedAt) : null;
  const tone = status.live ? (test ? 'amber' : 'red') : 'idle';
  const stats = status.live ? feed.stats : null;

  if (!open) {
    return (
      <button className={`live-dock-pill ${tone} ${animate ? 'enter' : ''}`} onClick={expand} aria-expanded="false" aria-controls="live-dock">
        <span className={`dot ${status.live ? 'live' : ''}`} aria-hidden="true" />
        <strong>{label}</strong>
        {time && <span className="num">{time}</span>}
        <Icon name="chevron" size={14} />
        <span className="sr-only">Show stream controls</span>
      </button>
    );
  }

  return (
    <section
      id="live-dock"
      className={`live-dock ${tone} ${animate ? 'enter' : ''} ${closing ? 'closing' : ''}`}
      aria-label="Stream controls"
      onAnimationEnd={(e) => e.target === e.currentTarget && closed()}
    >
      <div className="live-dock-head">
        <span className={`dot ${status.live ? 'live' : ''}`} aria-hidden="true" />
        <strong>{status.live ? (test ? 'Test mode' : 'Live on TikTok') : 'Offline'}</strong>
        {time && <span className="num muted">{time}</span>}
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm btn-icon" onClick={collapse} disabled={closing} aria-expanded="true" aria-label="Hide stream controls" title="Hide">
          <Icon name="chevron" size={14} />
        </button>
      </div>

      {stats && (
        <dl className="live-dock-stats">
          <div>
            <dt>Viewers</dt>
            <dd className="num">{stats.viewers.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Followers</dt>
            <dd className="num">+{stats.follows.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Likes</dt>
            <dd className="num">{stats.likes.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Coins</dt>
            <dd className="num">{stats.diamonds.toLocaleString()}</dd>
          </div>
        </dl>
      )}

      <label className="live-dock-row">
        <span className="muted small">Crowd mode</span>
        <select className="input" value={host.mode} onChange={(e) => setMode(e.target.value as Mode)}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_INFO[m].label}
            </option>
          ))}
        </select>
      </label>
      <div className="live-dock-row">
        <span className="muted small">Companion</span>
        <span className={`live-dock-companion ${status.companionsOnline > 0 ? 'on' : ''}`}>
          <span className="dot" aria-hidden="true" />
          {status.companionsOnline > 0 ? `${status.companionsOnline} connected` : 'Not connected'}
        </span>
      </div>

      <ErrorNotice error={error} />
      <div className="live-dock-actions">
        {status.live ? (
          <button className="btn btn-danger" onClick={stop}>
            {test ? 'Stop test' : 'Stop'}
          </button>
        ) : (
          <>
            <button
              className="btn btn-primary"
              disabled={busy || !host.tiktokUsername}
              title={host.tiktokUsername ? undefined : 'Add your TikTok username in Settings first'}
              onClick={start('tiktok')}
            >
              {busy ? 'Connecting…' : 'Go live'}
            </button>
            <button className="btn" disabled={busy} onClick={start('simulated')}>
              Test mode
            </button>
          </>
        )}
      </div>
      <Link href="/dashboard" className="small live-dock-link">
        Open the Live page
      </Link>
    </section>
  );
}
