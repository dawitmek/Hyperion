import { useEffect, useState, type ReactNode } from 'react';
import { ANALYTICS_RANGES, type AnalyticsOverview, type AnalyticsRange, type StreamDetail, type StreamSummary, type StreamViewer } from '@hyperion/shared';
import { api, type LiveStatus } from '../api';
import { Card, Seg, Spinner, ViewerAvatar } from '../ui';
import { Icon, type IconName } from '../icons';
import { Link, navigate, usePath } from '../router';
import { BarList, ColumnChart, Sparkline, type Series } from './charts';
import type { PageProps } from './Dashboard';
import { ActivityChart, clock, CommandUsage, duration, useStreamDetail } from './StreamInsights';
import { ActivityFeed, type ActivityFocus } from './ActivityFeed';
import { ViewerLink } from './ViewerPanel';

const TREND_STREAMS = 20;

const shortDate = (at: number) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
const longDate = (at: number) => new Date(at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const number = (n: number) => n.toLocaleString();
const streamPath = (id: string) => `/dashboard/analytics/${id}`;
const VIEWER_ROWS = 10; // shown before "Show all"
const VIEWERS_REFRESH_MS = 10_000;

export function AnalyticsPage({ host, status }: PageProps) {
  const path = usePath();
  const opened = /^\/dashboard\/analytics\/([0-9a-f-]{36})\/?$/.exec(path)?.[1]; // one stream's own page
  const [streams, setStreams] = useState<StreamSummary[] | null>(null);
  const [account, setAccount] = useState<string | null>(null); // '' is every TikTok account; null is the one in settings
  useEffect(() => {
    const load = () => api<StreamSummary[]>('GET', '/analytics/streams').then(setStreams);
    void load();
    // A stream that starts or ends changes the list.
  }, [status.live]);
  // An opened stream's report is asked for alongside the list, not after it. Whether it's live, so kept refreshed, is
  // only known once the list is in.
  const detail = useStreamDetail(opened, opened !== undefined && streams?.find((s) => s.id === opened)?.endedAt === null);

  if (!streams) return <Spinner />;
  if (opened) return <StreamPage id={opened} streams={streams} detail={detail} status={status} />;
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
  return (
    <div className="stack analytics-page">
      {accounts.length > 1 && (
        <label className="row account-picker">
          <span className="muted">TikTok account</span>
          <select className="input" value={picked} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a} value={a}>
                @{a}
              </option>
            ))}
          </select>
        </label>
      )}
      {shown.length > 0 && (
        <>
          <Overview streams={shown} />
          <AllStreams account={picked} live={status.live} />
          <Trends streams={shown} onSelect={(id) => navigate(streamPath(id))} />
          <StreamList streams={shown} showAccount={accounts.length > 1 && !picked} />
        </>
      )}
    </div>
  );
}

// One stream's full report, on a page of its own, with a way back and to the streams either side on the same account.
function StreamPage({ id, streams, detail, status }: { id: string; streams: StreamSummary[]; detail: StreamDetail | null | undefined; status: LiveStatus }) {
  const summary = streams.find((s) => s.id === id);
  if (!summary) {
    return (
      <Card title="Stream not found" description="It may have been a test session, which isn't kept here, or it belongs to another account.">
        <Link href="/dashboard/analytics" className="btn">
          Back to all streams
        </Link>
      </Card>
    );
  }
  const same = streams.filter((s) => s.tiktokUsername === summary.tiktokUsername);
  const at = same.indexOf(summary);
  const newer = same[at - 1];
  const older = same[at + 1];
  return (
    <div className="stack analytics-page">
      <nav className="stream-nav" aria-label="Streams">
        <Link href="/dashboard/analytics" className="btn btn-ghost btn-sm">
          <span aria-hidden="true">‹</span> All streams
        </Link>
        <span className="spacer" />
        {older && (
          <Link href={streamPath(older.id)} className="btn btn-sm" title={longDate(older.startedAt)}>
            <span aria-hidden="true">‹</span> Older stream
          </Link>
        )}
        {newer && (
          <Link href={streamPath(newer.id)} className="btn btn-sm" title={longDate(newer.startedAt)}>
            Newer stream <span aria-hidden="true">›</span>
          </Link>
        )}
      </nav>
      <StreamReport key={id} detail={detail} previous={older} status={status} />
    </div>
  );
}

const RANGE_OPTIONS = ANALYTICS_RANGES.map((r) => [r.id, r.label] as const);

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const hourName = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' });
const dayName = (day: number, weekday: 'short' | 'long') => new Date(2023, 0, 1 + day).toLocaleDateString([], { weekday }); // 1 Jan 2023 was a Sunday
const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
const oneDecimal = (n: number) => Math.round(n * 10) / 10;

// Patterns across every stream in a stretch of time, which no single stream shows: when chat is busiest, whether
// viewers come back, a few rates, and the most used commands and gifts worth the most coins.
function AllStreams({ account, live }: { account: string; live: boolean }) {
  const [range, setRange] = useState<AnalyticsRange>('all');
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  useEffect(() => {
    const query = new URLSearchParams({ range, tz: TIME_ZONE, ...(account && { account }) });
    void api<AnalyticsOverview>('GET', `/analytics/overview?${query}`).then(setOverview);
  }, [range, account, live]);
  const label = ANALYTICS_RANGES.find((r) => r.id === range)!.label;
  const o = overview;
  const hours = o ? o.liveMs / 3_600_000 : 0;
  const cameBack = o ? o.loyalty.few + o.loyalty.many : 0;
  return (
    <Card
      title="Patterns"
      description={
        o &&
        (o.streams === 0
          ? `No streams in the last ${label}.`
          : `Across ${number(o.streams)} ${o.streams === 1 ? 'stream' : 'streams'}${range === 'all' ? '' : ` in the last ${label}`}, ${duration(o.liveMs)} live.`)
      }
      actions={<Seg label="Time range" value={range} options={RANGE_OPTIONS} onChange={setRange} />}
    >
      {!o ? (
        <Spinner />
      ) : o.streams === 0 ? null : (
        <>
          <div className="stat-tiles">
            <Stat icon="live" hue="red" label="Average stream" value={duration(o.liveMs / o.streams)} />
            <Stat icon="coin" hue="teal" label="Coins per hour live" value={hours > 0 ? number(Math.round(o.coins / hours)) : '—'} />
            <Stat icon="follower" hue="pink" label="Follows per 100 viewers" value={o.viewers > 0 ? oneDecimal((o.follows / o.viewers) * 100).toString() : '—'} />
            <Stat icon="crowd" hue="indigo" label="Viewers who interact" value={percent(o.interactors, o.viewers)} note="chatted or sent a gift" />
            <Stat icon="leaderboard" hue="violet" label="Came back" value={percent(cameBack, o.interactors)} note="of interactors took part in 2+ streams" />
          </div>
          <div className="analytics-grid">
            <BusiestTimes activity={o.activity} />
            <div>
              <h3>Loyalty</h3>
              <p className="muted small">How many of your streams each interactor took part in.</p>
              {o.streams < 2 ? (
                <p className="empty">Shows once there's more than one stream in this range.</p>
              ) : (
                <BarList
                  caption="Interactors by streams taken part in"
                  series={[{ name: 'Interactors', slot: 2 }]}
                  rows={[
                    { label: 'One stream', values: [o.loyalty.once], value: `${number(o.loyalty.once)} (${percent(o.loyalty.once, o.interactors)})` },
                    { label: '2 to 3 streams', values: [o.loyalty.few], value: `${number(o.loyalty.few)} (${percent(o.loyalty.few, o.interactors)})` },
                    { label: '4 or more', values: [o.loyalty.many], value: `${number(o.loyalty.many)} (${percent(o.loyalty.many, o.interactors)})` },
                  ]}
                />
              )}
            </div>
          </div>
          <div className="analytics-grid">
            <div>
              <h3>Top commands</h3>
              {o.topCommands.length === 0 ? (
                <p className="empty">No key presses yet.</p>
              ) : (
                <BarList
                  caption="Most used commands"
                  series={[{ name: 'Key presses', slot: 1 }]}
                  rows={o.topCommands.map((c) => ({ label: c.keyword, values: [c.count], value: number(c.count) }))}
                />
              )}
            </div>
            <div>
              <h3>Top gifts</h3>
              {o.topGifts.length === 0 ? (
                <p className="empty">No gifts yet.</p>
              ) : (
                <BarList
                  caption="Gifts by total coins"
                  series={[{ name: 'Coins', slot: 3 }]}
                  rows={o.topGifts.map((g) => ({ label: g.gift, icon: <GiftImage src={g.image} />, values: [g.coins], value: `${number(g.coins)} (${number(g.count)} sent)` }))}
                />
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// Chat and gifts per minute live, by hour of the day and by weekday, in this computer's time zone. Per minute live, so
// an hour you stream in often doesn't look busy just for that.
function BusiestTimes({ activity }: { activity: AnalyticsOverview['activity'] }) {
  const sum = (key: (a: AnalyticsOverview['activity'][number]) => number, count: number) =>
    Array.from({ length: count }, (_, i) => {
      const cells = activity.filter((a) => key(a) === i);
      const minutes = cells.reduce((n, a) => n + a.minutes, 0);
      const events = cells.reduce((n, a) => n + a.events, 0);
      return { minutes, rate: minutes > 0 ? oneDecimal(events / minutes) : 0 };
    });
  const byHour = sum((a) => a.hour, 24);
  const byDay = sum((a) => a.day, 7);
  const best = (list: { rate: number }[]) => list.reduce((b, x, i) => (x.rate > list[b]!.rate ? i : b), 0);
  const bestHour = best(byHour);
  const bestDay = best(byDay);
  const extra = (minutes: number) => [minutes > 0 ? `${duration(minutes * 60_000)} live` : 'Not live then'];
  return (
    <div>
      <h3>When chat is busiest</h3>
      <p className="muted small">
        Chat and gifts per minute live, in your time zone.
        {byDay[bestDay]!.rate > 0 && ` Busiest on ${dayName(bestDay, 'long')}s, and around ${hourName(bestHour)}.`}
      </p>
      <ColumnChart
        caption="Chat and gifts per minute live, by hour of the day"
        height={120}
        series={[{ name: 'Per minute', slot: 1 }]}
        columns={byHour.map((h, hour) => ({ label: hourName(hour), tick: hour % 6 === 0 ? hourName(hour) : undefined, values: [h.rate], extra: extra(h.minutes) }))}
      />
      <ColumnChart
        caption="Chat and gifts per minute live, by weekday"
        height={120}
        series={[{ name: 'Per minute', slot: 2 }]}
        columns={byDay.map((d, day) => ({ label: dayName(day, 'long'), tick: dayName(day, 'short'), values: [d.rate], extra: extra(d.minutes) }))}
      />
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
function Trends({ streams, selected, onSelect }: { streams: StreamSummary[]; selected?: string; onSelect: (id: string) => void }) {
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
      <div className="analytics-grid aligned">
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

function StreamList({ streams, showAccount }: { streams: StreamSummary[]; showAccount: boolean }) {
  return (
    <Card title="Streams" description="Open one for its full report: who took part, its busiest moments, and everything that happened. Bars on the charts above open theirs too.">
      <div className="table-wrap stream-scroll">
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
              <tr key={s.id} onClick={() => navigate(streamPath(s.id))}>
                <td>
                  {/* The row opens it too; the link is for keyboards, new tabs and copying. */}
                  <Link href={streamPath(s.id)} className="link-button" onClick={(e) => e.stopPropagation()}>
                    {longDate(s.startedAt)}
                  </Link>
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

function StreamReport({ detail, previous, status }: { detail: StreamDetail | null | undefined; previous?: StreamSummary; status: LiveStatus }) {
  // What's being looked into in the activity list; picking it again puts everything back.
  const [focus, setFocus] = useState<ActivityFocus | null>(null);
  const toggle = (next: ActivityFocus) => setFocus((now) => (now && JSON.stringify(now) === JSON.stringify(next) ? null : next));
  if (detail === undefined) return <Spinner />;
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
        <p className="muted small">Click a point to see what happened then.</p>
        <ActivityChart
          detail={detail}
          selected={focus?.keyword || focus?.gift || focus?.viewer ? undefined : focus?.from}
          onSelect={(s) => toggle({ label: s.label, from: s.from, to: s.to })}
        />
      </Card>
      <div className="analytics-grid">
        <Card title="Commands" description="How often each fired, and how often chat asked but it didn't. Click one to see who used it.">
          <CommandUsage detail={detail} selected={focus?.keyword} onSelect={(keyword) => toggle({ label: `the ${keyword} command`, keyword })} />
        </Card>
        <Card title="Peak moments" description="The busiest two minutes, worth checking for clips. Click one to see what happened.">
          <Peaks detail={detail} focus={focus} onSelect={toggle} />
        </Card>
      </div>
      <StreamViewers id={s.id} live={s.endedAt === null} focus={focus} onSelect={toggle} />
      <div className="analytics-grid">
        <Card title="Gifts" description="What viewers sent, by total coins. Click one to see who sent it.">
          <Gifts detail={detail} selected={focus?.gift} onSelect={(gift) => toggle({ label: `${gift} gifts`, gift })} />
        </Card>
        <Card title="Crowd modes" description="Votes in democracy, and the line in queue mode.">
          <Modes detail={detail} />
        </Card>
      </div>
      <ActivityFeed status={status} stream={s.id} storageKey="hyperion-report-activity-open" focus={focus} onClearFocus={() => setFocus(null)} />
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

type ViewerSort = 'coins' | 'commands' | 'comments' | 'likes';
const VIEWER_COLUMNS: { key: ViewerSort; label: string }[] = [
  { key: 'coins', label: 'Coins' },
  { key: 'commands', label: 'Key presses' },
  { key: 'comments', label: 'Chat' },
  { key: 'likes', label: 'Likes' },
];

// Everyone who took part in the stream, biggest gifters first. A name opens their profile; Activity shows what they
// did in this stream, in the list below.
function StreamViewers({ id, live, focus, onSelect }: { id: string; live: boolean; focus: ActivityFocus | null; onSelect: (focus: ActivityFocus) => void }) {
  const [viewers, setViewers] = useState<StreamViewer[] | null>(null);
  const [sort, setSort] = useState<ViewerSort>('coins');
  const [all, setAll] = useState(false);
  useEffect(() => {
    const load = () => api<StreamViewer[]>('GET', `/analytics/streams/${id}/viewers`).then(setViewers);
    void load();
    if (!live) return;
    const timer = setInterval(load, VIEWERS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [id, live]);
  if (!viewers) return <Spinner label="Loading viewers" />;

  // Ties keep the server's order, so the biggest gifter stays ahead of an equal player.
  const sorted = viewers.map((v, i) => ({ v, i })).sort((a, b) => b.v[sort] - a.v[sort] || a.i - b.i).map(({ v }) => v);
  const rows = all ? sorted : sorted.slice(0, VIEWER_ROWS);
  return (
    <Card
      title="Viewers"
      description={`${number(viewers.length)}${viewers.length >= 500 ? '+' : ''} seen in this stream. Click a name for their profile, or Activity for what they did in this stream.`}
    >
      {viewers.length === 0 ? (
        <p className="empty">Nobody did anything this stream.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table stream-viewers">
              <thead>
                <tr>
                  <th>Viewer</th>
                  {VIEWER_COLUMNS.map((c) => (
                    <th key={c.key} className="num" aria-sort={sort === c.key ? 'descending' : undefined}>
                      <button type="button" className={`sort-button ${sort === c.key ? 'on' : ''}`} onClick={() => setSort(c.key)}>
                        {c.label}
                        {sort === c.key && <span aria-hidden="true"> ↓</span>}
                      </button>
                    </th>
                  ))}
                  <th>
                    <span className="sr-only">Activity</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.viewer} className={focus?.viewer === v.viewer ? 'selected' : ''}>
                    <td>
                      <span className="stream-viewer">
                        <ViewerAvatar name={v.name ?? v.viewer} src={v.avatar} />
                        <ViewerLink name={v.viewer} label={v.name} />
                        {v.followed && <span className="tag violet">Followed</span>}
                      </span>
                    </td>
                    {VIEWER_COLUMNS.map((c) => (
                      <td key={c.key} className="num">
                        {v[c.key] === 0 ? <span className="muted">–</span> : number(v[c.key])}
                      </td>
                    ))}
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-pressed={focus?.viewer === v.viewer}
                        onClick={() => onSelect({ label: `${v.name ?? v.viewer}'s activity`, viewer: v.viewer })}
                      >
                        Activity
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > VIEWER_ROWS && (
            <button className="btn btn-ghost" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${number(sorted.length)}`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function Peaks({ detail, focus, onSelect }: { detail: StreamDetail; focus: ActivityFocus | null; onSelect: (focus: ActivityFocus) => void }) {
  if (detail.peaks.length === 0) return <p className="empty">Nothing happened yet.</p>;
  const start = detail.summary.startedAt;
  const offset = (at: number) => clock(Math.round((at - start) / 60_000));
  const busiest = detail.peaks[0]!.events;
  return (
    <ol className="peak-list">
      {detail.peaks.map((p, i) => (
        <li key={p.start}>
          <button
            type="button"
            className="peak-button"
            aria-pressed={focus?.from === p.start && focus?.to === p.end}
            onClick={() => onSelect({ label: `${offset(p.start)} to ${offset(p.end)} into the stream`, from: p.start, to: p.end })}
          >
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
          </button>
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

function Gifts({ detail, selected, onSelect }: { detail: StreamDetail; selected?: string; onSelect: (gift: string) => void }) {
  const { byGift, perHour } = detail.gifts;
  if (byGift.length === 0) return <p className="empty">No gifts this stream.</p>;
  const top = byGift.slice(0, 8);
  const picked = top.findIndex((g) => g.gift === selected);
  return (
    <div className="stack">
      <BarList
        caption="Coins by gift"
        series={[{ name: 'Coins', slot: 3 }]}
        rows={top.map((g) => ({ label: g.gift, icon: <GiftImage src={g.image} />, values: [g.diamonds], value: `${number(g.diamonds)} (${number(g.count)} sent)` }))}
        selected={picked < 0 ? undefined : picked}
        onSelect={(i) => onSelect(top[i]!.gift)}
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
