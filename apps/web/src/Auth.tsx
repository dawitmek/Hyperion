import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { Logo } from './icons';
import { Link, navigate } from './router';
import { Glow } from './site/Glow';
import { ErrorNotice, Spinner, useError } from './ui';

// Only same-site paths, so a crafted ?next= can't send someone elsewhere after logging in.
function nextPath() {
  const next = new URLSearchParams(location.search).get('next');
  return next?.startsWith('/dashboard') ? next : '/dashboard';
}

// What this server offers: whether it takes new accounts, and whether it sends emails (confirmation and reset links).
type AuthConfig = { signups: boolean; email: boolean };

function useAuthConfig() {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  useEffect(() => void api<AuthConfig>('GET', '/auth/config').then(setConfig, () => setConfig({ signups: true, email: false })), []);
  return config;
}

// The token from an emailed link, which is after the # so it never reaches the server's logs. Taken off the address
// at once, so it doesn't stay in the browser's history.
function useLinkToken() {
  const [token] = useState(() => location.hash.slice(1));
  useEffect(() => {
    if (location.hash) history.replaceState(null, '', location.pathname);
  }, []);
  return token;
}

function AuthShell({ children, onSubmit }: { children: ReactNode; onSubmit?: (e: FormEvent) => void }) {
  return (
    <div className="auth">
      <div className="content-glow" aria-hidden="true">
        <Glow />
      </div>
      <Link href="/" className="brand">
        <Logo />
        Hyperion
      </Link>
      {onSubmit ? (
        <form className="card stack auth-card" onSubmit={onSubmit}>
          {children}
        </form>
      ) : (
        <div className="card stack auth-card">{children}</div>
      )}
    </div>
  );
}

function PasswordField({ value, onChange, label = 'Password', isNew }: { value: string; onChange: (v: string) => void; label?: string; isNew: boolean }) {
  return (
    <label className="field">
      {label}
      {isNew && <span className="hint">At least 8 characters.</span>}
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={8}
        maxLength={128}
        required
        autoComplete={isNew ? 'new-password' : 'current-password'}
      />
    </label>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      Email
      <input type="email" value={value} maxLength={254} onChange={(e) => onChange(e.target.value.trim())} required autoComplete="email" />
    </label>
  );
}

export function Auth({ mode }: { mode: 'login' | 'signup' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, guard } = useError();
  const config = useAuthConfig();
  const login = mode === 'login';
  // Set once a confirmation link is on its way: after signing up, or logging in to an unconfirmed account.
  const [waiting, setWaiting] = useState<'signup' | 'login' | null>(null);
  const [resent, setResent] = useState(false);
  // Someone already signed in has no business here: send them on instead of showing the form.
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    api('GET', '/auth/me')
      .then(() => navigate(nextPath(), { replace: true }))
      .catch(() => setChecking(false));
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    guard(async () => {
      try {
        const res = await api<{ verify?: boolean }>('POST', `/auth/${mode}`, { email, password });
        if (res.verify) setWaiting('signup');
        else navigate(nextPath(), { replace: true });
      } catch (err) {
        // 403 at login means the password was right but the email isn't confirmed yet.
        if (login && err instanceof ApiError && err.status === 403) setWaiting('login');
        else throw err;
      }
    })();
  };
  const resend = guard(() => api('POST', '/auth/resend-verification', { email }).then(() => setResent(true)));

  if (checking || !config) return <Spinner page />;
  if (waiting) {
    return (
      <AuthShell>
        <div>
          <h1>Check your email</h1>
          <p className="muted">
            {waiting === 'signup' ? 'We sent an email to ' : 'Confirm your email first: open the link we sent to '}
            <strong>{email}</strong>.{waiting === 'signup' ? ' Open the link in it to continue.' : ' It signs you in.'}
          </p>
        </div>
        <ErrorNotice error={error} />
        {resent ? <p className="notice info">Sent again. Check your spam folder too.</p> : null}
        <button type="button" className="btn" onClick={() => void resend()} disabled={resent}>
          Send the link again
        </button>
      </AuthShell>
    );
  }
  if (!login && !config.signups) {
    return (
      <AuthShell>
        <div>
          <h1>Signups are closed</h1>
          <p className="muted">This server isn’t taking new accounts. Ask whoever runs it if you need one.</p>
        </div>
        <Link href="/login" className="btn btn-primary btn-lg">
          Log in
        </Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell onSubmit={submit}>
      <div>
        <h1>{login ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted">{login ? 'Log in to your dashboard.' : 'Free, and it takes a minute.'}</p>
      </div>
      <ErrorNotice error={error} />
      <EmailField value={email} onChange={setEmail} />
      <PasswordField value={password} onChange={setPassword} isNew={!login} />
      {login && (
        <Link href="/forgot-password" className="muted" style={{ marginTop: -8 }}>
          Forgot your password?
        </Link>
      )}
      <button className="btn btn-primary btn-lg">{login ? 'Log in' : 'Create account'}</button>
      {(login ? config.signups : true) && (
        <p className="muted" style={{ textAlign: 'center' }}>
          {login ? 'New to Hyperion? ' : 'Already have an account? '}
          <Link href={login ? '/signup' : '/login'}>{login ? 'Create an account' : 'Log in'}</Link>
        </p>
      )}
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { error, guard } = useError();
  const config = useAuthConfig();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    guard(() => api('POST', '/auth/forgot-password', { email }).then(() => setSent(true)))();
  };

  if (!config) return <Spinner page />;
  if (!config.email) {
    return (
      <AuthShell>
        <div>
          <h1>Forgot your password?</h1>
          <p className="muted">This server doesn’t send emails. Ask whoever runs it for a reset link.</p>
        </div>
        <Link href="/login">Back to log in</Link>
      </AuthShell>
    );
  }
  if (sent) {
    return (
      <AuthShell>
        <div>
          <h1>Check your email</h1>
          <p className="muted">
            If an account uses <strong>{email}</strong>, we sent it a link to choose a new password. It works for 1 hour.
          </p>
        </div>
        <Link href="/login">Back to log in</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell onSubmit={submit}>
      <div>
        <h1>Forgot your password?</h1>
        <p className="muted">We’ll email you a link to choose a new one.</p>
      </div>
      <ErrorNotice error={error} />
      <EmailField value={email} onChange={setEmail} />
      <button className="btn btn-primary btn-lg">Send the link</button>
      <Link href="/login" style={{ textAlign: 'center' }}>
        Back to log in
      </Link>
    </AuthShell>
  );
}

export function ResetPassword() {
  const token = useLinkToken();
  const [password, setPassword] = useState('');
  const { error, guard } = useError();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    guard(() => api('POST', '/auth/reset-password', { token, password }).then(() => navigate('/dashboard', { replace: true })))();
  };

  if (!token) {
    return (
      <AuthShell>
        <div>
          <h1>This link isn’t complete</h1>
          <p className="muted">Open the whole link from your email, or ask for a new one.</p>
        </div>
        <Link href="/forgot-password">Ask for a new link</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell onSubmit={submit}>
      <div>
        <h1>Choose a new password</h1>
        <p className="muted">You’ll be signed out everywhere else.</p>
      </div>
      <ErrorNotice error={error} />
      <PasswordField value={password} onChange={setPassword} label="New password" isNew />
      <button className="btn btn-primary btn-lg">Save and log in</button>
    </AuthShell>
  );
}

// One request per link: React runs effects twice in development, and a link only works once.
const verifying = new Map<string, Promise<unknown>>();

export function VerifyEmail() {
  const token = useLinkToken();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return setError('This link isn’t complete. Open the whole link from your email.');
    if (!verifying.has(token)) verifying.set(token, api('POST', '/auth/verify-email', { token }));
    verifying.get(token)!.then(
      () => navigate('/dashboard', { replace: true }),
      (e) => setError(e instanceof ApiError ? e.message : String(e)),
    );
  }, [token]);

  if (!error) return <Spinner page />;
  return (
    <AuthShell>
      <div>
        <h1>Couldn’t confirm your email</h1>
      </div>
      <ErrorNotice error={error} />
      <Link href="/login" className="btn btn-primary btn-lg">
        Log in
      </Link>
    </AuthShell>
  );
}
