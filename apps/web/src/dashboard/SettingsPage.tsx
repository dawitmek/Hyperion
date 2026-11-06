import { useState } from 'react';
import { UI_THEMES, type UiMode, type UiTheme, type UiThemeStyle } from '@hyperion/shared';
import { api, type Host } from '../api';
import { navigate } from '../router';
import { Card, Choices, ErrorNotice, Seg, Switch, useError } from '../ui';
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
      <Card title="Account" description={`Signed in as ${host.email}.`}>
        <div className="row">
          <button className="btn" onClick={() => api('POST', '/auth/logout').then(() => navigate('/'))}>
            Log out
          </button>
        </div>
      </Card>
      <Card title="About">
        <span className="muted">Hyperion version {__APP_VERSION__}</span>
      </Card>
    </div>
  );
}

// Each theme's light and dark look, for its swatch: page, card, accent, second accent.
const SWATCHES: Record<UiTheme, { light: string[]; dark: string[]; note: string }> = {
  default: { light: ['#f6f6f9', '#ffffff', '#5b5fef', '#e5469a'], dark: ['#0a0b12', '#171a25', '#6366f1', '#a855f7'], note: 'Indigo and plasma, with Geist.' },
  legacy: { light: ['#f6f6f9', '#ffffff', '#0b0c12', '#5b5fef'], dark: ['#07080c', '#141720', '#ffffff', '#6366f1'], note: 'The original look: indigo and plasma on plain black and white, with Geist.' },
  'solar-dusk': { light: ['#fdfbf7', '#f1e9da', '#b45309', '#ca8a04'], dark: ['#1c1917', '#292524', '#f97316', '#0ea5e9'], note: 'Parchment and amber, with Oxanium and sharp corners.' },
  'graphite-mono': { light: ['#ffffff', '#f0f0f0', '#171717', '#3b82f6'], dark: ['#171717', '#262626', '#e5e5e5', '#3b82f6'], note: 'Black, white and grays with a blue accent, with DM Sans and soft corners.' },
  'sage-mist': { light: ['#fdfdfd', '#f5f5f5', '#afbea5', '#495940'], dark: ['#070503', '#1e1a14', '#afbea5', '#495940'], note: 'Sage and olive on white or near-black, with Plus Jakarta Sans and round corners.' },
  'mocha-cream': { light: ['#f9f9f9', '#efefef', '#644a40', '#ffdfb5'], dark: ['#111111', '#222222', '#ffe0c2', '#393028'], note: 'Mocha brown and peach cream on light gray or near-black, with medium corners.' },
  tangerine: { light: ['#e8ebed', '#ffffff', '#e05d38', '#86a7c8'], dark: ['#1c2433', '#2a3040', '#e05d38', '#5a7ca6'], note: 'Tangerine and slate blue on cool gray or deep navy, with Inter.' },
};

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
                  const [page, card, accent, second] = SWATCHES[id][mode];
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
              {SWATCHES[id].note}
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
