// OS-level keyboard input and window inspection on Windows and macOS; other platforms refuse actions.

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct GameWindow {
    pub title: String,
    pub process: String, // executable file name, lowercase, e.g. "gta5.exe" or "textedit"
    pub icon: Option<String>, // the program's icon as a PNG data URL, for the game picker
}

// Icons by program path, made once: the window list is refreshed often and icons don't change while a program runs.
fn cached_icon(path: &str, make: impl FnOnce() -> Option<Vec<u8>>) -> Option<String> {
    use base64::Engine;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    static ICONS: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let icons = ICONS.get_or_init(Default::default);
    if let Some(icon) = icons.lock().unwrap().get(path) {
        return icon.clone();
    }
    let icon = make().map(|png| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)));
    icons.lock().unwrap().insert(path.to_string(), icon.clone());
    icon
}

#[cfg(windows)]
mod imp {
    use super::GameWindow;
    use crate::keys::{Modifier, ScanCode};
    use std::path::Path;
    use std::ffi::c_void;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDIBits,
        GetObjectW,
    };
    use windows::Win32::UI::Shell::ExtractIconExW;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
        KEYEVENTF_SCANCODE, MOUSE_EVENT_FLAGS, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
        MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT, INPUT_MOUSE, SendInput, VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, EnumWindows, GetForegroundWindow, GetIconInfo, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, HICON, ICONINFO, IsWindowVisible,
    };
    use windows::core::{BOOL, PCWSTR, PWSTR};

    use crate::macros::{Button, Input};
    use std::sync::Mutex;
    use windows::Win32::Foundation::{LRESULT, POINT, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, HC_ACTION, HHOOK, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, LLKHF_INJECTED,
        LLKHF_UP, LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, PostThreadMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx,
        WH_KEYBOARD_LL, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_QUIT,
        WM_RBUTTONDOWN, WM_RBUTTONUP,
    };

    fn send_mouse(dx: i32, dy: i32, data: u32, flags: MOUSE_EVENT_FLAGS) -> Result<(), String> {
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 { mi: MOUSEINPUT { dx, dy, mouseData: data, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        };
        let sent = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
        if sent == 1 { Ok(()) } else { Err("SendInput was blocked".into()) }
    }

    pub fn send_pointer(input: &Input) -> Result<(), String> {
        match input {
            Input::Move { dx, dy } => send_mouse(*dx, *dy, 0, MOUSEEVENTF_MOVE),
            Input::Wheel { delta } => send_mouse(0, 0, *delta as u32, MOUSEEVENTF_WHEEL),
            Input::Button { button, up } => send_mouse(0, 0, 0, match (button, up) {
                (Button::Left, false) => MOUSEEVENTF_LEFTDOWN,
                (Button::Left, true) => MOUSEEVENTF_LEFTUP,
                (Button::Right, false) => MOUSEEVENTF_RIGHTDOWN,
                (Button::Right, true) => MOUSEEVENTF_RIGHTUP,
                (Button::Middle, false) => MOUSEEVENTF_MIDDLEDOWN,
                (Button::Middle, true) => MOUSEEVENTF_MIDDLEUP,
            }),
            Input::Key { .. } => Ok(()),
        }
    }

    // Windows' hooks are plain functions with no room for state, so where input goes lives here.
    static SINK: Mutex<Option<Box<dyn FnMut(Input) + Send>>> = Mutex::new(None);

    fn deliver(input: Input) {
        if let Some(sink) = SINK.lock().unwrap().as_mut() {
            sink(input);
        }
    }

    unsafe extern "system" fn on_key(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            // Injected input is ours or another tool's, not the player's.
            if event.flags.0 & LLKHF_INJECTED.0 == 0
                && let Some(key) = crate::keys::key_for_scan(event.scanCode as u16, event.flags.0 & LLKHF_EXTENDED.0 != 0)
            {
                deliver(Input::Key { key: key.to_string(), up: event.flags.0 & LLKHF_UP.0 != 0 });
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    unsafe extern "system" fn on_mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let event = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
            if event.flags & LLMHF_INJECTED == 0 {
                let button = |button, up| Some(Input::Button { button, up });
                let input = match wparam.0 as u32 {
                    WM_LBUTTONDOWN => button(Button::Left, false),
                    WM_LBUTTONUP => button(Button::Left, true),
                    WM_RBUTTONDOWN => button(Button::Right, false),
                    WM_RBUTTONUP => button(Button::Right, true),
                    WM_MBUTTONDOWN => button(Button::Middle, false),
                    WM_MBUTTONUP => button(Button::Middle, true),
                    WM_MOUSEWHEEL => Some(Input::Wheel { delta: (event.mouseData >> 16) as i16 as i32 }),
                    WM_MOUSEMOVE => {
                        // The cursor hasn't moved yet, so this is the movement even in a game that keeps re-centering it.
                        let mut now = POINT::default();
                        unsafe { GetCursorPos(&mut now) }.ok().map(|_| Input::Move { dx: event.pt.x - now.x, dy: event.pt.y - now.y })
                    }
                    _ => None,
                };
                if let Some(input) = input {
                    deliver(input);
                }
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    pub struct RecordHook {
        thread_id: u32,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Drop for RecordHook {
        fn drop(&mut self) {
            let _ = unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) };
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
            *SINK.lock().unwrap() = None;
        }
    }

    pub fn start_recording(sink: Box<dyn FnMut(Input) + Send>) -> Result<RecordHook, String> {
        *SINK.lock().unwrap() = Some(sink);
        let (started, ready) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || unsafe {
            let set = |id, hook| SetWindowsHookExW(id, hook, None, 0).map_err(|e| e.to_string());
            let hooks: Result<[HHOOK; 2], String> = set(WH_KEYBOARD_LL, Some(on_key)).and_then(|k| set(WH_MOUSE_LL, Some(on_mouse)).map(|m| [k, m]));
            let hooks = match hooks {
                Ok(hooks) => hooks,
                Err(reason) => return drop(started.send(Err(reason))),
            };
            let _ = started.send(Ok(GetCurrentThreadId()));
            // Low-level hooks are called through this thread's message loop.
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            for hook in hooks {
                let _ = UnhookWindowsHookEx(hook);
            }
        });
        let thread_id = ready.recv().map_err(|e| e.to_string())??;
        Ok(RecordHook { thread_id, thread: Some(thread) })
    }

    // Windows tracks modifier state from the modifier key events themselves, so `_held` isn't needed here.
    pub fn send_key(scan: &ScanCode, up: bool, _held: &[Modifier]) -> Result<(), String> {
        let mut flags = KEYEVENTF_SCANCODE;
        if scan.extended {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        let input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: scan.code,
                    dwFlags: KEYBD_EVENT_FLAGS(flags.0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let sent = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
        if sent == 1 { Ok(()) } else { Err("SendInput was blocked".into()) }
    }

    fn process_name(hwnd: HWND) -> Option<String> {
        let path = process_path(hwnd)?;
        Path::new(&path).file_name().map(|n| n.to_string_lossy().to_lowercase())
    }

    fn process_path(hwnd: HWND) -> Option<String> {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 {
            return None;
        }
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = unsafe { QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) };
        unsafe {
            let _ = CloseHandle(handle);
        }
        ok.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }

    // The large icon in the program's .exe, as a PNG.
    fn exe_icon(path: &str) -> Option<Vec<u8>> {
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let mut icon = HICON::default();
        if unsafe { ExtractIconExW(PCWSTR(wide.as_ptr()), 0, Some(&mut icon), None, 1) } == 0 || icon.is_invalid() {
            return None;
        }
        let png = icon_png(icon);
        unsafe {
            let _ = DestroyIcon(icon);
        }
        png
    }

    fn icon_png(icon: HICON) -> Option<Vec<u8>> {
        let mut info = ICONINFO::default();
        unsafe { GetIconInfo(icon, &mut info) }.ok()?;
        let pixels = (|| {
            let mut bitmap = BITMAP::default();
            let size = std::mem::size_of::<BITMAP>() as i32;
            if unsafe { GetObjectW(info.hbmColor.into(), size, Some(&mut bitmap as *mut _ as *mut c_void)) } == 0 {
                return None;
            }
            let (width, height) = (bitmap.bmWidth, bitmap.bmHeight);
            let mut header = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height, // top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bgra = vec![0u8; (width * height * 4) as usize];
            let dc = unsafe { CreateCompatibleDC(None) };
            let rows = unsafe {
                GetDIBits(dc, info.hbmColor, 0, height as u32, Some(bgra.as_mut_ptr() as *mut c_void), &mut header, DIB_RGB_COLORS)
            };
            unsafe {
                let _ = DeleteDC(dc);
            }
            (rows == height).then_some((width as u32, height as u32, bgra))
        })();
        unsafe {
            let _ = DeleteObject(info.hbmColor.into());
            let _ = DeleteObject(info.hbmMask.into());
        }
        let (width, height, mut rgba) = pixels?;
        // Old icons without an alpha channel are fully opaque.
        let opaque = rgba.chunks(4).all(|p| p[3] == 0);
        for p in rgba.chunks_mut(4) {
            p.swap(0, 2);
            if opaque {
                p[3] = 255;
            }
        }
        super::png(width, height, &rgba)
    }

    fn window_title(hwnd: HWND) -> String {
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let copied = unsafe { GetWindowTextW(hwnd, &mut buf) };
        String::from_utf16_lossy(&buf[..copied as usize])
    }

    pub fn foreground_process() -> Option<String> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_invalid() { None } else { process_name(hwnd) }
    }

    pub fn list_windows() -> Vec<GameWindow> {
        unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let windows = unsafe { &mut *(lparam.0 as *mut Vec<GameWindow>) };
            if unsafe { IsWindowVisible(hwnd) }.as_bool() {
                let title = window_title(hwnd);
                if !title.is_empty() {
                    if let Some(path) = process_path(hwnd) {
                        let process = Path::new(&path).file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                        let icon = super::cached_icon(&path, || exe_icon(&path));
                        windows.push(GameWindow { title, process, icon });
                    }
                }
            }
            BOOL(1)
        }
        let mut windows: Vec<GameWindow> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&mut windows as *mut _ as isize));
        }
        // EnumWindows goes front to back, so the most recently focused program comes first. Each program once, at its
        // frontmost window, and not this app, which is in front whenever its picker is open.
        let own = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
        let mut seen = std::collections::HashSet::new();
        windows.retain(|w| Some(&w.process) != own.as_ref() && seen.insert(w.process.clone()));
        windows
    }
}

// RGBA pixels as a PNG.
#[cfg(windows)]
fn png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().ok()?.write_image_data(rgba).ok()?;
    Some(out)
}

#[cfg(target_os = "macos")]
mod imp {
    use super::GameWindow;
    use crate::keys::{Modifier, ScanCode};
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::CFString;
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSApplicationActivationPolicy, NSBitmapImageFileType, NSBitmapImageRep, NSRunningApplication, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize};
    use std::path::Path;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        // Whether this app may post input events: the same Accessibility switch, asked the way CGEventPost asks it.
        fn CGPreflightPostEventAccess() -> bool;
    }

    // macOS drops synthetic key events from apps without Accessibility permission, silently.
    pub fn permission_problem() -> Option<&'static str> {
        if unsafe { AXIsProcessTrusted() || CGPreflightPostEventAccess() } {
            None
        } else {
            Some("Hyperion Companion needs Accessibility permission to press keys")
        }
    }

    // Forgets this app's Accessibility entry, then asks again. An unsigned app counts as a new app after each update or
    // reinstall, so the switch still showing as on belongs to the old copy and does nothing for this one.
    pub fn reset_permission(bundle_id: &str) {
        let _ = std::process::Command::new("tccutil").args(["reset", "Accessibility", bundle_id]).status();
        request_permission();
    }

    // Shows macOS's own prompt and opens the Accessibility settings pane.
    pub fn request_permission() {
        let options = CFDictionary::from_CFType_pairs(&[(
            CFString::new("AXTrustedCheckOptionPrompt").as_CFType(),
            CFBoolean::true_value().as_CFType(),
        )]);
        unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) };
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }

    // macOS doesn't apply posted modifier key events to later events by itself, so each event carries the
    // modifiers held at that moment as flags.
    pub fn send_key(scan: &ScanCode, up: bool, held: &[Modifier]) -> Result<(), String> {
        if let Some(problem) = permission_problem() {
            return Err(problem.into());
        }
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|()| "could not create an input source")?;
        let event = CGEvent::new_keyboard_event(source, scan.mac, !up).map_err(|()| "could not create a key event")?;
        let flags = held.iter().fold(CGEventFlags::CGEventFlagNull, |flags, m| {
            flags
                | match m {
                    Modifier::Control => CGEventFlags::CGEventFlagControl,
                    Modifier::Alt => CGEventFlags::CGEventFlagAlternate,
                    Modifier::Shift => CGEventFlags::CGEventFlagShift,
                }
        });
        event.set_flags(flags);
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn process_name(pid: i32) -> Option<String> {
        let path = process_path(pid)?;
        Path::new(&path).file_name().map(|n| n.to_string_lossy().to_lowercase())
    }

    fn process_path(pid: i32) -> Option<String> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let len = unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
        if len <= 0 {
            return None;
        }
        Some(String::from_utf8_lossy(&buf[..len as usize]).into_owned())
    }

    // The app's Dock icon, sized for a 64-point box (its 128-pixel image on a Retina Mac), as a PNG.
    fn app_icon(app: &NSRunningApplication) -> Option<Vec<u8>> {
        let icon = app.icon()?;
        let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(64.0, 64.0));
        let image = unsafe { icon.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
        let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image);
        let png = unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
        Some(png.to_vec())
    }

    pub fn foreground_process() -> Option<String> {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        process_name(app.processIdentifier())
    }

    // The processes with windows on screen, front to back: the most recently focused first. Owner ids and layers are
    // shared without Screen Recording permission (titles aren't). Layer 0 is ordinary windows, not the menu bar or Dock.
    fn front_to_back() -> Vec<i32> {
        use core_foundation::base::CFType;
        use core_foundation::number::CFNumber;
        use core_graphics::window::{copy_window_info, kCGNullWindowID, kCGWindowLayer, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, kCGWindowOwnerPID};
        let Some(list) = copy_window_info(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID) else {
            return Vec::new();
        };
        let (pid_key, layer_key) = unsafe { (CFString::wrap_under_get_rule(kCGWindowOwnerPID), CFString::wrap_under_get_rule(kCGWindowLayer)) };
        let number = |info: &CFDictionary<CFString, CFType>, key: &CFString| info.find(key).and_then(|v| v.downcast::<CFNumber>()).and_then(|n| n.to_i64());
        let mut pids = Vec::new();
        for item in list.iter() {
            let info: CFDictionary<CFString, CFType> = unsafe { CFDictionary::wrap_under_get_rule(*item as CFDictionaryRef) };
            if number(&info, &layer_key) != Some(0) {
                continue;
            }
            if let Some(pid) = number(&info, &pid_key).and_then(|p| i32::try_from(p).ok()) {
                if !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
        }
        pids
    }

    // Apps with a Dock icon, the most recently focused first (then those with no window on screen, by name), and not
    // this app, which is in front whenever its picker is open. macOS only shares window titles with Screen Recording
    // permission, so use app names.
    pub fn list_windows() -> Vec<GameWindow> {
        let order = front_to_back();
        let own = std::process::id() as i32;
        let mut windows: Vec<(usize, GameWindow)> = NSWorkspace::sharedWorkspace()
            .runningApplications()
            .iter()
            .filter(|app| app.activationPolicy() == NSApplicationActivationPolicy::Regular && app.processIdentifier() != own)
            .filter_map(|app| {
                let path = process_path(app.processIdentifier())?;
                let process = Path::new(&path).file_name()?.to_string_lossy().to_lowercase();
                let title = app.localizedName().map(|n| n.to_string()).unwrap_or_else(|| process.clone());
                let icon = super::cached_icon(&path, || app_icon(&app));
                let rank = order.iter().position(|&pid| pid == app.processIdentifier()).unwrap_or(usize::MAX);
                Some((rank, GameWindow { title, process, icon }))
            })
            .collect();
        windows.sort_by(|(a_rank, a), (b_rank, b)| a_rank.cmp(b_rank).then_with(|| a.process.cmp(&b.process)));
        let mut seen = std::collections::HashSet::new();
        windows.into_iter().filter(|(_, w)| seen.insert(w.process.clone())).map(|(_, w)| w).collect()
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod imp {
    use super::GameWindow;
    use crate::keys::{Modifier, ScanCode};

    pub fn send_key(_scan: &ScanCode, _up: bool, _held: &[Modifier]) -> Result<(), String> {
        Err("Key input is only supported on Windows and macOS so far".into())
    }

    pub fn foreground_process() -> Option<String> {
        None
    }

    pub fn list_windows() -> Vec<GameWindow> {
        Vec::new()
    }
}

// Only macOS asks the user for permission before input works.
// Recording and playing mouse input is Windows-only so far.
#[cfg(not(windows))]
mod pointer {
    use crate::macros::Input;

    pub struct RecordHook;

    pub fn send_pointer(_input: &Input) -> Result<(), String> {
        Err("macros need Windows for now".into())
    }

    pub fn start_recording(_sink: Box<dyn FnMut(Input) + Send>) -> Result<RecordHook, String> {
        Err("Recording macros needs Windows for now".into())
    }
}
#[cfg(not(windows))]
pub use pointer::{RecordHook, start_recording};
#[cfg(not(windows))]
use pointer::send_pointer;
#[cfg(windows)]
pub use imp::{RecordHook, start_recording};
#[cfg(windows)]
use imp::send_pointer;

/// Performs one step of a macro.
pub fn send(input: &crate::macros::Input) -> Result<(), String> {
    match input {
        crate::macros::Input::Key { key, up } => send_key(&crate::keys::scan_code(key).ok_or("key not supported")?, *up, &[]),
        _ => send_pointer(input),
    }
}

#[cfg(not(target_os = "macos"))]
mod permission {
    pub fn permission_problem() -> Option<&'static str> {
        None
    }

    pub fn request_permission() {}

    pub fn reset_permission(_bundle_id: &str) {}
}

#[cfg(target_os = "macos")]
use imp as permission;

pub use imp::{foreground_process, list_windows, send_key};
pub use permission::{permission_problem, request_permission, reset_permission};
