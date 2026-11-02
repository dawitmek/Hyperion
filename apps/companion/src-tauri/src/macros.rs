// Macros: keyboard and mouse input recorded on this PC and kept here. The server only ever names one to run, so a
// change on the dashboard, or a stolen account, can't write new input for this PC.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;

pub const MAX_LENGTH_MS: u32 = 60_000;
pub const MAX_NAME_CHARS: usize = 64;
const MAX_STEPS: usize = 30_000;
const MOVE_MERGE_MS: u32 = 8; // mouse movement within this is one step, so a fast mouse can't fill a macro

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Button {
    Left,
    Right,
    Middle,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Input {
    Key { key: String, up: bool },
    Button { button: Button, up: bool },
    Move { dx: i32, dy: i32 }, // by how much, not to where: games that lock the cursor only see movement
    Wheel { delta: i32 },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Step {
    pub at: u32, // ms from the start
    pub input: Input,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Macro {
    pub name: String,
    pub length_ms: u32,
    pub steps: Vec<Step>,
}

pub fn load(path: &Path) -> Vec<Macro> {
    std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn save(path: &Path, macros: &[Macro]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_string(macros).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the macro a name".into());
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("Macro names can be up to {MAX_NAME_CHARS} characters"));
    }
    Ok(name.to_string())
}

/// What's held down: a key or button. Everything held is let go when a macro ends, however it ends.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Held {
    Key(String),
    Button(Button),
}

#[derive(Default)]
pub struct Pressed(BTreeSet<Held>);

impl Pressed {
    /// Tracks an input. False for a release of something that isn't held.
    pub fn note(&mut self, input: &Input) -> bool {
        let (held, up) = match input {
            Input::Key { key, up } => (Held::Key(key.clone()), *up),
            Input::Button { button, up } => (Held::Button(*button), *up),
            _ => return true,
        };
        if up { self.0.remove(&held) } else { self.0.insert(held); true }
    }

    /// The inputs that let go of everything held.
    pub fn releases(&mut self) -> Vec<Input> {
        std::mem::take(&mut self.0)
            .into_iter()
            .map(|held| match held {
                Held::Key(key) => Input::Key { key, up: true },
                Held::Button(button) => Input::Button { button, up: true },
            })
            .collect()
    }
}

/// Builds a macro from input as it happens.
#[derive(Default)]
pub struct Recorder {
    steps: Vec<Step>,
    pressed: Pressed,
    down: BTreeSet<Held>, // repeats: Windows sends key-down again while a key is held
    full: bool,
}

impl Recorder {
    pub fn push(&mut self, at: u32, input: Input) {
        if self.full {
            return;
        }
        if at >= MAX_LENGTH_MS || self.steps.len() >= MAX_STEPS {
            self.full = true;
            return;
        }
        // Holding a key repeats its key-down; a release of something pressed before recording means nothing.
        let held = match &input {
            Input::Key { key, .. } => Some(Held::Key(key.clone())),
            Input::Button { button, .. } => Some(Held::Button(*button)),
            _ => None,
        };
        if let Some(held) = held {
            let up = matches!(input, Input::Key { up: true, .. } | Input::Button { up: true, .. });
            if !up && !self.down.insert(held.clone()) {
                return;
            }
            if up {
                self.down.remove(&held);
            }
        }
        if !self.pressed.note(&input) {
            return;
        }
        if let (Input::Move { dx, dy }, Some(Step { at: last, input: Input::Move { dx: x, dy: y } })) = (&input, self.steps.last_mut())
            && at - *last < MOVE_MERGE_MS
        {
            *x += dx;
            *y += dy;
            return;
        }
        self.steps.push(Step { at, input });
    }

    /// The macro, starting at its first input and letting go of anything still held.
    pub fn finish(mut self, name: String, stopped_at: u32) -> Macro {
        let start = self.steps.first().map_or(0, |s| s.at);
        for input in self.pressed.releases() {
            self.steps.push(Step { at: stopped_at.min(MAX_LENGTH_MS), input });
        }
        for step in &mut self.steps {
            step.at -= start;
        }
        Macro { name, length_ms: self.steps.last().map_or(0, |s| s.at), steps: self.steps }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(key: &str, up: bool) -> Input {
        Input::Key { key: key.into(), up }
    }

    #[test]
    fn records_from_the_first_input() {
        let mut r = Recorder::default();
        r.push(500, key("KeyW", false));
        r.push(700, key("KeyW", true));
        let m = r.finish("walk".into(), 900);
        assert_eq!(m.steps, vec![Step { at: 0, input: key("KeyW", false) }, Step { at: 200, input: key("KeyW", true) }]);
        assert_eq!(m.length_ms, 200);
    }

    #[test]
    fn ignores_key_repeat_and_releases_of_keys_pressed_before_recording() {
        let mut r = Recorder::default();
        r.push(0, key("KeyA", true));
        r.push(10, key("KeyW", false));
        r.push(40, key("KeyW", false));
        r.push(70, key("KeyW", false));
        r.push(90, key("KeyW", true));
        let m = r.finish("x".into(), 100);
        assert_eq!(m.steps.len(), 2);
    }

    #[test]
    fn lets_go_of_whatever_is_still_held() {
        let mut r = Recorder::default();
        r.push(0, key("KeyW", false));
        r.push(10, Input::Button { button: Button::Left, up: false });
        let m = r.finish("x".into(), 300);
        let last: Vec<_> = m.steps[2..].iter().map(|s| (s.at, s.input.clone())).collect();
        assert!(last.contains(&(300, key("KeyW", true))));
        assert!(last.contains(&(300, Input::Button { button: Button::Left, up: true })));
    }

    #[test]
    fn merges_fast_mouse_movement_without_losing_any() {
        let mut r = Recorder::default();
        r.push(0, Input::Move { dx: 1, dy: 2 });
        r.push(3, Input::Move { dx: 4, dy: -1 });
        r.push(7, Input::Move { dx: 1, dy: 0 });
        r.push(8, Input::Move { dx: 5, dy: 5 });
        let m = r.finish("x".into(), 8);
        assert_eq!(m.steps[0].input, Input::Move { dx: 6, dy: 1 });
        assert_eq!(m.steps[1], Step { at: 8, input: Input::Move { dx: 5, dy: 5 } });
    }

    #[test]
    fn a_click_between_moves_keeps_its_place() {
        let mut r = Recorder::default();
        r.push(0, Input::Move { dx: 1, dy: 0 });
        r.push(1, Input::Button { button: Button::Left, up: false });
        r.push(2, Input::Move { dx: 1, dy: 0 });
        assert_eq!(r.finish("x".into(), 2).steps.len(), 4); // and the release added at the end
    }

    #[test]
    fn stops_at_the_time_limit_and_still_lets_go() {
        let mut r = Recorder::default();
        r.push(0, key("KeyW", false));
        r.push(MAX_LENGTH_MS, key("KeyD", false));
        r.push(MAX_LENGTH_MS + 1, key("KeyS", false));
        let m = r.finish("x".into(), MAX_LENGTH_MS + 5);
        assert_eq!(m.steps, vec![Step { at: 0, input: key("KeyW", false) }, Step { at: MAX_LENGTH_MS, input: key("KeyW", true) }]);
    }

    #[test]
    fn checks_names() {
        assert_eq!(clean_name("  spin  ").unwrap(), "spin");
        assert!(clean_name("   ").is_err());
        assert!(clean_name(&"x".repeat(MAX_NAME_CHARS + 1)).is_err());
    }

    #[test]
    fn saved_macros_round_trip() {
        let mut r = Recorder::default();
        r.push(0, Input::Move { dx: 3, dy: -4 });
        r.push(20, Input::Wheel { delta: 120 });
        let m = r.finish("x".into(), 20);
        let text = serde_json::to_string(&m).unwrap();
        assert_eq!(serde_json::from_str::<Macro>(&text).unwrap(), m);
    }
}
