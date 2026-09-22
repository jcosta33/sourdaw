//! Arm and disarm the engine's retrospective audio ring.
//!
//! PunchRecording names one project strip; this command resolves that strip to
//! the engine-native track id the ring already accepts, then arms or disarms.
//! Opening the input is the engine's duty on a successful arm.

use crate::state::AppState;

/// Arm retrospective retention for one project track strip.
///
/// Resolves `track_id` through the live graph registry so the engine receives
/// the same `usize` identity it uses everywhere else. Declines when no engine
/// is running or the strip is not a known track.
pub async fn arm_retrospective_capture(
    track_id: String,
    channels: u32,
    state: &AppState,
) -> Result<(), String> {
    let registry_guard = state
        .graph
        .lock()
        .map_err(|error| format!("Failed to lock graph registry: {error}"))?;

    let native_id = registry_guard
        .track_native_id(&track_id)
        .ok_or_else(|| format!("arm-retrospective-capture: unknown track strip '{track_id}'"))?;

    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {error}"))?;

    let Some(engine) = engine_guard.as_mut() else {
        return Err("no native engine is running".to_string());
    };

    engine.arm_retrospective_capture(native_id, channels as usize);
    Ok(())
}

/// Stop retrospective retention. Capture-callback writes keep nothing until
/// the next arm.
pub async fn disarm_retrospective_capture(state: &AppState) -> Result<(), String> {
    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {error}"))?;

    let Some(engine) = engine_guard.as_mut() else {
        return Err("no native engine is running".to_string());
    };

    engine.disarm_retrospective_capture();
    Ok(())
}
