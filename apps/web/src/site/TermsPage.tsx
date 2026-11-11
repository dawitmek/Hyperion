import type { ReactNode } from 'react';
import { Link } from '../router';
import { PageHero } from './pages';
import { GITHUB_URL, SiteLayout } from './SiteLayout';

// The rules for using a Hyperion server. Plain words on purpose; keep it in step with the privacy page and with what
// the dashboard really lets people do (deleting an account, uploads, raffles).
const UPDATED = 'November 9, 2026';

const GLANCE: [string, string][] = [
  ['18 or older', 'Going LIVE on TikTok takes 18, so a Hyperion account does too.'],
  ['Not part of TikTok', 'Hyperion isn’t made, endorsed or supported by TikTok, and TikTok can change or block how it works.'],
  ['Your stream, your rules to follow', 'You’re responsible for following TikTok’s rules and your games’ rules while you use it.'],
  ['Leave whenever you like', 'Delete your account from Settings. Everything in it goes with it.'],
];

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: 'who',
    title: 'Who these terms are with',
    body: (
      <>
        <p>
          Hyperion is free, open-source software under the GPL-3.0. These terms cover using a Hyperion server: they’re between
          you and whoever runs the server you sign in to. If you <Link href="/self-hosting">host Hyperion yourself</Link>, you
          set the rules for your own server; the software’s licence still applies to the code.
        </p>
        <p>
          By creating an account you agree to these terms and to the <Link href="/privacy">privacy page</Link>, which says what’s
          stored and why.
        </p>
      </>
    ),
  },
  {
    id: 'age',
    title: 'Who can use it',
    body: (
      <ul className="s-checks">
        <li>You must be 18 or older. TikTok only lets adults go LIVE, and Hyperion is made for people who do.</li>
        <li>Use it with your own TikTok account, or one you’re allowed to run.</li>
        <li>One person per account. Keep your password to yourself; you’re responsible for what happens under your account.</li>
      </ul>
    ),
  },
  {
    id: 'tiktok',
    title: 'TikTok and your games',
    body: (
      <>
        <p>
          Hyperion isn’t affiliated with, endorsed by or supported by TikTok or ByteDance. TikTok doesn’t offer a public way
          to read LIVE chat, so Hyperion reads it the way a viewer’s app does. TikTok can change or block that at any time, and
          Hyperion can stop working without warning when it does.
        </p>
        <ul className="s-checks">
          <li>
            You’re responsible for following TikTok’s Terms of Service, Community Guidelines and LIVE rules while you use
            Hyperion, including what your alerts show and what chat is read aloud.
          </li>
          <li>
            The companion presses keys in the games you choose. Some games, especially online ones with anti-cheat, don’t allow
            automated input. Check a game’s rules before you hand it to chat; the risk to your game account is yours.
          </li>
          <li>Don’t use Hyperion to mislead viewers about who is in control of the game or the stream.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'gifts',
    title: 'Gifts, raffles and prizes',
    body: (
      <>
        <p>
          Gifts are paid for with real money. Hyperion lets gifts trigger alerts and actions, and in raffle mode, with gift
          boosts on, each gift adds an entry to the draw.
        </p>
        <ul className="s-checks">
          <li>
            Don’t offer prizes with real-world value (money, items, codes or anything that can be sold) for winning a raffle or
            for sending gifts. In many places that makes it a lottery or gambling, which needs a licence or is against the law,
            and it breaks TikTok’s rules.
          </li>
          <li>A command firing in your game is the only “prize” Hyperion is meant for.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'content',
    title: 'What you upload',
    body: (
      <>
        <p>
          You keep the rights to the sounds, pictures and videos you upload. You give the server what it needs to store them and
          play them on your overlays, and nothing more.
        </p>
        <ul className="s-checks">
          <li>Only upload what you have the right to use: your own work, or work you’re licensed to use on a stream.</li>
          <li>Nothing illegal, nothing that sexualises minors, and nothing made to harass, threaten or deceive people.</li>
          <li>Whoever runs the server can remove an upload that breaks these rules, and will tell you why when they do.</li>
        </ul>
        <p>
          To report something illegal on a Hyperion server, contact whoever runs it with the link to the file and why you think
          it’s illegal. For a problem with the software itself, open an issue on <a href={`${GITHUB_URL}/issues`}>GitHub</a>.
        </p>
      </>
    ),
  },
  {
    id: 'viewers',
    title: 'Your viewers',
    body: (
      <p>
        Hyperion keeps what your viewers do on your streams: their TikTok names, comments and gifts (see the{' '}
        <Link href="/privacy#viewers">privacy page</Link>). Use it to run your stream, and only in ways the law where you live
        allows. Don’t collect it to build profiles of people, sell it or publish it somewhere else.
      </p>
    ),
  },
  {
    id: 'fair-use',
    title: 'Using the server fairly',
    body: (
      <ul className="s-checks">
        <li>Don’t try to get into other people’s accounts, overlays or companions, or around the server’s limits.</li>
        <li>Don’t overload the server on purpose, or use it to send spam or attack anything else.</li>
        <li>
          Found a security problem? Report it privately to whoever runs the server, or for the software on{' '}
          <a href={`${GITHUB_URL}/security`}>GitHub</a>, rather than in public.
        </li>
      </ul>
    ),
  },
  {
    id: 'ending',
    title: 'Ending',
    body: (
      <>
        <p>
          You can delete your account at any time from Settings in the dashboard. Your settings, uploads, stream history and
          leaderboard are deleted with it straight away, and your overlays and companions are disconnected. Download a copy of
          your data first if you want to keep it.
        </p>
        <p>
          Whoever runs the server can suspend or delete an account that breaks these terms, and should tell you why. They can
          also shut the server down; a server run for others should give its users notice first.
        </p>
      </>
    ),
  },
  {
    id: 'warranty',
    title: 'No warranty',
    body: (
      <p>
        Hyperion is provided as it is, without any warranty, as the GPL-3.0 says. It can have bugs, miss events or stop working,
        and it shouldn’t be relied on for anything where that would cause harm. As far as the law allows, neither the people who
        write Hyperion nor whoever runs your server are liable for losses from using it. Nothing here takes away rights the law
        where you live gives you and that can’t be signed away.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes and questions',
    body: (
      <p>
        When these terms change, this page changes and the date below moves. If a change matters to how you use Hyperion, it’s
        noted in the <Link href="/changelog">changelog</Link>. Questions about the software are welcome on{' '}
        <a href={`${GITHUB_URL}/issues`}>GitHub</a>; questions about a particular server go to whoever runs it.
      </p>
    ),
  },
];

export function TermsPage() {
  return (
    <SiteLayout>
      <PageHero title="Terms of use">The rules for using a Hyperion server, in plain words.</PageHero>
      <div className="s-wrap">
        <div className="s-privacy-glance">
          {GLANCE.map(([title, text]) => (
            <div key={title} className="s-box">
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
        <div className="s-privacy">
          <nav className="s-privacy-toc" aria-label="On this page">
            <p>On this page</p>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.title}
              </a>
            ))}
          </nav>
          <article className="s-privacy-body">
            {SECTIONS.map((s) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`}>
                <h2 id={`${s.id}-title`}>{s.title}</h2>
                {s.body}
              </section>
            ))}
            <p className="s-privacy-updated">Last updated {UPDATED}.</p>
          </article>
        </div>
      </div>
    </SiteLayout>
  );
}
