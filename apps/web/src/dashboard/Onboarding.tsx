import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ONBOARDING_STEPS, type OnboardingState, type OnboardingStep } from '@hyperion/shared';
import { api, type Host, type LiveStatus } from '../api';
import { stopAutoChat } from './auto-chat-run';
import { Icon, type IconName } from '../icons';
import { isDemo, Link, navigate, usePath } from '../router';
import { Card, ErrorNotice, hueStyle, useError, type Hue } from '../ui';
import type { PageProps } from './Dashboard';

type HostProps = { host: Host; refreshHost: () => Promise<unknown> };

const setOnboarding = (onboarding: OnboardingState, refreshHost: () => Promise<unknown>) => api('PATCH', '/settings', { onboarding }).then(refreshHost);

// Ticks off steps the moment they're done, from anywhere in the dashboard: a companion paired on its page counts.
// Steps are saved once done, so one that only shows for a while (a companion online, a test stream) stays ticked.
export function useSetupSteps({ host, refreshHost, status }: HostProps & { status: LiveStatus }) {
  const sent = useRef(new Set<OnboardingStep>());
  const seen: Partial<Record<OnboardingStep, boolean>> = {
    tiktok: !!host.tiktokUsername,
    game: host.profileGames.length > 0,
    companion: status.companionsOnline > 0,
    test: status.live && status.source === 'simulated' && !startedTest.current, // the tour's own test stream doesn't count
  };
  const fresh = ONBOARDING_STEPS.filter((s) => seen[s] && !host.onboardingSteps.includes(s) && !sent.current.has(s));
  useEffect(() => {
    if (isDemo() || host.onboarding === 'done' || host.onboarding === 'skipped' || !fresh.length) return;
    fresh.forEach((s) => sent.current.add(s));
    void markSteps(host, fresh).then(refreshHost);
  }, [fresh.join()]);
}

const markSteps = (host: Host, steps: OnboardingStep[]) =>
  api('PATCH', '/settings', { onboardingSteps: ONBOARDING_STEPS.filter((s) => host.onboardingSteps.includes(s) || steps.includes(s)) });

// The setup guide, on top of the Live page until it's finished, skipped or tucked into the sidebar.
export function SetupGuide({ host, refreshHost, status, setStatus }: PageProps) {
  const { error, guard } = useError();
  if (isDemo() || host.onboarding !== 'open') return null;
  const done = (s: OnboardingStep) => host.onboardingSteps.includes(s);
  const count = ONBOARDING_STEPS.filter(done).length;
  const all = count === ONBOARDING_STEPS.length;
  const leave = (state: OnboardingState) => guard(() => setOnboarding(state, refreshHost));
  const next = ONBOARDING_STEPS.find((s) => !done(s));
  const state = (s: OnboardingStep): StepState => (done(s) ? 'done' : s === next ? 'next' : 'later');
  // The next step's button leads; a done step's is quiet.
  const button = (s: OnboardingStep) => `btn btn-sm ${done(s) ? 'btn-ghost' : s === next ? 'btn-primary' : ''}`;

  return (
    <Card
      id="setup-guide"
      badge="sparkle"
      hue="indigo"
      className="setup-guide"
      title={all ? "You're all set" : 'Get started'}
      description={all ? 'Go live on TikTok, then press Start on this page. Chat takes it from there.' : 'A few steps to your first crowd-played stream. Each one ticks itself off.'}
      actions={
        <div className="row setup-guide-actions">
          <button className="btn btn-sm" onClick={startTour}>
            <Icon name="flow" size={14} />
            Take the tour
          </button>
          {all ? (
            <button className="btn btn-primary btn-sm" onClick={leave('done')}>
              Finish
            </button>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={leave('collapsed')} title="Keep it in the sidebar">
                Hide for now
              </button>
              <button className="btn btn-ghost btn-sm" onClick={leave('skipped')} title="You can bring it back in Settings">
                Skip setup
              </button>
            </>
          )}
        </div>
      }
    >
      <ErrorNotice error={error} />
      <div className="setup-meter">
        <div className="setup-progress" role="progressbar" aria-label="Setup" aria-valuemin={0} aria-valuemax={ONBOARDING_STEPS.length} aria-valuenow={count}>
          {ONBOARDING_STEPS.map((s) => (
            <span key={s} className={done(s) ? 'on' : ''} />
          ))}
        </div>
        <span className="setup-count">
          <strong>{count}</strong> of {ONBOARDING_STEPS.length} done
        </span>
      </div>
      <ol className="setup-steps">
        <SetupStep state={state('tiktok')} icon="live" hue="red" title="Add your TikTok username" hint="The account Hyperion listens to when you go live.">
          {done('tiktok') && host.tiktokUsername ? (
            <Link href="/dashboard/settings" className={button('tiktok')}>
              @{host.tiktokUsername}
            </Link>
          ) : (
            <TiktokField refreshHost={refreshHost} />
          )}
        </SetupStep>
        <SetupStep state={state('game')} icon="profiles" hue="indigo" title="Choose your game profile" hint="Each game gets its own commands, and the companion knows which program gets the keys.">
          <Link href="/dashboard/profiles" className={button('game')}>
            {done('game') ? host.profileName : 'Pick a game'}
          </Link>
        </SetupStep>
        <SetupStep state={state('companion')} icon="companion" hue="orange" title="Pair the companion app" hint="It runs on your gaming PC and presses the keys chat sends.">
          <Link href="/dashboard/companion" className={button('companion')}>
            {done('companion') ? 'Paired' : 'Pair it'}
          </Link>
        </SetupStep>
        <SetupStep state={state('overlay')} icon="overlay" hue="sky" title="Add the overlay to your stream" hint="Paste its link as a browser source in TikTok LIVE Studio or OBS.">
          <CopyOverlay
            className={button('overlay')}
            url={`${location.origin}/overlay/${host.overlayToken}`}
            onCopied={() => !done('overlay') && void guard(() => markSteps(host, ['overlay']).then(refreshHost))()}
          />
        </SetupStep>
        <SetupStep state={state('test')} icon="play" hue="green" title="Try a test stream" hint="Made-up viewers chat and play, so you see it all work before going live.">
          <button
            className={button('test')}
            disabled={status.live}
            onClick={guard(() => api<LiveStatus>('POST', '/live/start', { source: 'simulated' }).then(setStatus))}
          >
            <Icon name="play" size={14} />
            {status.live && status.source === 'simulated' ? 'Running' : 'Start a test'}
          </button>
        </SetupStep>
      </ol>
    </Card>
  );
}

type StepState = 'done' | 'next' | 'later';

// One step: its icon (a check once done), what it is, and what to do. The next one to do stands out.
function SetupStep({ state, icon, hue, title, hint, children }: { state: StepState; icon: IconName; hue: Hue; title: string; hint: string; children: ReactNode }) {
  return (
    <li className={`setup-step ${state}`} style={hueStyle(hue)}>
      <span className="setup-step-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
        {state === 'done' && (
          <span className="setup-step-tick">
            <Icon name="check" size={10} strokeWidth={3.5} />
          </span>
        )}
      </span>
      <span className="setup-step-text">
        <strong>
          {title}
          {state === 'done' && <span className="sr-only"> (done)</span>}
        </strong>
        {state === 'next' && <span className="setup-next-tag">Next</span>}
        <span className="muted small">{hint}</span>
      </span>
      <span className="setup-step-action">{children}</span>
    </li>
  );
}

function TiktokField({ refreshHost }: { refreshHost: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const { error, guard } = useError();
  return (
    <form
      className="row setup-tiktok"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.replace(/^@/, '')) void guard(() => api('PATCH', '/settings', { tiktokUsername: name.trim() }).then(refreshHost))();
      }}
    >
      <input className="input" value={name} maxLength={25} placeholder="@yourname" aria-label="TikTok username" onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_.@]/g, ''))} />
      <button className="btn btn-primary btn-sm">Save</button>
      <ErrorNotice error={error} />
    </form>
  );
}

function CopyOverlay({ url, onCopied, className }: { url: string; onCopied: () => void; className: string }) {
  const [copied, setCopied] = useState(false);
  const { error, guard } = useError();
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span className="row">
      <button className={className} onClick={guard(() => navigator.clipboard.writeText(url).then(() => (setCopied(true), onCopied())))}>
        <Icon name="copy" size={14} />
        {copied ? 'Copied' : error ? "Couldn't copy" : 'Copy link'}
      </button>
      <Link href="/dashboard/overlay" className="btn btn-ghost btn-sm">
        Design it
      </Link>
    </span>
  );
}

// The guide while it's tucked away: a line in the sidebar that brings it back.
export function SetupNavItem({ host, refreshHost }: HostProps) {
  if (isDemo() || host.onboarding !== 'collapsed') return null;
  const count = host.onboardingSteps.length;
  return (
    <button className="nav-item setup-nav" onClick={() => void setOnboarding('open', refreshHost).then(() => navigate('/dashboard'))}>
      <span className="nav-icon indigo">
        <Icon name="sparkle" />
      </span>
      Get started
      <span className="setup-nav-count">
        {count}/{ONBOARDING_STEPS.length}
      </span>
    </button>
  );
}

// Shows the guide again, from Settings, after it was skipped or finished.
export function reopenSetup(refreshHost: () => Promise<unknown>) {
  return setOnboarding('open', refreshHost).then(() => navigate('/dashboard'));
}

// The quick tour: the parts of the dashboard that aren't obvious at a glance, each tip beside the thing it's about.
// A tip can take you to its page first. One whose part isn't there (a card the host hid, a page with nothing on it
// yet) is passed over. Only ever started by the host.
// `open` runs once as the step starts, to show what the tip is about (a tab, test mode).
type TourContext = { status: LiveStatus; setStatus: (status: LiveStatus) => void; startedTest: { current: boolean } };
type TourStep = { page?: string; target?: string; open?: (ctx: TourContext) => unknown; title: string; body: string };

// Clicks the tab (a Seg option) with this label, if it isn't chosen already.
const pickTab = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.seg [role="radio"]')].find((b) => b.textContent === label && b.getAttribute('aria-checked') !== 'true')?.click();

const TOUR: TourStep[] = [
  {
    page: '/dashboard',
    title: 'A quick tour',
    body: 'The handy bits that are easy to miss. Use the arrow keys to move through, and Esc to leave whenever you like.',
  },
  {
    page: '/dashboard',
    target: '.status-tiles',
    title: 'Going live',
    body: 'Go live on TikTok first, then press Go live here. These tiles show the stream, your companion and how busy chat is.',
  },
  {
    page: '/dashboard',
    target: '[data-tour="auto-chat"]',
    // Test mode, unless a stream is already on. The tour turns it off again when it ends.
    open: async ({ status, setStatus, startedTest }) => {
      if (status.live) return;
      startedTest.current = true;
      setStatus(await api<LiveStatus>('POST', '/live/start', { source: 'simulated' }));
    },
    title: 'Test mode and auto chat',
    body: 'Test mode runs a stream without TikTok. Start auto chat and a made-up crowd types your real commands and sends gifts, for trying things out or recording a demo.',
  },
  {
    page: '/dashboard',
    target: '[data-tour="arrange"]',
    title: 'Make this page yours',
    body: 'Add cards like coins, likes or the last follower, drag them between the columns, and hide what you don’t use.',
  },
  {
    page: '/dashboard',
    target: '[data-tour="pop-out"]',
    title: 'Chat on a second screen',
    body: 'Pop the activity feed into a window of its own. It keeps going while you use other pages.',
  },
  {
    page: '/dashboard/commands',
    target: '.live-dock, .live-dock-pill',
    title: 'Your controls follow you',
    body: 'Off the Live page, the stream controls wait in this corner: go live, switch crowd mode or stop from anywhere. Shrink them to a pill when they’re in the way.',
  },
  {
    page: '/dashboard/commands',
    target: '.deck-layout > div:first-child, .command-open', // the commands, in the map or tiles; or the first one in the list view
    title: 'Change many commands at once',
    body: 'Shift- or Ctrl-click commands, hold one down, or press Ctrl+A for all, then set their cooldown, cost or level together.',
  },
  {
    page: '/dashboard/alerts',
    target: '[data-tour="uploads"]',
    title: 'Your own pictures and sounds',
    body: 'Upload images, GIFs, videos and sounds here, then pick them for any alert. Built-in ones are there too, and don’t use up your space.',
  },
  {
    page: '/dashboard/overlay',
    target: '.page-tools .seg',
    open: () => pickTab('Widget links'),
    title: 'One widget at a time',
    body: 'Widget links give each widget, like the leaderboard or a goal bar, a browser source of its own, so you can place it anywhere in OBS or LIVE Studio.',
  },
  {
    target: '.topbar .profile-trigger',
    title: 'One profile per game',
    body: 'Commands, gifts and crowd mode change with the profile, even mid-stream. Give a profile its game and keys only go to that game while it’s in front.',
  },
  {
    target: '.sidebar [data-tour="/dashboard/settings"]',
    title: 'That’s the tour',
    body: 'Take it again any time from Settings, where your TikTok account and theme are too.',
  },
];

// A test stream the tour started and stopped gets no recap: there was nothing to sum up.
let tourTestStopped = false;
export const takeTourTestStopped = () => {
  const was = tourTestStopped;
  tourTestStopped = false;
  return was;
};

// The tour turned test mode on, so it turns it off at the end; and it doesn't tick the checklist's test step.
const startedTest = { current: false };

const tourStarts = new Set<() => void>();
export const startTour = () => tourStarts.forEach((start) => start());

export function Tour({ status, setStatus }: { status: LiveStatus; setStatus: (status: LiveStatus) => void }) {
  const path = usePath();
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [found, setFound] = useState(false); // the step's part was looked for (and is there, or it has none)
  const tip = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 160 });
  const forward = useRef(true); // which way to pass over a step whose part isn't there
  const startedOn = useRef('/dashboard');
  const opened = useRef(-1); // the step whose `open` has run
  const live = useRef({ status, setStatus });
  live.current = { status, setStatus };
  useEffect(() => {
    const start = () => {
      startedOn.current = appPathNow();
      forward.current = true;
      startedTest.current = false;
      opened.current = -1;
      setStep(0);
    };
    tourStarts.add(start);
    return () => void tourStarts.delete(start);
  }, []);

  const go = (to: number | null) => {
    if (to === null || to >= TOUR.length) {
      setStep(null);
      navigate(startedOn.current); // back where the tour began
      if (startedTest.current) {
        startedTest.current = false;
        stopAutoChat();
        tourTestStopped = true;
        void api<LiveStatus>('POST', '/live/stop').then(live.current.setStatus);
      }
      return;
    }
    forward.current = step === null || to > step;
    setStep(Math.max(0, to));
  };
  const current = step === null ? null : TOUR[step]!;

  // Opens the step's page, waits a moment for its part to show, then follows it on scroll and resize. Hidden parts
  // (the sidebar on a phone) get the tip in the middle instead.
  useLayoutEffect(() => {
    setFound(false);
    if (!current) return;
    if (current.page && current.page !== path) {
      navigate(current.page);
      return; // runs again on the new page
    }
    if (current.open && opened.current !== step) {
      opened.current = step!;
      void Promise.resolve(current.open({ ...live.current, startedTest })).catch(() => {});
    }
    let el: HTMLElement | null = null;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle: ReturnType<typeof setTimeout>[] = [];
    // Into the middle of the screen, clear of the sticky top bar. Checked again as the page finishes loading, since
    // what loads above it (a list, the uploads) can push it back out of view.
    const reveal = () => {
      const r = el?.getBoundingClientRect();
      if (el && r && r.width > 0 && (r.top < 72 || r.bottom > innerHeight - 16)) {
        const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: r.height > innerHeight - 100 ? 'start' : 'center', behavior: smooth ? 'smooth' : 'auto' });
      }
      measure();
    };
    const measure = () => {
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 && r.right > 0 && r.left < innerWidth ? r : null);
      if (tip.current) setSize({ w: tip.current.offsetWidth, h: tip.current.offsetHeight });
    };
    const look = () => {
      el = current.target ? document.querySelector<HTMLElement>(current.target) : null;
      if (current.target && !el) {
        if (++tries < 25) timer = setTimeout(look, 100);
        else go(step! + (forward.current ? 1 : -1));
        return;
      }
      reveal();
      settle.push(setTimeout(reveal, 350), setTimeout(reveal, 900));
      setFound(true);
    };
    look();
    addEventListener('resize', measure);
    addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(timer);
      settle.forEach(clearTimeout);
      removeEventListener('resize', measure);
      removeEventListener('scroll', measure, true);
    };
  }, [step, path]);

  // The stream controls in the corner would cover other steps' parts, so they step aside except for their own tip.
  useEffect(() => {
    const hide = !!current && !current.target?.includes('live-dock');
    document.documentElement.classList.toggle('tour-no-dock', hide);
    return () => document.documentElement.classList.remove('tour-no-dock');
  }, [current]);

  useLayoutEffect(() => {
    if (found && tip.current) setSize({ w: tip.current.offsetWidth, h: tip.current.offsetHeight });
  }, [found, step]);

  useEffect(() => {
    if (step === null || !found) return;
    tip.current?.querySelector<HTMLButtonElement>('.btn-primary')?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') go(null);
      else if (e.key === 'ArrowRight') go(step + 1);
      else if (e.key === 'ArrowLeft' && step > 0) go(step - 1);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [step, found]);

  if (step === null || !current || !found) return null;
  const last = step === TOUR.length - 1;
  // Beside the target when there's room, else below it, or above when it's low on the screen; kept on screen.
  const gap = 14;
  let style: CSSProperties | undefined;
  if (rect) {
    const right = rect.right + gap + size.w <= innerWidth - 16;
    const below = rect.bottom + gap + size.h <= innerHeight - 16;
    const left = right ? rect.right + gap : rect.left + rect.width / 2 - size.w / 2;
    const top = right ? rect.top + rect.height / 2 - size.h / 2 : below ? rect.bottom + gap : rect.top - gap - size.h;
    style = { left: clamp(left, 16, innerWidth - size.w - 16), top: clamp(top, 16, innerHeight - size.h - 16) };
  }
  return (
    <>
      {rect ? (
        <div className="tour-spot" aria-hidden="true" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />
      ) : (
        <div className="tour-shade" aria-hidden="true" />
      )}
      <div ref={tip} className={`tour-tip ${rect ? '' : 'centered'}`} style={style} role="dialog" aria-labelledby="tour-title" aria-describedby="tour-body">
        <div className="tour-count muted small">
          {step + 1} of {TOUR.length}
        </div>
        <h2 id="tour-title">{current.title}</h2>
        <p id="tour-body">{current.body}</p>
        <div className="row tour-buttons">
          <button className="btn btn-ghost btn-sm" onClick={() => go(null)}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          <span className="spacer" />
          {step > 0 && (
            <button className="btn btn-sm" onClick={() => go(step - 1)}>
              Back
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => go(step + 1)}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}

const appPathNow = () => (isDemo() ? location.pathname.replace(/^\/demo(?=[/?#]|$)/, '/dashboard') : location.pathname);

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));
