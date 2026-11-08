import { useState } from 'react';
import { UI_THEMES, type UiMode, type UiTheme, type UiThemeStyle } from '@hyperion/shared';
import { THEME_SWATCHES } from '@hyperion/theme/swatches';
import { api, type Host } from '../api';
import { navigate } from '../router';
import { Card, Choices, ConfirmButton, ErrorNotice, Seg, Switch, useError } from '../ui';
import { rememberTheme } from '../theme';
import type { PageProps } from './Dashboard';

export function SettingsPage({ host, refreshHost }: PageProps) {
  const [username, setUsername] = useState(host.tiktokUsername ?? '');
  const [rate, setRate] = useState(host.actionsPerSecond);
  const [saved, setSaved] = useState(false);
  const { error, guard } = useError();
  const save = guard(() =>
    api('PATCH', '/settings', { tiktokUsername: username.trim() || null, actionsPerSecond: rate })
      .then(refreshHost)
      .then(() => setSaved(true)),
  );

  return (
    <div className="stack">
      <Card title="Stream" description="You must already be live on TikTok before Hyperion can connect to your stream.">
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
      </Card>
      <AfterStream host={host} refreshHost={refreshHost} />
      <Appearance host={host} refreshHost={refreshHost} />
      <Account host={host} />
      <Card title="About">
        <span className="muted">Hyperion version {__APP_VERSION__}</span>
      </Card>
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
    <Card title="Appearance" description="The look of your dashboard and the companion app.">
      <ErrorNotice error={error} />
      <div className="stack">
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

function AfterStream({ host, refreshHost }: Pick<PageProps, 'host' | 'refreshHost'>) {
  const { error, guard } = useError();
  const save = (streamRecap: boolean) => guard(() => api('PATCH', '/settings', { streamRecap }).then(refreshHost))();
  return (
    <Card title="After a stream" description="What the dashboard does when a stream or test session ends.">
      <ErrorNotice error={error} />
      <Switch checked={host.streamRecap} onChange={save} hint="Peak viewers, new followers, likes, coins, the top player and the busiest moment, over whichever page is open.">
        Show a recap of the stream
      </Switch>
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
    <Card title="Account" description={`Signed in as ${host.email}.`}>
      <ErrorNotice error={error} />
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void change();
        }}
      >
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
    </Card>
  );
}
