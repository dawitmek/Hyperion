// Mirrors the companion messages in packages/shared/src/index.ts.

use serde::{Deserialize, Serialize};

/// One of the dashboard's commands, as the server describes it.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct CommandInfo {
    pub keyword: String,
    pub key: String,
    pub enabled: bool,
    #[serde(default, rename = "macro")]
    pub macro_name: Option<String>, // runs this macro instead of pressing a key
    #[serde(default, rename = "gameAction")]
    pub game_action: Option<String>, // or this game action
}

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeyAction {
    pub id: String,
    pub key: String,
    pub hold_ms: u64,
    #[serde(default, rename = "macro")]
    pub macro_name: Option<String>,
    #[serde(default)]
    pub game_action: Option<String>,
    #[serde(default)]
    pub viewer: Option<String>, // who set it off, for a game action's {viewer}
    #[serde(default)]
    pub count: Option<u32>, // how many gifts, for {count} and "times the gift count"
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage {
    Ready {},
    Error { reason: String },
    Action { action: KeyAction },
    // The host's active profile and the programs that count as its game: when there are any, they become this PC's
    // target. Servers from before a profile could have several send only `gameProcess`.
    #[serde(rename_all = "camelCase")]
    Profile {
        name: String,
        game_process: Option<String>,
        #[serde(default)]
        game_processes: Option<Vec<String>>,
    },
    // Asks which programs have a window open, for picking a profile's games on the dashboard.
    ListWindows {},
    // The active profile's commands. Key combinations among them still need this PC's own approval.
    Commands { commands: Vec<CommandInfo> },
    // The dashboard's look, which this window follows: a theme ("default", "solar-dusk"…) in "full" or "colors"
    // style, and "light", "dark" or "system". Servers from before light or dark was a choice don't send a mode.
    Theme {
        theme: String,
        style: String,
        #[serde(default)]
        mode: Option<String>,
    },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CompanionMessage<'a> {
    Hello {
        token: &'a str,
        protocol: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        hostname: Option<&'a str>,
        platform: &'a str,
    },
    Ack { id: &'a str, status: &'a str, #[serde(skip_serializing_if = "Option::is_none")] reason: Option<&'a str> },
    // The names of the macros on this PC, so the dashboard can offer them. The macros themselves stay here.
    Macros { names: Vec<String> },
    // The game actions set up on this PC, by name. Like macros, their commands stay here.
    GameActions { names: Vec<String> },
    // The programs with a window open, in answer to ListWindows.
    Windows { windows: Vec<crate::input::GameWindow> },
}

#[cfg(test)]
mod tests {
    use super::ServerMessage;

    #[test]
    fn parses_theme_messages() {
        let theme: ServerMessage = serde_json::from_str(r#"{"type":"theme","theme":"solar-dusk","style":"colors","mode":"dark"}"#).unwrap();
        assert!(matches!(theme, ServerMessage::Theme { ref theme, ref style, mode: Some(ref mode) } if theme == "solar-dusk" && style == "colors" && mode == "dark"));
        let older: ServerMessage = serde_json::from_str(r#"{"type":"theme","theme":"default","style":"full"}"#).unwrap();
        assert!(matches!(older, ServerMessage::Theme { mode: None, .. }));
    }

    #[test]
    fn parses_profile_messages() {
        let games: ServerMessage =
            serde_json::from_str(r#"{"type":"profile","name":"MC","gameProcess":"javaw.exe","gameProcesses":["javaw.exe","minecraft.windows.exe"]}"#).unwrap();
        assert!(matches!(games, ServerMessage::Profile { game_processes: Some(ref p), .. } if p == &["javaw.exe", "minecraft.windows.exe"]));
        // From an older server: one game, or none.
        let with_game: ServerMessage = serde_json::from_str(r#"{"type":"profile","name":"GTA V","gameProcess":"gta5.exe"}"#).unwrap();
        assert!(matches!(with_game, ServerMessage::Profile { ref name, game_process: Some(ref p), game_processes: None } if name == "GTA V" && p == "gta5.exe"));
        let without: ServerMessage = serde_json::from_str(r#"{"type":"profile","name":"Default","gameProcess":null}"#).unwrap();
        assert!(matches!(without, ServerMessage::Profile { game_process: None, .. }));
        assert!(matches!(serde_json::from_str(r#"{"type":"listWindows"}"#).unwrap(), ServerMessage::ListWindows {}));
    }

    #[test]
    fn parses_macro_actions_and_servers_without_them() {
        let action: ServerMessage = serde_json::from_str(r#"{"type":"action","action":{"id":"1","key":"","holdMs":300,"macro":"spin"}}"#).unwrap();
        assert!(matches!(action, ServerMessage::Action { ref action } if action.macro_name.as_deref() == Some("spin")));
        let key: ServerMessage = serde_json::from_str(r#"{"type":"action","action":{"id":"1","key":"KeyA","holdMs":300}}"#).unwrap();
        assert!(matches!(key, ServerMessage::Action { ref action } if action.macro_name.is_none()));
    }

    #[test]
    fn parses_game_actions() {
        let action: ServerMessage =
            serde_json::from_str(r#"{"type":"action","action":{"id":"1","key":"","holdMs":0,"gameAction":"rain","viewer":"Ann","count":5}}"#).unwrap();
        assert!(matches!(action, ServerMessage::Action { ref action }
            if action.game_action.as_deref() == Some("rain") && action.viewer.as_deref() == Some("Ann") && action.count == Some(5)));
        let names = serde_json::to_string(&super::CompanionMessage::GameActions { names: vec!["rain".into()] }).unwrap();
        assert_eq!(names, r#"{"type":"gameActions","names":["rain"]}"#);
    }

    #[test]
    fn parses_command_lists() {
        let message: ServerMessage =
            serde_json::from_str(r#"{"type":"commands","commands":[{"keyword":"emote","key":"Control+Shift+KeyE","enabled":true}]}"#).unwrap();
        assert!(matches!(message, ServerMessage::Commands { ref commands } if commands[0].key == "Control+Shift+KeyE"));
    }
}
