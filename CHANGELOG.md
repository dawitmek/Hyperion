# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Game actions: the companion sends commands straight into a Minecraft Java server, through the RCON connection Minecraft servers have built in. Set up the server and write actions in the companion's Game actions section, then pick one with "Run a game action" for a chat command or gift action.
- An action is one or more commands, repeated up to 100 times with a wait between. Blanks fill in the viewer's name ({viewer}), how many gifts they sent ({count}) and your Minecraft name ({player}), so `execute at {player} run summon creeper ~ ~ ~` spawns a creeper beside you. Viewer names are cleaned so they can never change a command.
- Actions and the RCON password stay on your PC. The server only knows action names, and a command whose action isn't on the connected PC is marked "(PC offline)".
- Try runs an action from the companion as a viewer called Tester, and commands Minecraft refuses show in the activity list with Minecraft's reason.

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

[Unreleased]: https://github.com/dawitmek/Hyperion/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/dawitmek/Hyperion/compare/v0.3.1...v0.4.0
