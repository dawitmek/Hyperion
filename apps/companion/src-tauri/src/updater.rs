// Finds newer companions on GitHub releases (the ones .github/workflows/release-companion.yml publishes) and
// installs them: by themselves once the host turns automatic updates on, otherwise when they click Update. An
// automatic update waits until chat hasn't been using this PC for a while, so it never cuts into a game.

use crate::controller::Controller;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

const RELEASES_API: &str = "https://api.github.com/repos/dawitmek/Hyperion/releases?per_page=20";
const RELEASES_PAGE: &str = "https://github.com/dawitmek/Hyperion/releases";
const TAG_PREFIX: &str = "companion-v";
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(10);
const CHECK_EVERY: Duration = Duration::from_secs(4 * 60 * 60);
/// How long chat must have left this PC alone before an automatic update installs.
const IDLE_BEFORE_INSTALL: Duration = Duration::from_secs(60);
const IDLE_POLL: Duration = Duration::from_secs(5);

pub const CURRENT: &str = env!("CARGO_PKG_VERSION");
/// The release workflow only builds installers for these.
pub const SUPPORTED: bool = cfg!(any(windows, target_os = "macos"));

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    #[default]
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Ready, // downloaded
    Installing,
    Error,
}

/// What the window shows about updates.
#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateView {
    pub status: Status,
    pub version: Option<String>,
    pub notes_url: Option<String>,
    pub progress: Option<f32>, // 0 to 1, while downloading
    pub error: Option<String>,
    pub waiting: bool,   // downloaded and waiting for chat to leave this PC alone
    pub dismissed: bool, // the host chose "Not now" for this version
}

#[derive(Clone, Debug, PartialEq)]
struct Release {
    version: String,
    notes_url: String,
    asset_name: String,
    asset_url: String,
    asset_size: Option<u64>,
}

#[derive(Default)]
pub struct Updater {
    view: UpdateView,
    release: Option<Release>,
    file: Option<PathBuf>, // the downloaded installer
}

impl Updater {
    pub fn view(&self) -> UpdateView {
        self.view.clone()
    }
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: Option<u64>,
}

/// Checks soon after starting, then every few hours.
pub fn start(ctl: Arc<Controller>) {
    if !SUPPORTED {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_AFTER).await;
        loop {
            check(&ctl, false).await;
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

/// Looks for a newer version. A check the host asked for shows its progress and errors, and offers a version they
/// said "Not now" to again; a background one stays quiet unless it finds something.
pub async fn check(ctl: &Arc<Controller>, manual: bool) {
    if !SUPPORTED {
        return;
    }
    {
        let mut u = ctl.update.lock().unwrap();
        if matches!(u.view.status, Status::Checking | Status::Downloading | Status::Ready | Status::Installing) {
            return;
        }
        if manual {
            u.view = UpdateView { status: Status::Checking, ..Default::default() };
        }
    }
    if manual {
        let _ = ctl.update_config(|c| c.skipped_version = None);
    }
    match latest().await {
        Ok(Some(release)) => {
            set(ctl, |u| {
                u.view = UpdateView {
                    status: Status::Available,
                    version: Some(release.version.clone()),
                    notes_url: Some(release.notes_url.clone()),
                    ..Default::default()
                };
                u.file = None;
                u.release = Some(release);
            });
            if ctl.config().auto_update == Some(true) {
                spawn_install(ctl.clone(), true);
            }
        }
        Ok(None) => set(ctl, |u| {
            u.view = UpdateView { status: if manual { Status::UpToDate } else { Status::Idle }, ..Default::default() };
            u.release = None;
            u.file = None;
        }),
        Err(error) => set(ctl, |u| {
            if manual {
                u.view = UpdateView { status: Status::Error, error: Some(error), ..Default::default() };
            }
        }),
    }
}

/// Automatic updates were just turned on: install what's already been found.
pub fn resume(ctl: Arc<Controller>) {
    let pending = {
        let u = ctl.update.lock().unwrap();
        u.release.is_some() && matches!(u.view.status, Status::Available | Status::Ready)
    };
    if pending {
        spawn_install(ctl, true);
    }
}

/// "Not now": hides this version until the host checks by hand.
pub fn dismiss(ctl: &Controller) -> Result<(), String> {
    let version = ctl.update.lock().unwrap().view.version.clone();
    ctl.update_config(|c| c.skipped_version = version)
}

fn spawn_install(ctl: Arc<Controller>, automatic: bool) {
    tauri::async_runtime::spawn(async move {
        let _ = install(ctl, automatic).await;
    });
}

/// Downloads the update if it isn't yet, installs it and restarts. An automatic install first waits for chat to leave
/// this PC alone, and stops waiting if automatic updates are turned off or the host installs it by hand meanwhile.
pub async fn install(ctl: Arc<Controller>, automatic: bool) -> Result<(), String> {
    let result = try_install(&ctl, automatic).await;
    if let Err(error) = &result {
        set(&ctl, |u| {
            u.view.status = Status::Error;
            u.view.error = Some(error.clone());
            u.view.progress = None;
            u.view.waiting = false;
        });
    }
    result
}

async fn try_install(ctl: &Arc<Controller>, automatic: bool) -> Result<(), String> {
    let (release, file) = {
        let mut u = ctl.update.lock().unwrap();
        let Some(release) = u.release.clone() else { return Err("There's no update to install. Check for updates first".into()) };
        if matches!(u.view.status, Status::Downloading | Status::Installing) {
            return Ok(()); // already under way
        }
        if u.file.is_none() {
            u.view.status = Status::Downloading;
            u.view.progress = Some(0.0);
            u.view.error = None;
        }
        (release, u.file.clone())
    };
    ctl.emit();
    let file = match file {
        Some(file) => file,
        None => download(ctl, &release).await?,
    };
    set(ctl, |u| {
        u.file = Some(file.clone());
        u.view.status = Status::Ready;
        u.view.progress = None;
    });
    if automatic && !wait_until_idle(ctl).await {
        return Ok(());
    }
    // Only one install goes ahead, whether it comes from waiting or from a click.
    {
        let mut u = ctl.update.lock().unwrap();
        if u.view.status != Status::Ready {
            return Ok(());
        }
        u.view.status = Status::Installing;
    }
    ctl.emit();
    apply(ctl, file).await
}

/// Waits until chat has left this PC alone for a while: the game not in front, no keys held, no macro running.
/// False when it stopped waiting instead.
async fn wait_until_idle(ctl: &Arc<Controller>) -> bool {
    {
        let mut u = ctl.update.lock().unwrap();
        if u.view.waiting {
            return false; // another wait is already under way
        }
        u.view.waiting = true;
    }
    ctl.emit();
    let mut idle_since: Option<Instant> = None;
    let idle = loop {
        let auto = ctl.config().auto_update == Some(true);
        let ready = ctl.update.lock().unwrap().view.status == Status::Ready;
        if !auto || !ready {
            break false;
        }
        if ctl.in_use() {
            idle_since = None;
        } else if idle_since.get_or_insert_with(Instant::now).elapsed() >= IDLE_BEFORE_INSTALL {
            break true;
        }
        tokio::time::sleep(IDLE_POLL).await;
    };
    set(ctl, |u| u.view.waiting = false);
    idle
}

async fn latest() -> Result<Option<Release>, String> {
    if let Some(version) = fake_version() {
        return Ok(Some(Release {
            version,
            notes_url: RELEASES_PAGE.into(),
            asset_name: "fake-update".into(),
            asset_url: String::new(),
            asset_size: None,
        }));
    }
    let response = client()?
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("GitHub answered {}", response.status()));
    }
    let releases: Vec<GithubRelease> = response.json().await.map_err(|e| format!("Couldn't read GitHub's answer: {e}"))?;
    Ok(newest(&releases, CURRENT, std::env::consts::OS))
}

/// The newest published companion release newer than `current` with an installer for `os`.
fn newest(releases: &[GithubRelease], current: &str, os: &str) -> Option<Release> {
    releases
        .iter()
        .filter(|r| !r.draft && !r.prerelease)
        .filter_map(|r| {
            let version = r.tag_name.strip_prefix(TAG_PREFIX)?;
            let parsed = parse_version(version)?;
            let asset = installer(&r.assets, os)?;
            Some((parsed, r, version, asset))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .filter(|(_, _, version, _)| is_newer(version, current))
        .map(|(_, r, version, asset)| Release {
            version: version.to_string(),
            notes_url: r.html_url.clone(),
            asset_name: asset.name.clone(),
            asset_url: asset.browser_download_url.clone(),
            asset_size: asset.size,
        })
}

/// The installer the release workflow makes for each system: an NSIS setup .exe for Windows, a universal .dmg for macOS.
fn installer<'a>(assets: &'a [GithubAsset], os: &str) -> Option<&'a GithubAsset> {
    let suffix = match os {
        "windows" => "-setup.exe",
        "macos" => ".dmg",
        _ => return None,
    };
    assets.iter().find(|a| a.name.ends_with(suffix))
}

/// "1.2.3" as [1, 2, 3], ignoring anything after a - or +. Missing parts count as 0.
fn parse_version(version: &str) -> Option<[u64; 3]> {
    let core = version.split(['-', '+']).next()?;
    let mut parts = [0; 3];
    for (i, part) in core.split('.').enumerate() {
        *parts.get_mut(i)? = part.parse().ok()?;
    }
    Some(parts)
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    matches!((parse_version(candidate), parse_version(current)), (Some(a), Some(b)) if a > b)
}

fn client() -> Result<reqwest::Client, String> {
    // GitHub's API refuses requests without a User-Agent.
    reqwest::Client::builder().user_agent(format!("hyperion-companion/{CURRENT}")).build().map_err(|e| e.to_string())
}

/// Debug builds only: HYPERION_FAKE_UPDATE=9.9.9 pretends that version is out, to try every step in the window
/// without publishing a release. Nothing is downloaded or installed.
fn fake_version() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var("HYPERION_FAKE_UPDATE").ok().filter(|v| !v.trim().is_empty())
}

async fn download(ctl: &Arc<Controller>, release: &Release) -> Result<PathBuf, String> {
    if fake_version().is_some() {
        for step in 1..=20 {
            tokio::time::sleep(Duration::from_millis(150)).await;
            set(ctl, |u| u.view.progress = Some(step as f32 / 20.0));
        }
        return Ok(PathBuf::from(&release.asset_name));
    }
    let name = Path::new(&release.asset_name).file_name().ok_or("The update has no file name")?;
    let dir = std::env::temp_dir().join("hyperion-companion-update");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't save the update: {e}"))?;
    let file = dir.join(name);
    let part = dir.join(format!("{}.part", name.to_string_lossy()));

    let mut response = client()?.get(&release.asset_url).send().await.map_err(|e| format!("Couldn't download the update: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't download the update: GitHub answered {}", response.status()));
    }
    let total = release.asset_size.or(response.content_length()).filter(|t| *t > 0);
    let mut out = std::fs::File::create(&part).map_err(|e| format!("Couldn't save the update: {e}"))?;
    let (mut done, mut shown) = (0u64, 0f32);
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("The download stopped: {e}"))? {
        out.write_all(&chunk).map_err(|e| format!("Couldn't save the update: {e}"))?;
        done += chunk.len() as u64;
        if let Some(total) = total {
            let progress = (done as f32 / total as f32).min(1.0);
            if progress - shown >= 0.01 {
                shown = progress;
                set(ctl, |u| u.view.progress = Some(progress));
            }
        }
    }
    out.flush().map_err(|e| format!("Couldn't save the update: {e}"))?;
    drop(out);
    // GitHub lists each file's size; anything else is a cut-off or tampered download.
    if total.is_some_and(|t| t != done) {
        let _ = std::fs::remove_file(&part);
        return Err("The download was incomplete. Try again".into());
    }
    std::fs::rename(&part, &file).map_err(|e| format!("Couldn't save the update: {e}"))?;
    Ok(file)
}

/// Lets go of every key, starts the installer and quits so it can replace this app. It starts the new version.
async fn apply(ctl: &Arc<Controller>, file: PathBuf) -> Result<(), String> {
    if fake_version().is_some() {
        return Err("Pretend update (HYPERION_FAKE_UPDATE): there's nothing to install".into());
    }
    crate::connection::stop(ctl);
    let launched = tauri::async_runtime::spawn_blocking(move || launch(&file)).await.map_err(|e| e.to_string()).and_then(|r| r);
    match launched {
        Ok(()) => {
            ctl.app().exit(0);
            Ok(())
        }
        Err(error) => {
            if ctl.config().device_token.is_some() {
                crate::connection::restart(ctl);
            }
            Err(error)
        }
    }
}

#[cfg(windows)]
fn launch(installer: &Path) -> Result<(), String> {
    // The Tauri installer's own flags: /P a progress bar with no questions, /R start the companion again when done,
    // /UPDATE an update of an existing install. A per-user install needs no administrator prompt.
    std::process::Command::new(installer)
        .args(["/P", "/R", "/UPDATE"])
        .spawn()
        .map(drop)
        .map_err(|e| format!("Couldn't start the installer: {e}"))
}

/// Copies the app out of the disk image over this one, then starts it once this one has quit. Where this app can't
/// be replaced (an Applications folder owned by an administrator, or run from the disk image), the disk image is left
/// open to drag it over by hand.
#[cfg(target_os = "macos")]
fn launch(dmg: &Path) -> Result<(), String> {
    use std::process::Command;
    let bundle = running_bundle().ok_or("Updates only install into the packaged app")?;
    let mount = std::env::temp_dir().join(format!("hyperion-companion-mount-{}", std::process::id()));
    std::fs::create_dir_all(&mount).map_err(|e| e.to_string())?;
    run(Command::new("hdiutil").arg("attach").arg(dmg).args(["-nobrowse", "-noautoopen", "-quiet", "-mountpoint"]).arg(&mount))
        .map_err(|e| format!("Couldn't open the update: {e}"))?;
    let replaced = replace_bundle(&mount, &bundle);
    let _ = Command::new("hdiutil").arg("detach").arg(&mount).arg("-quiet").status();
    let _ = std::fs::remove_dir(&mount);
    if let Err(error) = replaced {
        let _ = Command::new("open").arg(dmg).status();
        return Err(format!("{error}. The update is open in Finder: drag Hyperion Companion into Applications to finish"));
    }
    Command::new("/bin/sh")
        .args(["-c", "sleep 2; open \"$0\""])
        .arg(&bundle)
        .spawn()
        .map(drop)
        .map_err(|e| format!("Updated, but couldn't restart: {e}. Open Hyperion Companion again"))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn launch(_installer: &Path) -> Result<(), String> {
    Err("Updates aren't available for this system".into())
}

/// The .app this is running from: …/Hyperion Companion.app/Contents/MacOS/hyperion-companion.
#[cfg(target_os = "macos")]
fn running_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?;
    (bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

/// Swaps in the new app beside the old one, so a failure part way leaves the old one in place.
#[cfg(target_os = "macos")]
fn replace_bundle(mount: &Path, bundle: &Path) -> Result<(), String> {
    use std::process::Command;
    let new_app = std::fs::read_dir(mount)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .ok_or("The update has no app in it")?;
    let parent = bundle.parent().ok_or("Couldn't find where the app is")?;
    let staged = parent.join(".hyperion-companion-update.app");
    let old = parent.join(".hyperion-companion-old.app");
    let _ = std::fs::remove_dir_all(&staged);
    let _ = std::fs::remove_dir_all(&old);
    run(Command::new("ditto").arg(&new_app).arg(&staged)).map_err(|e| format!("Couldn't copy the new version: {e}"))?;
    if let Err(e) = std::fs::rename(bundle, &old) {
        let _ = std::fs::remove_dir_all(&staged);
        return Err(format!("Couldn't replace the app: {e}"));
    }
    if let Err(e) = std::fs::rename(&staged, bundle) {
        let _ = std::fs::rename(&old, bundle);
        let _ = std::fs::remove_dir_all(&staged);
        return Err(format!("Couldn't replace the app: {e}"));
    }
    let _ = std::fs::remove_dir_all(&old); // fine while running: the files stay open until this one quits
    Ok(())
}

#[cfg(target_os = "macos")]
fn run(command: &mut std::process::Command) -> Result<(), String> {
    let output = command.output().map_err(|e| e.to_string())?;
    if output.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&output.stderr).trim().to_string()) }
}

/// Changes the update state and tells the window.
fn set(ctl: &Controller, change: impl FnOnce(&mut Updater)) {
    change(&mut ctl.update.lock().unwrap());
    ctl.emit();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, assets: &[&str]) -> GithubRelease {
        GithubRelease {
            tag_name: tag.into(),
            html_url: format!("https://github.com/dawitmek/Hyperion/releases/tag/{tag}"),
            draft: false,
            prerelease: false,
            assets: assets
                .iter()
                .map(|name| GithubAsset { name: name.to_string(), browser_download_url: format!("https://example.com/{name}"), size: Some(10) })
                .collect(),
        }
    }

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.4.0", "0.3.0"));
        assert!(is_newer("0.3.1", "0.3.0"));
        assert!(is_newer("1.0", "0.9.9"));
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(!is_newer("0.3.0", "0.3.0"));
        assert!(!is_newer("0.3", "0.3.0"));
        assert!(!is_newer("0.2.9", "0.3.0"));
        assert!(!is_newer("0.4.0-beta", "0.4.0"));
        assert!(!is_newer("nonsense", "0.3.0"));
        assert!(!is_newer("1.2.3.4", "0.3.0"));
    }

    #[test]
    fn picks_the_newest_release_with_an_installer_for_this_system() {
        let releases = [
            release("companion-v0.4.0", &["Hyperion.Companion_0.4.0_x64-setup.exe", "Hyperion.Companion_0.4.0_universal.dmg"]),
            release("companion-v0.5.0", &["Hyperion.Companion_0.5.0_universal.dmg"]), // the Windows build failed
            release("v9.0.0", &["server.tar.gz"]),                                      // not a companion release
        ];
        let windows = newest(&releases, "0.3.0", "windows").unwrap();
        assert_eq!((windows.version.as_str(), windows.asset_name.as_str()), ("0.4.0", "Hyperion.Companion_0.4.0_x64-setup.exe"));
        let mac = newest(&releases, "0.3.0", "macos").unwrap();
        assert_eq!((mac.version.as_str(), mac.asset_name.as_str()), ("0.5.0", "Hyperion.Companion_0.5.0_universal.dmg"));
        assert!(newest(&releases, "0.5.0", "macos").is_none());
        assert!(newest(&releases, "0.3.0", "linux").is_none());
    }

    #[test]
    fn skips_drafts_and_prereleases() {
        let mut draft = release("companion-v0.6.0", &["a.dmg"]);
        draft.draft = true;
        let mut beta = release("companion-v0.7.0", &["b.dmg"]);
        beta.prerelease = true;
        assert!(newest(&[draft, beta], "0.3.0", "macos").is_none());
    }
}

