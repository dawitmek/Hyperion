// What this PC did, kept in memory for the host to export when something goes wrong. Starts, the connection, pauses,
// and anything refused or failing are always kept; debug mode adds every message from the server and every key and
// action. Never the device token, passwords or the TikTok session: callers keep those out.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Lines kept: enough for a long stream in debug mode, small enough to forget about (a few MB at most).
const MAX_LINES: usize = 20_000;
/// A line longer than this (a whole command list, say) is cut short.
const MAX_LINE_CHARS: usize = 600;

static DEBUG: AtomicBool = AtomicBool::new(false);
static LINES: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

pub fn set_debug(on: bool) {
    if DEBUG.swap(on, Ordering::SeqCst) != on {
        write("INFO", if on { "Debug mode on" } else { "Debug mode off" });
    }
}

pub fn debug_on() -> bool {
    DEBUG.load(Ordering::SeqCst)
}

/// Always kept.
pub fn info(message: impl AsRef<str>) {
    write("INFO", message.as_ref());
}

/// Only in debug mode. Takes a closure so nothing is formatted while it's off.
pub fn debug(message: impl FnOnce() -> String) {
    if debug_on() {
        write("DEBUG", &message());
    }
}

fn write(level: &str, message: &str) {
    let mut text: String = message.chars().filter(|c| !c.is_control() || *c == ' ').take(MAX_LINE_CHARS).collect();
    if message.chars().count() > MAX_LINE_CHARS {
        text.push('…');
    }
    let line = format!("{} {level:<5} {text}", timestamp(SystemTime::now()));
    let mut lines = LINES.lock().unwrap();
    if lines.len() == MAX_LINES {
        lines.pop_front();
    }
    lines.push_back(line);
}

/// Everything kept, under `header`, as the text of a file.
pub fn export(header: &str) -> String {
    let lines = LINES.lock().unwrap();
    let mut text = String::with_capacity(header.len() + lines.len() * 80);
    text.push_str(header);
    text.push_str("\n\n");
    for line in lines.iter() {
        text.push_str(line);
        text.push('\n');
    }
    text
}

/// UTC, like 2026-11-12T09:41:07.250Z.
pub fn timestamp(time: SystemTime) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let (year, month, day) = civil_date((secs / 86_400) as i64);
    let rest = secs % 86_400;
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", rest / 3600, rest / 60 % 60, rest % 60, since.subsec_millis())
}

/// For a file name: 2026-11-12-094107, in UTC.
pub fn file_stamp(time: SystemTime) -> String {
    let stamp = timestamp(time);
    format!("{}-{}", &stamp[..10], stamp[11..19].replace(':', ""))
}

/// Days since 1970-01-01 to (year, month, day), by Howard Hinnant's algorithm.
fn civil_date(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn formats_utc_times() {
        assert_eq!(timestamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let time = UNIX_EPOCH + Duration::from_millis(1_794_456_067_250);
        assert_eq!(timestamp(time), "2026-11-12T04:01:07.250Z");
        assert_eq!(file_stamp(time), "2026-11-12-040107");
        // A leap day.
        assert_eq!(timestamp(UNIX_EPOCH + Duration::from_secs(951_782_400)), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn keeps_debug_lines_only_in_debug_mode() {
        set_debug(false);
        debug(|| "hidden line".into());
        info("shown line");
        set_debug(true);
        debug(|| "debug line".into());
        set_debug(false);
        let text = export("header");
        assert!(text.starts_with("header\n\n"));
        assert!(!text.contains("hidden line"));
        assert!(text.contains("INFO  shown line"));
        assert!(text.contains("DEBUG debug line"));
    }
}
