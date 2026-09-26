//! Microphone position mixing.
//!
//! A multi-mic bank holds one recording per mic position of the same
//! performance, phase-locked across positions (Kontakt/Spitfire-style mic
//! positions). Every note plays every loaded position together; the mixer
//! places each position's own signal chain into the stereo output through
//! that position's level, constant-power pan and on/off switch.
//!
//! The recordings already carry each position's own arrival time and
//! polarity, so the mixer applies neither a delay nor a phase flip.
//!
//! Position state is fixed-size and independent of how many positions the
//! loaded bank declares: hosts send `mic_N_*` parameters before a bank loads,
//! and those settings must still hold once it has.

use super::types::{MicPosition, MAX_MICS};

/// Maximum number of mic positions — the zone map's own mic limit, so every
/// mic a bank can declare has a position here.
pub const MAX_MIC_POSITIONS: usize = MAX_MICS;

/// Level, pan and on/off for every mic position.
#[derive(Default)]
pub struct MicMixer {
    positions: [MicPosition; MAX_MIC_POSITIONS],
}

impl MicMixer {
    /// Set volume for a mic position.
    pub fn set_mic_volume(&mut self, index: usize, volume: f32) {
        if let Some(position) = self.positions.get_mut(index) {
            position.volume = volume;
        }
    }

    /// Set pan for a mic position and recompute cached pan gains.
    pub fn set_mic_pan(&mut self, index: usize, pan: f32) {
        if let Some(position) = self.positions.get_mut(index) {
            position.pan = pan.clamp(-1.0, 1.0);
            position.update_pan_cache();
        }
    }

    /// Enable/disable a mic position.
    pub fn set_mic_enabled(&mut self, index: usize, enabled: bool) {
        if let Some(position) = self.positions.get_mut(index) {
            position.enabled = enabled;
        }
    }

    /// Whether a mic position is enabled.
    #[inline]
    pub fn is_enabled(&self, index: usize) -> bool {
        self.positions
            .get(index)
            .is_some_and(|position| position.enabled)
    }

    /// Place one mic position's mono signal into the stereo field at that
    /// position's volume and constant-power pan. Returns (left, right).
    #[inline]
    pub fn place(&self, index: usize, sample: f32) -> (f32, f32) {
        let Some(position) = self.positions.get(index) else {
            return (0.0, 0.0);
        };
        let gained = sample * position.volume;
        (
            gained * position.cached_pan_l,
            gained * position.cached_pan_r,
        )
    }
}
