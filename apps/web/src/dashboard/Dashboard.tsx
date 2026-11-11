import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { StreamStats } from '@hyperion/shared';
import { api, type Host, type LiveStatus, type Profile } from '../api';
import { Icon, Logo, type IconName } from '../icons';
import { isDemo, Link, navigate, usePath } from '../router';
import { Glow } from '../site/Glow';
import { rememberTheme } from '../theme';
import { ErrorNotice, ProfileBadge, Spinner, useError } from '../ui';
import { setAutoChatMode, startAutoChat } from './auto-chat-run';
import { useLiveFeed, type LiveFeed } from './live-feed';
import { LivePage } from './LivePage';
import { CommandsPage } from './CommandsPage';
import { ActionsPage } from './ActionsPage';
import { VoicePage } from './VoicePage';
import { LeaderboardPage } from './LeaderboardPage';
import { AnalyticsPage } from './AnalyticsPage';
import { ViewerContext, ViewerPanel } from './ViewerPanel';
import { ProfilesPage } from './ProfilesPage';
import { CompanionPage } from './CompanionPage';
import { OverlayPage } from './OverlayPage';
import { SettingsPage } from './SettingsPage';
import { StreamRecap } from './StreamRecap';
import { LiveDock } from './LiveDock';

export interface PageProps {
  host: Host;
  refreshHost: () => Promise<unknown>;
  status: LiveStatus;
  setStatus: (status: LiveStatus) => void;
  feed: LiveFeed;
}

type Section = { path: string; label: string; blurb: string; icon: IconName; hue: string; page: (props: PageProps) => ReactNode };

// Each section keeps its colour wherever it appears.
const SECTIONS: Section[][] = [
  [
    { path: '/dashboard', label: 'Live', blurb: 'What chat is doing right now, and the controls to go live.', icon: 'live', hue: 'red', page: LivePage },
    { path: '/dashboard/commands', label: 'Commands', blurb: 'What chat types, the key it presses, and how the crowd shares control.', icon: 'commands', hue: 'indigo', page: CommandsPage },
    { path: '/dashboard/actions', label: 'Actions', blurb: 'What happens on stream when viewers follow, gift, subscribe or type a command.', icon: 'gift', hue: 'pink', page: ActionsPage },
    { path: '/dashboard/voice', label: 'Voice', blurb: 'What gets read aloud on your stream, and how it sounds.', icon: 'voice', hue: 'violet', page: VoicePage },
    { path: '/dashboard/leaderboard', label: 'Leaderboard', blurb: 'Who plays the most, and the levels and points viewers earn.', icon: 'leaderboard', hue: 'sky', page: LeaderboardPage },
    { path: '/dashboard/analytics', label: 'Analytics', blurb: 'How your streams are going, and how chat plays.', icon: 'analytics', hue: 'teal', page: AnalyticsPage },
    { path: '/dashboard/profiles', label: 'Game profiles', blurb: 'A set of commands, gifts and crowd mode for each game.', icon: 'profiles', hue: 'teal', page: ProfilesPage },
  ],
  [
    { path: '/dashboard/companion', label: 'Companion', blurb: 'The app on your gaming PC that presses the keys.', icon: 'companion', hue: 'orange', page: CompanionPage },
    { path: '/dashboard/overlay', label: 'Stream overlay', blurb: 'The browser source that puts Hyperion on your stream.', icon: 'overlay', hue: 'sky', page: OverlayPage },
    { path: '/dashboard/settings', label: 'Settings', blurb: 'Your TikTok account, limits, appearance and login.', icon: 'settings', hue: 'muted', page: SettingsPage },
  ],
];

export function Dashboard() {
  const [host, setHost] = useState<Host | null | undefined>(undefined);
  const refresh = useCallback(
    () =>
      api<Host>('GET', '/auth/me')
        .then(setHost)
        .catch(() => setHost(null)),
    [],
  );
  useEffect(() => void refresh(), [refresh]);
  // The account's theme, also remembered for the login page and the next first paint.
  useEffect(() => {
    if (host) rememberTheme({ theme: host.uiTheme, style: host.uiThemeStyle, mode: host.uiMode });
  }, [host?.uiTheme, host?.uiThemeStyle, host?.uiMode]);
  useEffect(() => {
    if (host === null) navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
  }, [host]);

  if (host === undefined) return <Spinner page />;
  if (!host) return null;
  return <Shell host={host} refreshHost={refresh} />;
}

// The demo opens mid-stream: test mode with auto chat already going. Once per visit, so stopping it sticks.
let demoStarted = false;

function Shell({ host, refreshHost }: { host: Host; refreshHost: () => Promise<unknown> }) {
  const path = usePath();
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState<LiveStatus>({ live: false, companionsOnline: 0 });
  const [viewer, setViewer] = useState<string | null>(null); // whose profile is open
  const closeViewer = useCallback(() => setViewer(null), []);
  const feed = useLiveFeed(host.overlayToken);
  useEffect(() => setAutoChatMode(feed.mode?.state), [feed.mode?.state]);
  // A stream that ends while this page is open gets a recap, unless turned off. Its last live totals are kept for it.
  const [recap, setRecap] = useState<{ stats: StreamStats | null } | null>(null);
  const wasLive = useRef(false);
  const lastStats = useRef<StreamStats | null>(null);
  useEffect(() => {
    if (status.live && feed.stats) lastStats.current = feed.stats;
  }, [status.live, feed.stats]);
  useEffect(() => {
    if (wasLive.current && !status.live && host.streamRecap) setRecap({ stats: lastStats.current });
    if (status.live && !wasLive.current) lastStats.current = null; // a new stream's totals start over
    wasLive.current = status.live;
  }, [status.live]);

  useEffect(() => {
    const load = () => api<LiveStatus>('GET', '/live/status').then(setStatus).catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    if (!isDemo() || demoStarted) return;
    demoStarted = true;
    void api<LiveStatus>('POST', '/live/start', { source: 'simulated' }).then((s) => (setStatus(s), startAutoChat()));
  }, []);

  const here = path.replace(/\/$/, '');
  // A section's own pages (like one stream on Analytics) sit under its path.
  const section =
    SECTIONS.flat().find((s) => s.path === here) ?? SECTIONS.flat().find((s) => s.path !== '/dashboard' && here.startsWith(`${s.path}/`)) ?? SECTIONS[0]![0]!;
  const Page = section.page;

  return (
    <div className="app">
      <div className="mobile-bar">
        <Link href="/dashboard" className="brand">
          <Logo size={28} />
          Hyperion
        </Link>
        {status.live && <span className="on-air">On air</span>}
        <ModeToggle host={host} refreshHost={refreshHost} />
        <button className="btn btn-ghost" aria-expanded={menuOpen} aria-controls="sidebar" onClick={() => setMenuOpen(!menuOpen)}>
          <Icon name={menuOpen ? 'close' : 'menu'} size={20} />
          <span className="sr-only">Menu</span>
        </button>
      </div>
      <nav id="sidebar" className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Dashboard">
        {/* The logo keeps you in the app; the public site is reached by its own address. */}
        <Link href="/dashboard" className="brand">
          <Logo />
          Hyperion
        </Link>
        {SECTIONS.map((group, i) => (
          <div key={i} className="nav-group">
            {group.map((s) => (
              <Link key={s.path} href={s.path} className="nav-item" aria-current={s === section ? 'page' : undefined}>
                <span className={`nav-icon ${s.hue}`}>
                  <Icon name={s.icon} />
                </span>
                {s.label}
                {s.path === '/dashboard' && status.live && <span className="on-air">On air</span>}
              </Link>
            ))}
          </div>
        ))}
        <div className="sidebar-account">
          <span className="avatar" aria-hidden="true">
            {(host.tiktokUsername ?? host.email)[0]!.toUpperCase()}
          </span>
          <span>
            <strong>{host.tiktokUsername ? host.tiktokUsername.replace(/^@/, '') : host.email}</strong>
            <span>{host.tiktokUsername ? 'TikTok account' : 'No TikTok account yet'}</span>
          </span>
        </div>
      </nav>

      <main className="content">
        <div className="content-glow" aria-hidden="true">
          <Glow />
        </div>
        {isDemo() && (
          <div className="demo-banner" role="note">
            <span>
              <strong>This is a demo.</strong> The viewers are made up, and nothing you change is saved.
            </span>
            <Link href="/signup" className="btn btn-primary btn-sm">
              Sign up free
            </Link>
          </div>
        )}
        <div className="topbar">
          <span className="crumbs">
            <span>Hyperion</span>
            <span>{host.profileName} profile</span>
            <span>{section.label}</span>
          </span>
          {status.live && <span className="on-air">{status.source === 'simulated' ? 'Test mode' : 'On air'}</span>}
          <div className="spacer" />
          <ProfilePicker host={host} refreshHost={refreshHost} />
          <ModeToggle host={host} refreshHost={refreshHost} />
        </div>
        <header className="page-header">
          <h1>{section.label}</h1>
          <p>{section.blurb}</p>
        </header>
        <ViewerContext.Provider value={setViewer}>
          {/* Keyed by profile so switching profiles reloads everything that belongs to one. */}
          <Page key={host.profileId} host={host} refreshHost={refreshHost} status={status} setStatus={setStatus} feed={feed} />
          {viewer && <ViewerPanel key={viewer} viewer={viewer} live={status.live} onClose={closeViewer} />}
          {/* The Live page has these controls already. */}
          {section.path !== '/dashboard' && <LiveDock host={host} refreshHost={refreshHost} status={status} setStatus={setStatus} feed={feed} />}
          {recap && <StreamRecap stats={recap.stats} refreshHost={refreshHost} onClose={() => setRecap(null)} />}
        </ViewerContext.Provider>
      </main>
    </div>
  );
}

// Light or dark in one click, from any page. It switches to the opposite of what shows now, even when following
// the system; Settings, Appearance can set it back to the system's.
function ModeToggle({ host, refreshHost }: { host: Host; refreshHost: () => Promise<unknown> }) {
  const [, redraw] = useState(0); // the page switches at once, so the icon does too, before the save comes back
  const dark = document.documentElement.dataset.mode === 'dark';
  const next = dark ? 'light' : 'dark';
  const toggle = () => {
    rememberTheme({ theme: host.uiTheme, style: host.uiThemeStyle, mode: next });
    redraw((n) => n + 1);
    void api('PATCH', '/settings', { uiMode: next }).then(refreshHost);
  };
  return (
    <button className="btn btn-ghost btn-icon mode-toggle" onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <Icon name={dark ? 'sun' : 'moon'} size={18} />
    </button>
  );
}

// The active game profile, and a menu to switch: each profile with the game the companion follows for it.
function ProfilePicker({ host, refreshHost }: { host: Host; refreshHost: () => Promise<unknown> }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { error, guard } = useError();
  useEffect(() => void api<Profile[]>('GET', '/profiles').then(setProfiles), [host]);
  const activate = (id: string) => {
    setSwitching(id);
    return guard(() =>
      api('POST', `/profiles/${id}/activate`)
        .then(refreshHost)
        .then(() => setOpen(false))
        .finally(() => setSwitching(null)),
    )();
  };

  // A click outside or Escape closes the menu; Escape puts focus back on the button.
  useEffect(() => {
    if (!open) return;
    const click = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('.profile-trigger')?.focus();
    };
    document.addEventListener('pointerdown', click);
    document.addEventListener('keydown', key);
    root.current?.querySelector<HTMLButtonElement>('.profile-option[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  // Up and down move between profiles in the menu.
  const arrows = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const options = [...(root.current?.querySelectorAll<HTMLButtonElement>('.profile-option') ?? [])];
    const at = options.indexOf(document.activeElement as HTMLButtonElement);
    options[(at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
  };

  return (
    <div className="profile-picker" ref={root}>
      <button className="profile-trigger" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} title="Switch game profile">
        <ProfileBadge name={host.profileName} />
        <span className="profile-trigger-text">
          <span className="muted small">Game profile</span>
          <strong>{host.profileName}</strong>
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <div className="profile-menu" role="radiogroup" aria-label="Game profiles" onKeyDown={arrows}>
          <div className="profile-menu-head muted small">Switch profile. Commands, gifts and crowd mode change with it, even while live.</div>
          <ul>
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  className="profile-option"
                  role="radio"
                  aria-checked={p.id === host.profileId}
                  disabled={switching !== null}
                  onClick={() => (p.id === host.profileId ? setOpen(false) : void activate(p.id))}
                >
                  <ProfileBadge name={p.name} />
                  <span className="profile-option-text">
                    <strong>{p.name}</strong>
                    <span className="muted small">{p.gameProcess ? `Follows ${p.gameProcess}` : 'Any game'}</span>
                  </span>
                  {switching === p.id ? <Spinner label="Switching" /> : p.id === host.profileId && <span className="tag teal">Active</span>}
                </button>
              </li>
            ))}
          </ul>
          <Link href="/dashboard/profiles" className="profile-menu-manage" onClick={() => setOpen(false)}>
            <Icon name="plus" size={14} />
            New or edit profiles
          </Link>
        </div>
      )}
      <ErrorNotice error={error} />
    </div>
  );
}
