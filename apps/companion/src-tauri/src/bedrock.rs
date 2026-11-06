// Minecraft Bedrock's /connect: typed in a world, it makes the game join a WebSocket server, here one on this PC, and
// run the commands it's sent as the player who typed it. So "~ ~ ~" is where they stand and @s is them.

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::async_runtime::{JoinHandle, spawn};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;

pub const PORT: u16 = 19131;
const WAIT: Duration = Duration::from_secs(5);

type Reply = oneshot::Sender<Result<Answer, String>>;

/// What the game said to a command.
pub struct Answer {
    pub ok: bool,
    pub message: String,
}

/// The game's connection: commands go to the task that owns it, one at a time, so Bedrock's queue never fills.
struct Link {
    id: u64,
    commands: mpsc::Sender<(String, Reply)>,
    task: JoinHandle<()>,
}

#[derive(Default)]
pub struct Bedrock {
    listener: Mutex<Option<JoinHandle<()>>>,
    link: Mutex<Option<Link>>,
    problem: Mutex<Option<String>>, // why it isn't listening
    links: AtomicU64,
}

impl Bedrock {
    /// Listens for the game on this PC only. `changed` is called when the game joins or leaves.
    pub fn start(self: &std::sync::Arc<Self>, port: u16, changed: impl Fn() + Send + Sync + 'static) {
        self.stop();
        let this = self.clone();
        let changed = std::sync::Arc::new(changed);
        let task = spawn(async move {
            let listener = match TcpListener::bind(("127.0.0.1", port)).await {
                Ok(listener) => listener,
                Err(e) => {
                    *this.problem.lock().unwrap() = Some(format!("couldn't listen on port {port}: {e}"));
                    return changed();
                }
            };
            loop {
                let Ok((stream, _)) = listener.accept().await else { continue };
                // Each handshake on its own, so one that never finishes doesn't hold up the game's.
                let (this, changed) = (this.clone(), changed.clone());
                spawn(async move {
                    let Ok(Ok(ws)) = timeout(WAIT, tokio_tungstenite::accept_hdr_async(stream, not_a_browser)).await else { return };
                    // The newest /connect wins, in case the old one is gone without saying so.
                    let id = this.links.fetch_add(1, Ordering::SeqCst);
                    let (commands, queue) = mpsc::channel(1);
                    let (this2, changed2) = (this.clone(), changed.clone());
                    let task = spawn(async move {
                        serve(ws, queue).await;
                        let mut link = this2.link.lock().unwrap();
                        if link.as_ref().is_some_and(|l| l.id == id) {
                            *link = None;
                            drop(link);
                            changed2();
                        }
                    });
                    if let Some(old) = this.link.lock().unwrap().replace(Link { id, commands, task }) {
                        old.task.abort();
                    }
                    changed();
                });
            }
        });
        *self.listener.lock().unwrap() = Some(task);
    }

    pub fn stop(&self) {
        if let Some(task) = self.listener.lock().unwrap().take() {
            task.abort();
        }
        if let Some(link) = self.link.lock().unwrap().take() {
            link.task.abort();
        }
        *self.problem.lock().unwrap() = None;
    }

    pub fn connected(&self) -> bool {
        self.link.lock().unwrap().is_some()
    }

    pub fn problem(&self) -> Option<String> {
        self.problem.lock().unwrap().clone()
    }

    pub async fn run(&self, command: &str) -> Result<Answer, String> {
        let commands = self.link.lock().unwrap().as_ref().map(|l| l.commands.clone());
        let commands = commands.ok_or(format!("Minecraft Bedrock isn't connected. Type /connect 127.0.0.1:{PORT} in your world"))?;
        let (reply, answer) = oneshot::channel();
        let gone = || "lost the connection to Minecraft Bedrock".to_string();
        commands.send((command.to_string(), reply)).await.map_err(|_| gone())?;
        answer.await.map_err(|_| gone())?
    }
}

/// Browsers always say which page opened a WebSocket and Minecraft never does, so a web page can't pose as the game,
/// take its place and read the commands meant for it.
#[allow(clippy::result_large_err)] // the shape tungstenite's callback takes
fn not_a_browser(request: &Request, response: Response) -> Result<Response, ErrorResponse> {
    if request.headers().contains_key("origin") {
        let mut refused = ErrorResponse::new(Some("Only Minecraft can connect here".into()));
        *refused.status_mut() = StatusCode::FORBIDDEN;
        return Err(refused);
    }
    Ok(response)
}

/// Sends each command and waits for its answer. Ends when the game leaves.
async fn serve(mut ws: WebSocketStream<TcpStream>, mut queue: mpsc::Receiver<(String, Reply)>) {
    let mut next = 0u64;
    loop {
        tokio::select! {
            request = queue.recv() => {
                let Some((command, reply)) = request else { return };
                next += 1;
                let result = send(&mut ws, next, &command).await;
                let lost = result.as_ref().is_err_and(|e| e.starts_with("lost"));
                let _ = reply.send(result);
                if lost {
                    return;
                }
            }
            // Between commands the game only sends events, which aren't asked for, and pings.
            message = ws.next() => match message {
                None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return,
                _ => {}
            },
        }
    }
}

async fn send(ws: &mut WebSocketStream<TcpStream>, n: u64, command: &str) -> Result<Answer, String> {
    let id = request_id(n);
    let request = json!({
        "header": { "version": 1, "requestId": id, "messageType": "commandRequest", "messagePurpose": "commandRequest" },
        "body": { "version": 1, "commandLine": command, "origin": { "type": "player" } },
    });
    ws.send(Message::text(request.to_string())).await.map_err(|e| format!("lost the connection to Minecraft Bedrock: {e}"))?;
    timeout(WAIT, async {
        loop {
            let text = match ws.next().await {
                Some(Ok(Message::Text(text))) => text,
                Some(Ok(Message::Close(_))) | None => return Err("lost the connection to Minecraft Bedrock".to_string()),
                Some(Err(e)) => return Err(format!("lost the connection to Minecraft Bedrock: {e}")),
                Some(Ok(_)) => continue,
            };
            if let Some(answer) = answer_to(&text, &id) {
                return Ok(answer);
            }
        }
    })
    .await
    .map_err(|_| "Minecraft Bedrock didn't answer. Is the game paused?".to_string())?
}

/// Bedrock wants request ids shaped like UUIDs.
fn request_id(n: u64) -> String {
    format!("00000000-0000-4000-8000-{:012x}", n & 0xffff_ffff_ffff)
}

/// The game's answer, if `text` is the answer to request `id`. A status of 0 means the command ran.
fn answer_to(text: &str, id: &str) -> Option<Answer> {
    let message: Value = serde_json::from_str(text).ok()?;
    let header = &message["header"];
    let purpose = header["messagePurpose"].as_str()?;
    if header["requestId"].as_str()? != id || !matches!(purpose, "commandResponse" | "error") {
        return None;
    }
    let body = &message["body"];
    let ok = purpose == "commandResponse" && body["statusCode"].as_i64() == Some(0);
    let mut text: String = body["statusMessage"].as_str().unwrap_or("").chars().take(200).collect();
    if !ok && text.is_empty() {
        text = "the command didn't run".into();
    }
    Some(Answer { ok, message: text })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn reads_answers() {
        let id = request_id(7);
        let reply = |purpose: &str, request: &str, code: i64, message: &str| {
            json!({ "header": { "messagePurpose": purpose, "requestId": request }, "body": { "statusCode": code, "statusMessage": message } }).to_string()
        };
        let ran = answer_to(&reply("commandResponse", &id, 0, "Object successfully summoned"), &id).unwrap();
        assert!(ran.ok);
        let refused = answer_to(&reply("commandResponse", &id, -2147483648, "Syntax error: Unexpected \"creper\""), &id).unwrap();
        assert_eq!((refused.ok, refused.message.as_str()), (false, "Syntax error: Unexpected \"creper\""));
        assert!(!answer_to(&reply("error", &id, 0, ""), &id).unwrap().ok);
        assert!(answer_to(&reply("commandResponse", &request_id(8), 0, ""), &id).is_none());
        assert!(answer_to(&reply("event", &id, 0, ""), &id).is_none());
        assert!(answer_to("not json", &id).is_none());
    }

    /// The game's side: answers a command, refusing ones that start with "bad", after an event nobody asked for.
    async fn answer(game: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>) -> String {
        let Some(Ok(Message::Text(text))) = game.next().await else { panic!("no command") };
        let request: Value = serde_json::from_str(&text).unwrap();
        let command = request["body"]["commandLine"].as_str().unwrap().to_string();
        let id = request["header"]["requestId"].clone();
        game.send(Message::text(json!({ "header": { "messagePurpose": "event", "eventName": "PlayerMessage" } }).to_string())).await.unwrap();
        let code = if command.starts_with("bad") { -1 } else { 0 };
        let reply = json!({ "header": { "messagePurpose": "commandResponse", "requestId": id }, "body": { "statusCode": code, "statusMessage": format!("ran {command}") } });
        game.send(Message::text(reply.to_string())).await.unwrap();
        command
    }

    #[tokio::test]
    async fn runs_commands_in_a_connected_game() {
        let bedrock = Arc::new(Bedrock::default());
        let joined = Arc::new(AtomicBool::new(false));
        let seen = joined.clone();
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        bedrock.start(port, move || seen.store(true, Ordering::SeqCst));
        assert!(bedrock.run("say hi").await.err().unwrap().contains("/connect"));

        let mut game = loop {
            if let Ok((game, _)) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}")).await {
                break game;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        while !bedrock.connected() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(joined.load(Ordering::SeqCst));

        let (ran, command) = tokio::join!(bedrock.run("summon creeper ~ ~ ~"), answer(&mut game));
        assert_eq!(command, "summon creeper ~ ~ ~");
        assert!(ran.unwrap().ok);
        let (refused, _) = tokio::join!(bedrock.run("bad command"), answer(&mut game));
        let refused = refused.unwrap();
        assert_eq!((refused.ok, refused.message.as_str()), (false, "ran bad command"));

        game.close(None).await.unwrap();
        while bedrock.connected() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        bedrock.stop();
    }

    #[tokio::test]
    async fn web_pages_cannot_take_the_games_place() {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let bedrock = Arc::new(Bedrock::default());
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        bedrock.start(port, || {});
        let mut page = format!("ws://127.0.0.1:{port}").into_client_request().unwrap();
        page.headers_mut().insert("origin", "https://example.com".parse().unwrap());
        let refused = loop {
            match tokio_tungstenite::connect_async(page.clone()).await {
                Err(tokio_tungstenite::tungstenite::Error::Io(_)) => tokio::time::sleep(Duration::from_millis(20)).await, // not listening yet
                other => break other,
            }
        };
        assert!(matches!(refused, Err(tokio_tungstenite::tungstenite::Error::Http(ref r)) if r.status() == 403), "{refused:?}");
        assert!(!bedrock.connected());
        bedrock.stop();
    }
}
