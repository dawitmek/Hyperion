import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GAME_TEMPLATES, type Mode, type UiMode, type UiTheme } from '@hyperion/shared';
import { GAME_TEMPLATE_ICONS } from '@hyperion/shared/game-icons';
import { api, ApiError, type Host, type Profile } from '../api';
import { Icon, Logo } from '../icons';
import { isDemo } from '../router';
import { rememberTheme } from '../theme';
import { ErrorNotice, HueIcon, useError } from '../ui';
import { ModeDemo } from './ModeDemo';
import { MODE_ICONS, ModeTiles } from './ModePicker';
import { MODE_INFO } from './modes';
import { startTour } from './Onboarding';
import { ThemeFields } from './SettingsPage';

type HostProps = { host: Host; refreshHost: () => Promise<unknown> };

const STEPS = ['name', 'game', 'mode', 'look'] as const;
type Step = (typeof STEPS)[number];
const OTHER_GAME = 'other';
const isMove = (keyword: string) => keyword.length === 1 || ['left', 'right', 'up', 'down', 'forward', 'back', 'backward'].includes(keyword);

// The first thing a new account sees: a few questions that set it up, any of them skippable. Closing it, however it's
// closed, hands over to the setup checklist on the Live page.
export function Welcome(props: HostProps) {
  if (isDemo() || props.host.onboarding !== 'new') return null;
  return <WelcomeDialog {...props} />;
}

function WelcomeDialog({ host, refreshHost }: HostProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState(host.tiktokUsername ?? '');
  const [game, setGame] = useState<string>(OTHER_GAME);
  const [madeGame, setMadeGame] = useState<string | null>(null); // the template whose profile was made, so Back then Next doesn't make it twice
  const [busy, setBusy] = useState(false);
  const tour = useRef(false);
  const { error, guard, setError } = useError();
  useEffect(() => dialog.current?.showModal(), []);
  const at = STEPS.indexOf(step);

  // What each step saves when you move on from it.
  const saveStep = async () => {
    if (step === 'name') {
      const typed = name.trim().replace(/^@/, '');
      if (typed && typed !== host.tiktokUsername) await api('PATCH', '/settings', { tiktokUsername: typed });
    }
    if (step === 'game' && game !== OTHER_GAME && game !== madeGame) {
      const template = GAME_TEMPLATES.find((t) => t.id === game)!;
      const games = template.processes.map((process) => ({ process, icon: null }));
      const made = await api<Profile>('POST', '/profiles', { name: template.name, games, template: template.id }).catch(async (e) => {
        // There's one by that name already: use it.
        if (!(e instanceof ApiError) || e.status !== 409) throw e;
        const found = (await api<Profile[]>('GET', '/profiles')).find((p) => p.name === template.name);
        if (!found) throw e;
        return found;
      });
      await api('POST', `/profiles/${made.id}/activate`);
      setMadeGame(game);
    }
    await refreshHost();
  };
  const next = () =>
    guard(async () => {
      setBusy(true);
      try {
        await saveStep();
        if (at === STEPS.length - 1) dialog.current?.close();
        else setStep(STEPS[at + 1]!);
      } finally {
        setBusy(false);
      }
    })();
  const finish = (withTour: boolean) => {
    tour.current = withTour;
    void next();
  };
  // Every way out (Finish, Skip, Escape) ends here: the checklist takes over.
  const closed = () =>
    void api('PATCH', '/settings', { onboarding: 'open' })
      .then(refreshHost)
      .then(() => tour.current && startTour());

  const saveLook = (patch: { uiTheme?: UiTheme; uiMode?: UiMode }) => {
    rememberTheme({ theme: patch.uiTheme ?? host.uiTheme, style: host.uiThemeStyle, mode: patch.uiMode ?? host.uiMode });
    return guard(() => api('PATCH', '/settings', patch).then(refreshHost))();
  };
  const saveMode = (mode: Mode) => guard(() => api('PATCH', '/settings', { mode }).then(refreshHost))();

  const handle = name.trim().replace(/^@/, '');
  const template = GAME_TEMPLATES.find((t) => t.id === game);
  const pages: Record<Step, { label: string; hue: string; title: string; lead: string; art: ReactNode; body: ReactNode }> = {
    name: {
      label: 'Your account',
      hue: 'red',
      title: 'Welcome to Hyperion',
      lead: 'Your TikTok chat plays your game. Four quick questions get you set up. Skip any of them and change it later in Settings.',
      art: <LivePreview handle={handle} />,
      body: (
        <div className="stack">
          <label className="field">
            Your TikTok username
            <span className="hint">The account Hyperion listens to when you go live.</span>
            <span className="handle-field">
              <span aria-hidden="true">@</span>
              <input
                value={name.replace(/^@/, '')}
                maxLength={24}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                // Not a login: keep password managers from offering to fill it. Bitwarden goes by the word "username"
                // and doesn't always honour data-bwignore, but it never fills a search field.
                type="search"
                data-bwignore="true"
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                placeholder="yourname"
                onChange={(e) => (setName(e.target.value.replace(/[^A-Za-z0-9_.]/g, '')), setError(null))}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), next())}
              />
            </span>
          </label>
          <div className="welcome-next">
            <span className="muted small">Up next</span>
            <ol>
              <li>
                <HueIcon name="cube" hue="indigo" size="sm" />
                Your game
              </li>
              <li>
                <Icon name="chevron" size={14} />
                <HueIcon name="crowd" hue="orange" size="sm" />
                How chat plays
              </li>
              <li>
                <Icon name="chevron" size={14} />
                <HueIcon name="sun" hue="amber" size="sm" />
                Your look
              </li>
            </ol>
          </div>
        </div>
      ),
    },
    game: {
      label: 'Your game',
      hue: 'indigo',
      title: 'What do you play?',
      lead: 'Pick a game and its controls come ready as chat commands. Make profiles for your other games later.',
      art: (
        <span className="welcome-art-tile">
          {template ? <img src={GAME_TEMPLATE_ICONS[template.id]} alt="" /> : <Icon name="sparkle" size={34} />}
        </span>
      ),
      body: (
        <div className="game-cards" role="radiogroup" aria-label="Game">
          {[...GAME_TEMPLATES, null].map((t) => {
            const id = t?.id ?? OTHER_GAME;
            return (
              <label key={id} className={`game-card ${game === id ? 'selected' : ''}`}>
                <input type="radio" name="welcome-game" checked={game === id} onChange={() => setGame(id)} />
                <span className="game-card-icon">{t ? <img src={GAME_TEMPLATE_ICONS[t.id]} alt="" /> : <Icon name="sparkle" size={20} />}</span>
                <span className="game-card-text">
                  <strong>{t?.name ?? 'Something else'}</strong>
                  <span className="game-card-keys">
                    {t ? (
                      <>
                        {/* Words like jump or attack say more about a game than moving about. */}
                        {[...t.commands].sort((a, b) => Number(isMove(a.keyword)) - Number(isMove(b.keyword))).slice(0, 3).map((c) => (
                          <kbd key={c.keyword} className="kbd">{c.keyword}</kbd>
                        ))}
                        {t.commands.length > 3 && <span className="muted small">+{t.commands.length - 3}</span>}
                      </>
                    ) : (
                      <span className="muted small">Basic commands to make your own</span>
                    )}
                  </span>
                </span>
                <span className="game-card-check" aria-hidden="true">
                  <Icon name="check" size={12} strokeWidth={3} />
                </span>
              </label>
            );
          })}
        </div>
      ),
    },
    mode: {
      label: 'How chat plays',
      hue: 'orange',
      title: 'How should chat play?',
      lead: 'The crowd mode decides whose commands go through. Switch any time, even mid-stream.',
      art: (
        <span className={`welcome-art-tile mode-is-${host.mode}`}>
          <Icon name={MODE_ICONS[host.mode]} size={34} />
        </span>
      ),
      body: (
        <div className="stack welcome-mode">
          <ModeTiles value={host.mode} onChange={saveMode} />
          <p className="muted">{MODE_INFO[host.mode].help}</p>
          <ModeDemo mode={host.mode} />
        </div>
      ),
    },
    look: {
      label: 'Your look',
      hue: 'amber',
      title: 'Pick a look',
      lead: 'For the dashboard and the companion app. It changes behind this window as you pick.',
      art: (
        <span className="welcome-art-tile">
          <Icon name={document.documentElement.dataset.mode === 'dark' ? 'moon' : 'sun'} size={34} />
        </span>
      ),
      body: (
        <div className="stack">
          <ThemeFields host={host} save={saveLook} />
        </div>
      ),
    },
  };
  const page = pages[step];

  return (
    <dialog ref={dialog} className="welcome-dialog" onClose={closed} aria-labelledby="welcome-title">
      <header className="welcome-hero" style={{ '--hero': `var(--${page.hue})` } as CSSProperties}>
        <div className="welcome-top">
          <span className="welcome-brand">
            <Logo size={24} />
            Hyperion
          </span>
          <ol className="welcome-progress" aria-label={`Step ${at + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <li key={s} className={i < at ? 'done' : i === at ? 'current' : ''} aria-current={i === at ? 'step' : undefined}>
                <span className="sr-only">{pages[s].label}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="welcome-hero-main">
          <div className="welcome-hero-text">
            <span className="welcome-eyebrow">
              Step {at + 1} of {STEPS.length} · {page.label}
            </span>
            <h2 id="welcome-title">{page.title}</h2>
            <p>{page.lead}</p>
          </div>
          <div className="welcome-art" aria-hidden="true">
            {page.art}
          </div>
        </div>
      </header>
      <div className="welcome-body" key={step}>
        {page.body}
        <ErrorNotice error={error} />
      </div>
      <div className="row welcome-buttons">
        <button className="btn btn-ghost btn-sm" onClick={() => dialog.current?.close()} title="The setup checklist on the Live page still has everything">
          Skip setup
        </button>
        <span className="spacer" />
        {at > 0 && (
          <button className="btn" onClick={() => setStep(STEPS[at - 1]!)} disabled={busy}>
            Back
          </button>
        )}
        {at < STEPS.length - 1 ? (
          <button className="btn btn-primary" onClick={next} disabled={busy}>
            {step === 'name' && !handle ? 'Skip for now' : 'Next'}
            <Icon name="chevron" size={16} />
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => finish(false)} disabled={busy}>
              Finish
            </button>
            <button className="btn btn-primary" onClick={() => finish(true)} disabled={busy}>
              Finish and take the tour
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}

// What the name step's picture shows: the host's stream as Hyperion will see it, with the name as it's typed.
function LivePreview({ handle }: { handle: string }) {
  return (
    <div className="live-preview">
      <div className="live-preview-head">
        <span className="live-preview-avatar">{handle ? handle[0]!.toUpperCase() : '?'}</span>
        <span className="live-preview-name">
          <strong className={handle ? '' : 'muted'}>@{handle || 'yourname'}</strong>
          <span className="live-preview-live">LIVE</span>
        </span>
      </div>
      <ul className="live-preview-chat">
        <li>
          <b>mia</b> jump
        </li>
        <li>
          <b>jay</b> left
        </li>
        <li>
          <b>sam</b> jump
        </li>
      </ul>
    </div>
  );
}
