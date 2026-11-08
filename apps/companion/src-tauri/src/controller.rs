// Shared companion state plus the safety gate every action passes through before a key is pressed.

use crate::bedrock::{self, Bedrock};
use crate::config::Config;
use crate::game_actions::{self, Game, GameAction, Values};
use crate::packs;
use crate::input::{self, GameWindow};
use crate::keys::{self, ALL_KEYS, Combo, Modifier, OLD_MODIFIER_TOGGLES};
use crate::macros::{self, Input, Macro, Pressed, Recorder};
use crate::minecraft::{self, Rcon};
use crate::protocol::CommandInfo;
use crate::updater::{self, UpdateView, Updater};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

pub const PANIC_HOTKEY: &str = "Ctrl+Shift+Backspace";
const MAX_HOLD_MS: u64 = 5000;
const LOG_LEN: usize = 50;
pub const STOP_RECORDING_HOTKEY: &str = "F9";
const RECORD_COUNTDOWN: Duration = Duration::from_secs(3); // to get back to the game
const FOCUS_CHECK: Duration = Duration::from_millis(100);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MacroView {
    name: String,
    length_ms: u32,
    steps: usize,
}

/// The Minecraft Java connection settings, without the password.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftView {
    host: String,
    port: u16,
    player: Option<String>,
    has_password: bool,
}

/// Whether this PC listens for Minecraft Bedrock, and whether the game has joined.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BedrockView {
    on: bool,
    connected: bool,
    port: u16,
    problem: Option<String>,
}

/// The stop key. Taken from other programs only during a recording, so F9 keeps working in games otherwise.
pub fn stop_key() -> Shortcut {
    Shortcut::new(None, Code::F9)
}

/// A recording under way, from pressing Record to pressing the stop key.
struct Recording {
    name: String,
    started: bool, // false during the countdown
    id: u64,
    began: Instant,
    recorder: Arc<Mutex<Recorder>>,
    hook: Option<input::RecordHook>,
}

#[derive(Serialize, Clone)]
pub struct LogEntry {
    pub key: String,
    pub ok: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    paired: bool,
    server_url: Option<String>,
    device_name: Option<String>,
    connection: String,
    paused: bool,
    paused_by_host: bool, // paused with the button or the panic key, rather than not started yet
    target_process: Option<String>,
    profile_name: Option<String>,
    profile_game: Option<String>,
    allowed_keys: Vec<String>,
    all_keys: Vec<String>,
    log: Vec<LogEntry>,
    platform_supported: bool,
    permission_problem: Option<&'static str>, // macOS: Accessibility permission not granted yet
    panic_hotkey: &'static str,
    commands: Vec<CommandView>,
    macros: Vec<MacroView>,
    macros_supported: bool, // recording and playing need Windows so far
    recording: Option<String>,       // its name, during the countdown or after it
    recording_started: bool,
    game_actions: Vec<GameAction>,
    minecraft_java: Option<MinecraftView>,
    minecraft_default_port: u16,
    minecraft_bedrock: BedrockView,
    stop_recording_hotkey: &'static str,
    pending_approvals: usize, // enabled combinations waiting for this PC's OK
    theme: Option<String>,
    theme_style: Option<String>,
    theme_mode: Option<String>,
    version: &'static str,
    updates_supported: bool,
    auto_update: Option<bool>, // None until the host answers the one-time question
    update: UpdateView,
}

/// A dashboard command and whether this PC will press it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandView {
    keyword: String,
    key: String,
    label: String, // "Ctrl+Shift+E"
    enabled: bool,
    combo: bool,              // needs its own approval on this PC
    approved: bool,           // combinations only
    problem: Option<String>,  // why it won't be pressed, apart from waiting for approval
}

pub struct Controller {
    app: AppHandle,
    config_path: PathBuf,
    config: Mutex<Config>,
    paused: AtomicBool,
    paused_by_host: AtomicBool,
    connection: Mutex<String>,
    profile: Mutex<(Option<String>, Option<String>)>, // active dashboard profile: (name, game process)
    commands: Mutex<Vec<CommandInfo>>,               // the active profile's commands, from the server
    log: Mutex<VecDeque<LogEntry>>,
    held: Mutex<HashMap<String, u32>>, // key -> number of actions currently holding it
    // A combination being held, and which press it is (so a finished press doesn't release a newer one).
    // While one is held nothing else is pressed, so viewers' overlapping holds can't add up to another combination.
    combo: Mutex<Option<(u64, Combo)>>,
    combo_count: AtomicU64,
    macros_path: PathBuf,
    macros: Mutex<Vec<Macro>>,
    pub macros_changed: tokio::sync::Notify, // tells the server the list changed
    recording: Mutex<Option<Recording>>,
    recording_count: AtomicU64,
    macro_running: AtomicBool,
    macro_generation: AtomicU64, // bumped to stop the macro playing, and any game action running
    game_actions_path: PathBuf,
    game_actions: Mutex<Vec<GameAction>>,
    pub game_actions_changed: tokio::sync::Notify, // tells the server the list changed
    // The open RCON connection and the settings it was made with. Held while any action runs, Java or Bedrock, so
    // actions go in order.
    rcon: tokio::sync::Mutex<Option<(minecraft::Settings, Rcon)>>,
    bedrock: Arc<Bedrock>,
    pub connection_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub update: Mutex<Updater>,
}

impl Controller {
    pub fn new(app: AppHandle, config_path: PathBuf) -> Arc<Controller> {
        let config = Config::load(&config_path);
        let macros_path = config_path.with_file_name("macros.json");
        let game_actions_path = config_path.with_file_name("game-actions.json");
        Arc::new(Controller {
            game_actions: Mutex::new(game_actions::load(&game_actions_path)),
            game_actions_path,
            game_actions_changed: tokio::sync::Notify::new(),
            rcon: tokio::sync::Mutex::new(None),
            bedrock: Arc::new(Bedrock::default()),
            macros: Mutex::new(macros::load(&macros_path)),
            macros_path,
            macros_changed: tokio::sync::Notify::new(),
            recording: Mutex::new(None),
            recording_count: AtomicU64::new(0),
            macro_running: AtomicBool::new(false),
            macro_generation: AtomicU64::new(0),
            app,
            config_path,
            config: Mutex::new(config),
            // Starts paused: nothing is pressed until the host has picked the game and pressed Play.
            paused: AtomicBool::new(true),
            paused_by_host: AtomicBool::new(false),
            connection: Mutex::new("disconnected".into()),
            profile: Mutex::new((None, None)),
            commands: Mutex::new(Vec::new()),
            log: Mutex::new(VecDeque::new()),
            held: Mutex::new(HashMap::new()),
            combo: Mutex::new(None),
            combo_count: AtomicU64::new(0),
            connection_task: Mutex::new(None),
            update: Mutex::new(Updater::default()),
        })
    }

    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    /// Tells the window when macOS's Accessibility permission changes, so granting it in System Settings shows up here
    /// without a click.
    pub fn watch_permission(self: &Arc<Self>) {
        if !cfg!(target_os = "macos") {
            return;
        }
        let this = self.clone();
        std::thread::spawn(move || {
            let mut last = input::permission_problem();
            loop {
                std::thread::sleep(Duration::from_secs(2));
                let now = input::permission_problem();
                if now != last {
                    last = now;
                    this.emit();
                }
            }
        });
    }

    /// Whether chat is using this PC right now: the game in front, keys held, a macro playing or being recorded, or a
    /// game action running. Automatic updates wait until it isn't.
    pub fn in_use(&self) -> bool {
        // One lock at a time: press_combo takes combo, then held.
        let combo = self.combo.lock().unwrap().is_some();
        let held = !self.held.lock().unwrap().is_empty();
        let recording = self.recording.lock().unwrap().is_some();
        let action = self.rcon.try_lock().is_err();
        combo || held || recording || action || self.macro_running.load(Ordering::SeqCst) || self.game_focused().is_ok()
    }

    pub fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }

    pub fn update_config(&self, change: impl FnOnce(&mut Config)) -> Result<(), String> {
        let mut config = self.config.lock().unwrap();
        change(&mut config);
        config.save(&self.config_path)?;
        drop(config);
        self.emit();
        Ok(())
    }

    pub fn snapshot(&self) -> Snapshot {
        let config = self.config();
        // Lock once: std's Mutex isn't reentrant, and two locks in one expression deadlock.
        let (profile_name, profile_game) = self.profile.lock().unwrap().clone();
        let allowed = allowed_keys(&config.allowed_keys);
        let approved = config.approved_combos.clone().unwrap_or_default();
        let macro_names = self.macro_names();
        let action_names = self.game_action_names();
        let commands: Vec<CommandView> =
            self.commands.lock().unwrap().iter().map(|c| command_view(c, &allowed, &approved, &macro_names, &action_names)).collect();
        let (recording, recording_started) = self.recording.lock().unwrap().as_ref().map_or((None, false), |r| (Some(r.name.clone()), r.started));
        let pending_approvals = commands.iter().filter(|c| c.enabled && c.combo && !c.approved && c.problem.is_none()).count();
        let mut update = self.update.lock().unwrap().view();
        update.dismissed = update.version.is_some() && update.version == config.skipped_version;
        Snapshot {
            paired: config.device_token.is_some(),
            server_url: config.server_url,
            device_name: config.device_name,
            connection: self.connection.lock().unwrap().clone(),
            paused: self.paused.load(Ordering::SeqCst),
            paused_by_host: self.paused_by_host.load(Ordering::SeqCst),
            target_process: config.target_process,
            profile_name,
            profile_game,
            allowed_keys: allowed,
            all_keys: ALL_KEYS.iter().map(|k| k.to_string()).collect(),
            log: self.log.lock().unwrap().iter().cloned().collect(),
            platform_supported: cfg!(any(windows, target_os = "macos")),
            permission_problem: input::permission_problem(),
            panic_hotkey: PANIC_HOTKEY,
            commands,
            macros: self.macros.lock().unwrap().iter().map(|m| MacroView { name: m.name.clone(), length_ms: m.length_ms, steps: m.steps.len() }).collect(),
            macros_supported: cfg!(windows),
            recording,
            recording_started,
            game_actions: self.game_actions.lock().unwrap().clone(),
            minecraft_java: config.minecraft_java.map(|m| MinecraftView { host: m.host, port: m.port, player: m.player, has_password: !m.password.is_empty() }),
            minecraft_default_port: minecraft::DEFAULT_PORT,
            minecraft_bedrock: BedrockView {
                on: config.minecraft_bedrock == Some(true),
                connected: self.bedrock.connected(),
                port: bedrock::PORT,
                problem: self.bedrock.problem(),
            },
            stop_recording_hotkey: STOP_RECORDING_HOTKEY,
            pending_approvals,
            theme: config.theme,
            theme_style: config.theme_style,
            theme_mode: config.theme_mode,
            version: updater::CURRENT,
            updates_supported: updater::SUPPORTED,
            auto_update: config.auto_update,
            update,
        }
    }

    /// The server's list of the active profile's commands. The first list after updating carries approvals over
    /// from the old Ctrl/Alt toggles, so combinations that worked before keep working.
    pub fn set_commands(&self, commands: Vec<CommandInfo>) -> Result<(), String> {
        let config = self.config();
        if config.approved_combos.is_none() {
            let carried = carried_over_approvals(&commands, &config.allowed_keys);
            self.update_config(|c| c.approved_combos = Some(carried))?;
        }
        *self.commands.lock().unwrap() = commands;
        self.emit();
        Ok(())
    }

    pub fn set_combo_approved(&self, key: &str, approved: bool) -> Result<(), String> {
        if Combo::parse(key).is_none_or(|c| c.modifiers.is_empty()) {
            return Err("only key combinations need approving".into());
        }
        self.update_config(|c| {
            let list = c.approved_combos.get_or_insert_with(Vec::new);
            list.retain(|k| k != key);
            if approved {
                list.push(key.to_string());
            }
        })
    }

    pub fn emit(&self) {
        let _ = self.app.emit("state", self.snapshot());
    }

    pub fn set_connection(&self, status: impl Into<String>) {
        *self.connection.lock().unwrap() = status.into();
        self.emit();
    }

    /// `by_host`: the host paused, with the button or the panic key, so the window offers Resume rather than Play.
    pub fn set_paused(&self, paused: bool, by_host: bool) {
        self.paused.store(paused, Ordering::SeqCst);
        self.paused_by_host.store(paused && by_host, Ordering::SeqCst);
        if paused {
            self.release_all();
        }
        self.emit();
    }

    /// Follows the dashboard's active profile. The host can still pick another game here until the next switch.
    /// A new game from the server waits for Play, so the dashboard (or a stolen account) can't point keys at another
    /// program while they're going out.
    pub fn apply_profile(&self, name: String, game_process: Option<String>) -> Result<(), String> {
        let game_process = game_process.map(|p| p.to_lowercase());
        *self.profile.lock().unwrap() = (Some(name), game_process.clone());
        match game_process {
            Some(process) => {
                if self.config().target_process.as_deref() != Some(process.as_str()) {
                    self.set_paused(true, false);
                }
                self.update_config(|c| c.target_process = Some(process))
            }
            None => {
                self.emit();
                Ok(())
            }
        }
    }

    pub fn list_windows(&self) -> Vec<GameWindow> {
        input::list_windows()
    }

    /// Runs the safety checks, then holds the key or combination. Returns why an action was refused.
    pub fn perform(self: &Arc<Self>, key: &str, hold_ms: u64) -> Result<(), String> {
        let result = Combo::parse(key)
            .ok_or_else(|| "key not supported".to_string())
            .and_then(|combo| {
                self.check(key, &combo)?;
                let hold_ms = hold_ms.min(MAX_HOLD_MS);
                if combo.modifiers.is_empty() { self.press(&combo.key, hold_ms) } else { self.press_combo(combo, hold_ms) }
            });
        self.record(key, &result);
        result
    }

    fn check(&self, key: &str, combo: &Combo) -> Result<(), String> {
        if self.paused.load(Ordering::SeqCst) {
            return Err("paused".into());
        }
        if let Some(reason) = combo.blocked() {
            return Err(reason.into());
        }
        if keys::scan_code(&combo.key).is_none() {
            return Err("key not supported".into());
        }
        let config = self.config();
        if let Some(problem) = input::permission_problem() {
            return Err(problem.into());
        }
        // Single keys go by the allowed-keys grid; a combination needs this exact combination approved here.
        if combo.modifiers.is_empty() {
            if !allowed_keys(&config.allowed_keys).iter().any(|k| *k == combo.key) {
                return Err("key disabled on this PC".into());
            }
        } else if !config.approved_combos.unwrap_or_default().iter().any(|k| k == key) {
            return Err(format!("{} isn't approved on this PC", keys::label(key)));
        }
        self.game_focused()
    }

    fn game_focused(&self) -> Result<(), String> {
        let target = self.config().target_process.ok_or("no game selected")?;
        if input::foreground_process().as_deref() != Some(target.as_str()) {
            return Err("game not focused".into());
        }
        Ok(())
    }

    pub fn macro_names(&self) -> Vec<String> {
        self.macros.lock().unwrap().iter().map(|m| m.name.clone()).collect()
    }

    fn save_macros(&self, change: impl FnOnce(&mut Vec<Macro>)) -> Result<(), String> {
        let mut list = self.macros.lock().unwrap();
        change(&mut list);
        let saved = macros::save(&self.macros_path, &list);
        drop(list);
        self.macros_changed.notify_one();
        self.emit();
        saved
    }

    pub fn delete_macro(&self, name: &str) -> Result<(), String> {
        self.save_macros(|list| list.retain(|m| m.name != name))
    }

    /// Plays a macro by name. Only macros recorded on this PC exist, so these skip the allowed-keys grid; the
    /// pause, panic key and focus check still apply, all the way through.
    pub fn run_macro(self: &Arc<Self>, name: &str) -> Result<(), String> {
        let result = self.start_macro(name);
        self.record(&format!("Macro: {name}"), &result);
        result
    }

    fn start_macro(self: &Arc<Self>, name: &str) -> Result<(), String> {
        let found = self.macros.lock().unwrap().iter().find(|m| m.name == name).cloned();
        let found = found.ok_or_else(|| format!("no macro called {name} on this PC"))?;
        if !cfg!(windows) {
            return Err("macros need Windows for now".into());
        }
        if self.paused.load(Ordering::SeqCst) {
            return Err("paused".into());
        }
        if self.recording.lock().unwrap().is_some() {
            return Err("a macro is being recorded".into());
        }
        self.game_focused()?;
        if self.macro_running.swap(true, Ordering::SeqCst) {
            return Err("another macro is running".into());
        }
        let generation = self.macro_generation.load(Ordering::SeqCst);
        let this = self.clone();
        // Its own thread: a macro's timing shouldn't depend on the connection's task, or hold it up.
        std::thread::spawn(move || {
            this.play(&found, generation);
            this.macro_running.store(false, Ordering::SeqCst);
        });
        Ok(())
    }

    fn play(&self, found: &Macro, generation: u64) {
        let began = Instant::now();
        let mut checked = began;
        let mut pressed = Pressed::default();
        'steps: for step in &found.steps {
            let at = Duration::from_millis(step.at.into());
            loop {
                if self.macro_generation.load(Ordering::SeqCst) != generation {
                    break 'steps;
                }
                if checked.elapsed() >= FOCUS_CHECK {
                    checked = Instant::now();
                    if self.game_focused().is_err() {
                        break 'steps;
                    }
                }
                let left = at.saturating_sub(began.elapsed());
                if left.is_zero() {
                    break;
                }
                std::thread::sleep(left.min(Duration::from_millis(5)));
            }
            pressed.note(&step.input);
            if input::send(&step.input).is_err() {
                break;
            }
        }
        for input in pressed.releases() {
            let _ = input::send(&input);
        }
    }

    pub fn game_action_names(&self) -> Vec<String> {
        self.game_actions.lock().unwrap().iter().map(|a| a.name.clone()).collect()
    }

    fn save_game_actions(&self, change: impl FnOnce(&mut Vec<GameAction>) -> Result<(), String>) -> Result<(), String> {
        let mut list = self.game_actions.lock().unwrap();
        let mut changed = list.clone();
        change(&mut changed)?;
        game_actions::save(&self.game_actions_path, &changed)?;
        *list = changed;
        drop(list);
        self.game_actions_changed.notify_one();
        self.emit();
        Ok(())
    }

    /// Adds an action, or changes the one called `editing`. Names are unique.
    pub fn save_game_action(&self, action: GameAction, editing: Option<String>) -> Result<(), String> {
        let action = game_actions::check(action)?;
        self.save_game_actions(|list| {
            if list.iter().any(|a| a.name == action.name && Some(&a.name) != editing.as_ref()) {
                return Err(format!("There's already an action called {}", action.name));
            }
            match list.iter_mut().find(|a| Some(&a.name) == editing.as_ref()) {
                Some(old) => *old = action,
                None => list.push(action),
            }
            Ok(())
        })
    }

    /// What a pack would add, for the preview. Nothing is saved.
    pub fn preview_pack(&self, text: &str) -> Result<packs::Preview, String> {
        packs::preview(text, &self.game_action_names())
    }

    /// Saves the actions picked in a pack's preview, all at once. Returns the names they were saved under.
    pub fn import_pack(&self, chosen: Vec<packs::Chosen>) -> Result<Vec<String>, String> {
        let mut saved = vec![];
        self.save_game_actions(|list| {
            saved = packs::merge(list, chosen)?;
            Ok(())
        })?;
        Ok(saved)
    }

    /// The named actions as a pack, in the order they're listed here.
    pub fn export_pack(&self, names: &[String], name: &str, author: &str) -> Result<String, String> {
        let list = self.game_actions.lock().unwrap();
        let picked: Vec<GameAction> = list.iter().filter(|a| names.contains(&a.name)).cloned().collect();
        packs::export(&picked, name, author)
    }

    /// Deletes the actions with these names, all in one save.
    pub fn delete_game_actions(&self, names: &[String]) -> Result<(), String> {
        self.save_game_actions(|list| {
            list.retain(|a| !names.contains(&a.name));
            Ok(())
        })
    }

    /// Saves the Minecraft server's address and the host's name in the game. No password keeps the saved one.
    pub fn set_minecraft(&self, host: &str, port: u16, password: Option<String>, player: &str) -> Result<(), String> {
        let host = host.trim();
        if host.is_empty() || host.contains(char::is_whitespace) {
            return Err("Enter the server's address, like localhost".into());
        }
        if port == 0 {
            return Err("Enter the RCON port, like 25575".into());
        }
        let player = if player.trim().is_empty() { None } else { Some(game_actions::check_player(player)?) };
        self.update_config(|c| {
            let saved = c.minecraft_java.take().map(|m| m.password).unwrap_or_default();
            let password = password.filter(|p| !p.is_empty()).unwrap_or(saved);
            c.minecraft_java = Some(minecraft::Settings { host: host.to_string(), port, password, player });
        })
    }

    /// Logs in to Minecraft and asks who's online, to show the connection works.
    pub async fn test_minecraft(&self) -> Result<String, String> {
        let settings = self.config().minecraft_java.ok_or("Set up the Minecraft server first")?;
        let mut rcon = self.rcon.lock().await;
        *rcon = None;
        let mut fresh = Rcon::connect(&settings).await?;
        let online = fresh.run("list").await?;
        *rcon = Some((settings, fresh));
        Ok(online)
    }

    /// Listens for Minecraft Bedrock's /connect, or stops.
    pub fn set_bedrock(self: &Arc<Self>, on: bool) -> Result<(), String> {
        self.update_config(|c| c.minecraft_bedrock = Some(on))?;
        if on {
            self.start_bedrock();
        } else {
            self.bedrock.stop();
            self.emit();
        }
        Ok(())
    }

    pub fn start_bedrock(self: &Arc<Self>) {
        let this = Arc::downgrade(self);
        self.bedrock.start(bedrock::PORT, move || {
            if let Some(this) = this.upgrade() {
                this.emit();
            }
        });
    }

    /// Runs a game action set up on this PC, for `viewer`'s gift of `count`. Pausing or the panic key stops it
    /// between commands.
    pub fn run_game_action(self: &Arc<Self>, name: &str, viewer: &str, count: u32) -> Result<(), String> {
        let result = self.start_game_action(name, viewer, count);
        self.record(&format!("Action: {name}"), &result);
        result
    }

    fn start_game_action(self: &Arc<Self>, name: &str, viewer: &str, count: u32) -> Result<(), String> {
        let found = self.game_actions.lock().unwrap().iter().find(|a| a.name == name).cloned();
        let found = found.ok_or_else(|| format!("no game action called {name} on this PC"))?;
        if self.paused.load(Ordering::SeqCst) {
            return Err("paused".into());
        }
        let target = match found.game {
            Game::MinecraftJava => Target::Java(self.config().minecraft_java.ok_or("Minecraft Java isn't set up on this PC")?),
            Game::MinecraftBedrock if self.bedrock.connected() => Target::Bedrock,
            Game::MinecraftBedrock => return Err(format!("Minecraft Bedrock isn't connected. Type /connect 127.0.0.1:{} in your world", bedrock::PORT)),
        };
        // Filled in now, so a missing {player} is refused before anything runs.
        let player = match &target {
            Target::Java(settings) => settings.player.as_deref(),
            Target::Bedrock => Some("@s"),
        };
        let values = Values { viewer, count, player };
        let commands = found.commands.iter().map(|c| game_actions::fill(c, &values)).collect::<Result<Vec<_>, _>>()?;
        let generation = self.macro_generation.load(Ordering::SeqCst);
        let this = self.clone();
        let name = name.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(reason) = this.send_rounds(&target, &commands, found.repeat, found.delay_ms, generation).await {
                this.record(&format!("Action: {name}"), &Err(reason));
            }
        });
        Ok(())
    }

    async fn send_rounds(&self, target: &Target, commands: &[String], rounds: u32, delay_ms: u32, generation: u64) -> Result<(), String> {
        let mut rcon = self.rcon.lock().await;
        // A command Minecraft turns down doesn't stop the rest; the first one is reported at the end.
        let mut refused = None;
        'rounds: for round in 0..rounds {
            if round > 0 {
                tokio::time::sleep(Duration::from_millis(delay_ms.into())).await;
            }
            for command in commands {
                if self.macro_generation.load(Ordering::SeqCst) != generation || self.paused.load(Ordering::SeqCst) {
                    break 'rounds;
                }
                let refusal = match target {
                    Target::Java(settings) => minecraft::refusal(&minecraft_command(&mut rcon, settings, command).await?),
                    Target::Bedrock => Some(self.bedrock.run(command).await?).filter(|a| !a.ok).map(|a| a.message),
                };
                if refused.is_none() {
                    refused = refusal;
                }
            }
        }
        refused.map_or(Ok(()), |reason| Err(format!("Minecraft said: {reason}")))
    }

    /// Runs a game action from this window, as a viewer called Tester sending one gift.
    pub fn try_game_action(self: &Arc<Self>, name: &str) {
        let _ = self.run_game_action(name, "Tester", 1);
    }

    /// Starts recording after a countdown, to give time to get back to the game. Only what happens while the game
    /// has focus is kept, so nothing typed anywhere else ends up in a macro.
    pub fn start_recording(self: &Arc<Self>, name: &str) -> Result<(), String> {
        let name = macros::clean_name(name)?;
        if !cfg!(windows) {
            return Err("Recording macros needs Windows for now".into());
        }
        self.config().target_process.ok_or("Pick your game first: only input in the game is recorded")?;
        if self.macro_running.load(Ordering::SeqCst) {
            return Err("A macro is running".into());
        }
        let id = self.recording_count.fetch_add(1, Ordering::SeqCst);
        {
            let mut current = self.recording.lock().unwrap();
            if current.is_some() {
                return Err("Already recording".into());
            }
            *current = Some(Recording { name, started: false, id, began: Instant::now(), recorder: Default::default(), hook: None });
        }
        self.emit();
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(RECORD_COUNTDOWN).await;
            this.begin_recording(id);
            // The limit, in case the stop key is never pressed.
            tokio::time::sleep(Duration::from_millis(macros::MAX_LENGTH_MS.into())).await;
            let current = this.recording.lock().unwrap().as_ref().map(|r| r.id);
            if current == Some(id) {
                this.finish_recording();
            }
        });
        Ok(())
    }

    fn begin_recording(self: &Arc<Self>, id: u64) {
        let mut current = self.recording.lock().unwrap();
        let Some(recording) = current.as_mut().filter(|r| r.id == id) else { return };
        recording.began = Instant::now();
        recording.started = true;
        let recorder = recording.recorder.clone();
        let began = recording.began;
        let this = self.clone();
        let mut focused = (Instant::now() - FOCUS_CHECK, false);
        if let Err(e) = self.app.global_shortcut().register(stop_key()) {
            *current = None;
            drop(current);
            return self.record("Macro recording", &Err(format!("couldn't take over F9: {e}")));
        }
        let hook = input::start_recording(Box::new(move |input: Input| {
            if focused.0.elapsed() >= FOCUS_CHECK {
                focused = (Instant::now(), this.game_focused().is_ok());
            }
            if focused.1 {
                recorder.lock().unwrap().push(began.elapsed().as_millis() as u32, input);
            }
        }));
        match hook {
            Ok(hook) => recording.hook = Some(hook),
            Err(reason) => {
                *current = None;
                drop(current);
                let _ = self.app.global_shortcut().unregister(stop_key());
                self.record("Macro recording", &Err(reason));
                return;
            }
        }
        drop(current);
        self.emit();
    }

    /// Stops and keeps the recording, reporting any problem in the activity log.
    pub fn finish_recording(&self) {
        if let Err(reason) = self.stop_recording() {
            self.record("Macro recording", &Err(reason));
        }
    }

    /// A new recording with an existing name replaces it.
    fn stop_recording(&self) -> Result<(), String> {
        let Some(mut recording) = self.recording.lock().unwrap().take() else { return Ok(()) };
        let _ = self.app.global_shortcut().unregister(stop_key());
        let stopped_at = recording.began.elapsed().as_millis() as u32;
        drop(recording.hook.take()); // no more input after this
        let recorder = std::mem::take(&mut *recording.recorder.lock().unwrap());
        let made = recorder.finish(recording.name, stopped_at);
        if made.steps.is_empty() {
            self.emit();
            return Err("Nothing was recorded. Only input in your game counts, so click into it first".into());
        }
        self.save_macros(|list| {
            list.retain(|m| m.name != made.name);
            list.push(made);
        })
    }

    pub fn cancel_recording(&self) {
        drop(self.recording.lock().unwrap().take());
        let _ = self.app.global_shortcut().unregister(stop_key());
        self.emit();
    }

    /// Plays a macro from this window, after a countdown to get back to the game.
    pub fn try_macro(self: &Arc<Self>, name: String) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(RECORD_COUNTDOWN).await;
            let _ = this.run_macro(&name);
        });
    }

    fn press(self: &Arc<Self>, key: &str, hold_ms: u64) -> Result<(), String> {
        let scan = keys::scan_code(key).ok_or("key not supported")?;
        {
            let combo = self.combo.lock().unwrap();
            if combo.as_ref().is_some_and(|(_, held)| !held.allows_overlap(key)) {
                return Err("a key combination is being pressed".into());
            }
            let mut held = self.held.lock().unwrap();
            let count = held.entry(key.to_string()).or_insert(0);
            if *count == 0 {
                input::send_key(&scan, false, &[])?;
            }
            *count += 1;
        }
        let this = self.clone();
        let key = key.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(hold_ms)).await;
            this.release(&key);
        });
        Ok(())
    }

    /// Holds a combination on its own: lets go of other held keys first, and refuses other presses until done.
    fn press_combo(self: &Arc<Self>, combo: Combo, hold_ms: u64) -> Result<(), String> {
        let scan = keys::scan_code(&combo.key).ok_or("key not supported")?;
        let id = {
            let mut current = self.combo.lock().unwrap();
            if current.is_some() {
                return Err("a key combination is being pressed".into());
            }
            // Other keys can stay down under Shift alone, so run and jump can overlap. Not its own key: this press has it.
            if combo.allows_overlap("") {
                if self.held.lock().unwrap().remove(&combo.key).is_some() {
                    input::send_key(&scan, true, &[])?;
                }
            } else {
                self.release_held();
            }
            for (i, m) in combo.modifiers.iter().enumerate() {
                input::send_key(&m.scan_code(), false, &combo.modifiers[..=i])?;
            }
            input::send_key(&scan, false, &combo.modifiers)?;
            let id = self.combo_count.fetch_add(1, Ordering::SeqCst);
            *current = Some((id, combo));
            id
        };
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(hold_ms)).await;
            let mut current = this.combo.lock().unwrap();
            // Gone or replaced means release_all already let go of this one.
            if current.as_ref().is_some_and(|(held, _)| *held == id) {
                release_combo(&current.take().unwrap().1);
            }
        });
        Ok(())
    }

    fn release(&self, key: &str) {
        let mut held = self.held.lock().unwrap();
        // Missing means release_all already let go of it.
        let Some(count) = held.get_mut(key) else { return };
        *count -= 1;
        if *count == 0 {
            held.remove(key);
            if let Some(scan) = keys::scan_code(key) {
                let _ = input::send_key(&scan, true, &[]);
            }
        }
    }

    fn release_held(&self) {
        let mut held = self.held.lock().unwrap();
        for key in held.keys() {
            if let Some(scan) = keys::scan_code(key) {
                let _ = input::send_key(&scan, true, &[]);
            }
        }
        held.clear();
    }

    pub fn release_all(&self) {
        self.macro_generation.fetch_add(1, Ordering::SeqCst); // the macro lets go of what it holds as it stops
        // Same lock order as press_combo: combo, then held.
        let mut combo = self.combo.lock().unwrap();
        if let Some((_, held)) = combo.take() {
            release_combo(&held);
        }
        self.release_held();
    }

    fn record(&self, key: &str, result: &Result<(), String>) {
        let mut log = self.log.lock().unwrap();
        log.push_front(LogEntry { key: key.to_string(), ok: result.is_ok(), reason: result.clone().err() });
        log.truncate(LOG_LEN);
        drop(log);
        self.emit();
    }
}

/// Where a game action's commands go.
enum Target {
    Java(minecraft::Settings),
    Bedrock,
}

/// Runs one command over the open connection, or a new one if there's none, the settings changed, or it dropped
/// (Minecraft restarted, say).
async fn minecraft_command(rcon: &mut Option<(minecraft::Settings, Rcon)>, settings: &minecraft::Settings, command: &str) -> Result<String, String> {
    if let Some((_, open)) = rcon.as_mut().filter(|(made_with, _)| made_with == settings) {
        if let Ok(answer) = open.run(command).await {
            return Ok(answer);
        }
    }
    *rcon = None;
    let mut fresh = Rcon::connect(settings).await?;
    let answer = fresh.run(command).await?;
    *rcon = Some((settings.clone(), fresh));
    Ok(answer)
}

/// Lets go of a combination's key, then its modifiers in reverse order.
fn release_combo(combo: &Combo) {
    if let Some(scan) = keys::scan_code(&combo.key) {
        let _ = input::send_key(&scan, true, &combo.modifiers);
    }
    for (i, m) in combo.modifiers.iter().enumerate().rev() {
        let _ = input::send_key(&m.scan_code(), true, &combo.modifiers[..i]);
    }
}

/// Single keys this PC allows. Nothing saved yet means everything.
fn allowed_keys(saved: &Option<Vec<String>>) -> Vec<String> {
    match saved {
        Some(keys) => keys.iter().filter(|k| keys::scan_code(k).is_some()).cloned().collect(),
        None => ALL_KEYS.iter().map(|k| k.to_string()).collect(),
    }
}

/// What the companion shows for a command: whether it will be pressed here, and if not, why.
fn command_view(command: &CommandInfo, allowed: &[String], approved: &[String], macro_names: &[String], action_names: &[String]) -> CommandView {
    if let Some(name) = &command.game_action {
        return CommandView {
            keyword: command.keyword.clone(),
            key: command.key.clone(),
            label: format!("Action: {name}"),
            enabled: command.enabled,
            combo: false,
            approved: false,
            problem: (!action_names.contains(name)).then(|| format!("no game action called {name} on this PC")),
        };
    }
    if let Some(name) = &command.macro_name {
        return CommandView {
            keyword: command.keyword.clone(),
            key: command.key.clone(),
            label: format!("Macro: {name}"),
            enabled: command.enabled,
            combo: false,
            approved: false,
            problem: (!macro_names.contains(name)).then(|| format!("no macro called {name} on this PC")),
        };
    }
    let combo = Combo::parse(&command.key);
    let is_combo = combo.as_ref().is_some_and(|c| !c.modifiers.is_empty());
    let problem = match &combo {
        None => Some("not a key this companion can press".to_string()),
        Some(c) => c.blocked().map(str::to_string).or_else(|| {
            if keys::scan_code(&c.key).is_none() {
                Some("not a key this companion can press".into())
            } else if !is_combo && !allowed.iter().any(|k| *k == c.key) {
                Some(format!("{} isn't allowed on this PC", keys::label(&c.key)))
            } else {
                None
            }
        }),
    };
    CommandView {
        keyword: command.keyword.clone(),
        key: command.key.clone(),
        label: keys::label(&command.key),
        enabled: command.enabled,
        combo: is_combo,
        approved: is_combo && approved.iter().any(|k| *k == command.key),
        problem,
    }
}

/// The combinations the old Ctrl/Alt toggles allowed: every modifier switched on (Shift went with the Shift keys)
/// and the key itself allowed. Nothing saved means everything was allowed.
fn carried_over_approvals(commands: &[CommandInfo], saved: &Option<Vec<String>>) -> Vec<String> {
    let had = |k: &str| saved.as_ref().is_none_or(|keys| keys.iter().any(|s| s == k));
    let mut approved: Vec<String> = commands
        .iter()
        .filter_map(|c| Combo::parse(&c.key).map(|combo| (c, combo)))
        .filter(|(_, combo)| !combo.modifiers.is_empty() && combo.blocked().is_none() && had(&combo.key))
        .filter(|(_, combo)| {
            combo.modifiers.iter().all(|m| match m {
                Modifier::Control => had(OLD_MODIFIER_TOGGLES[0]),
                Modifier::Alt => had(OLD_MODIFIER_TOGGLES[1]),
                Modifier::Shift => had("ShiftLeft") || had("ShiftRight"),
            })
        })
        .map(|(c, _)| c.key.clone())
        .collect();
    approved.sort();
    approved.dedup();
    approved
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(keyword: &str, key: &str) -> CommandInfo {
        CommandInfo { keyword: keyword.into(), key: key.into(), enabled: true, macro_name: None, game_action: None }
    }
    fn keys(list: &[&str]) -> Vec<String> {
        list.iter().map(|k| k.to_string()).collect()
    }

    #[test]
    fn single_keys_go_by_the_grid_and_combinations_by_approval() {
        let allowed = keys(&["KeyA", "KeyE"]);
        let approved = keys(&["Control+Shift+KeyE"]);
        let view = |key: &str| command_view(&command("x", key), &allowed, &approved, &[], &[]);
        assert_eq!((view("KeyA").combo, view("KeyA").problem), (false, None));
        assert_eq!(view("KeyD").problem.as_deref(), Some("D isn't allowed on this PC"));
        assert!(view("Control+Shift+KeyE").approved);
        // A combination doesn't need its key in the grid, only its own approval.
        assert_eq!((view("Control+KeyD").approved, view("Control+KeyD").problem), (false, None));
        assert!(view("Control+KeyW").problem.unwrap().contains("blocked"));
        assert_eq!(view("Control+KeyE").label, "Ctrl+E");
    }

    #[test]
    fn a_macro_command_needs_the_macro_on_this_pc() {
        let spin = CommandInfo { macro_name: Some("spin".into()), ..command("x", "") };
        assert_eq!(command_view(&spin, &[], &[], &keys(&["spin"]), &[]).problem, None);
        assert_eq!(command_view(&spin, &[], &[], &[], &[]).problem.as_deref(), Some("no macro called spin on this PC"));
        assert_eq!(command_view(&spin, &[], &[], &[], &[]).label, "Macro: spin");
    }

    #[test]
    fn a_game_action_command_needs_the_action_on_this_pc() {
        let rain = CommandInfo { game_action: Some("rain".into()), ..command("x", "") };
        assert_eq!(command_view(&rain, &[], &[], &[], &keys(&["rain"])).problem, None);
        assert_eq!(command_view(&rain, &[], &[], &[], &[]).problem.as_deref(), Some("no game action called rain on this PC"));
        assert_eq!(command_view(&rain, &[], &[], &[], &[]).label, "Action: rain");
    }

    #[test]
    fn approvals_carry_over_from_the_old_toggles() {
        let commands = [command("a", "Control+KeyE"), command("b", "Alt+KeyE"), command("c", "Shift+KeyE"), command("d", "Control+KeyR"), command("e", "Control+KeyW")];
        // Ctrl on, Alt off, Shift keys and E allowed; R not allowed; Ctrl+W blocked anyway.
        let saved = Some(keys(&["Control", "ShiftLeft", "KeyE"]));
        assert_eq!(carried_over_approvals(&commands, &saved), keys(&["Control+KeyE", "Shift+KeyE"]));
        // A companion that never changed its keys allowed everything that isn't blocked.
        assert_eq!(carried_over_approvals(&commands, &None), keys(&["Alt+KeyE", "Control+KeyE", "Control+KeyR", "Shift+KeyE"]));
    }
}
