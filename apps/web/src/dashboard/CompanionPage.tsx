import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type Companion } from '../api';
import { Icon } from '../icons';
import { Card, ErrorNotice, useError } from '../ui';
import type { PageProps } from './Dashboard';

const PLATFORMS: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

export function CompanionPage({ status }: PageProps) {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const { error, guard } = useError();
  // A new code replaces the previous one on the server.
  const newCode = guard(() => api<typeof pairing>('POST', '/companions/pairing-code').then(setPairing));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const expired = pairing !== null && new Date(pairing.expiresAt).getTime() <= now;
  const load = useCallback(() => api<Companion[]>('GET', '/companions').then(setCompanions), []);
  // A device that just paired shows up as online; list it without a manual refresh.
  useEffect(() => void load(), [load, status.companionsOnline]);

  return (
    <div className="stack">
      <Card
        title="Pair a companion"
        description="The companion app runs on your gaming PC and presses keys in your game. Create a code here, then enter it in the companion along with this server's address."
        actions={
          <a className="btn" href="/download" target="_blank" rel="noreferrer">
            <Icon name="download" size={16} />
            Download the app
          </a>
        }
      >
        <ErrorNotice error={error} />
        <div className="pairing">
          <div className="inset">
            <div className="muted small">Server address</div>
            <CopyText text={location.origin} label="server address" className="pairing-address">
              <code>{location.origin}</code>
            </CopyText>
          </div>
          <div className="inset">
            <div className="muted small">Pairing code</div>
            {pairing ? (
              <>
                {/* Keyed by the code, so a new one doesn't still say Copied. */}
                <CopyText key={pairing.code} text={pairing.code} label="pairing code" className={`pairing-code ${expired ? 'expired' : ''}`} disabled={expired}>
                  {pairing.code}
                </CopyText>
                <div className="row">
                  <span className="muted small">
                    {expired ? 'Expired. Make a new one.' : `Valid until ${new Date(pairing.expiresAt).toLocaleTimeString()}`}
                  </span>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={newCode} aria-label="New code" title="New code">
                    <Icon name="refresh" />
                  </button>
                </div>
              </>
            ) : (
              <button className="btn btn-primary" style={{ marginTop: 6 }} onClick={newCode}>
                Create pairing code
              </button>
            )}
          </div>
        </div>
      </Card>
      <Card
        title="Paired devices"
        description={`${status.companionsOnline} online now. Revoking a device disconnects it; pair it again with a new code.`}
        actions={
          <button className="btn btn-ghost" onClick={guard(load)}>
            Refresh
          </button>
        }
      >
        {companions.length === 0 ? (
          <p className="empty">No devices paired yet.</p>
        ) : (
          <ul className="list">
            {companions.map((c) => (
              <li key={c.id}>
                <span className="device-name">
                  <strong>{c.name}</strong>
                  {(c.hostname || c.platform) && (
                    <span className="muted small">{[c.hostname, PLATFORMS[c.platform ?? ''] ?? c.platform].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
                <span className="muted">{c.lastSeenAt ? `last seen ${new Date(c.lastSeenAt).toLocaleString()}` : 'never connected'}</span>
                <span className="spacer" />
                <button className="btn btn-ghost btn-sm btn-delete" onClick={guard(() => api('DELETE', `/companions/${c.id}`).then(load))}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// Text that copies itself when clicked, then says so for a moment. `label` names it, for screen readers.
function CopyText({ text, label, className, disabled, children }: { text: string; label: string; className: string; disabled?: boolean; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const { error, guard } = useError();
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={`copy-text ${className} ${copied ? 'copied' : ''}`}
      onClick={guard(() => navigator.clipboard.writeText(text).then(() => setCopied(true)))}
      disabled={disabled}
      aria-label={`${text}. ${copied ? `Copied the ${label}` : `Copy the ${label}`}`}
    >
      {children}
      <span className={`copy-hint ${error ? 'failed' : ''}`} aria-hidden="true">
        {copied ? 'Copied' : error ? "Couldn't copy" : 'Click to copy'}
      </span>
    </button>
  );
}
