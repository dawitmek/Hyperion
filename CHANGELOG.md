# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-11-07

Game action packs and themes for the companion, and new login and signup pages.

### Added
- Importing and sharing game actions in the companion. Import adds a starter pack for Minecraft Java or Bedrock (the guide's sample commands), a pack pasted from another streamer, or a pack file. Every action and command shows before anything is added, and you pick which to take; commands that can do lasting harm or run a command that isn't shown, like `op`, `stop`, `fill`, `kill @a` or a command block, are marked with why and start unticked, the starter packs are marked Built in so a shared pack can't pass for one, and an action whose name you already use can be kept alongside yours or replace it. Share copies the actions you pick as a pack, or saves it to your Downloads folder. A pack holds only the actions, never your server details.
- Selecting several game actions in the companion, to share or delete them together.
- An Appearance button in the companion. It matches the dashboard's theme as before, or the companion can have a theme, light or dark of its own, kept on that PC.

### Changed
- The companion's game actions are redrawn: each action is a card in its game's colour, choosing Java or Bedrock is a card per edition that says whether it's connected, and a pack's preview groups its actions into ready, risky and can't be imported, with the ones being imported highlighted.
- The login, signup and password pages are redesigned: the form sits beside a panel showing chat pressing keys, passwords can be shown while typing, signup ticks off the 8-character minimum, and the button says when it's working.
- The site is up to date: it covers Analytics and commands read aloud, lists the right starting commands, offline voice count and voice effects, and its self-hosting steps use the published image, built-in HTTPS, closing signups and email.
- For self-hosters, the containers are named `hyperion-server`, `hyperion-postgres` and `hyperion-caddy` rather than `hyperion-selfhost-hyperion-1` and so on. The next `up -d` renames them, and your data stays as it is.

### Security
- A viewer's name with spaces in it stays one word in a game action's commands, wherever the command puts it.

## [0.7.1] - 2026-11-07

Fixes from a security review of signup and password recovery.

### Added
- An email when your password is changed or reset, with a link to reset it if it wasn't you (on servers with email set up).

### Security
- Changing or resetting a password cancels every link already emailed for the account, so a reset link someone else asked for stops working.
- At most one confirmation, reset or "you already have an account" email goes to an address every 2 minutes, however many times it's asked for.
- Wrong current passwords when changing your password count toward the same 15-minute pause as wrong logins.
- A login with an email that has no account takes as long as a wrong password, so timing can't show who has an account.
- On servers with email set up, signing up with an email that already has an account looks the same as a new signup, and the owner gets an email about it.

## [0.7.0] - 2026-11-07

Account security: closing signups, password change and reset, and sign out everywhere.

### Added
- Changing your password, under Settings → Account. It signs you out on every other device.
- Sign out everywhere, under Settings → Account. Overlays and paired companions keep working.
- Forgot your password? on the login page, which emails a link to choose a new one. It signs you out everywhere else.
- Email confirmation: on servers with email set up, a new account confirms its address before it can sign in. Accounts made before stay as they are.
- For self-hosters: `SIGNUPS_ENABLED=false` closes signups (existing accounts keep working); `SMTP_URL` and `MAIL_FROM` turn on email through any SMTP service; and on a server without email, `admin.js reset-link <email>` makes a one-time password reset link to send someone.

### Changed
- Piper voices are optional, for self-hosters. The published image no longer includes them, so it's about 360 MB smaller and reading chat aloud doesn't use the server's CPU. To keep Piper, set `WITH_PIPER=true` in `.env` and build the image yourself. The dashboard only offers Piper on servers that have it; hosts who had picked it on a server without it hear eSpeak and see a notice on the Voice page.

### Security
- Ten wrong passwords for one account within 15 minutes pause logins to it for the rest of that time, wherever the guesses come from. A password reset ends the pause.
- Overlay links no longer appear in the server's request log.

## [0.6.0] - 2026-11-06

Patterns across streams, commands read aloud, and a safer companion.

### Added
- Patterns on Analytics, across your streams in the last 7, 30 or 90 days or all time: the hours of each weekday chat is busiest (in your time zone), how many viewers interact and how many come back for another stream, coins per hour live, follows per 100 viewers, the average stream, the most used commands and the gifts worth the most coins.
- Reading commands aloud, on the Voice page: the voice says each command that fires, in wording of your own ("{viewer} pressed {command}" by default), whether chat reading is on or not. One is read at most every 3 seconds and never over chat or alerts. Democracy votes are read as "Chat", and a name the voice can't say as "Someone".
- A New goal button in an action's editor, for when the goal it should run on doesn't exist yet. Like a goal made on the Stream overlay page, it gets its own widget on the main screen.
- Two themes: Mocha Cream and Tangerine.

### Changed
- Blocked words on the Voice page are chips you can remove one at a time, with a box to add more.
- A new gift action that presses a key presses it once per gift in a streak by default, so a streak of 5 roses is 5 presses.
- Read-aloud wording only takes its own blanks, so a typo like {veiwer} is refused when you save rather than spoken.
- The live dock's numbers each have an icon and colour.
- The companion's game picker lists the programs you used most recently first, and leaves out the companion itself.
- The companion's sections all start folded. The ones you open stay open next time.

### Fixed
- An action for one viewer matches them whether their username was typed with its @ or without.

### Security
- The companion only installs updates signed with Hyperion's release key, and doesn't offer a release without a signature. The release workflow's build steps are pinned to exact versions.
- When the dashboard switches to a profile for a different game, the companion pauses until you press Play, so keys can't be sent to another program without you knowing.
- The companion's Minecraft Bedrock connection turns away web pages, so a site open in your browser can't pose as the game and read the commands meant for it.
- Text fields across the dashboard and server refuse invisible characters like tabs and line breaks, and the dashboard drops them as you type or paste. Cloud voice keys and voice names are checked for the right shape.

## [0.5.0] - 2026-11-05

Game integrations, starting with Minecraft, and a raffle crowd mode.

### Added
- Game actions: the companion sends commands straight into Minecraft, Java or Bedrock. Set up the game and write actions in the companion's Game actions section, then choose Game action for a chat command, which a gift action can run too.
- Minecraft Java goes through the RCON connection Minecraft servers have built in. Minecraft Bedrock connects itself: turn it on in the companion, then type `/connect 127.0.0.1:19131` in a world with cheats on, single-player included.
- An action is one or more commands, repeated up to 100 times with a wait between. Blanks fill in the viewer's name ({viewer}), how many gifts they sent ({count}) and you ({player}), so `execute at {player} run summon creeper ~ ~ ~` spawns a creeper beside you on Java. On Bedrock commands run as you, so `summon creeper ~ ~ ~` does. Viewer names are cleaned so they can never change a command.
- Actions and the Java RCON password stay on your PC. The server only knows action names, and a command whose action isn't on the connected PC is marked "(PC offline)".
- Try runs an action from the companion as a viewer called Tester, and commands Minecraft refuses show in the activity list with Minecraft's reason.
- A fifth crowd mode, Raffle: chat types commands to enter, and every few seconds (10 by default, set per profile) one entrant is drawn at random and only their command fires. Made for big commands like spawning a mob, where every comment firing would be too much. A viewer has one entry per draw, their latest command, and with gift boosts on each gift adds an entry. The overlay and Live page show the entrants, a countdown and the last winner.
- An Integrations page on the site lists the games Hyperion sends commands into, starting with Minecraft, and a [Minecraft guide](docs/MINECRAFT.md) covers setup step by step with sample commands for both editions.

### Changed
- Choosing what a command does is four labelled options (Key, Macro, Game action and Chain), each with its own icon and colour, which its tile and list row carry too. Options with nothing to pick yet say what to set up first, and switching back to an option restores what it was set to.
- Choosing a crowd mode is a row of tiles, each mode with its own icon and colour, on the Commands page and the Live page. Below them the chosen mode explains how it plays in three steps using your own numbers, and shows only its own settings, with gift boosts described for that mode.
- An action's "Press a command's key" is now "Run a command", since the command can be a macro, chain or game action.
- The site shows the current apps: the Commands deck, the companion's status card, and game actions.
- The companion's sections fold away to their title and a one-line summary, like "14 commands" or "2 need your OK", and stay folded next time. A bar at the top jumps to any section and shows which one you're in.
- The companion offers Play when it starts, after pairing and after the game is cleared. It only says Paused and offers Resume after you pause it yourself, with the button or the panic key.

### Fixed
- The Download page finds the newest companion release itself, so it keeps offering the installers when a server release is marked as GitHub's latest.

## [0.4.0] - 2026-11-04

Stream reports, phone layouts and a published image.

### Added
- Each stream has a full report on a page of its own on Analytics, listing everyone who took part and what they did, biggest gifters first, with links to the streams on either side.
- A stream's activity can be narrowed to a stretch of time (click a column on the chat chart), one command (with the times chat asked for it and didn't get it), one gift or one viewer.
- A recap appears over whichever page is open when a stream or test session ends: peak viewers, new followers, likes, coins, the top player and the busiest moment. It can be turned off in Settings under After a stream.
- Screens can be laid out for a portrait stream as TikTok shows it on phones (1080 by 1920), keeping widgets clear of TikTok's buttons at the top and its chat at the bottom.
- Widgets on a screen have a size of their own, set with a corner handle, separate from their look. A screen's alerts can be resized too.
- A position pad for placing widgets: drag the knob, click a spot or use the arrow keys.
- A live preview of each screen's overlay page, exactly as OBS or LIVE Studio shows it, alerts included, with sample numbers until you go live.
- A dock in a corner of every page except Live, for going live, switching crowd mode or stopping without going back to Live. It collapses to a pill.
- The leaderboard tracks the coins each viewer has gifted, has a podium for the top three, and explains how XP and levels work. Coins for existing viewers are worked out from their XP.
- Every built-in sound has its own volume, and built-in sounds can be removed from the Sound menu like built-in pictures. Removed pictures and removed sounds can be brought back separately.
- Seven new sounds in the media library.
- A reset button beside an action's trigger puts back that trigger's default name, text, sound and settings.
- Shift-click selects a range of files in the media library.
- Number fields with − and + buttons, steps that fit the number and one-click amounts.
- A coin jar or goal can raise its target and start over once reached.
- A Legacy theme with the original plain black and white look.
- The Hyperion version is shown in Settings.
- A published server image at ghcr.io/dawitmek/hyperion for x86-64 and ARM, built on each release tag. HYPERION_VERSION in .env pins a release.

### Changed
- The coin jar is redrawn as a glass jar. Coins settle onto a pile that rises toward the target, with up to a dozen coins per gift, and a full jar glows and sparkles.
- The Live page puts the stream card first by default, and its numbers are split into headline figures and a Show details section that stays open or closed as you left it.
- Changing an action's trigger no longer replaces its text or anything else, in case it was a slip. The reset button puts the defaults in.
- The default theme uses the brand's indigo for lines, the main button and the sidebar instead of plain black.
- Stream analytics load faster: an ended stream's summary is worked out once and kept, and totals for many streams come from one query each.
- Self-hosting docs and compose.yml cover pulling the published image as well as building it.
- Signed-in visitors going to the login or signup page are taken straight to the dashboard.
- When a session ends, for example after logging out in another tab, the dashboard goes back to the login page and returns to the same page afterwards.

### Removed
- **BREAKING:** The gift animation widget. It's migrated for you: each screen that had one gets a gift action instead, with the same minimum amount, animation and speed, on that screen. It plays the animation without showing an alert.

### Security
- Logging in ends the session the browser already had, so an old session can't stay valid after it.

[Unreleased]: https://github.com/dawitmek/Hyperion/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/dawitmek/Hyperion/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/dawitmek/Hyperion/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/dawitmek/Hyperion/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/dawitmek/Hyperion/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/dawitmek/Hyperion/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dawitmek/Hyperion/compare/v0.3.1...v0.4.0
