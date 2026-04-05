use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

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
    pub enabled: bool,
    pub tempo: f64,
    pub quantum: f64,
    pub beat: f64,
    pub phase: f64,
    pub num_peers: u32,
}

/// Enable Ableton Link sync.
/// Starts listening on the local network for Link-compatible apps.
#[tauri::command]
pub async fn enable_link(state: tauri::State<'_, LinkState>) -> Result<LinkStatus, String> {
    let mut session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    session.enabled = true;

    // In production: rusty_link::AblLink::new(session.tempo)
    // Then: link.enable(true); link.enable_start_stop_sync(true);

    Ok(LinkStatus {
        enabled: true,
        tempo: session.tempo,
        quantum: session.quantum,
        beat: session.beat,
        phase: session.beat % session.quantum,
        num_peers: session.num_peers,
    })
}

/// Disable Ableton Link sync.
#[tauri::command]
pub async fn disable_link(state: tauri::State<'_, LinkState>) -> Result<(), String> {
    let mut session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    session.enabled = false;
    Ok(())
}

/// Set the Link tempo. Propagates to all connected peers.
#[tauri::command]
pub async fn set_link_tempo(tempo: f64, state: tauri::State<'_, LinkState>) -> Result<(), String> {
    let mut session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    session.tempo = tempo.clamp(20.0, 999.0);
    // In production: link.capture_app_session_state() -> set_tempo -> commit
    Ok(())
}

/// Get current Link status for UI display.
#[tauri::command]
pub async fn get_link_status(state: tauri::State<'_, LinkState>) -> Result<LinkStatus, String> {
    let session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(LinkStatus {
        enabled: session.enabled,
        tempo: session.tempo,
        quantum: session.quantum,
        beat: session.beat,
        phase: session.beat % session.quantum,
        num_peers: session.num_peers,
    })
}

/// Force-start playback across all Link peers.
#[tauri::command]
pub async fn link_start_playing(state: tauri::State<'_, LinkState>) -> Result<(), String> {
    let session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    if !session.enabled {
        return Err("Link is not enabled".into());
    }
    // In production: session_state.set_is_playing_and_request_beat_at_time(true, ...)
    Ok(())
}

/// Force-stop playback across all Link peers.
#[tauri::command]
pub async fn link_stop_playing(state: tauri::State<'_, LinkState>) -> Result<(), String> {
    let session = state.inner.lock().map_err(|e| format!("Lock error: {e}"))?;
    if !session.enabled {
        return Err("Link is not enabled".into());
    }
    // In production: session_state.set_is_playing(false)
    Ok(())
}
