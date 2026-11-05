# Minecraft

Let chat and gifts run commands inside Minecraft: a creeper beside you, TNT raining down, diamonds for every rose, a
zombie wearing a viewer's name. Hyperion sends the commands straight into the game, so they work whichever window is
in front and need no key presses.

Both editions work:

| | Minecraft Java Edition | Minecraft Bedrock Edition |
| --- | --- | --- |
| How it connects | The companion logs in to a Minecraft **server** through RCON, a remote console every Java server has | Your **world** connects to the companion with `/connect` |
| Single-player | No: play on a server, one on your own PC is fine | Yes, any world with cheats on |
| What it needs | A Java server with RCON turned on | Cheats on, and one setting changed |
| Who commands run as | The server console, so use `execute at {player} run …` for anything near you | You, so `~ ~ ~` is where you stand |

You need Hyperion set up with the companion paired and running on the PC that plays Minecraft. If you haven't done
that yet, follow [Getting started](../README.md#getting-started) first. A copy of Minecraft comes from
[minecraft.net](https://www.minecraft.net): one purchase includes both Java and Bedrock for PC.

- [Minecraft Java Edition](#minecraft-java-edition)
- [Minecraft Bedrock Edition](#minecraft-bedrock-edition)
- [Make your first game action](#make-your-first-game-action)
- [Let chat and gifts run it](#let-chat-and-gifts-run-it)
- [Sample commands](#sample-commands)
- [Troubleshooting](#troubleshooting)

## Minecraft Java Edition

Java's single-player has no RCON, so you play on a server. A server on your own PC takes a few minutes to set up and
costs nothing.

### 1. Install Java 21

Minecraft servers from 1.20.5 on need Java 21 or newer. Download **Temurin 21** from
[adoptium.net](https://adoptium.net) and install it with the default options. To check, open a new Command Prompt and
run:

```sh
java -version
```

It should say version 21 or higher.

### 2. Get a server

Make a new folder for it, such as `Documents\minecraft-server`, and download one of these into it:

- **Vanilla:** the official server, from [minecraft.net/download/server](https://www.minecraft.net/en-us/download/server).
- **Paper:** a faster server that runs the same commands, from [papermc.io/downloads](https://papermc.io/downloads/paper).

Pick the same version as your game. To play a different version, open the Minecraft Launcher, go to
**Installations**, then **New installation**, and choose that version.

### 3. Start it once

Open the folder, click the address bar, type `cmd` and press Enter. A Command Prompt opens in that folder. Run the
server, using the name of the file you downloaded:

```sh
java -Xmx2G -jar server.jar nogui
```

It stops straight away and asks you to accept the EULA. Open `eula.txt` in the folder, change `eula=false` to
`eula=true`, and save it.

### 4. Turn on RCON

Open `server.properties` in the folder and set these lines. Pick your own password:

```properties
enable-rcon=true
rcon.password=pick-a-long-password
rcon.port=25575
```

Save it, then start the server again with the same command. When it's ready it prints `Done` and
`RCON running on 0.0.0.0:25575`. Leave that window open: it's the server's console, and closing it stops the server.

> **Never forward port 25575 on your router.** RCON can run any command on your server, so keep it on your own PC or
> network. Hyperion's companion connects to it locally.

### 5. Join it and make yourself an operator

In Minecraft, open **Multiplayer**, then **Add Server**. Give it any name, set the address to `localhost`, and join it.

Then type this in the **server's console window** (not the game), with your own Minecraft name:

```
op YourName
```

Being an operator lets you run cheat commands yourself while you test. Hyperion doesn't need it.

### 6. Connect the companion

In the companion, find **Game actions**. On the **Minecraft Java** tile, click **Set up** and fill in:

| Field | What to enter |
| --- | --- |
| Server address | `localhost`, since the server runs on this PC |
| RCON port | `25575`, or whatever `rcon.port` says |
| RCON password | Exactly what `rcon.password` says |
| Your Minecraft name | The name you play as, for `{player}` |

Click **Save**. The companion checks the connection, and the tile says **Connected**. The password stays on your PC:
it is never sent to the Hyperion server.

## Minecraft Bedrock Edition

Bedrock connects the other way round: the companion waits, and your world joins it. There's no server to set up.

### 1. Allow unencrypted connections

In Minecraft, open **Settings**, then **General**, and turn **Require Encrypted Websockets** off. The companion only
listens on your own PC, so nothing leaves it.

### 2. Open a world with cheats on

Create a world or edit one, and turn on **Allow Cheats** under **Game**. Single-player is fine.

### 3. Turn Bedrock on in the companion

In the companion, under **Game actions**, click **Turn on** on the **Minecraft Bedrock** tile. It says **Waiting**.

### 4. Connect the world

In your world, open chat and type:

```
/connect 127.0.0.1:19131
```

The game says it's connected, and the companion's tile turns to **Connected**. The **Copy** button in the companion
copies this command for you.

The connection ends when you leave the world. Type `/connect` again whenever you reopen it.

## Make your first game action

A game action is one or more commands the companion sends in order, saved on your PC under a name.

1. In the companion, under **Game actions**, click **New game action**.
2. Name it, such as `creeper`, and choose **Java** or **Bedrock**.
3. Type the commands, one per line. The leading `/` is optional.

   Java:

   ```
   execute at {player} run summon creeper ~ ~ ~
   say {viewer} sent a creeper!
   ```

   Bedrock:

   ```
   summon creeper ~ ~ ~
   say {viewer} sent a creeper!
   ```

4. To run it more than once, set **Run it** to a number of times and the seconds between each.
5. Click **Save action**, then **Try**. A creeper should appear next to you, and chat says "Tester sent a creeper!".

### Blanks

Hyperion fills these in each time it runs. The buttons under the commands box add them where your cursor is.

| Blank | Becomes | Example |
| --- | --- | --- |
| `{viewer}` | The viewer's name | `say {viewer} sent a creeper!` |
| `{count}` | How many gifts they sent, or 1 | `give {player} diamond {count}` |
| `{player}` | Java: your Minecraft name. Bedrock: `@s`, which means you | `execute at {player} run summon tnt ~ ~5 ~` |

Viewer names are cleaned to letters, digits, spaces, `_`, `-` and `.` before they go in, so a name can never change a
command. Anything else in braces, like Minecraft's own `{NoAI:1b}`, is left alone.

If a command doesn't work, the companion's **Activity** list shows the game's reason, such as
`Minecraft said: No entity was found`.

## Let chat and gifts run it

The dashboard only knows each action's name. The commands themselves stay on your PC, so nobody can change them from
the dashboard.

**From a chat command:**

1. In the dashboard, open **Commands** and click **Add command**.
2. Type the keyword viewers will use, such as `creeper`.
3. Under **What it does**, choose **Game action** and pick your action.
4. Set a cooldown, so one viewer can't spam it.

**From a gift:**

1. Make a chat command for the action as above. You can switch it off if only gifts should run it.
2. In the dashboard, open **Actions**, add one, and choose **Sends a gift** with the gift you want.
3. Under **Do**, pick that command in **Run a command**.
4. Turn on **Once per gift in a streak** to run it for every gift: five roses, five creepers, up to 10.

Pausing the companion, or pressing `Ctrl+Shift+Backspace`, stops an action that's still running.

## Sample commands

Each box is one game action. Paste it into the commands box and save.

### Java

**Creeper next to you**

```
execute at {player} run summon creeper ~ ~ ~
say {viewer} sent a creeper!
```

**A zombie wearing the viewer's name** (Minecraft 1.21.5 and newer; before that, write `CustomName:'"{viewer}"'`)

```
execute at {player} run summon zombie ~ ~ ~ {CustomName:"{viewer}",CustomNameVisible:1b}
```

**TNT rain** (set Run it to 5 times, 1 second apart; before 1.20.3, write `Fuse` with a capital F)

```
execute at {player} run summon tnt ~ ~8 ~ {fuse:60}
```

**Diamonds, one for each gift**

```
give {player} diamond {count}
title {player} title {"text":"{viewer} sent diamonds"}
```

**Lightning strike**

```
execute at {player} run summon lightning_bolt ~ ~ ~
```

**Thunderstorm at night**

```
weather thunder
time set night
say {viewer} brought the storm
```

**Speed boost for 30 seconds**

```
effect give {player} minecraft:speed 30 2
```

**Teleport somewhere random within 50 blocks**

```
execute at {player} run spreadplayers ~ ~ 0 50 false {player}
```

### Bedrock

**Creeper next to you**

```
summon creeper ~ ~ ~
say {viewer} sent a creeper!
```

**A zombie wearing the viewer's name**

```
summon zombie "{viewer}" ~ ~ ~
```

**TNT rain** (set Run it to 5 times, 1 second apart)

```
summon tnt ~ ~8 ~
```

**Diamonds, one for each gift**

```
give @s diamond {count}
title @s title {viewer} sent diamonds
```

**Lightning strike**

```
summon lightning_bolt ~ ~ ~
```

**Thunderstorm at night**

```
weather thunder
time set night
say {viewer} brought the storm
```

**Speed boost for 30 seconds**

```
effect @s speed 30 2
```

**Teleport somewhere random within 50 blocks**

```
spreadplayers ~ ~ 0 50 @s
```

## Troubleshooting

**The companion says it couldn't reach Minecraft (Java).** The server isn't running, or RCON is off. Check the
server's window is open and printed `RCON running on 0.0.0.0:25575`. If not, check `enable-rcon=true` in
`server.properties` and restart the server.

**"Minecraft refused the RCON password".** The password in the companion doesn't match `rcon.password`. Click
**Change**, type it again and save.

**The action runs, but nothing appears near you (Java).** Your Minecraft name in the companion doesn't match the name
you're playing as, so `{player}` points at nobody, and the Activity list shows `No entity was found`. Type `list` in
the server's console to see the exact name, then fix it under **Change**.

**"Failed to log in" or "Invalid session" when joining your server.** That's Minecraft's account check, not
Hyperion. Close the game and the launcher completely and open them again, or sign out of the launcher and back in.
Check your PC's clock is right, too.

**"You are not whitelisted on this server".** Type `whitelist add YourName` in the server's console, or set
`white-list=false` in `server.properties` and restart.

**Hostile mobs vanish straight away.** The world is on Peaceful. Type `difficulty easy` in the server's console, or
change it in the world's settings on Bedrock.

**Bedrock says it couldn't connect.** Check Bedrock is turned on in the companion (the tile says **Waiting**), and
that **Require Encrypted Websockets** is off. Type the address exactly: `/connect 127.0.0.1:19131`.

**Bedrock: "Minecraft Bedrock didn't answer".** The game was paused, for example with the menu open. Close the menu
and try again.

**Try is greyed out.** The game isn't connected yet: set up Java, or connect Bedrock with `/connect`.

**The dashboard says "(PC offline)" beside an action.** The companion that has that action isn't connected to the
server. Open it on your gaming PC.
