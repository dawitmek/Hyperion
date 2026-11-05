// Game actions: commands sent straight into a game (Minecraft Java or Bedrock for now), set up and kept on this PC. Like macros, the
// server only ever names one to run, and viewer names only fill blanks in commands the host wrote.

use serde::{Deserialize, Serialize};
use std::path::Path;

pub const MAX_NAME_CHARS: usize = 64;
pub const MAX_COMMANDS: usize = 20;
pub const MAX_COMMAND_CHARS: usize = 1000; // Minecraft's RCON takes up to 1446 bytes
pub const MAX_REPEAT: u32 = 100;
pub const MAX_DELAY_MS: u32 = 10_000;
const MAX_VIEWER_CHARS: usize = 24;
const BLANKS: [&str; 3] = ["viewer", "count", "player"];

/// The games this PC can send commands to.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Game {
    MinecraftJava,
    MinecraftBedrock,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameAction {
    pub name: String,
    pub game: Game,
    pub commands: Vec<String>, // run in order, each round
    pub repeat: u32,           // rounds
    pub delay_ms: u32,         // between rounds
}

/// What fills the blanks in a command.
pub struct Values<'a> {
    pub viewer: &'a str,
    pub count: u32, // how many gifts; a gift action that repeats per gift runs the whole action once for each
    pub player: Option<&'a str>, // the host's own name in the game, or @s on Bedrock, where commands run as them
}

pub fn load(path: &Path) -> Vec<GameAction> {
    std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn save(path: &Path, actions: &[GameAction]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_string(actions).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// The action as it's kept: trimmed, empty lines dropped, a leading slash taken off, and within the limits.
pub fn check(mut action: GameAction) -> Result<GameAction, String> {
    action.name = crate::macros::clean_name(&action.name).map_err(|_| {
        if action.name.trim().is_empty() { "Give the action a name".to_string() } else { format!("Action names can be up to {MAX_NAME_CHARS} characters") }
    })?;
    action.commands = action
        .commands
        .iter()
        .map(|c| c.trim().trim_start_matches('/').trim().to_string())
        .filter(|c| !c.is_empty())
        .collect();
    if action.commands.is_empty() {
        return Err("Add at least one command".into());
    }
    if action.commands.len() > MAX_COMMANDS {
        return Err(format!("An action can have up to {MAX_COMMANDS} commands"));
    }
    for command in &action.commands {
        if command.chars().count() > MAX_COMMAND_CHARS {
            return Err(format!("Commands can be up to {MAX_COMMAND_CHARS} characters"));
        }
        if let Some(blank) = blanks(command).find(|b| !BLANKS.contains(b)) {
            return Err(format!("{{{blank}}} isn't a blank Hyperion can fill. Use {{viewer}}, {{count}} or {{player}}"));
        }
    }
    if !(1..=MAX_REPEAT).contains(&action.repeat) {
        return Err(format!("Repeat it 1 to {MAX_REPEAT} times"));
    }
    if action.delay_ms > MAX_DELAY_MS {
        return Err(format!("The wait between repeats can be up to {} seconds", MAX_DELAY_MS / 1000));
    }
    Ok(action)
}

/// Blanks are a lowercase word in braces. Anything else in braces, like Minecraft's {CustomName:"…"}, is left alone.
fn blanks(command: &str) -> impl Iterator<Item = &str> {
    command.split('{').skip(1).filter_map(|rest| {
        let word = rest.split_once('}')?.0;
        (!word.is_empty() && word.chars().all(|c| c.is_ascii_lowercase())).then_some(word)
    })
}

/// A command with its blanks filled in.
pub fn fill(command: &str, values: &Values) -> Result<String, String> {
    let mut out = String::with_capacity(command.len());
    let mut rest = command;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let value = after.split_once('}').and_then(|(word, _)| {
            let value = match word {
                "viewer" => Ok(clean_viewer(values.viewer)),
                "count" => Ok(values.count.to_string()),
                "player" => values.player.map(str::to_string).ok_or_else(|| "set your Minecraft name first: this action uses {player}".to_string()),
                _ => return None,
            };
            Some((word.len(), value))
        });
        match value {
            Some((len, value)) => {
                out.push_str(&value?);
                rest = &after[len + 1..];
            }
            None => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    Ok(out)
}

/// A viewer's name, safe anywhere in a command: letters, digits, spaces, _ - and . only, so no name can close a quote,
/// a bracket or a selector and add to the command.
pub fn clean_viewer(name: &str) -> String {
    let kept: String = name.chars().filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | ' ')).collect();
    let kept: String = kept.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_VIEWER_CHARS).collect();
    let kept = kept.trim().to_string();
    if kept.is_empty() { "viewer".into() } else { kept }
}

/// Minecraft Java names: 3 to 16 letters, digits and underscores.
pub fn check_player(name: &str) -> Result<String, String> {
    let name = name.trim();
    if (3..=16).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        Ok(name.to_string())
    } else {
        Err("Minecraft names are 3 to 16 letters, digits and underscores".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action(commands: &[&str]) -> GameAction {
        GameAction {
            name: "rain".into(),
            game: Game::MinecraftJava,
            commands: commands.iter().map(|c| c.to_string()).collect(),
            repeat: 1,
            delay_ms: 0,
        }
    }
    fn values(viewer: &str) -> Values<'_> {
        Values { viewer, count: 3, player: Some("Steve") }
    }

    #[test]
    fn fills_blanks_and_leaves_minecraft_braces_alone() {
        let command = r#"execute at {player} run summon zombie ~ ~ ~ {CustomName:'"{viewer}"',NoAI:1b}"#;
        assert_eq!(fill(command, &values("Ann")).unwrap(), r#"execute at Steve run summon zombie ~ ~ ~ {CustomName:'"Ann"',NoAI:1b}"#);
        assert_eq!(fill("say {count} from {viewer}", &values("Bo")).unwrap(), "say 3 from Bo");
        assert_eq!(fill("say {} {", &values("Bo")).unwrap(), "say {} {");
    }

    #[test]
    fn viewer_names_cannot_break_out_of_a_command() {
        for hostile in [r#"x'"}] run op me"#, "a\nstop", "@a", "§cRed", "{player}", "]}/op x"] {
            let filled = fill(r#"summon zombie ~ ~ ~ {CustomName:'"{viewer}"'}"#, &values(hostile)).unwrap();
            let name = filled.trim_start_matches(r#"summon zombie ~ ~ ~ {CustomName:'""#).trim_end_matches(r#""'}"#);
            assert!(name.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | ' ')), "{hostile} gave {filled}");
        }
        assert_eq!(clean_viewer("  🌹🌹 "), "viewer");
        assert_eq!(clean_viewer("Zoë  the   great"), "Zoë the great");
        assert_eq!(clean_viewer(&"a".repeat(40)).len(), 24);
    }

    #[test]
    fn player_blank_needs_a_name() {
        let none = Values { viewer: "x", count: 1, player: None };
        assert!(fill("tp {player} 0 0 0", &none).unwrap_err().contains("Minecraft name"));
    }

    #[test]
    fn checks_actions() {
        let kept = check(action(&["  /summon creeper ~ ~ ~ ", "", "say hi"])).unwrap();
        assert_eq!(kept.commands, ["summon creeper ~ ~ ~", "say hi"]);
        assert!(check(action(&["", " "])).unwrap_err().contains("at least one"));
        assert!(check(action(&["say {name}"])).unwrap_err().contains("{name}"));
        assert!(check(action(&["summon zombie ~ ~ ~ {NoAI:1b}"])).is_ok());
        assert!(check(GameAction { repeat: 0, ..action(&["say hi"]) }).is_err());
        assert!(check(GameAction { delay_ms: 20_000, ..action(&["say hi"]) }).is_err());
        assert!(check(GameAction { name: " ".into(), ..action(&["say hi"]) }).unwrap_err().contains("name"));
    }

    #[test]
    fn checks_player_names() {
        assert_eq!(check_player(" Steve_01 ").unwrap(), "Steve_01");
        assert!(check_player("ab").is_err());
        assert!(check_player("Steve @a").is_err());
    }
}
