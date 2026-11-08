// Packs: game actions shared as text, pasted or opened as a file, plus the starter packs that come with the companion.
// Nothing in a pack runs or is saved until the host has seen every command in the preview and chosen to import it,
// and each action passes the same checks as one written here.

use crate::game_actions::{self, GameAction, MAX_NAME_CHARS};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const KIND: &str = "game-actions";
const VERSION: u32 = 1;
pub const MAX_PACK_BYTES: usize = 512 * 1024;
pub const MAX_PACK_ACTIONS: usize = 100;
const MAX_ABOUT_CHARS: usize = 300;

/// Ready-made packs, read the same way as any other so they get the same preview.
const STARTERS: [&str; 2] = [include_str!("../packs/minecraft-java.json"), include_str!("../packs/minecraft-bedrock.json")];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Starter {
    name: String,
    description: String,
    text: &'static str,
}

pub fn starters() -> Vec<Starter> {
    STARTERS
        .iter()
        .filter_map(|text| {
            let pack: Value = serde_json::from_str(text).ok()?;
            let field = |key: &str| pack.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
            Some(Starter { name: field("name"), description: field("description"), text })
        })
        .collect()
}

/// A pack as the preview shows it. An action that fails a check is listed with why, and can't be imported.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub built_in: bool, // one of the starter packs, exactly as it comes with the companion
    pub name: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub actions: Vec<PreviewAction>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAction {
    pub name: String,
    pub action: Option<GameAction>, // as it would be saved, when it passes
    pub problem: Option<String>,
    pub risks: Vec<Risk>,
    pub exists: bool, // this PC already has an action with that name
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Risk {
    pub line: usize, // which command, from 0
    pub reason: &'static str,
}

/// Text about a pack, on one line with invisible characters taken out.
fn clean_about(text: &str) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    text.chars().filter(|c| !game_actions::is_hidden(*c)).take(MAX_ABOUT_CHARS).collect::<String>().trim().to_string()
}

fn text_field(pack: &Value, key: &str) -> Option<String> {
    let text = clean_about(pack.get(key)?.as_str()?);
    (!text.is_empty()).then_some(text)
}

pub fn preview(text: &str, existing: &[String]) -> Result<Preview, String> {
    if text.len() > MAX_PACK_BYTES {
        return Err(format!("That's too big for a pack. Packs can be up to {} KB", MAX_PACK_BYTES / 1024));
    }
    let not_a_pack = "That isn't a Hyperion game actions pack. Copy the whole pack, from the first { to the last }";
    let pack: Value = serde_json::from_str(text.trim()).map_err(|_| not_a_pack.to_string())?;
    if pack.get("hyperion").and_then(Value::as_str) != Some(KIND) {
        return Err(not_a_pack.into());
    }
    match pack.get("version").and_then(Value::as_u64) {
        Some(v) if v as u32 == VERSION => {}
        Some(v) if v as u32 > VERSION => return Err("This pack was made by a newer Hyperion. Update the companion to open it".into()),
        _ => return Err(not_a_pack.into()),
    }
    let list = pack.get("actions").and_then(Value::as_array).ok_or_else(|| "This pack has no game actions in it".to_string())?;
    if list.is_empty() {
        return Err("This pack has no game actions in it".into());
    }
    if list.len() > MAX_PACK_ACTIONS {
        return Err(format!("A pack can have up to {MAX_PACK_ACTIONS} game actions"));
    }
    let actions = list
        .iter()
        .enumerate()
        .map(|(i, raw)| {
            let name = raw.get("name").and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty());
            let name = name.map_or_else(|| format!("Action {}", i + 1), |n| n.chars().filter(|c| !game_actions::is_hidden(*c)).take(MAX_NAME_CHARS).collect());
            let checked = serde_json::from_value::<GameAction>(raw.clone())
                .map_err(|_| "Something in this action isn't right, like a game Hyperion doesn't know".to_string())
                .and_then(game_actions::check);
            match checked {
                Ok(action) => PreviewAction {
                    exists: existing.contains(&action.name),
                    risks: action.commands.iter().enumerate().filter_map(|(line, c)| risk(c).map(|reason| Risk { line, reason })).collect(),
                    name: action.name.clone(),
                    action: Some(action),
                    problem: None,
                },
                Err(problem) => PreviewAction { name, action: None, problem: Some(problem), risks: vec![], exists: false },
            }
        })
        .collect();
    Ok(Preview {
        built_in: STARTERS.iter().any(|starter| starter.trim() == text.trim()),
        name: text_field(&pack, "name").unwrap_or_else(|| "Untitled pack".into()),
        author: text_field(&pack, "author"),
        description: text_field(&pack, "description"),
        actions,
    })
}

/// Commands that can do lasting harm to a world or server, hand control to someone else, or run commands that aren't
/// shown, with why in plain words. `execute ... run <command>` is checked for what it runs. Not every harmful command
/// can be caught, which is why the preview shows every command in full.
pub fn risk(command: &str) -> Option<&'static str> {
    let lower = command.to_lowercase();
    // A command can carry another in its data: a command block's Command, or a click in chat text or a book that
    // runs one. Quotes and spaces are ignored, since the data can be written with or without them, and escapes like
    // \u0043 could spell anything.
    let flat: String = lower.chars().filter(|c| !c.is_whitespace() && !matches!(c, '"' | '\'' )).collect();
    if ["command:", "command_block", "run_command", "click_event", "clickevent", "\\u", "\\x", "\\n{"].iter().any(|s| flat.contains(s)) {
        return Some("Can run a command that isn't listed here");
    }
    let words: Vec<&str> = lower.split_whitespace().collect();
    let mut starts = vec![0];
    starts.extend(words.iter().enumerate().filter(|(_, w)| **w == "run").map(|(i, _)| i + 1));
    starts.into_iter().find_map(|at| {
        let name = words.get(at)?.trim_start_matches('/');
        let name = name.strip_prefix("minecraft:").unwrap_or(name);
        let rest = &words[at + 1..];
        let everyone = rest.iter().any(|w| w.starts_with("@a") || w.starts_with("@e"));
        Some(match name {
            "op" | "deop" => "Changes who has operator rights",
            "stop" => "Shuts down the server",
            "ban" | "ban-ip" | "pardon" | "pardon-ip" | "kick" => "Bans or kicks players",
            "whitelist" | "allowlist" => "Changes who can join",
            "gamerule" | "difficulty" | "defaultgamemode" | "tick" => "Changes the world's rules",
            "save-off" => "Stops the world from saving",
            "fill" | "clone" | "place" | "structure" => "Can change a large part of the world",
            "worldborder" => "Moves the world's border, which can trap or kill players",
            "setworldspawn" | "forceload" | "tickingarea" => "Changes the world's settings",
            "data" => "Changes saved data in the world or its creatures",
            "function" | "reload" | "datapack" | "script" | "scriptevent" | "schedule" => "Runs commands that aren't shown here",
            "connect" | "wsserver" => "Connects your game to another program, which could then run any command",
            "permission" | "ops" | "setmaxplayers" | "transfer" | "ability" => "Changes the server's settings or players",
            "kill" if everyone => "Kills every player or every entity",
            "gamemode" | "spawnpoint" if everyone => "Changes every player's game mode or spawn",
            "xp" | "experience" if everyone || rest.contains(&"set") || rest.iter().any(|w| w.starts_with('-')) => "Takes away experience",
            "clear" => "Empties inventories",
            _ => return None,
        })
    })
}

/// What to do with an action whose name is already taken: replace the old one, or keep both under a new name.
#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum OnClash {
    Replace,
    KeepBoth,
}

/// One action picked in the preview, and what to do if its name is taken.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chosen {
    pub action: GameAction,
    pub on_clash: OnClash,
}

/// Adds the chosen actions to the list, checking each again. Returns the names they were saved under.
pub fn merge(list: &mut Vec<GameAction>, chosen: Vec<Chosen>) -> Result<Vec<String>, String> {
    if chosen.is_empty() {
        return Err("Pick at least one action to import".into());
    }
    let mut saved = vec![];
    for Chosen { action, on_clash } in chosen {
        let mut action = game_actions::check(action)?;
        // Within the pack, a second action with the same name is always kept as well.
        let taken_by_pack = saved.contains(&action.name);
        match list.iter().position(|a| a.name == action.name) {
            Some(at) if on_clash == OnClash::Replace && !taken_by_pack => list[at] = action.clone(),
            Some(_) => {
                action.name = free_name(list, &action.name);
                list.push(action.clone());
            }
            None => list.push(action.clone()),
        }
        saved.push(action.name);
    }
    Ok(saved)
}

/// "Creeper" becomes "Creeper 2", then "Creeper 3", within the name limit.
fn free_name(list: &[GameAction], name: &str) -> String {
    (2..)
        .map(|n| {
            let suffix = format!(" {n}");
            let base: String = name.chars().take(MAX_NAME_CHARS - suffix.chars().count()).collect();
            format!("{}{suffix}", base.trim_end())
        })
        .find(|candidate| !list.iter().any(|a| &a.name == candidate))
        .unwrap()
}

/// The chosen actions as a pack, readable so people can see what's in it before they share or paste it.
pub fn export(actions: &[GameAction], name: &str, author: &str) -> Result<String, String> {
    if actions.is_empty() {
        return Err("Pick at least one action to share".into());
    }
    let mut pack = serde_json::json!({
        "hyperion": KIND,
        "version": VERSION,
        "name": if clean_about(name).is_empty() { "My game actions".to_string() } else { clean_about(name) },
    });
    if !clean_about(author).is_empty() {
        pack["author"] = clean_about(author).into();
    }
    pack["actions"] = serde_json::to_value(actions).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&pack).map_err(|e| e.to_string())
}

/// A file name from the pack's name: letters, digits and dashes, ending in .json.
pub fn file_name(name: &str) -> String {
    let slug: String = name.chars().map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let slug = slug.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    let slug: String = slug.chars().take(48).collect();
    format!("{}.hyperion.json", if slug.is_empty() { "game-actions" } else { &slug })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_actions::Game;

    fn action(name: &str, commands: &[&str]) -> GameAction {
        GameAction { name: name.into(), game: Game::MinecraftJava, commands: commands.iter().map(|c| c.to_string()).collect(), repeat: 1, delay_ms: 0 }
    }

    #[test]
    fn starter_packs_pass_every_check_with_no_warnings() {
        let starters = starters();
        assert_eq!(starters.len(), STARTERS.len());
        for starter in starters {
            let preview = preview(starter.text, &[]).unwrap();
            assert!(!starter.description.is_empty());
            assert_eq!(preview.actions.len(), 8, "{}", preview.name);
            for a in preview.actions {
                assert!(a.problem.is_none(), "{}: {:?}", a.name, a.problem);
                assert!(a.risks.is_empty(), "{}: {:?}", a.name, a.risks);
            }
        }
    }

    #[test]
    fn exported_packs_read_back_the_same() {
        let actions = vec![action("Creeper", &["summon creeper ~ ~ ~"]), GameAction { repeat: 5, delay_ms: 1000, ..action("TNT", &["summon tnt ~ ~8 ~"]) }];
        let text = export(&actions, "  My   pack ", "mira").unwrap();
        let preview = preview(&text, &["TNT".into()]).unwrap();
        assert_eq!(preview.name, "My pack");
        assert_eq!(preview.author.as_deref(), Some("mira"));
        assert_eq!(preview.actions.iter().map(|a| a.action.clone().unwrap()).collect::<Vec<_>>(), actions);
        assert_eq!(preview.actions.iter().map(|a| a.exists).collect::<Vec<_>>(), [false, true]);
        assert!(export(&[], "x", "").is_err());
    }

    #[test]
    fn refuses_what_isnt_a_pack() {
        assert!(preview("hello", &[]).unwrap_err().contains("isn't a Hyperion"));
        assert!(preview(r#"{"actions":[]}"#, &[]).unwrap_err().contains("isn't a Hyperion"));
        assert!(preview(r#"{"hyperion":"game-actions","version":2,"actions":[]}"#, &[]).unwrap_err().contains("newer"));
        assert!(preview(r#"{"hyperion":"game-actions","version":1,"actions":[]}"#, &[]).unwrap_err().contains("no game actions"));
        assert!(preview(&"x".repeat(MAX_PACK_BYTES + 1), &[]).unwrap_err().contains("too big"));
    }

    #[test]
    fn a_bad_action_is_listed_with_why_and_the_rest_still_import() {
        let text = r#"{"hyperion":"game-actions","version":1,"name":"Mixed","commands":[{"keyword":"later"}],"actions":[
            {"name":"Good","game":"minecraftJava","commands":["/say hi"],"repeat":1,"delayMs":0},
            {"name":"Bad blank","game":"minecraftJava","commands":["say {name}"],"repeat":1,"delayMs":0},
            {"name":"Odd game","game":"tetris","commands":["say hi"],"repeat":1,"delayMs":0},
            {"game":"minecraftJava","commands":["say hi"],"repeat":500,"delayMs":0}]}"#;
        let preview = preview(text, &[]).unwrap();
        assert_eq!(preview.actions[0].action.as_ref().unwrap().commands, ["say hi"]);
        assert!(preview.actions[1].problem.as_ref().unwrap().contains("{name}"));
        assert!(preview.actions[2].problem.is_some());
        assert_eq!(preview.actions[3].name, "Action 4");
        assert!(preview.actions[3].problem.is_some());
    }

    #[test]
    fn flags_risky_commands_wherever_they_run() {
        assert_eq!(risk("op {viewer}"), Some("Changes who has operator rights"));
        assert_eq!(risk("/minecraft:stop"), Some("Shuts down the server"));
        assert_eq!(risk("execute as @a run kill @s"), None);
        assert!(risk("execute at {player} run kill @e[type=!player]").is_some());
        assert!(risk("execute at {player} RUN fill ~-50 ~ ~-50 ~50 ~ ~50 air").is_some());
        assert!(risk("kill @a").is_some());
        assert_eq!(risk("summon creeper ~ ~ ~"), None);
        assert_eq!(risk("say {viewer} wants to op the stop"), None);
        assert_eq!(risk("kill {player}"), None);
    }

    #[test]
    fn flags_commands_hidden_inside_others() {
        let hidden = Some("Can run a command that isn't listed here");
        for command in [
            r#"setblock ~ ~ ~ command_block{Command:"kill @a",auto:1b}"#,
            r#"execute at {player} run summon minecraft:command_block_minecart ~ ~ ~"#,
            r#"setblock ~ ~ ~ repeating_command_block{ "Command" : "op bob" }"#,
            r#"data merge block ~ ~-1 ~ {'Command':'say hi'}"#,
            r#"tellraw {player} {"text":"Click me","clickEvent":{"action":"run_command","value":"/op bob"}}"#,
            r#"tellraw {player} {text:"Click me",click_event:{action:"run_command",command:"/op bob"}}"#,
            r#"setblock ~ ~ ~ command_block{"Command":"op bob"}"#,
        ] {
            assert_eq!(risk(command), hidden, "{command}");
        }
    }

    #[test]
    fn flags_other_lasting_harm() {
        for command in [
            "connect example.com:1234",
            "/wsserver 1.2.3.4:5",
            "worldborder set 1",
            "execute as {player} run difficulty hard",
            "gamemode survival @a",
            "xp set {player} 0",
            "experience add @s -100 levels",
            "place structure minecraft:mansion",
            "structure load base ~ ~ ~",
            "schedule function x 1t",
            "scriptevent my:event",
            "data modify entity @e[limit=1] Health set value 0",
        ] {
            assert!(risk(command).is_some(), "{command}");
        }
        for command in ["gamemode creative {player}", "xp add {player} 10 levels", "effect give {player} minecraft:speed 30 2"] {
            assert_eq!(risk(command), None, "{command}");
        }
    }

    #[test]
    fn only_starter_packs_are_built_in() {
        let java = starters().into_iter().next().unwrap().text;
        assert!(preview(java, &[]).unwrap().built_in);
        let claims = java.replacen("Minecraft Java starter", "Totally official", 1);
        assert!(!preview(&claims, &[]).unwrap().built_in);
    }

    #[test]
    fn pack_text_has_no_invisible_characters() {
        let text = r#"{"hyperion":"game-actions","version":1,"name":"Fun\u202e pack","author":"Hyper\u200bion","actions":[{"name":"Cree\u202eper","game":"minecraftJava","commands":["say hi"],"repeat":1,"delayMs":0}]}"#;
        let preview = preview(text, &[]).unwrap();
        assert_eq!((preview.name.as_str(), preview.author.as_deref()), ("Fun pack", Some("Hyperion")));
        assert_eq!(preview.actions[0].name, "Creeper");
        assert!(preview.actions[0].problem.is_some());
    }

    #[test]
    fn merges_by_replacing_or_keeping_both() {
        let pick = |a: GameAction, on_clash| Chosen { action: a, on_clash };
        let mut list = vec![action("Creeper", &["say old"])];
        let saved = merge(&mut list, vec![pick(action("Creeper", &["say new"]), OnClash::Replace)]).unwrap();
        assert_eq!((saved, list.len(), list[0].commands[0].as_str()), (vec!["Creeper".to_string()], 1, "say new"));

        let saved = merge(&mut list, vec![pick(action("Creeper", &["say a"]), OnClash::KeepBoth), pick(action("Creeper", &["say b"]), OnClash::KeepBoth)]).unwrap();
        assert_eq!(saved, ["Creeper 2", "Creeper 3"]);
        // Two of the same name in one pack: the second is kept too, even when replacing.
        let saved = merge(&mut list, vec![pick(action("Lightning", &["say a"]), OnClash::Replace), pick(action("Lightning", &["say b"]), OnClash::Replace)]).unwrap();
        assert_eq!(saved, ["Lightning", "Lightning 2"]);
        let long = "x".repeat(MAX_NAME_CHARS);
        let mut list = vec![action(&long, &["say a"])];
        let saved = merge(&mut list, vec![pick(action(&long, &["say b"]), OnClash::KeepBoth)]).unwrap();
        assert_eq!(saved[0].chars().count(), MAX_NAME_CHARS);
        assert!(merge(&mut list, vec![pick(action("Empty", &[]), OnClash::KeepBoth)]).is_err());
        assert!(merge(&mut list, vec![]).is_err());
    }

    #[test]
    fn file_names() {
        assert_eq!(file_name("Mira's Minecraft pack!"), "mira-s-minecraft-pack.hyperion.json");
        assert_eq!(file_name("  ///  "), "game-actions.hyperion.json");
    }
}
