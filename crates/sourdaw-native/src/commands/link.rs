use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const LINK_IMPLEMENTATION_STATE: &str = "unsupported";
const LINK_UNSUPPORTED_REASON: &str =
    "Ableton Link native runtime integration is not implemented in this build";

/// Ableton Link state managed across sessions.
pub struct LinkState {
    inner: Mutex<LinkSession>,
}

struct LinkSession {
    enabled: bool,
    tempo: f64,
    quantum: f64,
    beat: f64,
    num_peers: u32,
}

impl Default for LinkState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(LinkSession {
                enabled: false,
                tempo: 120.0,
                quantum: 4.0,
                beat: 0.0,
                num_peers: 0,
            }),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LinkStatus {
    pub supported: bool,
    pub implementation: String,
    pub enabled: bool,
    pub tempo: f64,
    pub quantum: f64,
    pub beat: f64,
    pub phase: f64,
    pub num_peers: u32,
    pub message: Option<String>,
}

fn status_from_session(session: &LinkSession) -> LinkStatus {
    LinkStatus {
        supported: false,
        implementation: LINK_IMPLEMENTATION_STATE.to_string(),
        enabled: false,
        tempo: session.tempo,
        quantum: session.quantum,
        beat: session.beat,
        phase: session.beat % session.quantum,
        num_peers: session.num_peers,
        message: Some(LINK_UNSUPPORTED_REASON.to_string()),
    }
}

/// Enable Ableton Link sync.
/// Starts listening on the local network for Link-compatible apps.
pub async fn enable_link(state: &LinkState) -> Result<LinkStatus, String> {
    let mut session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    session.enabled = false;
    Ok(status_from_session(&session))
}

/// Disable Ableton Link sync.
pub async fn disable_link(state: &LinkState) -> Result<(), String> {
    let mut session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    session.enabled = false;
    Ok(())
}

/// Set the Link tempo. Propagates to all connected peers.
pub async fn set_link_tempo(tempo: f64, state: &LinkState) -> Result<(), String> {
    let mut session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    session.tempo = tempo.clamp(20.0, 999.0);
    Ok(())
}

/// Get current Link status for UI display.
pub async fn get_link_status(state: &LinkState) -> Result<LinkStatus, String> {
    let session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(status_from_session(&session))
}

/// Force-start playback across all Link peers.
pub async fn link_start_playing(state: &LinkState) -> Result<(), String> {
    let session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    if !session.enabled {
        return Err(LINK_UNSUPPORTED_REASON.to_string());
    }
    Ok(())
}

/// Force-stop playback across all Link peers.
pub async fn link_stop_playing(state: &LinkState) -> Result<(), String> {
    let session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    if !session.enabled {
        return Err(LINK_UNSUPPORTED_REASON.to_string());
    }
    Ok(())
}
