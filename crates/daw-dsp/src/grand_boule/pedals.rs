//! Pedal & damper model for the Grand Boule piano.
//!
//! Implements the piano pedal model:
//! * **Sustain (CC64)** — continuous "half-pedal". Maps pedal position to a
//!   per-key damper bandwidth via a smoothstep. Notes above C7 (key 76)
//!   have no damper.
//! * **Una Corda (CC67)** — binary. When engaged, hammer stiffness is scaled
//!   by `UNA_CORDA_STIFFNESS_SCALE` and the sympathetic coupling ratio is
//!   reduced. Conceptually it strikes 2/3 strings.
//! * **Sostenuto (CC66)** — binary. Captures which notes are held when it
//!   engages; those keys keep their damper raised regardless of sustain.

use super::parameters::{damper_strength, has_damper};

/// Hammer stiffness multiplier under the una-corda pedal.
pub const UNA_CORDA_STIFFNESS_SCALE: f32 = 0.7;

/// Sympathetic coupling scaling to un-excited strings under una-corda.
pub const UNA_CORDA_SYMPATHETIC_COUPLING: f32 = 0.3;

/// Reference smoothstep lower threshold for the half-pedal curve — the pedal
/// position at which the dampers start to leave the strings. Calibratable at
/// runtime via `PedalState::set_half_pedal_low`; this is the value a
/// reference pedal is measured at.
pub const DEFAULT_HALF_PEDAL_LOW: f32 = 0.15;

/// Upper bound accepted for the calibrated lower threshold. Mirrors the
/// `sustainThreshold` range in `GrandBouleMidiCalibration.ts`, and keeps the
/// smoothstep span non-degenerate whatever a caller asks for.
pub const MAX_HALF_PEDAL_LOW: f32 = 0.5;

/// Smoothstep upper threshold.
const HALF_PEDAL_HIGH: f32 = 0.85;

/// Upper bound accepted for the continuous-CC smoothing time constant, in
/// milliseconds. Mirrors the `ccSmoothingMs` range in
/// `GrandBouleMidiCalibration.ts`.
pub const MAX_CC_SMOOTHING_MS: f32 = 50.0;

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
    /// Calibrated lower edge of the half-pedal smoothstep — the pedal
    /// position at which the dampers begin to lift.
    half_pedal_low: f32,
    /// Sustain position after continuous-CC smoothing. This is what the
    /// damper curve reads; `sustain_position` stays the raw controller value
    /// so the engine's discrete pedal-engaged decisions are never delayed.
    smoothed_sustain: f32,
    /// One-pole time constant, in milliseconds, applied to `sustain_position`
    /// on its way to `smoothed_sustain`. 0 disables smoothing entirely.
    cc_smoothing_ms: f32,
}

impl PedalState {
    pub fn new() -> Self {
        Self {
            sustain_position: 0.0,
            una_corda: false,
            sostenuto: false,
            keys_held: KeyBitset::EMPTY,
            half_pedal_low: DEFAULT_HALF_PEDAL_LOW,
            smoothed_sustain: 0.0,
            // Unsmoothed until a host calibrates it, so an engine driven
            // without the calibration panel behaves exactly as before.
            cc_smoothing_ms: 0.0,
        }
    }

    pub fn sustain_position(&self) -> f32 {
        self.sustain_position
    }

    pub fn half_pedal_low(&self) -> f32 {
        self.half_pedal_low
    }

    /// Calibrate the pedal position at which the dampers start to lift.
    ///
    /// Sustain pedals differ in travel and rest position, so the reference
    /// `DEFAULT_HALF_PEDAL_LOW` is not right for every controller. Raising it
    /// delays the lift (a pedal that rests part-way down stops bleeding
    /// sustain); lowering it makes the dampers respond earlier in the travel.
    ///
    /// A non-finite threshold is dropped: it survives the clamp and turns the
    /// smoothstep's lower edge into NaN, which poisons the damper curve for
    /// every key on the next block.
    pub fn set_half_pedal_low(&mut self, threshold: f32) {
        if !threshold.is_finite() {
            return;
        }
        self.half_pedal_low = threshold.clamp(0.0, MAX_HALF_PEDAL_LOW);
    }

    pub fn una_corda(&self) -> bool {
        self.una_corda
    }

    pub fn sostenuto(&self) -> bool {
        self.sostenuto
    }

    /// Update the sustain (CC64) pedal position.
    ///
    /// A non-finite position is dropped rather than clamped. `f32::clamp`
    /// passes NaN straight through, and with smoothing enabled that NaN seeds
    /// `smoothed_sustain`, which no later valid position can clear — the snap
    /// back to the raw value only happens at 0 ms. From there it reaches
    /// `damper_bandwidth_for_key`, whose result goes to
    /// `PianoVoice::set_extra_damping`; that function's `< 1.0e-3` no-op check
    /// is false for NaN, so it retunes every resonator with NaN coefficients
    /// and the instrument never produces a finite sample again.
    pub fn set_sustain(&mut self, position: f32) {
        if !position.is_finite() {
            return;
        }
        self.sustain_position = position.clamp(0.0, 1.0);
        if self.cc_smoothing_ms <= 0.0 {
            self.smoothed_sustain = self.sustain_position;
        }
    }

    /// Sustain position the damper curve actually reads.
    pub fn smoothed_sustain_position(&self) -> f32 {
        self.smoothed_sustain
    }

    pub fn cc_smoothing_ms(&self) -> f32 {
        self.cc_smoothing_ms
    }

    /// Calibrate how hard the continuous sustain controller is smoothed.
    ///
    /// CC64 arrives in 128 steps at whatever rate the controller scans, so a
    /// swept pedal steps the damper bandwidth rather than sliding it. This is
    /// the time constant that turns those steps back into a slide; 0 restores
    /// the raw stepped response.
    /// A non-finite time constant is dropped for the same reason `set_sustain`
    /// drops a non-finite position: NaN survives the clamp, fails the
    /// `<= 0.0` disable check, and poisons the smoother permanently.
    pub fn set_cc_smoothing_ms(&mut self, milliseconds: f32) {
        if !milliseconds.is_finite() {
            return;
        }
        self.cc_smoothing_ms = milliseconds.clamp(0.0, MAX_CC_SMOOTHING_MS);
        if self.cc_smoothing_ms <= 0.0 {
            self.smoothed_sustain = self.sustain_position;
        }
    }

    /// Advance the sustain smoother by one block.
    ///
    /// Block-rate, matching the granularity the damper coefficients are
    /// already rebuilt at (`GrandBouleEngine::apply_damper_state`), and
    /// RT-safe: no allocation, no locking, one `exp` per block.
    pub fn advance_sustain_smoothing(&mut self, frames: usize, sample_rate: f32) {
        // `is_finite` is spelled out alongside the sign check rather than
        // folded into a negated comparison: a NaN rate fails `<= 0.0` as
        // readily as a good one, and would produce a NaN coefficient that the
        // smoother can never recover from.
        if self.cc_smoothing_ms <= 0.0
            || frames == 0
            || !sample_rate.is_finite()
            || sample_rate <= 0.0
        {
            self.smoothed_sustain = self.sustain_position;
            return;
        }
        let tau_frames = self.cc_smoothing_ms * 0.001 * sample_rate;
        let coefficient = (-(frames as f32) / tau_frames).exp();
        self.smoothed_sustain =
            self.sustain_position + (self.smoothed_sustain - self.sustain_position) * coefficient;
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
    ///
    /// # Fast-stomp artifact
    ///
    /// This reads `smoothed_sustain`; the engine's discrete "pedal engaged"
    /// decision in `note_off` reads the raw `sustain_position`. They are
    /// deliberately different clocks, and on a fast stomp they briefly
    /// disagree in a way that is audible.
    ///
    /// Stomp the pedal to the floor and release a key in the same instant: the
    /// raw gate says engaged, so the voice is classified pedal-sustained and
    /// keeps its key ownership immediately — but the dampers it is measured
    /// against are still most of the way down, and stay partly down for
    /// roughly five time constants. Measured: one block after a full stomp at
    /// `cc_smoothing_ms = 30`, `smoothed_sustain` is 0.085; at the 50 ms
    /// maximum the curve takes about 250 ms to settle. For that window the
    /// note is a sustained note being damped — it survives, quieter and duller
    /// than the pedal position suggests, then opens up.
    ///
    /// Nothing here is wrong. That window *is* the knob: smoothing the
    /// controller necessarily means the damper curve lags the controller, and
    /// the alternative — routing the discrete gate through the smoother too —
    /// would swallow note-offs for the same duration, which is worse. It is
    /// recorded because it is the one behaviour a player can hear and cannot
    /// find by reading the parameter's name, and because the fix for "my
    /// stomped pedal sounds soft for a moment" is to turn CC Smooth down, not
    /// to change this curve.
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
        let lifted = smoothstep(self.half_pedal_low, HALF_PEDAL_HIGH, self.smoothed_sustain);
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
        1.0 - smoothstep(self.half_pedal_low, HALF_PEDAL_HIGH, self.smoothed_sustain)
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

    #[test]
    fn calibrated_threshold_moves_where_the_dampers_start_to_lift() {
        // One pedal position, two calibrations. 0.30 sits above the reference
        // lift point and below a raised one, so the same physical pedal
        // travel reads as partly lifted or fully down depending on calibration.
        let mut pedals = PedalState::new();
        pedals.set_sustain(0.30);
        let at_reference = pedals.damper_bandwidth_for_key(40, false, false);

        pedals.set_half_pedal_low(0.45);
        let raised = pedals.damper_bandwidth_for_key(40, false, false);
        assert!(
            raised > at_reference,
            "raising the threshold past the pedal position must keep the \
             dampers down: raised={raised} at_reference={at_reference}"
        );

        pedals.set_half_pedal_low(0.0);
        let lowered = pedals.damper_bandwidth_for_key(40, false, false);
        assert!(
            lowered < at_reference,
            "lowering the threshold must lift the dampers earlier: \
             lowered={lowered} at_reference={at_reference}"
        );
    }

    #[test]
    fn calibrated_threshold_also_gates_the_sympathetic_bank() {
        // The sympathetic bank reads the same smoothstep, so a calibration
        // that lifts the dampers must open sympathetic resonance with them.
        let mut pedals = PedalState::new();
        pedals.set_sustain(0.30);
        let at_reference = pedals.sympathetic_damping();

        pedals.set_half_pedal_low(0.0);
        assert!(
            pedals.sympathetic_damping() < at_reference,
            "lowering the threshold must undamp the sympathetic bank too: \
             {} vs {at_reference}",
            pedals.sympathetic_damping()
        );
    }

    /// Damper bandwidth one 128-frame block (2.67 ms at 48 kHz) after the
    /// pedal is slammed from the floor to fully up, at a given smoothing.
    fn bandwidth_one_block_after_pedal_release(cc_smoothing_ms: f32) -> f32 {
        let mut pedals = PedalState::new();
        pedals.set_cc_smoothing_ms(cc_smoothing_ms);
        pedals.set_sustain(1.0);
        // Settle first — ten time constants at the 50 ms maximum — so both
        // runs release from the same fully-down pedal and the measurement is
        // of the release alone, not of how far each one got on the way down.
        for _ in 0..200 {
            pedals.advance_sustain_smoothing(128, 48_000.0);
        }
        pedals.set_sustain(0.0);
        pedals.advance_sustain_smoothing(128, 48_000.0);
        pedals.damper_bandwidth_for_key(40, false, false)
    }

    #[test]
    fn cc_smoothing_slews_the_damper_curve_instead_of_stepping_it() {
        // Two calibrated smoothing times, neither of them the engine default
        // of 0: 5 ms is most of the way through one block, 50 ms has barely
        // started, so the same pedal gesture lands the dampers at different
        // depths one block later.
        let quick = bandwidth_one_block_after_pedal_release(5.0);
        let slow = bandwidth_one_block_after_pedal_release(50.0);

        assert!(
            quick > slow,
            "a shorter smoothing time must bring the dampers down sooner: \
             quick={quick} slow={slow}"
        );
    }

    #[test]
    fn zero_smoothing_restores_the_stepped_response() {
        // The disable path: at 0 ms the damper curve reads the raw controller
        // value with no block of latency at all.
        let mut pedals = PedalState::new();
        pedals.set_cc_smoothing_ms(0.0);
        pedals.set_sustain(1.0);
        assert_eq!(pedals.smoothed_sustain_position(), 1.0);
        assert_eq!(pedals.damper_bandwidth_for_key(40, false, false), 0.0);
    }

    #[test]
    fn cc_smoothing_converges_on_the_controller_value() {
        // Smoothing may lag the pedal; it may not park somewhere else. 200
        // blocks is ~533 ms, ten time constants at the 50 ms maximum.
        let mut pedals = PedalState::new();
        pedals.set_cc_smoothing_ms(MAX_CC_SMOOTHING_MS);
        pedals.set_sustain(0.75);
        for _ in 0..200 {
            pedals.advance_sustain_smoothing(128, 48_000.0);
        }
        assert!(
            (pedals.smoothed_sustain_position() - 0.75).abs() < 1.0e-4,
            "smoothed position never reached the pedal: {}",
            pedals.smoothed_sustain_position()
        );
    }

    #[test]
    fn cc_smoothing_is_clamped_to_the_published_range() {
        let mut pedals = PedalState::new();
        assert_eq!(pedals.cc_smoothing_ms(), 0.0);

        pedals.set_cc_smoothing_ms(-3.0);
        assert_eq!(pedals.cc_smoothing_ms(), 0.0);

        pedals.set_cc_smoothing_ms(999.0);
        assert_eq!(pedals.cc_smoothing_ms(), MAX_CC_SMOOTHING_MS);
    }

    #[test]
    fn smoothing_never_delays_the_discrete_pedal_engaged_decision() {
        // `GrandBouleEngine` decides note-off catching on `sustain_position`.
        // Smoothing is a damper-curve concern only — routing the discrete
        // decision through it too would make a heavily smoothed pedal swallow
        // note-offs for tens of milliseconds after it was lifted.
        let mut pedals = PedalState::new();
        pedals.set_cc_smoothing_ms(MAX_CC_SMOOTHING_MS);
        pedals.set_sustain(1.0);

        assert_eq!(pedals.sustain_position(), 1.0);
        assert!(pedals.smoothed_sustain_position() < 1.0);
    }

    /// Settle the smoother, feed one bad value, render a block with it, then
    /// hand the controller back a good value (0.2). Returns the smoothed
    /// position after 50 more blocks — the reviewer's observation point — and
    /// after 250, by which point 30 ms of smoothing has had ~22 time constants
    /// to arrive.
    fn smoothed_after_recovery(bad: f32) -> (f32, f32) {
        let mut pedals = PedalState::new();
        pedals.set_cc_smoothing_ms(30.0);
        pedals.set_sustain(0.8);
        for _ in 0..50 {
            pedals.advance_sustain_smoothing(128, 48_000.0);
        }

        pedals.set_sustain(bad);
        pedals.advance_sustain_smoothing(128, 48_000.0);

        // The controller sends a perfectly good value again.
        pedals.set_sustain(0.2);
        for _ in 0..50 {
            pedals.advance_sustain_smoothing(128, 48_000.0);
        }
        let at_50 = pedals.smoothed_sustain_position();

        for _ in 0..200 {
            pedals.advance_sustain_smoothing(128, 48_000.0);
        }
        (at_50, pedals.smoothed_sustain_position())
    }

    #[test]
    fn a_non_finite_pedal_position_cannot_poison_the_smoother() {
        // `f32::clamp` passes NaN through, and with smoothing enabled a NaN
        // that reaches `smoothed_sustain` is permanent: the snap back to the
        // raw controller value only fires at 0 ms, so every later block
        // recomputes NaN from NaN. Measured without the guard: NaN, still,
        // 50 valid blocks later.
        let (at_50, settled) = smoothed_after_recovery(f32::NAN);

        assert!(
            at_50.is_finite(),
            "one non-finite pedal value poisoned the smoother permanently: {at_50}"
        );
        assert!(
            (settled - 0.2).abs() < 1.0e-4,
            "the smoother did not converge on the pedal after recovering: {settled}"
        );
    }

    #[test]
    fn an_infinite_pedal_position_is_rejected_rather_than_read_as_fully_down() {
        // Infinity does not poison anything — it clamps — so the smoother
        // recovers from it either way and asserting that proves nothing. The
        // claim worth making is what the clamp *does* with it: silently
        // reading a garbage message as "pedal slammed to the floor" is a
        // behaviour, and not one anybody asked for. The guard is `is_finite`
        // rather than `is_nan` precisely so the pedal stays where the player
        // last put it.
        let mut pedals = PedalState::new();
        pedals.set_sustain(0.8);

        pedals.set_sustain(f32::INFINITY);

        assert_eq!(pedals.sustain_position(), 0.8);
    }

    #[test]
    fn a_non_finite_smoothing_time_cannot_poison_the_damper_curve() {
        // NaN survives the clamp and then fails the `<= 0.0` disable check, so
        // the smoother runs with a NaN time constant.
        let mut pedals = PedalState::new();
        pedals.set_cc_smoothing_ms(f32::NAN);
        pedals.set_sustain(0.6);
        pedals.advance_sustain_smoothing(128, 48_000.0);

        assert!(
            pedals.cc_smoothing_ms().is_finite(),
            "a non-finite smoothing time was stored: {}",
            pedals.cc_smoothing_ms()
        );
        assert!(
            pedals
                .damper_bandwidth_for_key(40, false, false)
                .is_finite(),
            "the damper curve went non-finite: {}",
            pedals.damper_bandwidth_for_key(40, false, false)
        );
    }

    #[test]
    fn a_non_finite_threshold_cannot_poison_the_damper_curve() {
        // A NaN lower edge makes `smoothstep` return NaN for every key.
        let mut pedals = PedalState::new();
        pedals.set_half_pedal_low(f32::NAN);
        pedals.set_sustain(0.6);

        assert_eq!(pedals.half_pedal_low(), DEFAULT_HALF_PEDAL_LOW);
        assert!(
            pedals
                .damper_bandwidth_for_key(40, false, false)
                .is_finite(),
            "the damper curve went non-finite: {}",
            pedals.damper_bandwidth_for_key(40, false, false)
        );
        assert!(
            pedals.sympathetic_damping().is_finite(),
            "the sympathetic bank went non-finite: {}",
            pedals.sympathetic_damping()
        );
    }

    #[test]
    fn a_non_finite_sample_rate_falls_back_to_no_smoothing() {
        let mut pedals = PedalState::new();
        pedals.set_cc_smoothing_ms(30.0);
        pedals.set_sustain(0.6);
        pedals.advance_sustain_smoothing(128, f32::NAN);

        assert_eq!(pedals.smoothed_sustain_position(), 0.6);
    }

    #[test]
    fn calibrated_threshold_is_clamped_to_the_published_range() {
        let mut pedals = PedalState::new();
        assert_eq!(pedals.half_pedal_low(), DEFAULT_HALF_PEDAL_LOW);

        pedals.set_half_pedal_low(-1.0);
        assert_eq!(pedals.half_pedal_low(), 0.0);

        pedals.set_half_pedal_low(9.0);
        assert_eq!(pedals.half_pedal_low(), MAX_HALF_PEDAL_LOW);
    }
}
