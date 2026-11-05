<div align="center">
  <h1><sub><img src="apps/web/public/logo.png" alt="" width="36" height="36" /></sub> Hyperion</h1>
  <h2>Let your TikTok LIVE chat play your game.</h2>
  <h3>Viewers type commands or send gifts, and Hyperion presses the keys on your PC.</h3>
  <p>Free and open source. Works with the games you already play, on Windows and macOS, with no game mods or plugins.</p>
  <p>
    <a href="https://github.com/dawitmek/Hyperion/releases">Download</a> ·
    <a href="#getting-started">Get started</a> ·
    <a href="#features">Features</a> ·
    <a href="#safety">Safety</a> ·
    <a href="docs/SELF_HOSTING.md">Self-hosting guide</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/version-0.3.0-5b5fef?style=flat-square&amp;labelColor=27272a" alt="Version 0.3.0" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-5b5fef?style=flat-square&amp;labelColor=27272a" alt="License: GPL-3.0" /></a>
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-5b5fef?style=flat-square&amp;labelColor=27272a" alt="Platforms: Windows and macOS" />
  </p>
</div>

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/images/dashboard-preview.png" />
    <img src="docs/images/live-demo.gif" alt="The Live page during a stream: chat commands arrive on the left, command keys press in the middle, and a vote runs on the right" width="100%" />
  </picture>
  <br />
  <sub>Sample chat · Default dark theme</sub>
</p>

<p align="center">
  <a href="https://github.com/dawitmek/Hyperion/releases"><img src="https://img.shields.io/badge/Download-5b5fef?style=for-the-badge&amp;logo=github&amp;logoColor=ffffff" alt="Download" height="24" /></a>
  <a href="#getting-started"><img src="https://img.shields.io/badge/Get%20started-27272a?style=for-the-badge" alt="Get started" height="24" /></a>
</p>

## How it works

![TikTok LIVE chat goes to the Hyperion server, which tells the companion app on your gaming PC which keys to press in your game. The server also drives the dashboard and the stream overlay.](docs/images/how-it-works.png)

1. The **server** reads your public LIVE chat by username. It never asks for your TikTok password.
2. It decides what happens, based on your commands, crowd mode, cooldowns and rate limit.
3. It tells the **companion**, a small desktop app paired to your account, which key to press.
4. The **overlay**, a browser source in TikTok LIVE Studio or OBS, shows what chat is doing.

## Features

![Six feature previews: crowd mode voting, a gift that presses a key, chat read aloud, viewer levels, game profiles, and allowed keys with a focus check](docs/images/features.png)

- **Five crowd modes:**
  - Anarchy: every command fires.
  - Democracy: chat votes, and the winner fires when each window closes.
  - Queue: viewers take turns.
  - Raffle: every few seconds one random viewer who typed a command wins, and only their command fires. Made for big
    commands, like spawning a mob.
  - Gift-only: only gifts press keys.

  You can switch modes mid-stream.

- **Actions:** follows, shares, gifts, like milestones, joins, subscriptions, stickers, chat commands and a
  viewer's first activity can each trigger an action. An action can:
  - show an alert
  - play a built-in sound or your own upload
  - show your picture or video
  - read its text aloud
  - run a command (a key, macro, chain or game action), once per gift in a streak if you like
  - give points

  Actions can be limited to followers, subscribers, moderators, top gifters or one viewer, with cooldowns and random
  picks. Gifts also add votes or move the gifter up the queue.

- **Overlay screens:** up to eight overlay addresses, each choosing what it shows, where alerts appear, its size, and
  whether it plays sound.
- **Widgets and goals:** each screen can add widgets in any corner or edge:
  - goal bars
  - top gift and longest streak
  - latest follower and latest gift
  - stream stats (viewers, likes, follows, coins)
  - chat
  - a coin jar that fills with coins
  - fireworks for big gifts

  Goals count a stream's likes, follows, shares, coins or subscriptions, and reaching one can trigger an action.

- **Points:** viewers earn points for chatting, gifts, follows and shares, and spend them on commands that cost
  points. `!points` shows a balance on the overlay when you allow it.
- **Text-to-speech:** read prefixed comments, alerts or all of chat. The Recommended mode reads all chat up to 25
  viewers, then only prefixed comments. The engines are:
  - Piper voices on your server
  - eSpeak in the overlay
  - TikTok's own voices, after you sign in to TikTok in the companion (an unofficial TikTok API, so it may break)
  - your own Google, Azure or ElevenLabs key
  - the PC's own voices

  Voice effects are available too.

- **Game integrations:** commands sent straight into a game, set up in the companion and run by chat or gifts.
  Minecraft is the first, Java and Bedrock: spawn mobs, drop TNT or hand out diamonds, with the viewer's name filled
  in. See the [Minecraft guide](docs/MINECRAFT.md) for setup and sample commands.
- **Levels and a leaderboard:** viewers earn XP, and level-ups and top players can show on stream.
- **Key combinations:** a command can press a key or a combination like Ctrl+Shift+E. Set it by pressing the keys.
- **Game profiles:** each game keeps its own commands, key-press actions and mode. The companion targets the game's
  process automatically.
- **Activity and analytics:** a full feed of everything viewers did during a stream (chat, gifts, joins, follows,
  shares, likes, subscriptions and stickers), and an Analytics page with trends across streams. It covers new and returning viewers,
  coins, how often each command fired or was refused, peak moments, gifts, and vote and queue stats.
- **Test mode:** type as a pretend viewer and watch the keys press before you go live.
- **Appearance:** color themes for the dashboard, with System, Light or Dark. The companion follows your choice.

![The Analytics page with totals across streams, charts of viewers and coins per stream, and a table of streams](docs/images/analytics.png)

_The Analytics page, shown with sample data._

## Safety

Chat is unpredictable, so the companion is built so it can't take over your PC:

- **Allowed keys only:** each PC keeps its own list. The Windows/Cmd key, Escape, Tab and the F-keys are never
  pressed. Ctrl and Alt are only pressed as part of a command's combination.
- **Combinations need the PC's OK:** the companion lists the dashboard's commands, and each key combination (like
  Ctrl+Shift+E) is only pressed once it's allowed on that PC. The server can propose a combination but never approve
  one.
- **Blocked combinations:** shortcuts that act outside the game, like Ctrl+Alt+Del, Ctrl+W, Alt+F4 and Alt+Enter, are
  refused by both the server and the companion. A combination with Ctrl or Alt is pressed on its own, so viewers'
  overlapping key holds can't add up to one. With Shift alone, other keys can overlap it, so run and jump can happen
  together, unless they'd make a blocked combination.
- **Macros stay on your PC:** you record them in the companion, and only input made while your game has focus is
  kept. The server can ask for one by name but can't create or change one. They stop if the game loses focus, and
  on pause or the panic hotkey, letting go of everything held. Macros are recorded by you, so they can press any
  key the allowed-keys list covers even if you've switched it off, plus mouse clicks and movement.
- **Focus check:** keys go to your game only while its window is in front.
- **Rate limit and cooldowns:** you set a cap on presses per second, and each command has a cooldown per viewer.
- **Panic hotkey:** <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Backspace</kbd> pauses the companion and lets go of every
  held key.

## Getting started

1. **Run a server.** See [Self-hosting](#self-hosting) below. Then sign up in its dashboard and add your TikTok
   username in Settings.
2. **Install the companion** on the PC that runs your game. Get it from the site's Download page or the
   [releases page](https://github.com/dawitmek/Hyperion/releases).
   - The builds aren't code-signed yet, so the first time you open it:
     - on Windows, choose _More info_ and then _Run anyway_
     - on macOS, go to _System Settings → Privacy & Security_ and choose _Open Anyway_
   - On macOS, also allow it under _Accessibility_ so it can press keys.
3. **Pair it.** In the dashboard, open Companion and create a pairing code. Enter the code and the server address in
   the app.
4. **Set up your commands and mode.** New accounts start with w, a, s, d, jump and run, on W, A, S, D, Space and Shift+W.
5. **Add the overlay.** In the dashboard, open Stream overlay and copy its address. Add it as a browser source in
   TikTok LIVE Studio or OBS.
6. **Go live.** Start your TikTok LIVE, focus your game, and press Go live in the dashboard.

## Self-hosting

One container runs the server, dashboard and overlay, and a second runs Postgres. You need Docker and Git.

```sh
git clone https://github.com/dawitmek/Hyperion && cd Hyperion
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, and SECRETS_KEY to the output of: openssl rand -base64 32
docker compose -f docker/compose.yml --env-file .env pull     # the published image, ghcr.io/dawitmek/hyperion
docker compose -f docker/compose.yml --env-file .env up -d     # or: up -d --build, to build it yourself
```

Hyperion is then on http://127.0.0.1:3000.

- **HTTPS:** built in. Add your domain to `.env` and Caddy handles certificates.
- **Signups:** open to anyone who can reach your server, so only share its address with people you trust.
- **More:** the step-by-step guide, settings, updates and backups are in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Development

You need Node 22 or later, and Docker for Postgres. The companion also needs Rust and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm install
cp .env.example .env                  # then set SECRETS_KEY: openssl rand -base64 32
npm run dev                           # Postgres (Docker) + server + dashboard on http://localhost:5173
npm run tauri dev -w apps/companion   # the companion, in another terminal
npm test                              # unit and end-to-end tests (needs the database from npm run dev or db:up)
npm run typecheck
```

What `npm run dev` starts:

- Postgres on 127.0.0.1:5432.
- The server on the `PORT` from `.env` (default 3000). It applies migrations on start.
- The dashboard on http://localhost:5173. It forwards `/api` and `/ws` to the server.

If another program uses port 3000, set `PORT=3001` in `.env`. To start the server and dashboard separately, use
`npm run dev:server` and `npm run dev:web`.

TikTok and cloud voices that fail fall back to Piper, and without Piper they and the Piper engine fall back to eSpeak.
To use Piper in development, install the `piper-tts` Python
package and download a voice (an `.onnx` model and its `.onnx.json`) from
[piper-voices](https://huggingface.co/rhasspy/piper-voices). Then set `PIPER_BIN` and `PIPER_VOICES_DIR` in `.env`.
The `piper-tts` package works on macOS; the older standalone macOS build is missing its libraries.

```sh
uv venv .local/piper-venv && uv pip install --python .local/piper-venv/bin/python piper-tts
# .env
PIPER_BIN=/absolute/path/to/Hyperion/.local/piper-venv/bin/piper
PIPER_VOICES_DIR=/absolute/path/to/voices
```

After changing `apps/server/src/db/schema.ts`, run `npm run db:generate -w apps/server` to create a migration.

For production, `npm run build && npm start` serves everything from one address.

### Project layout

| Path                    | What                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`           | Fastify and WebSockets: TikTok connection, mode engine, API. Serves the built web app in production.                                                                               |
| `apps/web`              | React and Vite: the public site (`/`, `/features`, `/how-it-works`, `/self-hosting`, `/faq`, `/download`), the dashboard (`/dashboard`) and the stream overlay (`/overlay/:token`) |
| `apps/companion`        | Tauri 2 desktop app: presses allowed keys in the host's game on Windows and macOS                                                                                                  |
| `packages/shared`       | Protocol types shared by the server, web app and companion                                                                                                                         |
| `packages/theme`        | Design system (colours, type, components) shared by the web app and companion                                                                                                      |
| `docker/`, `Dockerfile` | Self-hosting (server and Postgres)                                                                                                                                                 |
| `docs/TODO.md`          | Everything still to do                                                                                                                                                                    |

### Releasing the companion

Pushing a tag that starts with `companion-v` runs
[`.github/workflows/release-companion.yml`](.github/workflows/release-companion.yml):

```sh
git tag companion-v0.3.0 && git push origin companion-v0.3.0
```

The workflow builds a Windows installer (`.exe`) and a universal macOS disk image (`.dmg`), and publishes them as a
GitHub release once both have built. The site's Download page always offers the newest published release.

To build an installer locally, run `npm run tauri build -w apps/companion`. It's saved in
`apps/companion/src-tauri/target/release/bundle`.

## Built with Claude

[Claude Code](https://claude.ai), was used in the development of Hyperion.

## License

Hyperion is free software under the [GNU General Public License v3.0 or later](LICENSE). Third-party components keep
their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Hyperion is not affiliated with TikTok.

The original prototype is kept at the `v0-legacy` tag.
