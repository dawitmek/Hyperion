// Minecraft Java's RCON: a small TCP protocol a Minecraft server opens for running commands, with a password. Commands
// run as the server console, so "~ ~ ~" is the world's origin unless wrapped in "execute at {player} run …".

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

pub const DEFAULT_PORT: u16 = 25575;
const AUTH: i32 = 3;
const AUTH_RESPONSE: i32 = 2;
const COMMAND: i32 = 2;
const RESPONSE: i32 = 0;
const WAIT: Duration = Duration::from_secs(5);
const MAX_PACKET: i32 = 1 << 16;

/// Where this PC's Minecraft server listens. Kept in this PC's config; the password never leaves the Rust side.
#[derive(Serialize, Deserialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub host: String,
    pub port: u16,
    pub password: String,
    pub player: Option<String>, // the host's own name in the game, for {player}
}

pub struct Rcon {
    stream: TcpStream,
    next_id: i32,
}

impl Rcon {
    pub async fn connect(settings: &Settings) -> Result<Rcon, String> {
        let address = format!("{}:{}", settings.host, settings.port);
        let stream = timeout(WAIT, TcpStream::connect(&address))
            .await
            .map_err(|_| format!("Minecraft didn't answer at {address}"))?
            .map_err(|e| format!("couldn't reach Minecraft at {address}: {e}"))?;
        let mut rcon = Rcon { stream, next_id: 1 };
        let id = rcon.send(AUTH, &settings.password).await?;
        loop {
            let (got, kind, _) = rcon.read().await?;
            if got == -1 {
                return Err("Minecraft refused the RCON password".into());
            }
            if got == id && kind == AUTH_RESPONSE {
                return Ok(rcon);
            }
        }
    }

    /// Runs a command and returns what Minecraft answered, like "Summoned new Creeper".
    pub async fn run(&mut self, command: &str) -> Result<String, String> {
        let id = self.send(COMMAND, command).await?;
        loop {
            // Anything else is left over from an earlier command whose answer came in parts.
            let (got, kind, body) = self.read().await?;
            if got == id && kind == RESPONSE {
                return Ok(body);
            }
        }
    }

    async fn send(&mut self, kind: i32, body: &str) -> Result<i32, String> {
        let id = self.next_id;
        self.next_id = self.next_id.checked_add(1).unwrap_or(1);
        self.stream.write_all(&encode(id, kind, body)).await.map_err(lost)?;
        Ok(id)
    }

    async fn read(&mut self) -> Result<(i32, i32, String), String> {
        timeout(WAIT, async {
            let len = self.stream.read_i32_le().await.map_err(lost)?;
            if !(10..=MAX_PACKET).contains(&len) {
                return Err("Minecraft sent something that isn't RCON".to_string());
            }
            let mut packet = vec![0; len as usize];
            self.stream.read_exact(&mut packet).await.map_err(lost)?;
            let id = i32::from_le_bytes(packet[0..4].try_into().unwrap());
            let kind = i32::from_le_bytes(packet[4..8].try_into().unwrap());
            Ok((id, kind, String::from_utf8_lossy(&packet[8..packet.len() - 2]).into_owned()))
        })
        .await
        .map_err(|_| "Minecraft stopped answering".to_string())?
    }
}

/// How Minecraft's error answers begin, like "No entity was found" or "Unknown or incomplete command, see below for
/// error". Answers to commands that worked ("Summoned new Creeper", "Gave 3 [Diamond] to Steve") never do.
const REFUSALS: [&str; 10] =
    ["Unknown", "Incorrect argument", "Expected", "Invalid", "No entity", "No player", "Unable to", "Could not", "Can't", "Nothing changed"];

/// Minecraft's reason, when its answer to a command says it didn't run.
pub fn refusal(answer: &str) -> Option<String> {
    // Some servers colour their errors with § codes.
    let mut plain = String::with_capacity(answer.len());
    let mut chars = answer.chars();
    while let Some(c) = chars.next() {
        if c == '§' {
            chars.next();
        } else {
            plain.push(c);
        }
    }
    let first = plain.lines().next().unwrap_or("").trim();
    REFUSALS.iter().any(|r| first.starts_with(r)).then(|| first.chars().take(200).collect())
}

fn lost(e: std::io::Error) -> String {
    format!("lost the connection to Minecraft: {e}")
}

/// One packet: its length, then id, type, the body and two zero bytes.
fn encode(id: i32, kind: i32, body: &str) -> Vec<u8> {
    let mut packet = Vec::with_capacity(body.len() + 14);
    packet.extend_from_slice(&(body.len() as i32 + 10).to_le_bytes());
    packet.extend_from_slice(&id.to_le_bytes());
    packet.extend_from_slice(&kind.to_le_bytes());
    packet.extend_from_slice(body.as_bytes());
    packet.extend_from_slice(&[0, 0]);
    packet
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    async fn read_packet(stream: &mut TcpStream) -> (i32, i32, String) {
        let len = stream.read_i32_le().await.unwrap();
        let mut packet = vec![0; len as usize];
        stream.read_exact(&mut packet).await.unwrap();
        let id = i32::from_le_bytes(packet[0..4].try_into().unwrap());
        let kind = i32::from_le_bytes(packet[4..8].try_into().unwrap());
        (id, kind, String::from_utf8(packet[8..packet.len() - 2].to_vec()).unwrap())
    }

    /// A pretend Minecraft server with the password "secret", answering every command with "ran <command>".
    async fn fake_server() -> Settings {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let (id, kind, password) = read_packet(&mut stream).await;
            assert_eq!(kind, AUTH);
            let answer = if password == "secret" { id } else { -1 };
            stream.write_all(&encode(answer, AUTH_RESPONSE, "")).await.unwrap();
            loop {
                let (id, kind, command) = read_packet(&mut stream).await;
                assert_eq!(kind, COMMAND);
                // A stray packet first, like the rest of an earlier long answer.
                stream.write_all(&encode(id - 1, RESPONSE, "old")).await.unwrap();
                stream.write_all(&encode(id, RESPONSE, &format!("ran {command}"))).await.unwrap();
            }
        });
        Settings { host: "127.0.0.1".into(), port, password: "secret".into(), player: None }
    }

    #[test]
    fn encodes_packets() {
        assert_eq!(encode(7, COMMAND, "list"), [14, 0, 0, 0, 7, 0, 0, 0, 2, 0, 0, 0, b'l', b'i', b's', b't', 0, 0]);
    }

    #[test]
    fn spots_refused_commands() {
        assert_eq!(refusal("No entity was found").as_deref(), Some("No entity was found"));
        assert_eq!(refusal("§cUnknown or incomplete command, see below for error\n...summon creper<--[HERE]").as_deref(), Some("Unknown or incomplete command, see below for error"));
        assert_eq!(refusal("Summoned new Creeper"), None);
        assert_eq!(refusal("Gave 3 [Diamond] to Steve"), None);
        assert_eq!(refusal(""), None);
    }

    #[tokio::test]
    async fn logs_in_and_runs_commands() {
        let settings = fake_server().await;
        let mut rcon = Rcon::connect(&settings).await.unwrap();
        assert_eq!(rcon.run("summon creeper ~ ~ ~").await.unwrap(), "ran summon creeper ~ ~ ~");
        assert_eq!(rcon.run("say hi").await.unwrap(), "ran say hi");
    }

    #[tokio::test]
    async fn says_when_the_password_is_wrong() {
        let settings = Settings { password: "nope".into(), ..fake_server().await };
        assert!(Rcon::connect(&settings).await.err().unwrap().contains("password"));
    }

    #[tokio::test]
    async fn says_when_nothing_is_listening() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let settings = Settings { host: "127.0.0.1".into(), port, ..Default::default() };
        assert!(Rcon::connect(&settings).await.err().unwrap().contains("couldn't reach"));
    }
}
