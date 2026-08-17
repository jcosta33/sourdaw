//! The Tauri shell's implementation of the native crate's sidecar seam.
//!
//! Locating and starting the generation sidecar is the shell's job; the line
//! protocol spoken over its stdio belongs to
//! `sourdaw_native::commands::audio_gen` and is identical either way.

use std::path::Path;

use sourdaw_native::host::sidecar::{SidecarEvent, SidecarHost, SidecarProcess};
use tauri::AppHandle;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::mpsc::Receiver;

/// How many sidecar lines may be in flight before the forwarding task applies
/// backpressure. The sidecar emits progress ticks, not a stream of audio, so
/// this only has to absorb a burst.
const SIDECAR_EVENT_QUEUE: usize = 64;

pub struct TauriSidecarHost {
    app: AppHandle,
}

impl TauriSidecarHost {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl SidecarHost for TauriSidecarHost {
    fn spawn_audio_generation(
        &self,
        model_dir: &Path,
    ) -> Result<(Receiver<SidecarEvent>, Box<dyn SidecarProcess>), String> {
        // Try bundled sidecar first, fall back to PATH
        let sidecar_result = self
            .app
            .shell()
            .sidecar("audio-sidecar")
            .map_err(|e| format!("Sidecar setup: {e}"))
            .and_then(|cmd| {
                cmd.args(["--model-dir", model_dir.to_str().unwrap_or("/tmp")])
                    .spawn()
                    .map_err(|e| format!("Sidecar spawn: {e}"))
            });

        let (mut rx, child) = match sidecar_result {
            Ok(result) => {
                eprintln!("[Audio Gen] Started bundled sidecar");
                result
            }
            Err(_) => {
                // Fall back to running the Python script directly
                eprintln!("[Audio Gen] Bundled sidecar not found, trying Python script...");
                let sidecar_dir = std::env::current_dir().unwrap_or_default().join("sidecar");
                let script_path = sidecar_dir.join("audio_gen.py");

                self.app
                    .shell()
                    .command("python3")
                    .args([
                        script_path.to_str().unwrap_or("sidecar/audio_gen.py"),
                        "--model-dir",
                        model_dir.to_str().unwrap_or("/tmp"),
                    ])
                    .spawn()
                    .map_err(|e| {
                        format!(
                            "Audio generation sidecar not available. \
                             Install Python 3 and run: pip install -r sidecar/requirements.txt. Error: {e}"
                        )
                    })?
            }
        };

        let (sender, receiver) = tokio::sync::mpsc::channel(SIDECAR_EVENT_QUEUE);
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                let forwarded = match event {
                    CommandEvent::Stdout(bytes) => SidecarEvent::Stdout(bytes),
                    CommandEvent::Stderr(bytes) => SidecarEvent::Stderr(bytes),
                    CommandEvent::Terminated(payload) => SidecarEvent::Terminated(payload.code),
                    // Every other variant carries no line and no exit status, so
                    // forwarding it would only teach the body a Tauri-shaped
                    // vocabulary it has no use for.
                    _ => continue,
                };
                let terminated = matches!(forwarded, SidecarEvent::Terminated(_));
                if sender.send(forwarded).await.is_err() || terminated {
                    break;
                }
            }
        });

        Ok((receiver, Box::new(TauriSidecarProcess { child })))
    }
}

struct TauriSidecarProcess {
    child: CommandChild,
}

impl SidecarProcess for TauriSidecarProcess {
    fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.child
            .write(bytes)
            .map_err(|error| format!("Failed to write to sidecar: {error}"))
    }

    fn kill(self: Box<Self>) -> Result<(), String> {
        self.child
            .kill()
            .map_err(|error| format!("Failed to stop sidecar: {error}"))
    }
}
