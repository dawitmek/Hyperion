import { useEffect, useState, type ReactNode } from 'react';
import { QUEUE_JOIN, type Mode } from '@hyperion/shared';
import { Icon } from '../icons';

// A short looping scene of how a crowd mode plays: chat on one side, what reaches the game on the other. Made-up
// viewers, a step every TICK_MS. It's only a picture; the words beside it say the same thing.
const TICK_MS = 850;

type Msg = { who: string; text: string; state?: 'fired' | 'ignored' | 'gift' };
type Scene = { chat: Msg[]; key: string | null; note: string; side?: ReactNode };

const VIEWERS: Record<string, string> = { mia: 'pink', jay: 'sky', sam: 'teal', leo: 'orange', ava: 'violet' };
const LOOP: Record<Mode, number> = { anarchy: 8, democracy: 11, queue: 12, raffle: 11, gift: 9 };

function anarchy(t: number): Scene {
  const said: Msg[] = [
    { who: 'mia', text: 'jump' },
    { who: 'jay', text: 'left' },
    { who: 'sam', text: 'jump' },
    { who: 'leo', text: 'right' },
    { who: 'ava', text: 'jump' },
    { who: 'jay', text: 'left' },
    { who: 'mia', text: 'right' },
    { who: 'sam', text: 'jump' },
  ];
  const chat = said.slice(0, t + 1).map((m) => ({ ...m, state: 'fired' as const }));
  return { chat, key: said[t]!.text, note: 'Every command fires' };
}

function democracy(t: number): Scene {
  const votes: Msg[] = [
    { who: 'mia', text: 'left' },
    { who: 'jay', text: 'jump' },
    { who: 'sam', text: 'jump' },
    { who: 'leo', text: 'right' },
    { who: 'ava', text: 'jump' },
    { who: 'mia', text: 'left' },
    { who: 'jay', text: 'jump' },
  ];
  const open = t < votes.length;
  const chat = votes.slice(0, Math.min(t + 1, votes.length));
  const tally = ['jump', 'left', 'right'].map((c) => [c, chat.filter((m) => m.text === c).length] as const);
  const most = Math.max(1, ...tally.map(([, n]) => n));
  return {
    chat,
    key: open ? null : 'jump',
    note: open ? `Voting, ${votes.length - t} s left` : 'Jump wins with 4 votes',
    side: (
      <div className="demo-votes">
        {tally.map(([c, n]) => (
          <div key={c} className={`demo-vote ${!open && c === 'jump' ? 'won' : ''}`}>
            <span>{c}</span>
            <span className="demo-vote-bar">
              <span style={{ width: `${(n / most) * 100}%` }} />
            </span>
            <span className="num">{n}</span>
          </div>
        ))}
      </div>
    ),
  };
}

function queue(t: number): Scene {
  const first = t < 6; // mia's turn, then jay's
  const line = first ? ['mia', 'jay', 'sam'] : ['jay', 'sam', 'leo'];
  const said: Msg[] = [
    { who: 'mia', text: 'jump' },
    { who: 'jay', text: 'left' },
    { who: 'mia', text: 'right' },
    { who: 'leo', text: QUEUE_JOIN },
    { who: 'sam', text: 'jump' },
    { who: 'mia', text: 'jump' },
    { who: 'jay', text: 'jump' },
    { who: 'mia', text: 'left' },
    { who: 'jay', text: 'right' },
    { who: 'sam', text: 'left' },
    { who: 'jay', text: 'jump' },
    { who: 'ava', text: QUEUE_JOIN },
  ];
  const chat = said.slice(0, t + 1).map((m, i): Msg => {
    if (m.text === QUEUE_JOIN) return m;
    return { ...m, state: m.who === (i < 6 ? 'mia' : 'jay') ? 'fired' : 'ignored' };
  });
  const last = chat[chat.length - 1]!;
  return {
    chat,
    key: last.state === 'fired' ? last.text : null,
    note: `@${line[0]}'s turn`,
    side: (
      <div className="demo-line">
        {line.map((who, i) => (
          <span key={who} className={`demo-person ${i === 0 ? 'turn' : ''}`}>
            <Avatar who={who} />
            {i === 0 ? 'Playing' : `${i}`}
          </span>
        ))}
        <span className="demo-turn-bar">
          <span style={{ width: `${(((first ? t : t - 6) + 1) / 6) * 100}%` }} />
        </span>
      </div>
    ),
  };
}

function raffle(t: number): Scene {
  const entries: Msg[] = [
    { who: 'mia', text: 'spawn' },
    { who: 'jay', text: 'jump' },
    { who: 'sam', text: 'drop' },
    { who: 'leo', text: 'spawn' },
    { who: 'ava', text: 'jump' },
  ];
  const collecting = t < entries.length;
  const drawing = !collecting && t < entries.length + 3;
  const winner = 2; // sam
  const chat = entries.slice(0, Math.min(t + 1, entries.length));
  const lit = collecting ? -1 : drawing ? (t * 3) % entries.length : winner;
  return {
    chat,
    key: !collecting && !drawing ? entries[winner]!.text : null,
    note: collecting ? 'Collecting entries' : drawing ? 'Drawing…' : '@sam wins the draw',
    side: (
      <div className="demo-entries">
        {chat.map((m, i) => (
          <span key={i} className={`demo-entry ${i === lit ? 'lit' : ''} ${!collecting && !drawing && i === winner ? 'won' : ''}`}>
            <Avatar who={m.who} />
            {m.text}
          </span>
        ))}
      </div>
    ),
  };
}

function gift(t: number): Scene {
  const said: Msg[] = [
    { who: 'mia', text: 'jump' },
    { who: 'jay', text: 'left' },
    { who: 'sam', text: 'jump!!' },
    { who: 'leo', text: 'sent a Rose', state: 'gift' },
    { who: 'ava', text: 'right' },
    { who: 'jay', text: 'jump' },
    { who: 'mia', text: 'sent a Rose', state: 'gift' },
    { who: 'sam', text: 'left' },
    { who: 'ava', text: 'jump' },
  ];
  const chat = said.slice(0, t + 1).map((m) => (m.state ? m : { ...m, state: 'ignored' as const }));
  const last = said[t]!;
  return { chat, key: last.state === 'gift' ? 'jump' : null, note: last.state === 'gift' ? 'A Rose jumps' : "Comments don't press keys" };
}

const SCENES: Record<Mode, (t: number) => Scene> = { anarchy, democracy, queue, raffle, gift };

function Avatar({ who }: { who: string }) {
  return <span className={`demo-avatar hue-${VIEWERS[who] ?? 'indigo'}`}>{who[0]!.toUpperCase()}</span>;
}

export function ModeDemo({ mode }: { mode: Mode }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [mode]);
  const t = tick % LOOP[mode];
  const scene = SCENES[mode](t);
  return (
    <div className={`mode-demo mode-is-${mode}`} aria-hidden="true">
      <div className="demo-chat">
        <span className="demo-label">Chat</span>
        <ul>
          {scene.chat.slice(-5).map((m, i, shown) => (
            <li key={`${t}-${i}`} className={`${m.state ?? ''} ${i === shown.length - 1 ? 'new' : ''}`}>
              <Avatar who={m.who} />
              <span className="demo-who">{m.who}</span>
              {m.state === 'gift' && <Icon name="gift" size={13} />}
              <span className="demo-text">{m.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="demo-game">
        <span className="demo-label">Your game</span>
        {scene.side}
        <div className="demo-key-row">
          {/* Keyed by tick, so the same key pressed twice in a row flashes twice. */}
          <span key={scene.key ? t : 'idle'} className={`demo-key ${scene.key ? 'pressed' : ''}`}>
            {scene.key ?? '·'}
          </span>
          <span className="demo-note">{scene.note}</span>
        </div>
      </div>
    </div>
  );
}
