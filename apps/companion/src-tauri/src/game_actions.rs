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

/// Characters that never belong in a name or a command: control codes like tabs and line breaks, and invisible ones
/// that can hide text or turn it right to left, so one thing can look like another.
pub fn is_hidden(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{180E}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

/// The action as it's kept: trimmed, empty lines dropped, a leading slash taken off, and within the limits.
pub fn check(mut action: GameAction) -> Result<GameAction, String> {
    if action.name.chars().any(is_hidden) {
        return Err("Action names can't have invisible characters, like tabs or line breaks".into());
    }
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
        if command.chars().any(is_hidden) {
            return Err("Commands can't have invisible characters, like tabs or line breaks".into());
        }
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
    // Words are joined with non-breaking spaces, which look the same in the game but never split a command, so a name
    // where a command expects one word can't add words of its own.
    let kept: String = kept.split_whitespace().collect::<Vec<_>>().join("\u{a0}").chars().take(MAX_VIEWER_CHARS).collect();
    let kept = kept.trim_matches('\u{a0}').to_string();
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
            assert!(name.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | '\u{a0}')), "{hostile} gave {filled}");
        }
        assert_eq!(clean_viewer("  🌹🌹 "), "viewer");
        assert_eq!(clean_viewer("Zoë  the   great"), "Zoë\u{a0}the\u{a0}great");
        // Where a command expects one word, a name with spaces stays one word.
        assert_eq!(fill("execute as {player} at {viewer}", &values("x run op bob")).unwrap(), "execute as Steve at x\u{a0}run\u{a0}op\u{a0}bob");
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

    #[test]
    fn refuses_invisible_characters() {
        for name in ["Creeper\n", "Cree\u{202E}per", "Cree\u{200B}per"] {
            assert!(check(GameAction { name: name.into(), ..action(&["say hi"]) }).is_err(), "{name:?}");
        }
        for command in ["say hi\nop bob", "say\thi", "say \u{2066}hi"] {
            assert!(check(action(&[command])).is_err(), "{command:?}");
        }
        assert!(check(action(&["say Zoë says hi"])).is_ok());
    }
}
