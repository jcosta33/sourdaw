//! Host seam for the bundled generation sidecar.
//!
//! Audio generation runs in a separate process on purpose: the model is a
//! Python stack that must never be loaded into the process that owns the audio
//! device. What differs between shells is only how that process is located and
//! started — a Tauri sidecar resource, or a Node child process. The line
//! protocol spoken over its stdin and stdout is the same either way, and it
//! belongs to the command body, so the body addresses this trait and each shell
//! supplies the spawning.
//!
//! The event channel is bounded and asynchronous; nothing here is reachable from
//! the audio thread.

use std::path::Path;

use tokio::sync::mpsc::Receiver;

/// One line or lifecycle notice from the sidecar process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SidecarEvent {
    /// One line written to stdout, without its terminator.
    Stdout(Vec<u8>),
    /// One line written to stderr, without its terminator.
    Stderr(Vec<u8>),
    /// The process exited. `None` when it was killed by a signal.
    Terminated(Option<i32>),
}

/// A running sidecar process the command body can write to and stop.
pub trait SidecarProcess: Send {
    /// Write raw bytes to the process's stdin.
    fn write(&mut self, bytes: &[u8]) -> Result<(), String>;

    /// Terminate the process. Consumes the handle: a killed child cannot be
    /// written to again, and the type says so.
    fn kill(self: Box<Self>) -> Result<(), String>;
}

/// Starts sidecar processes on behalf of a command body.
pub trait SidecarHost: Send + Sync {
    /// Start the audio-generation sidecar, pointed at the directory holding the
    /// downloaded model weights.
    ///
    /// Returns the process handle and the stream of its output. The receiver is
    /// drained by a background task, not by the caller's frame.
    fn spawn_audio_generation(
        &self,
        model_dir: &Path,
    ) -> Result<(Receiver<SidecarEvent>, Box<dyn SidecarProcess>), String>;
}

/// Sidecar host for a shell that cannot start child processes yet.
///
/// Refuses rather than pretending: a generation request that silently never
/// completes is worse than one that says the sidecar is unavailable.
pub struct NoSidecarHost;

impl SidecarHost for NoSidecarHost {
    fn spawn_audio_generation(
        &self,
        _model_dir: &Path,
    ) -> Result<(Receiver<SidecarEvent>, Box<dyn SidecarProcess>), String> {
        Err("This host cannot start the audio generation sidecar".to_string())
    }
}
