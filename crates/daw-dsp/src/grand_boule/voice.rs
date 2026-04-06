//! A single piano voice = one hammer + one coupled-string assembly + a
//! release envelope.
//!
//! The voice is allocation-free after construction. `note_on` resets state and
//! configures the coupled-string assembly; `process` runs the hammer at an
//! oversampled rate and drives every active unison through their bridge.

use super::coupled_strings::CoupledStringAssembly;
use super::duplex::DuplexBank;
use super::hammer::{HammerParams, HammerState};
use super::longitudinal::LongitudinalBank;
use super::parameters::{
    hammer_exponent_p, hammer_mass_kg, hammer_stiffness_k, hammer_strike_ratio, key_fundamental_hz,
};

/// Hammer oversampling factor — 4× keeps the Störmer-Verlet integrator stable
/// for top-octave keys without being too expensive.
const HAMMER_OVERSAMPLE: usize = 4;

/// Coarse voice lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceStage {
    Idle,
    Active,
    Releasing,
    /// A ~1 ms fast fade-out applied when the voice is stolen (§4.2).
    Stealing,
}

/// Voice rendering quality. Drives progressive simplification (§4.1).
/// * `High` — Stulov hysteresis hammer + full modal bank.
/// * `Standard` — power-law hammer + full modal bank.
/// * `Simplified` — power-law hammer + half-partials modal bank (cheapest).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceQuality {
    High,
    Standard,
    Simplified,
}

#[derive(Debug, Clone)]
pub struct PianoVoice {
    stage: VoiceStage,
    midi_note: u8,
    velocity: f32,
    age_samples: u64,
    hammer: HammerState,
    hammer_params: HammerParams,
    strings: CoupledStringAssembly,
    longitudinal: LongitudinalBank,
    duplex: DuplexBank,
    fundamental_hz: f32,
    key: u32,
    base_bandwidth: f32,
    extra_damping_hz: f32,
    attack_key: u32,
    attack_position: u32,
    attack_length: u32,
    /// Output gain. On note-off we ramp this down to zero over ~150 ms.
    amplitude: f32,
    /// Per-sample multiplier applied during the release phase.
    release_coefficient: f32,
    sample_rate: f32,
    quality: VoiceQuality,
}

impl PianoVoice {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            stage: VoiceStage::Idle,
            midi_note: 0,
            velocity: 0.0,
            age_samples: 0,
            hammer: HammerState::idle(),
            hammer_params: HammerParams {
                stiffness_k: 0.0,
                exponent_p: 2.0,
                mass_kg: 0.01,
                hysteresis_epsilon: 0.0,
                hysteresis_alpha: 0.0,
            },
            strings: CoupledStringAssembly::new(),
            longitudinal: LongitudinalBank::new(),
            duplex: DuplexBank::new(),
            fundamental_hz: 0.0,
            key: 1,
            base_bandwidth: 0.0,
            extra_damping_hz: 0.0,
            attack_key: 0,
            attack_position: 0,
            attack_length: 0,
            amplitude: 1.0,
            release_coefficient: 1.0,
            sample_rate,
            quality: VoiceQuality::Standard,
        }
    }

    /// Get the current quality tier.
    pub fn quality(&self) -> VoiceQuality {
        self.quality
    }

    /// Override the quality tier. May be called at any time; takes effect on
    /// the next `tick`.
    pub fn set_quality(&mut self, quality: VoiceQuality) {
        self.quality = quality;
    }

    pub fn stage(&self) -> VoiceStage {
        self.stage
    }

    pub fn midi_note(&self) -> u8 {
        self.midi_note
    }

    pub fn age_samples(&self) -> u64 {
        self.age_samples
    }

    pub fn is_idle(&self) -> bool {
        self.stage == VoiceStage::Idle
    }

    pub fn amplitude(&self) -> f32 {
        self.amplitude
    }

    /// Attempt to arm the hybrid sampled-attack playhead for this voice.
    /// `clip_length` in samples; a length of 0 disables sampled attack.
    pub fn arm_attack(&mut self, key: u32, clip_length: usize) {
        self.attack_key = key;
        self.attack_position = 0;
        self.attack_length = clip_length.min(u32::MAX as usize) as u32;
    }

    /// Current sampled-attack playhead state: (key, position, length).
    /// Returns `None` if no clip is loaded / playback has finished.
    pub fn attack_playhead(&self) -> Option<(u32, u32, u32)> {
        if self.attack_length == 0 || self.attack_position >= self.attack_length {
            return None;
        }
        Some((self.attack_key, self.attack_position, self.attack_length))
    }

    /// Advance the attack playhead by one sample. Called by the engine
    /// after it has read the sample for the current frame.
    #[inline]
    pub fn advance_attack(&mut self) {
        if self.attack_length > 0 && self.attack_position < self.attack_length {
            self.attack_position += 1;
        }
    }

    /// Fade this voice out over ~1 ms. Used by the voice-stealing path so
    /// the incoming note can claim the slot once the tail finishes (§4.2).
    pub fn begin_steal(&mut self) {
        if self.stage == VoiceStage::Idle || self.stage == VoiceStage::Stealing {
            return;
        }
        self.stage = VoiceStage::Stealing;
        let steal_seconds = 0.001_f32;
        self.release_coefficient = (-1.0 / (steal_seconds * self.sample_rate)).exp();
    }

    /// Voice-stealing score per spec §4.2. Higher score = better victim.
    /// Caller is responsible for protecting the very top and very bottom
    /// notes before comparing scores.
    pub fn steal_score(&self) -> f32 {
        match self.stage {
            VoiceStage::Idle => 1000.0,
            VoiceStage::Stealing => 500.0,
            VoiceStage::Releasing => {
                // Older released voices are more eligible. `age_samples` is
                // capped at ~24 hours' worth of samples at 96kHz inside f32
                // representation — divide by sample_rate for seconds.
                let age_seconds = self.age_samples as f32 / self.sample_rate.max(1.0);
                400.0 - age_seconds.min(200.0)
            }
            VoiceStage::Active => {
                // Loud active voices are hardest to steal; quiet ones go first.
                200.0 - 200.0 * self.amplitude.clamp(0.0, 1.0)
            }
        }
    }

    /// Assign this voice to a new note.
    ///
    /// `pitch_ratio` scales the fundamental (1.0 = standard Railsback
    /// tuning, `2^(cents/1200)` for microtuning offsets).
    /// `stiffness_scale` multiplies the hammer stiffness (una-corda pedal).
    pub fn note_on(
        &mut self,
        midi_note: u8,
        velocity: f32,
        key: u32,
        pitch_ratio: f32,
        stiffness_scale: f32,
    ) {
        self.midi_note = midi_note;
        self.velocity = velocity.clamp(0.0, 1.0);
        self.age_samples = 0;
        self.amplitude = 1.0;
        self.release_coefficient = 1.0;
        self.stage = VoiceStage::Active;

        let fundamental = key_fundamental_hz(key) * pitch_ratio;
        let strike_ratio = hammer_strike_ratio(key);

        // Stulov hysteresis strength grows mildly with key — felt gets stiffer
        // and more lossy on short treble hammers. 0 at bass end, ~0.004 at C8.
        let epsilon = if self.quality == VoiceQuality::High {
            0.002 + 0.00002 * (key as f32 - 1.0)
        } else {
            0.0
        };
        self.hammer_params = HammerParams {
            stiffness_k: hammer_stiffness_k(key) * stiffness_scale,
            exponent_p: hammer_exponent_p(key),
            mass_kg: hammer_mass_kg(key),
            hysteresis_epsilon: epsilon,
            hysteresis_alpha: 0.9,
        };

        // Base partial bandwidth controls the T60 of the note. Bass notes are
        // narrower (longer decay); treble notes wider. The interpolation is
        // deliberately gentle — the frequency-dependent term inside the bank
        // already provides most of the per-partial variation.
        let base_bandwidth = 0.25 + 0.0015 * fundamental;
        self.attack_key = 0;
        self.attack_position = 0;
        self.attack_length = 0;
        self.fundamental_hz = fundamental;
        self.key = key;
        self.base_bandwidth = base_bandwidth;
        self.extra_damping_hz = 0.0;
        self.strings.configure(
            fundamental,
            key,
            strike_ratio,
            self.sample_rate,
            base_bandwidth,
            self.extra_damping_hz,
        );
        self.strings.reset();
        self.longitudinal.configure(key, self.sample_rate);
        self.longitudinal.reset();
        self.duplex.configure(key, self.sample_rate);
        self.duplex.reset();

        // Strike velocity scales with MIDI velocity. A velocity of 1.0 maps to
        // ~4 m/s, matching measurements from Askenfelt/Jansson.
        self.hammer.strike(0.8 + 4.0 * self.velocity);
    }

    /// Begin the release phase. The voice keeps ringing but its amplitude
    /// decays exponentially toward zero.
    pub fn note_off(&mut self) {
        if self.stage == VoiceStage::Idle {
            return;
        }
        self.stage = VoiceStage::Releasing;
        // ~150 ms release tail (damper mute approximation).
        let release_seconds = 0.15_f32;
        self.release_coefficient = (-1.0 / (release_seconds * self.sample_rate)).exp();
    }

    /// Force the voice back to idle immediately.
    pub fn kill(&mut self) {
        self.stage = VoiceStage::Idle;
        self.amplitude = 0.0;
        self.age_samples = 0;
        self.hammer = HammerState::idle();
        self.strings.reset();
        self.longitudinal.reset();
        self.duplex.reset();
    }

    /// Update the extra damping applied uniformly to all strings (used by
    /// damper and una-corda pedal handling). Takes effect on the next sample.
    pub fn set_extra_damping(&mut self, extra_damping_hz: f32) {
        if (extra_damping_hz - self.extra_damping_hz).abs() < 1.0e-3 {
            return;
        }
        self.extra_damping_hz = extra_damping_hz;
        self.strings.reset_decay(
            self.fundamental_hz,
            self.key,
            self.sample_rate,
            self.base_bandwidth,
            extra_damping_hz,
        );
    }

    /// Render one output sample from this voice.
    #[inline]
    pub fn tick(&mut self) -> f32 {
        if self.stage == VoiceStage::Idle {
            return 0.0;
        }

        let dt = 1.0 / (self.sample_rate * HAMMER_OVERSAMPLE as f32);
        let mut output = 0.0_f32;

        // Four oversampled hammer ticks per output sample. Only the last
        // hammer force is fed into the modal string — the intermediate steps
        // exist to keep the integrator stable. (For the minimal slice this is
        // accurate enough; a future revision can accumulate the substeps.)
        let mut force = 0.0_f32;
        match self.quality {
            VoiceQuality::High => {
                for _ in 0..HAMMER_OVERSAMPLE {
                    force = self.hammer.tick_hysteresis(0.0, dt, &self.hammer_params);
                }
            }
            VoiceQuality::Standard | VoiceQuality::Simplified => {
                for _ in 0..HAMMER_OVERSAMPLE {
                    force = self.hammer.tick(0.0, dt, &self.hammer_params);
                }
            }
        }

        let transverse = match self.quality {
            VoiceQuality::Simplified => self.strings.tick_simplified(force),
            _ => self.strings.tick(force),
        };
        // Longitudinal (phantom) partials driven by squared transverse
        // amplitude; duplex resonance driven by the bridge signal.
        let longitudinal = if self.quality == VoiceQuality::Simplified {
            0.0
        } else {
            self.longitudinal.tick(transverse)
        };
        let duplex = self.duplex.tick(transverse);
        output += transverse + longitudinal + duplex;
        output *= self.amplitude;

        if self.stage == VoiceStage::Releasing || self.stage == VoiceStage::Stealing {
            self.amplitude *= self.release_coefficient;
            if self.amplitude < 1.0e-5 {
                self.kill();
                return 0.0;
            }
        }

        // Progressive simplification (§4.1): as the voice ages and quiets
        // down, downgrade it through the quality tiers. The thresholds are
        // loose enough to be inaudible on a normal listening level.
        if self.quality == VoiceQuality::High && self.amplitude < 0.3 {
            self.quality = VoiceQuality::Standard;
        }
        if self.quality == VoiceQuality::Standard && self.amplitude < 0.05 {
            self.quality = VoiceQuality::Simplified;
        }

        self.age_samples = self.age_samples.saturating_add(1);
        output
    }
}
