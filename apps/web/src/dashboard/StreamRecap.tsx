import { useEffect, useRef, useState } from 'react';
import type { StreamDetail, StreamStats } from '@hyperion/shared';
import { api, type Host } from '../api';
import { Icon } from '../icons';
import { Link } from '../router';
import { ErrorNotice, Spinner, useError } from '../ui';
import { Stat } from './AnalyticsPage';
import { clock, duration } from './StreamInsights';
import { ViewerLink } from './ViewerPanel';

const n = (value: number | null | undefined) => (value === null || value === undefined ? '—' : value.toLocaleString());

// A quick look at the stream that just ended. `stats` are the stream's last live totals, for the likes, shares and
// subscriptions its report doesn't keep. Turned off in Settings, or with the button here.
export function StreamRecap({ stats, refreshHost, onClose }: { stats: StreamStats | null; refreshHost: () => Promise<unknown>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<StreamDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const { error, guard } = useError();
  useEffect(() => dialog.current?.showModal(), []);
  useEffect(() => void api<StreamDetail>('GET', '/analytics/streams/latest').then(setDetail).catch(() => setFailed(true)), []);

  const close = () => dialog.current?.close();
  const turnOff = guard(async () => {
    await api('PATCH', '/settings', { streamRecap: false });
    await refreshHost();
    close();
  });

  const s = detail?.summary;
  const test = s?.source === 'simulated';
  const peak = detail?.peaks[0];
  return (
    <dialog ref={dialog} className="recap-dialog" onClose={onClose} aria-labelledby="recap-title">
      <div className="pos-head">
        <div>
          <h2 id="recap-title">{test ? 'Test session over' : 'Stream over'}</h2>
          <p className="muted small">
            {s
              ? `${new Date(s.startedAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, ${duration((s.endedAt ?? Date.now()) - s.startedAt)}${s.tiktokUsername ? ` as @${s.tiktokUsername}` : ''}.`
              : 'Adding it up…'}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={close} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <ErrorNotice error={error} />
      {!s && !failed && <Spinner label="Adding up the stream" />}
      {s && (
        <>
          <div className="stat-tiles">
            <Stat icon="eye" hue="sky" label="Peak viewers" value={n(s.peakViewers ?? stats?.peakViewers)} note={`${n(s.viewers)} seen in all`} />
            <Stat icon="follower" hue="pink" label="New followers" value={n(s.follows)} />
            <Stat icon="heart" hue="red" label="Likes" value={n(stats?.likes)} note={stats ? `${n(stats.shares)} shares` : undefined} />
            <Stat icon="coin" hue="teal" label="Coins" value={n(s.diamonds)} note={`${n(s.gifts)} gift${s.gifts === 1 ? '' : 's'}`} />
            <Stat icon="crowd" hue="indigo" label="Interactors" value={n(s.participants)} note={`${n(s.newParticipants)} new`} />
            <Stat icon="chat" hue="sky" label="Chat messages" value={n(s.comments)} />
            <Stat icon="commands" hue="violet" label="Key presses" value={n(s.commands)} note={s.topCommand ? `mostly ${s.topCommand}` : undefined} />
            {!!stats?.subscriptions && <Stat icon="star" hue="orange" label="Subscriptions" value={n(stats.subscriptions)} />}
          </div>
          {(s.topPlayer || stats?.topGift || peak) && (
            <ul className="recap-highlights">
              {s.topPlayer && (
                <li>
                  <Icon name="trophy" size={16} />
                  <span>
                    Top player: <ViewerLink name={s.topPlayer} label={s.topPlayerName} />
                  </span>
                </li>
              )}
              {stats?.topGift && (
                <li>
                  <Icon name="gift" size={16} />
                  <span>
                    Biggest gift: {stats.topGift.gift} from {stats.topGift.viewer}, {n(stats.topGift.diamonds)} coins
                  </span>
                </li>
              )}
              {peak && (
                <li>
                  <Icon name="flame" size={16} />
                  <span>
                    Busiest moment: {clock(Math.round((peak.start - s.startedAt) / 60_000))} into the stream, {n(peak.events)} events
                  </span>
                </li>
              )}
            </ul>
          )}
        </>
      )}
      <div className="recap-actions">
        <button className="btn btn-ghost btn-sm" onClick={turnOff} title="You can turn it back on in Settings">
          Don't show after streams
        </button>
        <span className="spacer" />
        {/* Test sessions aren't kept on the Analytics page, so only real streams get a full report. */}
        {s && !test && (
          <Link href={`/dashboard/analytics/${s.id}`} className="btn btn-sm" onClick={close}>
            Full report
          </Link>
        )}
        <button className="btn btn-primary btn-sm" onClick={close}>
          Done
        </button>
      </div>
    </dialog>
  );
}
