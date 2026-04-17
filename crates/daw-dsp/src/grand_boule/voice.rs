//! A single piano voice = one hammer + one coupled-string assembly + a
//! release envelope.
//!
//! The voice is allocation-free after construction. `note_on` resets state and
//! configures the coupled-string assembly; `process` runs the hammer at an
//! oversampled rate and drives every active unison through their bridge.

use super::coupled_strings::CoupledStringAssembly;
use super::duplex::DuplexBank;
use super::hammer::{contact_lowpass_alpha, HammerParams, HammerState};
use super::longitudinal::LongitudinalBank;
use super::parameters::{
    hammer_exponent_p, hammer_mass_kg, hammer_stiffness_k, hammer_strike_ratio, key_fundamental_hz,
};

/// Hammer oversampling factor — 4× keeps the Störmer-Verlet integrator stable
/// for top-octave keys without being too expensive.
const HAMMER_OVERSAMPLE: usize = 4;

/// Scales the hammer's Newton-force output into the normalised signal range
/// expected by the modal string bank. The modal resonators use narrow-bandwidth
/// biquads with small C0, so a forte hammer pulse (~50–100 N peak) produces
/// only ~0.005 signal amplitude without this boost. The factor is chosen so
/// that a fortissimo hit (velocity = 1.0) peaks around 0.4–0.6 before master
/// gain, leaving headroom for multi-note chords.
const FORCE_NORMALIZATION: f32 = 80.0;

/// Converts normalised modal-bank output back to approximate physical string
/// displacement (metres) for the hammer feedback loop. During the ~2 ms hammer
/// contact, the modal bank accumulates to signal amplitudes of order 1–10.
/// Multiplied by this scale, the feedback displacement must stay well below the
/// peak hammer compression (~2–4 mm) to avoid positive-feedback runaway.
/// 5×10⁻⁵ yields ~0.1–0.5 mm feedback at forte — enough for audible
/// velocity-dependent cushioning without destabilising the loop.
const FEEDBACK_SCALE: f32 = 5.0e-5;

/// Maximum physical string displacement (metres) fed back to the hammer.
/// Piano strings never exceed ~3 mm at the strike point. Clamping here
/// prevents numerical runaway even if the modal bank briefly overshoots.
const MAX_STRING_DISPLACEMENT: f32 = 0.003;

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
    /// Last string output — fed back to the hammer for closed-loop interaction.
    last_string_displacement: f32,
    fundamental_hz: f32,
    /// Steady-state fundamental, after the pitch-glide settles. The voice
    /// is configured at a slightly higher frequency on attack and retuned
    /// down to this value once the glide countdown expires (§A5.2).
    nominal_fundamental_hz: f32,
    /// Samples remaining until the pitch-glide retune fires. Zero ⇒ done.
    pitch_glide_samples_remaining: u32,
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
                stulov_a: 0.0,
                contact_lp_alpha: 0.0,
            },
            strings: CoupledStringAssembly::new(),
            longitudinal: LongitudinalBank::new(),
            duplex: DuplexBank::new(),
            last_string_displacement: 0.0,
            fundamental_hz: 0.0,
            nominal_fundamental_hz: 0.0,
            pitch_glide_samples_remaining: 0,
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
                400.0 + age_seconds.min(200.0)
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
    /// `stiffness_scale` multiplies the hammer stiffness (pedal + preset + model).
    /// `mass_scale` multiplies the hammer mass (piano model).
    pub fn note_on(
        &mut self,
        midi_note: u8,
        velocity: f32,
        key: u32,
        pitch_ratio: f32,
        stiffness_scale: f32,
        mass_scale: f32,
    ) {
        self.midi_note = midi_note;
        self.velocity = velocity.clamp(0.0, 1.0);
        self.age_samples = 0;
        self.amplitude = 1.0;
        self.release_coefficient = 1.0;
        self.last_string_displacement = 0.0;
        self.stage = VoiceStage::Active;

        let nominal_fundamental = key_fundamental_hz(key) * pitch_ratio;
        let strike_ratio = hammer_strike_ratio(key);

        // Pitch glide from tension modulation (§A5.2). Large-amplitude
        // transverse vibration raises mean tension, sharping the partials
        // by a few cents on attack; the offset decays with τ ≈ 100 ms as
        // energy bleeds out. We approximate this with a one-shot retune:
        // configure at the sharp frequency, then drop back to nominal after
        // a short countdown. Bass strings are affected most.
        let glide_strength_v = self.velocity * self.velocity;
        let bass_weight = 1.0 - ((key as f32 - 1.0) / 87.0).clamp(0.0, 1.0);
        let glide_cents = 5.0 * glide_strength_v * (0.4 + 0.6 * bass_weight);
        let glide_ratio = (2.0_f32).powf(glide_cents / 1200.0);
        let fundamental = nominal_fundamental * glide_ratio;
        // ~80 ms hold then snap back. The countdown lives in the audio
        // thread but only triggers a single biquad re-tune when it expires.
        self.pitch_glide_samples_remaining = if glide_cents > 0.05 {
            (0.080 * self.sample_rate) as u32
        } else {
            0
        };

        // Stulov asymmetry coefficient `a`. Stulov (2005) reports a ≈ 310 µs
        // for note 49; the felt becomes stiffer and slightly more lossy on
        // short treble hammers. We linearly interpolate around the published
        // anchor and disable it on the cheaper quality tiers.
        let stulov_a = if self.quality == VoiceQuality::High {
            (0.000_25 + 0.000_002 * (key as f32 - 49.0)).max(0.0)
        } else {
            0.0
        };

        // Velocity-dependent contact lowpass (§A2.4 — the #1 perceptual
        // priority per the realism appendix). The min/max cutoff is set per
        // register from Russell & Rossing (1998) anchor data:
        //   bass  v=1 m/s ⇒ ~200 Hz, v=5 m/s ⇒ ~500 Hz
        //   treble v=1 m/s ⇒ ~2 kHz, v=5 m/s ⇒ ~6 kHz
        let key_norm = ((key as f32 - 1.0) / 87.0).clamp(0.0, 1.0);
        let f_min = 200.0 + (2_000.0 - 200.0) * key_norm;
        let f_max = 500.0 + (6_000.0 - 500.0) * key_norm;
        // Map MIDI velocity (0..1) to a strike speed (m/s). Hammer speed at
        // forte is about 5 m/s — same as `strike()` below.
        let strike_speed = 0.8 + 4.0 * self.velocity;
        let contact_lp_alpha =
            contact_lowpass_alpha(strike_speed, f_min, f_max, 0.6, self.sample_rate);

        self.hammer_params = HammerParams {
            stiffness_k: hammer_stiffness_k(key) * stiffness_scale,
            exponent_p: hammer_exponent_p(key),
            mass_kg: hammer_mass_kg(key) * mass_scale,
            stulov_a,
            contact_lp_alpha,
        };

        // Base partial bandwidth controls the T60 of the note (intrinsic
        // string damping σ_string). The formula produces ~0.06 Hz for bass
        // (T60 ≈ 23 s) ramping to ~0.9 Hz for treble (T60 ≈ 2.4 s). The
        // bridge coupling constant SIGMA_BRIDGE_HZ (4 Hz) in CoupledStringAssembly
        // separately drives the fast prompt-sound decay; this value only governs
        // the slow aftersound tail.
        let base_bandwidth = 0.05 + 0.0002 * fundamental;
        self.attack_key = 0;
        self.attack_position = 0;
        self.attack_length = 0;
        self.fundamental_hz = fundamental;
        self.nominal_fundamental_hz = nominal_fundamental;
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
        // ~300 ms release tail — realistic felt-damper mute time for a grand
        // piano (150 ms was too fast, giving a harpsichord-like cut-off).
        let release_seconds = 0.30_f32;
        self.release_coefficient = (-1.0 / (release_seconds * self.sample_rate)).exp();
    }

    /// Force the voice back to idle immediately.
    pub fn kill(&mut self) {
        self.stage = VoiceStage::Idle;
        self.amplitude = 0.0;
        self.age_samples = 0;
        self.last_string_displacement = 0.0;
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

        // One-shot pitch-glide retune (§A5.2). The voice was configured at
        // a sharped fundamental on attack; once the countdown expires we
        // re-tune the resonator decay coefficients to the nominal frequency
        // to model the tension settling back as energy radiates away. Only
        // c1/c2 are touched — we accept the small residual amplitude error
        // in c0 in exchange for cheap re-tuning.
        if self.pitch_glide_samples_remaining > 0 {
            self.pitch_glide_samples_remaining -= 1;
            if self.pitch_glide_samples_remaining == 0 {
                self.fundamental_hz = self.nominal_fundamental_hz;
                self.strings.reset_decay(
                    self.fundamental_hz,
                    self.key,
                    self.sample_rate,
                    self.base_bandwidth,
                    self.extra_damping_hz,
                );
            }
        }

        let dt = 1.0 / (self.sample_rate * HAMMER_OVERSAMPLE as f32);
        let mut output = 0.0_f32;

        // Closed-loop hammer-string interaction with impedance-matched feedback.
        // The modal bank output (normalised signal) is scaled by FEEDBACK_SCALE
        // to approximate physical string displacement in metres. This gives the
        // hammer a realistic view of the string moving away during contact,
        // which:
        //   - Broadens the force pulse at high velocity (cushioning)
        //   - Creates velocity-dependent timbre (the #1 perceptual priority)
        //   - Produces a more natural, less "plucky" attack
        //
        // The oversampled sub-steps are averaged so the string sees the
        // integrated impulse rather than a single force snapshot.
        let disp = (self.last_string_displacement * FEEDBACK_SCALE)
            .clamp(-MAX_STRING_DISPLACEMENT, MAX_STRING_DISPLACEMENT);
        let mut force_sum = 0.0_f32;
        match self.quality {
            VoiceQuality::High => {
                for _ in 0..HAMMER_OVERSAMPLE {
                    force_sum += self.hammer.tick_stulov(disp, dt, &self.hammer_params);
                }
            }
            VoiceQuality::Standard | VoiceQuality::Simplified => {
                for _ in 0..HAMMER_OVERSAMPLE {
                    force_sum += self.hammer.tick(disp, dt, &self.hammer_params);
                }
            }
        }
        let force = force_sum / HAMMER_OVERSAMPLE as f32 * FORCE_NORMALIZATION;

        let transverse = match self.quality {
            VoiceQuality::Simplified => self.strings.tick_simplified(force),
            _ => self.strings.tick(force),
        };
        self.last_string_displacement = transverse;

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
