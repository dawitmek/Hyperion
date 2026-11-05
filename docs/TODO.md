# To do

Everything still to do on Hyperion, in one place. Add new work here rather than as `TODO` comments in the code, and
tick an item off in the same commit that finishes it.

## Features

### Timers and games

Decided so far:

- [ ] Subathon timer: a countdown widget with start, pause, +time and reset on the dashboard, a starting length and
      an optional max. Time is added from a simple rules table (seconds per diamond, follow, sub, share, and per N
      likes), not from actions
- [ ] Repeating goals (likeathon): a goal that, once reached, moves its target up by the same step and runs its
      "Reaches a goal" actions again
- [ ] Timed challenges: started from the dashboard ("500 likes in 2 minutes"). The overlay shows progress and a
      countdown, and actions can run on a win or a loss

Still to design:

- [ ] Wheel of fortune, spun by a gift, a command or points
- [ ] Points drops (`!claim` in a window)

### Overlays and actions

- [ ] Live streak widget: gift combos as they happen (who, which gift, the count climbing with a flame), gone a few
      seconds after the combo ends. Not the stream's longest streak, which `top_streak` already shows
- [ ] Reverse goal: the opposite of a goal, a widget that shows how many likes, shares and so on are available ("X
      likes available") rather than progress toward a target
- [ ] More actions and overlays

### Game integrations

Game actions send commands straight into a game, set up and kept on the companion. Minecraft Java (RCON) works.

- [ ] Minecraft Bedrock: the companion as a local WebSocket server the game joins with `/connect localhost:PORT`
      (cheats on, "Require Encrypted Websockets" off), pacing commands since Bedrock queues about 100 at a time.
      Check whether Windows still needs a `CheckNetIsolation` loopback exemption
- [ ] A list of compatible games on the site, with a setup guide for each
- [ ] More games through a small localhost protocol that game mods connect to (GTA V via Script Hook V, story mode
      only)

### Platforms and accounts

- [ ] Other platforms (YouTube, Twitch, Kick) through new adapters
- [ ] Log in with TikTok. Waiting on a registered TikTok developer app (client key and secret, HTTPS redirect)
- [ ] StreamElements voices. On hold: the free endpoint now needs each host's StreamElements JWT, which gives full
      account access
- [ ] All-in-one local mode: the server bundled as an optional Tauri sidecar, dashboard and overlay on `localhost`,
      likely SQLite, so streamers can run Hyperion with no hosted server
- [ ] Macros on macOS: recording and playing mouse input only exist for Windows (`apps/companion/src-tauri/src/input.rs`)

## Verification

- [ ] GTA V story mode runs live through Hyperion
- [ ] Look and feel reviewed in a browser and the companion, on Windows and macOS, light and dark, phone to desktop
- [ ] Companion updates end to end from a real release, on Windows and macOS: the one-time question, asking each
      time, automatic (waits while the game is in front), and the restart. Mac: check whether Accessibility has to
      be granted again after updating an unsigned build
