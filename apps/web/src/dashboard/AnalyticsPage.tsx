import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StreamDetail, StreamSummary } from '@hyperion/shared';
import { api, type LiveStatus } from '../api';
import { Card } from '../ui';
import { Icon, type IconName } from '../icons';
import { BarList, ColumnChart, Sparkline, type Series } from './charts';
import type { PageProps } from './Dashboard';
import { ActivityChart, clock, CommandUsage, duration, useStreamDetail } from './StreamInsights';
import { ActivityFeed } from './ActivityFeed';
import { ViewerLink } from './ViewerPanel';

const TREND_STREAMS = 20;

const shortDate = (at: number) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
const longDate = (at: number) => new Date(at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const number = (n: number) => n.toLocaleString();

export function AnalyticsPage({ host, status }: PageProps) {
  const [streams, setStreams] = useState<StreamSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null); // '' is every TikTok account; null is the one in settings
  useEffect(() => {
    const load = () => api<StreamSummary[]>('GET', '/analytics/streams').then(setStreams);
    void load();
    // A stream that starts or ends changes the list.
  }, [status.live]);

  if (!streams) return null;
  if (streams.length === 0) {
    return (
      <Card title="No streams yet" description="Your TikTok streams show up here once you go live. Test mode isn't counted.">
        <p className="empty">Go live from the Live page and come back afterwards, or during the stream.</p>
      </Card>
    );
  }
  // Streams on different TikTok accounts reach different audiences, so they can be looked at separately.
  const accounts = [...new Set(streams.map((s) => s.tiktokUsername).filter((a): a is string => a !== null))];
  const mine = accounts.find((a) => a.toLowerCase() === host.tiktokUsername?.toLowerCase()) ?? '';
  const picked = account ?? mine;
  const shown = picked ? streams.filter((s) => s.tiktokUsername === picked) : streams;
  const current = shown.find((s) => s.id === selected) ?? shown[0];
  return (
    <div className="stack">
      {accounts.length > 1 && (
        <label className="row account-picker">
          <span className="muted">TikTok account</span>
          <select className="input" value={picked} onChange={(e) => (setAccount(e.target.value), setSelected(null))}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a} value={a}>
                @{a}
              </option>
            ))}
          </select>
        </label>
      )}
      {current && (
        <>
          <Overview streams={shown} />
          <Trends streams={shown} selected={current.id} onSelect={setSelected} />
          <StreamList streams={shown} showAccount={accounts.length > 1 && !picked} selected={current.id} onSelect={setSelected} />
          <StreamReport key={current.id} summary={current} previous={shown[shown.indexOf(current) + 1]} status={status} />
        </>
      )}
    </div>
  );
}

// Totals over the recent streams, each with its trend. Oldest on the left.
function Overview({ streams }: { streams: StreamSummary[] }) {
  const recent = streams.slice(0, TREND_STREAMS).reverse();
  const trend = (value: (s: StreamSummary) => number) => recent.map(value);
  const total = (value: (s: StreamSummary) => number) => recent.reduce((n, s) => n + value(s), 0);
  const perStream = (value: (s: StreamSummary) => number) => `${number(Math.round(total(value) / recent.length))} per stream`;
  const count = recent.length === 1 ? 'your latest stream' : `your last ${recent.length} streams`;
  const peaks = recent.flatMap((s) => s.peakViewers ?? []);
  return (
    <section className="overview" aria-label="Your recent streams">
      <Stat
        hero
        icon="eye"
        hue="sky"
        label="Viewers per stream"
        value={number(Math.round(total((s) => s.viewers) / recent.length))}
        note={`on average, across ${count}`}
        trend={{ values: trend((s) => s.viewers), slot: 1 }}
      />
      <Stat
        icon="eye"
        hue="sky"
        label="Peak viewers"
        value={peaks.length > 0 ? number(Math.max(...peaks)) : '—'}
        note={peaks.length > 0 ? `highest at once, ${number(Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length))} per stream` : 'recorded from your next stream'}
        trend={{ values: peaks, slot: 1 }}
      />
      <Stat
        icon="crowd"
        hue="indigo"
        label="Interactors per stream"
        value={number(Math.round(total((s) => s.participants) / recent.length))}
        note="chatted or sent a gift"
        trend={{ values: trend((s) => s.participants), slot: 2 }}
      />
      <Stat icon="coin" hue="teal" label="Coins" value={number(total((s) => s.diamonds))} note={`${number(total((s) => s.gifts))} gifts`} trend={{ values: trend((s) => s.diamonds), slot: 3 }} />
      <Stat icon="chat" hue="sky" label="Chat messages" value={number(total((s) => s.comments))} note={perStream((s) => s.comments)} trend={{ values: trend((s) => s.comments), slot: 1 }} />
      <Stat icon="commands" hue="violet" label="Key presses" value={number(total((s) => s.commands))} note={perStream((s) => s.commands)} trend={{ values: trend((s) => s.commands), slot: 1 }} />
    </section>
  );
}

// Across streams: who watched and who interacted (new and returning), and diamonds received. Oldest on the left; clicking a column opens that stream.
function Trends({ streams, selected, onSelect }: { streams: StreamSummary[]; selected: string; onSelect: (id: string) => void }) {
  const recent = streams.slice(0, TREND_STREAMS).reverse();
  const every = Math.max(1, Math.ceil(recent.length / 6));
  const last = recent.length - 1;
  // The last date is always shown, so the regular ones stop short of it rather than run into it.
  const tick = (i: number, s: StreamSummary) => (i === last || (i % every === 0 && last - i >= every) ? shortDate(s.startedAt) : undefined);
  const picked = recent.findIndex((s) => s.id === selected);
  const pick = { selected: picked < 0 ? undefined : picked, onSelect: (i: number) => onSelect(recent[i]!.id) };
  const latest = streams[0]!;
  const before = streams[1];
  const change = before && before.viewers > 0 ? Math.round(((latest.viewers - before.viewers) / before.viewers) * 100) : null;

  return (
    <Card
      title="Across your streams"
      description={
        `${number(latest.viewers)} viewers in your latest stream${change === null ? '' : `, ${change >= 0 ? `${change}% more` : `${-change}% fewer`} than the one before`}. ${number(latest.participants)} interacted.`
      }
    >
      <div className="analytics-grid">
        <div>
          <h3>Viewers</h3>
          <p className="muted small">Seen joining or doing anything. Quiet viewers already there aren't counted, so peak can be higher.</p>
          <ColumnChart
            {...pick}
            caption="Viewers per stream"
            series={[
              { name: 'Just watched', slot: 1 },
              { name: 'Interacted', slot: 2 },
            ]}
            columns={recent.map((s, i) => ({
              label: longDate(s.startedAt),
              tick: tick(i, s),
              values: [s.viewers - s.participants, s.participants],
              extra: s.peakViewers === null ? undefined : [`${number(s.peakViewers)} peak viewers`],
            }))}
          />
        </div>
        <div>
          <h3>Interactors</h3>
          <p className="muted small">Chatted or sent a gift. New means their first time on that TikTok account's streams.</p>
          <ColumnChart
            {...pick}
            caption="Interactors per stream"
            series={[
              { name: 'New', slot: 1 },
              { name: 'Returning', slot: 2 },
            ]}
            columns={recent.map((s, i) => ({
              label: longDate(s.startedAt),
              tick: tick(i, s),
              values: [s.newParticipants, s.participants - s.newParticipants],
            }))}
          />
        </div>
        <div>
          <h3>Coins received</h3>
          <p className="muted small">Gifts' total value in coins, per stream.</p>
          <ColumnChart
            {...pick}
            caption="Coins per stream"
            series={[{ name: 'Coins', slot: 3 }]}
            columns={recent.map((s, i) => ({ label: longDate(s.startedAt), tick: tick(i, s), values: [s.diamonds], extra: [`${number(s.gifts)} gifts`] }))}
          />
        </div>
      </div>
    </Card>
  );
}

function StreamList({
  streams,
  showAccount,
  selected,
  onSelect,
}: {
  streams: StreamSummary[];
  showAccount: boolean;
  selected: string;
  onSelect: (id: string) => void;
}) {
  // A stream picked from a chart may be scrolled out of the list. This moves the list only, never the page.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = box.current!.getBoundingClientRect();
    const head = box.current!.querySelector('thead')!.getBoundingClientRect().height;
    const row = box.current!.querySelector('tr.selected')?.getBoundingClientRect();
    if (!row) return;
    if (row.top < list.top + head) box.current!.scrollTop -= list.top + head - row.top;
    else if (row.bottom > list.bottom) box.current!.scrollTop += row.bottom - list.bottom;
  }, [selected]);
  return (
    <Card title="Streams" description="Pick one for its details below.">
      <div className="table-wrap stream-scroll" ref={box}>
        <table className="table stream-table">
          <thead>
            <tr>
              <th>Started</th>
              {showAccount && <th>Account</th>}
              <th className="num">Length</th>
              <th className="num">Peak viewers</th>
              <th className="num">Viewers</th>
              <th className="num">Interactors</th>
              <th className="num">New</th>
              <th className="num">Chat</th>
              <th className="num">Key presses</th>
              <th className="num">Coins</th>
              <th>Top command</th>
            </tr>
          </thead>
          <tbody>
            {streams.map((s) => (
              <tr key={s.id} className={s.id === selected ? 'selected' : ''} onClick={() => onSelect(s.id)}>
                <td>
                  <button className="link-button" onClick={() => onSelect(s.id)} aria-pressed={s.id === selected}>
                    {longDate(s.startedAt)}
                  </button>
                  {s.endedAt === null && <span className="tag red">Live</span>}
                </td>
                {showAccount && <td>{s.tiktokUsername ? `@${s.tiktokUsername}` : '—'}</td>}
                <td className="num">{duration((s.endedAt ?? Date.now()) - s.startedAt)}</td>
                <td className="num">{s.peakViewers === null ? '—' : number(s.peakViewers)}</td>
                <td className="num">{number(s.viewers)}</td>
                <td className="num">{number(s.participants)}</td>
                <td className="num">{number(s.newParticipants)}</td>
                <td className="num">{number(s.comments)}</td>
                <td className="num">{number(s.commands)}</td>
                <td className="num">{number(s.diamonds)}</td>
                <td>{s.topCommand ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function StreamReport({ summary, previous, status }: { summary: StreamSummary; previous?: StreamSummary; status: LiveStatus }) {
  const detail = useStreamDetail(summary.id, summary.endedAt === null);
  if (!detail) return null;
  const s = detail.summary;
  // A stream that's still going would look like a drop, so it isn't compared yet.
  const before = s.endedAt === null ? undefined : previous;
  return (
    <>
      <Card
        title={`Stream on ${longDate(s.startedAt)}`}
        description={`${s.tiktokUsername ? `@${s.tiktokUsername}, ` : ''}${s.profileName} profile, ${duration((s.endedAt ?? Date.now()) - s.startedAt)}.${before ? ' Arrows compare it with the stream before.' : ''}`}
      >
        <div className="stat-tiles">
          <Stat icon="eye" hue="sky" label="Peak viewers" value={s.peakViewers === null ? '—' : number(s.peakViewers)} note="most at once" delta={before?.peakViewers != null && s.peakViewers !== null ? [s.peakViewers, before.peakViewers] : undefined} />
          <Stat icon="eye" hue="sky" label="Viewers" value={number(s.viewers)} note="seen in the stream" delta={before && [s.viewers, before.viewers]} />
          <Stat icon="crowd" hue="indigo" label="Interactors" value={number(s.participants)} note={`${number(s.newParticipants)} new`} delta={before && [s.participants, before.participants]} />
          <Stat icon="commands" hue="violet" label="Key presses" value={number(s.commands)} note={s.topCommand ? `mostly ${s.topCommand}` : undefined} delta={before && [s.commands, before.commands]} />
          <Stat icon="coin" hue="teal" label="Coins" value={number(s.diamonds)} note={`${number(s.gifts)} gifts`} delta={before && [s.diamonds, before.diamonds]} />
          <Stat icon="follower" hue="pink" label="New followers" value={number(s.follows)} delta={before && [s.follows, before.follows]} />
          <Stat icon="trophy" hue="orange" label="Top player" value={s.topPlayer ? <ViewerLink name={s.topPlayer} label={s.topPlayerName} /> : '—'} />
        </div>
        <h3>Chat over the stream</h3>
        <ActivityChart detail={detail} />
      </Card>
      <div className="analytics-grid">
        <Card title="Commands" description="How often each fired, and how often chat asked but it didn't.">
          <CommandUsage detail={detail} />
        </Card>
        <Card title="Peak moments" description="The busiest two minutes, worth checking for clips.">
          <Peaks detail={detail} />
        </Card>
      </div>
      <div className="analytics-grid">
        <Card title="Gifts" description="What viewers sent, by total coins.">
          <Gifts detail={detail} />
        </Card>
        <Card title="Crowd modes" description="Votes in democracy, and the line in queue mode.">
          <Modes detail={detail} />
        </Card>
      </div>
      <ActivityFeed status={status} stream={s.id} storageKey="hyperion-report-activity-open" />
    </>
  );
}

export function Stat({
  label,
  value,
  note,
  icon,
  hue,
  delta,
  trend,
  hero,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  icon?: IconName;
  hue?: string;
  delta?: [now: number, before: number];
  trend?: { values: number[]; slot: Series['slot'] };
  hero?: boolean;
}) {
  return (
    <div className={`stat-tile ${hero ? 'hero' : ''}`}>
      <span className="stat-label muted small">
        {icon && (
          <span className={`tag ${hue} stat-icon`}>
            <Icon name={icon} size={14} />
          </span>
        )}
        {label}
      </span>
      <span className="stat-value">
        <strong>{value}</strong>
        {delta && <Delta now={delta[0]} before={delta[1]} />}
      </span>
      {note && <span className="muted small">{note}</span>}
      {trend && <Sparkline {...trend} />}
    </div>
  );
}

// Green when up, plain when down: red means live on this dashboard, and a quieter stream isn't an alarm.
function Delta({ now, before }: { now: number; before: number }) {
  if (before === 0) return null;
  const change = Math.round(((now - before) / before) * 100);
  return (
    <span className={`tag delta ${change > 0 ? 'green' : ''}`}>
      <span aria-hidden="true">{change > 0 ? '▲' : change < 0 ? '▼' : '='}</span>
      {Math.abs(change)}%<span className="sr-only">{change >= 0 ? ' more than' : ' fewer than'} the stream before</span>
    </span>
  );
}

function Peaks({ detail }: { detail: StreamDetail }) {
  if (detail.peaks.length === 0) return <p className="empty">Nothing happened yet.</p>;
  const start = detail.summary.startedAt;
  const offset = (at: number) => clock(Math.round((at - start) / 60_000));
  const busiest = detail.peaks[0]!.events;
  return (
    <ol className="peak-list">
      {detail.peaks.map((p, i) => (
        <li key={p.start}>
          <span className={`tag ${i === 0 ? 'orange' : ''} peak-rank`}>{i === 0 ? <Icon name="flame" size={14} /> : i + 1}</span>
          <span className="peak-when">
            <strong>
              {offset(p.start)} to {offset(p.end)}
            </strong>
            <span className="muted small">into the stream, {new Date(p.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          </span>
          <span className="peak-events">{number(p.events)} events</span>
          <span className="peak-meter" aria-hidden="true">
            <i className="slot-1" style={{ width: `${(p.events / busiest) * 100}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

// TikTok's picture of a gift. Gifts recorded before pictures were kept, test gifts and pictures that won't load get an icon.
function GiftImage({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="gift-image">
      {src && !failed ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Icon name="gift" size={16} />}
    </span>
  );
}

function Gifts({ detail }: { detail: StreamDetail }) {
  const { byGift, perHour } = detail.gifts;
  if (byGift.length === 0) return <p className="empty">No gifts this stream.</p>;
  return (
    <div className="stack">
      <BarList
        caption="Coins by gift"
        series={[{ name: 'Coins', slot: 3 }]}
        rows={byGift.slice(0, 8).map((g) => ({ label: g.gift, icon: <GiftImage src={g.image} />, values: [g.diamonds], value: `${number(g.diamonds)} (${number(g.count)} sent)` }))}
      />
      {perHour.length > 1 && (
        <>
          <h3>Coins per hour</h3>
          <ColumnChart
            caption="Coins per hour of the stream"
            height={110}
            series={[{ name: 'Coins', slot: 3 }]}
            columns={perHour.map((h) => ({ label: `Hour ${h.hour + 1}`, tick: `Hour ${h.hour + 1}`, values: [h.diamonds] }))}
          />
        </>
      )}
    </div>
  );
}

function Modes({ detail }: { detail: StreamDetail }) {
  const { votes, queue } = detail.modes;
  if (votes.rounds === 0 && queue.joins === 0) return <p className="empty">Democracy and queue weren't used this stream.</p>;
  return (
    <div className="stack">
      {votes.rounds > 0 && (
        <div>
          <h3>Democracy</h3>
          <div className="stat-tiles">
            <Stat label="Vote rounds" value={number(votes.rounds)} />
            <Stat label="Voters per round" value={votes.avgVoters.toFixed(1)} note="on average" />
            <Stat label="Close votes" value={`${Math.round((votes.closeRounds / votes.rounds) * 100)}%`} note="won by one vote or tied" />
          </div>
        </div>
      )}
      {queue.joins > 0 && (
        <div>
          <h3>Queue</h3>
          <div className="stat-tiles">
            <Stat label="Joined the queue" value={number(queue.joins)} />
            <Stat label="Turns played" value={number(queue.turns)} />
            <Stat label="Average wait" value={duration(queue.avgWaitMs).replace(/^0 min$/, 'under a minute')} />
          </div>
        </div>
      )}
    </div>
  );
}
