import { useEffect, useState } from 'react';
import { UI_THEMES, type UiMode, type UiTheme, type UiThemeStyle } from '@hyperion/shared';
import { THEME_SWATCHES } from '@hyperion/theme/swatches';
import { api, type Host } from '../api';
import { Icon, type IconName } from '../icons';
import { Link, navigate } from '../router';
import { Card, Choices, ConfirmButton, ErrorNotice, Seg, Switch, useError } from '../ui';
import { rememberTheme } from '../theme';
import type { PageProps } from './Dashboard';
import { reopenSetup, startTour } from './Onboarding';

// Settings sections, in page order: the side nav links to each card's heading.
const SECTIONS: { id: string; title: string; icon: IconName }[] = [
  { id: 'settings-stream', title: 'Stream', icon: 'live' },
  { id: 'settings-appearance', title: 'Appearance', icon: 'sun' },
  { id: 'settings-account', title: 'Account', icon: 'shield' },
  { id: 'settings-data', title: 'Your data', icon: 'download' },
];

// A card title's icon badge, so each section is easy to spot when scrolling.

export function SettingsPage({ host, refreshHost }: PageProps) {
  const [username, setUsername] = useState(host.tiktokUsername ?? '');
  const [rate, setRate] = useState(host.actionsPerSecond);
  const [saved, setSaved] = useState(false);
  const { error, guard } = useError();
  // Linked to from the Live page while there's no username yet.
  useEffect(() => {
    if (location.hash === '#tiktok-username') document.getElementById('tiktok-username')?.focus();
  }, []);
  const save = guard(() =>
    api('PATCH', '/settings', { tiktokUsername: username.trim() || null, actionsPerSecond: rate })
      .then(refreshHost)
      .then(() => setSaved(true)),
  );

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            <Icon name={s.icon} size={16} />
            {s.title}
          </a>
        ))}
      </nav>
      <div className="stack settings-body">
        <Card id="settings-stream" badge="live" hue="red" title="Stream" description="You must already be live on TikTok before Hyperion can connect to your stream.">
          <ErrorNotice error={error} />
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="form-grid">
              <label className="field">
                TikTok username
                <span className="hint">Each account keeps its own leaderboard and viewer points. Switching back brings them back.</span>
                <input
                  id="tiktok-username"
                  value={username}
                  maxLength={25}
                  onChange={(e) => (setUsername(e.target.value.replace(/[^A-Za-z0-9_.@]/g, '')), setSaved(false))}
                  placeholder="@yourname"
                />
              </label>
              <label className="field">
                Max key presses per second
                <span className="hint">Across all of chat, so a busy stream can't flood your game.</span>
                <input type="number" min={1} max={50} value={rate} onChange={(e) => (setRate(Number(e.target.value)), setSaved(false))} />
              </label>
            </div>
            <div className="row">
              <button className="btn btn-primary">Save</button>
              {saved && <span className="muted">Saved</span>}
            </div>
          </form>
          <AfterStream host={host} refreshHost={refreshHost} />
        </Card>
        <Appearance host={host} refreshHost={refreshHost} />
        <Account host={host} />
        <YourData />
        <footer className="settings-footer muted">
          <span>Hyperion {__APP_VERSION__}</span>
          <Link href="/changelog">Changelog</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <span className="spacer" />
          {host.onboarding !== 'open' && (
            <button className="link-button" onClick={() => void reopenSetup(refreshHost)}>
              Setup guide
            </button>
          )}
          <button className="link-button" onClick={startTour}>
            Take the tour
          </button>
        </footer>
      </div>
    </div>
  );
}

// The dashboard's and companion's look. Applies at once, here and on the paired companions.
function Appearance({ host, refreshHost }: { host: Host; refreshHost: () => Promise<unknown> }) {
  const { error, guard } = useError();
  const save = (patch: { uiTheme?: UiTheme; uiThemeStyle?: UiThemeStyle; uiMode?: UiMode }) => {
    rememberTheme({ theme: patch.uiTheme ?? host.uiTheme, style: patch.uiThemeStyle ?? host.uiThemeStyle, mode: patch.uiMode ?? host.uiMode });
    return guard(() => api('PATCH', '/settings', patch).then(refreshHost))();
  };
  return (
    <Card id="settings-appearance" badge="sun" hue="amber" title="Appearance" description="The look of your dashboard and the companion app.">
      <ErrorNotice error={error} />
      <div className="stack">
        <ThemeFields host={host} save={save} />
        <div className="field">
          What the theme changes
          <span className="hint">Colors only keeps Hyperion's own font and rounded corners with any theme.</span>
          <Seg<UiThemeStyle>
            label="What the theme changes"
            value={host.uiThemeStyle}
            options={[
              ['colors', 'Colors only'],
              ['full', 'Full theme'],
            ]}
            onChange={(uiThemeStyle) => save({ uiThemeStyle })}
          />
        </div>
      </div>
    </Card>
  );
}

// Light or dark and the theme: in Settings and the welcome window. `save` applies a change at once.
export function ThemeFields({ host, save }: { host: Host; save: (patch: { uiTheme?: UiTheme; uiMode?: UiMode }) => unknown }) {
  return (
    <>
      <div className="field">
        Light or dark
        <span className="hint">System matches your computer, and switches when it does.</span>
        <Seg<UiMode>
          label="Light or dark"
          value={host.uiMode}
          options={[
            ['system', 'System'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ]}
          onChange={(uiMode) => save({ uiMode })}
        />
      </div>
      <Choices<UiTheme>
        label="Theme"
        value={host.uiTheme}
        options={UI_THEMES.map(({ id, label }) => [
          id,
          label,
          <>
            <span className="theme-swatch" aria-hidden="true">
              {(['light', 'dark'] as const).map((mode) => {
                const [page, card, accent, second] = THEME_SWATCHES[id][mode];
                return (
                  <span key={mode} className="theme-swatch-half" style={{ background: page }}>
                    <span className="theme-swatch-card" style={{ background: card }}>
                      <span style={{ background: accent }} />
                      <span style={{ background: second }} />
                    </span>
                  </span>
                );
              })}
            </span>
            {THEME_SWATCHES[id].note}
          </>,
        ])}
        onChange={(uiTheme) => save({ uiTheme })}
      />
    </>
  );
}

// Part of the Stream card: what happens when a stream or test session ends.
function AfterStream({ host, refreshHost }: Pick<PageProps, 'host' | 'refreshHost'>) {
  const { error, guard } = useError();
  const save = (streamRecap: boolean) => guard(() => api('PATCH', '/settings', { streamRecap }).then(refreshHost))();
  return (
    <div className="settings-sub">
      <h3>After a stream</h3>
      <ErrorNotice error={error} />
      <Switch checked={host.streamRecap} onChange={save} hint="Peak viewers, new followers, likes, coins, the top player and the busiest moment, over whichever page is open.">
        Show a recap of the stream
      </Switch>
    </div>
  );
}

// A copy of everything the account holds, and deleting it all. Deleting asks for the password and then to confirm.
function YourData() {
  const [password, setPassword] = useState('');
  const { error, guard } = useError();
  const remove = guard(() => api('POST', '/auth/delete-account', { password }).then(() => navigate('/')));

  return (
    <Card id="settings-data" badge="download" hue="teal" title="Your data" description="Take a copy of everything your account holds, or delete it for good.">
      <ErrorNotice error={error} />
      <div className="settings-panels">
        <div className="inset settings-panel">
          <h3>Download a copy</h3>
          <p className="muted small">One JSON file: settings, commands, uploads, stream history and leaderboard. Passwords, keys and tokens are left out.</p>
          <a className="btn" href="/api/auth/export" download>
            <Icon name="download" size={16} />
            Download my data
          </a>
        </div>
        <form className="inset settings-panel settings-danger" onSubmit={(e) => e.preventDefault()}>
          <h3>Delete account</h3>
          <p className="muted small">Removes your settings, uploads, stream history and leaderboard, and disconnects your overlays and companions. It can’t be undone.</p>
          <label className="field">
            <span className="sr-only">Your password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} placeholder="Your password" autoComplete="current-password" />
          </label>
          {password ? (
            <ConfirmButton
              className="btn btn-danger"
              message="Delete your account and everything in it? This can’t be undone."
              confirmLabel="Delete for good"
              onConfirm={() => void remove()}
            >
              Delete account
            </ConfirmButton>
          ) : (
            <button type="button" className="btn btn-danger" disabled title="Type your password first">
              Delete account
            </button>
          )}
        </form>
      </div>
    </Card>
  );
}

// Changing the password signs out every other browser, so a leaked one stops working everywhere at once.
function Account({ host }: { host: Host }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [changed, setChanged] = useState(false);
  const { error, guard } = useError();
  const change = guard(() =>
    api('POST', '/auth/password', { currentPassword: current, newPassword: next }).then(() => {
      setCurrent('');
      setNext('');
      setChanged(true);
    }),
  );
  const signOutEverywhere = guard(() => api('POST', '/auth/logout-all').then(() => navigate('/login')));

  return (
    <Card id="settings-account" badge="shield" hue="indigo" title="Account">
      <div className="settings-who">
        <span className="settings-avatar" aria-hidden="true">
          {host.email[0]?.toUpperCase()}
        </span>
        <div>
          <span className="muted small">Signed in as</span>
          <strong>{host.email}</strong>
        </div>
      </div>
      <ErrorNotice error={error} />
      <form
        className="settings-sub"
        onSubmit={(e) => {
          e.preventDefault();
          void change();
        }}
      >
        <h3>Change password</h3>
        <div className="form-grid">
          <label className="field">
            Current password
            <input type="password" value={current} onChange={(e) => (setCurrent(e.target.value), setChanged(false))} minLength={8} maxLength={128} required autoComplete="current-password" />
          </label>
          <label className="field">
            New password
            <span className="hint">At least 8 characters. Signs you out on every other device.</span>
            <input type="password" value={next} onChange={(e) => (setNext(e.target.value), setChanged(false))} minLength={8} maxLength={128} required autoComplete="new-password" />
          </label>
        </div>
        <div className="row">
          <button className="btn btn-primary">Change password</button>
          {changed && <span className="muted">Changed. Other devices are signed out.</span>}
        </div>
      </form>
      <div className="settings-sub">
        <h3>Sessions</h3>
        <p className="muted small">Signing out doesn’t stop your overlays or paired companions.</p>
        <div className="row">
          <button className="btn" onClick={() => api('POST', '/auth/logout').then(() => navigate('/'))}>
            Log out
          </button>
          <ConfirmButton
            className="btn"
            message="Sign out on every device, this one included? Overlays and paired companions keep working."
            confirmLabel="Sign out everywhere"
            onConfirm={() => void signOutEverywhere()}
          >
            Sign out everywhere
          </ConfirmButton>
        </div>
      </div>
    </Card>
  );
}
