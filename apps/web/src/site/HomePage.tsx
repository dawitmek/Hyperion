import '@fontsource-variable/bricolage-grotesque';
import type { CSSProperties } from 'react';
import { Icon, type IconName } from '../icons';
import { Link } from '../router';
import { Glow } from './Glow';
import { LiveScene } from './LiveScene';
import { LoopVideo } from './LoopVideo';
import { SiteLayout } from './SiteLayout';
import './home.css';

// Games streamers run on TikTok LIVE. Minecraft has a full integration; the rest are played on the keyboard alone, so
// key presses from chat are enough to play them. Games that need the mouse to look or aim don't fit and aren't listed.
// `clip` names a gameplay loop in public/games: <clip>.mp4, its first frame <clip>.jpg, and the logo logos/<clip>.webp.
const GAMES: { name: string; colour: string; clip: string; integrated?: string }[] = [
  { name: 'Minecraft: Java & Bedrock', colour: '#2f7a46', clip: 'minecraft', integrated: 'Spawn mobs, drop TNT' },
  { name: 'Hollow Knight', colour: '#3a4660', clip: 'hollow-knight' },
  { name: 'GTA V', colour: '#c2366e', clip: 'gta-v' },
  { name: 'Fall Guys', colour: '#d04a6a', clip: 'fall-guys' },
  { name: 'Only Up!', colour: '#b0398f', clip: 'only-up' },
  { name: 'Geometry Dash', colour: '#2456d9', clip: 'geometry-dash' },
  { name: 'Forza Horizon', colour: '#d0632b', clip: 'forza-horizon' },
  { name: 'Vampire Survivors', colour: '#8a2b3f', clip: 'vampire-survivors' },
];

const STEPS = [
  { title: 'Install the companion', text: 'It runs on the PC that plays your game, on Windows or macOS.' },
  { title: 'Map commands and gifts', text: '“jump” presses Space. A Rose spawns a creeper. You pick the keys and the cooldowns.' },
  { title: 'Go live', text: 'Hyperion reads your LIVE chat and the companion does the rest. Your overlay shows who did what.' },
];

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'crowd', title: 'Five crowd modes', text: 'Anarchy, democracy votes, a queue of players, a raffle, or gifts only. Switch mid-stream.' },
  { icon: 'gift', title: 'Gift alerts', text: 'Thank gifters with an on-stream alert, your own sound or video, or a key press.' },
  { icon: 'voice', title: 'Chat read aloud', text: '22 offline voice languages, your own cloud key, and effects from chipmunk to robot.' },
  { icon: 'trophy', title: 'Levels and a leaderboard', text: 'Viewers earn XP as they play. Lock commands behind a level if you like.' },
  { icon: 'analytics', title: 'A report for every stream', text: 'When chat is busiest, who comes back, and coins per hour.' },
  { icon: 'shield', title: 'Only the keys you allow', text: 'Keys go to your game only while it’s in front, and a panic hotkey stops everything.' },
];

export function HomePage() {
  return (
    <SiteLayout>
      <div className="s-home">
        <section className="h-hero">
          <Glow />
          <div className="s-wrap h-hero-grid">
            <div className="h-hero-copy">
              <h1>Let your TikTok LIVE chat play your game</h1>
              <p>
                Viewers type commands or send gifts, and Hyperion presses the keys on your PC. Free, open source, and it
                works with the games you already stream.
              </p>
              <div className="h-ctas">
                <Link href="/signup" className="h-btn h-btn-solid">
                  Get started free
                </Link>
                <Link href="/demo" className="h-btn h-btn-line">
                  Try the demo
                </Link>
                <Link href="/download" className="h-btn h-btn-line">
                  <Icon name="download" size={18} />
                  Download for Windows or Mac
                </Link>
              </div>
            </div>
            <LiveScene />
          </div>
        </section>

        <section className="h-games" aria-labelledby="games-title">
          <div className="s-wrap">
            <div className="h-head">
              <h2 id="games-title">Works with the games you stream</h2>
              <p>
                Minecraft gets a full integration: gifts spawn mobs and drop TNT right in your world. Other games work
                through key presses, and fit best when you can play them without the mouse.
              </p>
            </div>
            <ul className="h-game-grid">
              {GAMES.map((g) => (
                <li key={g.name} className="h-game" style={{ background: g.colour, '--tint': g.colour } as CSSProperties}>
                  <LoopVideo className="h-game-media" src={`/games/${g.clip}.mp4`} poster={`/games/${g.clip}.jpg`} />
                  <span className="h-game-kind">{g.integrated ? 'Integration' : 'Key presses'}</span>
                  <h3>
                    <img src={`/games/logos/${g.clip}.webp`} alt={g.name} loading="lazy" />
                  </h3>
                  {g.integrated && <span className="h-game-does">{g.integrated}</span>}
                </li>
              ))}
            </ul>
            <p className="h-fine">
              Plus any other PC game you can play on the keyboard alone. <Link href="/integrations">See integrations</Link>.
              Game names belong to their owners.
            </p>
          </div>
        </section>

        <section className="h-steps" aria-labelledby="steps-title">
          <div className="s-wrap h-steps-grid">
            <h2 id="steps-title">Set up once, then just go live</h2>
            <ol>
              {STEPS.map((s) => (
                <li key={s.title}>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="h-features" aria-labelledby="features-title">
          <div className="s-wrap">
            <div className="h-head">
              <h2 id="features-title">Everything a chat-run stream needs</h2>
              <Link href="/features" className="h-more">
                See all features
              </Link>
            </div>
            <ul className="h-feature-grid">
              {FEATURES.map((f) => (
                <li key={f.title}>
                  <Icon name={f.icon} size={22} />
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}
