import { useEffect, useState, type CSSProperties } from 'react';

// The home page's hero: a LIVE stream where chat drives a little platformer. Each comment presses a key on the
// keycaps below, and the character moves. A fixed script loops, so the server and browser draw the same first frame.

type Move = 'left' | 'right' | 'jump';
const KEYS: { move: Move; label: string; wide?: boolean }[] = [
  { move: 'left', label: 'A' },
  { move: 'jump', label: 'Space', wide: true },
  { move: 'right', label: 'D' },
];
const SCRIPT: { viewer: string; move: Move; gift?: string }[] = [
  { viewer: 'mira', move: 'right' },
  { viewer: 'kai_x', move: 'right' },
  { viewer: 'nova', move: 'jump', gift: 'nova sent 5 Roses' },
  { viewer: 'jules', move: 'right' },
  { viewer: 'sam.r', move: 'jump' },
  { viewer: 'ivy', move: 'left' },
  { viewer: 'mira', move: 'left' },
  { viewer: 'kai_x', move: 'jump' },
  { viewer: 'jules', move: 'left', gift: 'jules sent a Lion' },
  { viewer: 'nova', move: 'jump' },
];
const COLOURS: Record<string, string> = { mira: '#8d5ef5', kai_x: '#2b95ea', nova: '#ff4f8b', jules: '#14a3a0', 'sam.r': '#f07f2e', ivy: '#6366f1' };
const STEP = 10; // percent of the frame's width

function useBeat(ms: number) {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setBeat((b) => b + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return beat;
}

export function LiveScene() {
  const beat = useBeat(1250);
  const at = (n: number) => SCRIPT[((n % SCRIPT.length) + SCRIPT.length) % SCRIPT.length]!;
  const now = at(beat);
  // Where the character stands: the sum of the script's sideways steps so far in this loop.
  const lap = beat % SCRIPT.length;
  const x = SCRIPT.slice(0, lap + 1).reduce((sum, s) => sum + (s.move === 'right' ? STEP : s.move === 'left' ? -STEP : 0), 0);
  // The script loops, so the first frame already shows the end of the last lap's chat.
  const chat = [3, 2, 1, 0].map((back) => ({ n: beat - back, ...at(beat - back) }));
  const gift = [0, 1].map((back) => at(beat - back)).find((s) => s.gift)?.gift;

  return (
    <div className="h-scene" aria-hidden="true">
      <div className="h-frame">
        <svg className="h-world" viewBox="0 0 360 560" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="h-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0a1650" />
              <stop offset="0.35" stopColor="#1d4ed8" />
              <stop offset="0.66" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          <rect width="360" height="560" fill="url(#h-sky)" />
          <circle cx="262" cy="190" r="54" fill="#ffb22e" />
          <path d="M0 360 L60 300 L120 340 L190 270 L260 330 L320 290 L360 320 L360 560 L0 560Z" fill="#1e3a9a" />
          <path d="M0 400 L80 350 L150 390 L230 340 L300 380 L360 360 L360 560 L0 560Z" fill="#142a72" />
          <rect x="0" y="430" width="360" height="130" fill="#0a1238" />
          <rect x="0" y="430" width="360" height="8" fill="#5b8cff" />
          <rect x="226" y="352" width="78" height="12" rx="3" fill="#5b8cff" />
          <rect x="40" y="370" width="64" height="12" rx="3" fill="#5b8cff" />
          <g className="h-coin">
            <circle cx="265" cy="326" r="9" fill="#ffd23f" />
            <circle cx="72" cy="344" r="9" fill="#ffd23f" />
          </g>
        </svg>
        <div className="h-hero-char" style={{ '--x': `${x}%` } as CSSProperties}>
          <span className="h-char-body" key={now.move === 'jump' ? beat : 'still'}>
            <i />
            <i />
          </span>
        </div>
        <div className="h-live-top">
          <span className="h-live-pill">LIVE</span>
          <span className="h-live-viewers">1.2K</span>
        </div>
        {gift && (
          <div className="h-gift" key={gift}>
            {gift}
          </div>
        )}
        <ul className="h-chat">
          {chat.map((c) => (
            <li key={c.n}>
              <span className="h-avatar" style={{ background: COLOURS[c.viewer] }}>
                {c.viewer[0]!.toUpperCase()}
              </span>
              <b>{c.viewer}</b> {c.move}
            </li>
          ))}
        </ul>
      </div>
      <div className="h-keys">
        {KEYS.map((k) => (
          <span key={k.move} className={`h-key ${k.wide ? 'wide' : ''} ${now.move === k.move ? 'down' : ''}`}>
            {k.label}
          </span>
        ))}
      </div>
    </div>
  );
}
