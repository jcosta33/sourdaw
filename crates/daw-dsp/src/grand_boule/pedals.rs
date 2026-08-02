//! Pedal & damper model for the Grand Boule piano.
//!
//! Implements §5.2 of the spec:
//! * **Sustain (CC64)** — continuous "half-pedal". Maps pedal position to a
//!   per-key damper bandwidth via a smoothstep. Notes above C7 (key 76)
//!   have no damper.
//! * **Una Corda (CC67)** — binary. When engaged, hammer stiffness is scaled
//!   by `UNA_CORDA_STIFFNESS_SCALE` and the sympathetic coupling ratio is
//!   reduced. Conceptually it strikes 2/3 strings.
//! * **Sostenuto (CC66)** — binary. Captures which notes are held when it
//!   engages; those keys keep their damper raised regardless of sustain.

use super::parameters::{damper_strength, has_damper};

/// Hammer stiffness multiplier under the una-corda pedal (§5.2).
pub const UNA_CORDA_STIFFNESS_SCALE: f32 = 0.7;

/// Sympathetic coupling scaling to un-excited strings under una-corda.
pub const UNA_CORDA_SYMPATHETIC_COUPLING: f32 = 0.3;

/// Smoothstep lower threshold for the half-pedal curve.
const HALF_PEDAL_LOW: f32 = 0.15;

/// Smoothstep upper threshold.
const HALF_PEDAL_HIGH: f32 = 0.85;

/// Maximum damper bandwidth (Hz) added to a damped key when the pedal is
/// fully up. Scales with `√key`.
const DAMPER_MAX_HZ: f32 = 60.0;

/// Bitset of 88 piano keys (one bit per key, LSB = key 1).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct KeyBitset {
    lo: u64,
    hi: u32,
}

impl KeyBitset {
    pub const EMPTY: Self = Self { lo: 0, hi: 0 };

    pub fn set(&mut self, key: u32) {
        if key == 0 || key > 88 {
            return;
        }
        let bit = key - 1;
        if bit < 64 {
            self.lo |= 1u64 << bit;
        } else {
            self.hi |= 1u32 << (bit - 64);
        }
    }

    pub fn clear(&mut self, key: u32) {
        if key == 0 || key > 88 {
            return;
        }
        let bit = key - 1;
        if bit < 64 {
            self.lo &= !(1u64 << bit);
        } else {
            self.hi &= !(1u32 << (bit - 64));
        }
    }

    pub fn contains(&self, key: u32) -> bool {
        if key == 0 || key > 88 {
            return false;
        }
        let bit = key - 1;
        if bit < 64 {
            (self.lo >> bit) & 1 == 1
        } else {
            (self.hi >> (bit - 64)) & 1 == 1
        }
    }

    pub fn clear_all(&mut self) {
        self.lo = 0;
        self.hi = 0;
    }
}

/// All three pedal states plus aggregate held-key bookkeeping used by the
/// physical damper model. Exact sostenuto ownership lives on each voice.
#[derive(Clone, Debug)]
pub struct PedalState {
    /// Continuous sustain pedal position 0.0 (up) .. 1.0 (down).
    sustain_position: f32,
    /// Una corda pedal on/off.
    una_corda: bool,
    /// Sostenuto pedal on/off.
    sostenuto: bool,
    /// Keys currently held by the performer.
    keys_held: KeyBitset,
}

impl PedalState {
    pub fn new() -> Self {
        Self {
            sustain_position: 0.0,
            una_corda: false,
            sostenuto: false,
            keys_held: KeyBitset::EMPTY,
        }
    }

    pub fn sustain_position(&self) -> f32 {
        self.sustain_position
    }

    pub fn una_corda(&self) -> bool {
        self.una_corda
    }

    pub fn sostenuto(&self) -> bool {
        self.sostenuto
    }

    /// Update the sustain (CC64) pedal position.
    pub fn set_sustain(&mut self, position: f32) {
        self.sustain_position = position.clamp(0.0, 1.0);
    }

    /// Update the una corda (CC67) pedal state.
    pub fn set_una_corda(&mut self, engaged: bool) {
        self.una_corda = engaged;
    }

    /// Update the sostenuto (CC66) controller state. The engine latches exact
    /// voice identities on the rising edge.
    pub fn set_sostenuto(&mut self, engaged: bool) {
        self.sostenuto = engaged;
    }

    pub fn clear_playing_keys(&mut self) {
        self.keys_held.clear_all();
    }

    /// Record that a key has been pressed.
    pub fn press_key(&mut self, key: u32) {
        self.keys_held.set(key);
    }

    /// Record that a key has been released.
    pub fn release_key(&mut self, key: u32) {
        self.keys_held.clear(key);
    }

    /// Whether the performer is currently holding `key` down.
    pub fn key_is_held(&self, key: u32) -> bool {
        self.keys_held.contains(key)
    }

    /// Damper bandwidth (Hz) applied to `key` given the current pedal state
    /// and the exact voice's key and sostenuto ownership.
    ///
    /// * Notes above C7 have no damper at any pedal position.
    /// * If the key is held OR the sustain pedal is fully engaged OR the
    ///   sostenuto has captured this key, the damper is fully off (0 Hz).
    /// * Intermediate sustain positions apply a smoothstep between max
    ///   damping and no damping.
    pub fn damper_bandwidth_for_key(
        &self,
        key: u32,
        key_is_held: bool,
        sostenuto_captured: bool,
    ) -> f32 {
        if !has_damper(key) {
            return 0.0;
        }
        if key_is_held {
            return 0.0;
        }
        if self.sostenuto && sostenuto_captured {
            return 0.0;
        }
        let lifted = smoothstep(HALF_PEDAL_LOW, HALF_PEDAL_HIGH, self.sustain_position);
        let max_damp = DAMPER_MAX_HZ * (damper_strength(key) / damper_strength(1));
        max_damp * (1.0 - lifted)
    }

    /// Hammer-stiffness multiplier under the current pedal state.
    pub fn hammer_stiffness_scale(&self) -> f32 {
        if self.una_corda {
            UNA_CORDA_STIFFNESS_SCALE
        } else {
            1.0
        }
    }

    /// Damping mix supplied to the sympathetic bank. 1.0 = fully damped
    /// (sustain fully up), 0.0 = fully undamped (sustain fully down).
    pub fn sympathetic_damping(&self) -> f32 {
        1.0 - smoothstep(HALF_PEDAL_LOW, HALF_PEDAL_HIGH, self.sustain_position)
    }
}

impl Default for PedalState {
    fn default() -> Self {
        Self::new()
    }
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sustain_up_applies_full_damper() {
        let mut pedals = PedalState::new();
        pedals.set_sustain(0.0);
        let bw = pedals.damper_bandwidth_for_key(40, false, false);
        assert!(bw > 0.0);
    }

    #[test]
    fn sustain_down_removes_damper() {
        let mut pedals = PedalState::new();
        pedals.set_sustain(1.0);
        assert_eq!(pedals.damper_bandwidth_for_key(40, false, false), 0.0);
    }

    #[test]
    fn keys_above_c7_have_no_damper_ever() {
        let mut pedals = PedalState::new();
        pedals.set_sustain(0.0);
        assert_eq!(pedals.damper_bandwidth_for_key(80, false, false), 0.0);
    }

    #[test]
    fn held_key_is_undamped() {
        let pedals = PedalState::new();
        assert_eq!(pedals.damper_bandwidth_for_key(40, true, false), 0.0);
    }

    #[test]
    fn captured_voice_is_undamped_while_sostenuto_is_engaged() {
        let mut pedals = PedalState::new();
        pedals.set_sostenuto(true);
        assert_eq!(pedals.damper_bandwidth_for_key(40, false, true), 0.0);
    }

    #[test]
    fn uncaptured_voice_is_damped_while_sostenuto_is_engaged() {
        let mut pedals = PedalState::new();
        pedals.set_sostenuto(true);
        assert!(pedals.damper_bandwidth_for_key(40, false, false) > 0.0);
    }

    #[test]
    fn una_corda_scales_hammer_stiffness() {
        let mut pedals = PedalState::new();
        assert_eq!(pedals.hammer_stiffness_scale(), 1.0);
        pedals.set_una_corda(true);
        assert_eq!(pedals.hammer_stiffness_scale(), UNA_CORDA_STIFFNESS_SCALE);
    }

    #[test]
    fn half_pedal_is_monotonic() {
        let mut pedals = PedalState::new();
        pedals.set_sustain(0.0);
        let bw_up = pedals.damper_bandwidth_for_key(40, false, false);
        pedals.set_sustain(0.5);
        let bw_half = pedals.damper_bandwidth_for_key(40, false, false);
        pedals.set_sustain(1.0);
        let bw_down = pedals.damper_bandwidth_for_key(40, false, false);
        assert!(bw_up > bw_half);
        assert!(bw_half > bw_down);
    }
}
