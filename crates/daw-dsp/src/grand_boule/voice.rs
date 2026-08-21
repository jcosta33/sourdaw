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
use crate::primitives::flush_denormal;

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
const STEAL_FADE_SECONDS: f32 = 0.001;
const STEAL_SILENCE_GAIN: f32 = 1.0e-5;

/// Time constant of the rectified-output follower that drives progressive
/// simplification. Long compared with the period of the lowest piano
/// fundamental (A0 ≈ 27.5 Hz, 36 ms) so the follower reads the note's decay
/// rather than its waveform, and short enough that a voice which has actually
/// quietened is downgraded promptly. One multiply-add per sample.
const DECAY_FOLLOWER_SECONDS: f32 = 0.050;

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

#[derive(Debug, Clone, Copy)]
pub struct PianoVoiceStart {
    pub midi_note: u8,
    pub channel: u8,
    pub velocity: f32,
    pub key: u32,
    pub pitch_ratio: f32,
    pub stiffness_scale: f32,
    pub mass_scale: f32,
    pub attack_length: usize,
}

#[derive(Debug, Clone)]
pub struct PianoVoice {
    stage: VoiceStage,
    midi_note: u8,
    /// MIDI channel this voice was struck on. With `midi_note` and
    /// `held` this is the per-note expression address (audit MD-2):
    /// under MPE each note owns its own member channel, so two voices
    /// at one pitch are told apart by it.
    channel: u8,
    /// True only while the physical key remains down. Sustain and sostenuto
    /// may keep a key-up voice sounding without retaining per-note expression
    /// ownership.
    held: bool,
    /// Latched only for this exact voice when sostenuto engages. A later voice
    /// at the same pitch must not inherit the capture.
    sostenuto_captured: bool,
    /// Per-note pitch bend as a frequency ratio; 1.0 is neutral.
    expr_bend_ratio: f32,
    /// Ratio the resonator coefficients were last tuned to, so the
    /// retune runs only when the bend actually moves.
    expr_bend_tuned: f32,
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
    /// Smoothed rectified output level. Unlike `amplitude`, which is pinned at
    /// 1.0 for the whole `Active` stage, this follows the note's real acoustic
    /// decay, so the progressive-simplification thresholds can see a held note
    /// quieten.
    decay_envelope: f32,
    /// Largest value `decay_envelope` reached since the strike. The thresholds
    /// are relative to it, which keeps them a fraction of the note's own
    /// loudness exactly as they were a fraction of the initial `amplitude`.
    decay_peak: f32,
    /// One-pole coefficient for `decay_envelope`, derived once from the sample
    /// rate.
    decay_follower_coefficient: f32,
    sample_rate: f32,
    configured_quality: VoiceQuality,
    quality: VoiceQuality,
}

impl PianoVoice {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            stage: VoiceStage::Idle,
            channel: 0,
            held: false,
            sostenuto_captured: false,
            expr_bend_ratio: 1.0,
            expr_bend_tuned: 1.0,
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
            decay_envelope: 0.0,
            decay_peak: 0.0,
            decay_follower_coefficient: 1.0
                - (-1.0 / (DECAY_FOLLOWER_SECONDS * sample_rate.max(1.0))).exp(),
            sample_rate,
            configured_quality: VoiceQuality::Standard,
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
        self.configured_quality = quality;
        self.quality = quality;
    }

    /// Record a new configured tier without touching the live one. Sounding
    /// voices keep the model they were struck with — swapping the physics
    /// mid-note discontinues the string state audibly — and pick up the new
    /// tier on their next strike, when `note_on` copies configured to live.
    pub fn set_configured_quality(&mut self, quality: VoiceQuality) {
        self.configured_quality = quality;
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

    /// Fade this displaced voice to silence over one millisecond.
    ///
    /// The engine moves the voice into a preallocated tail slot before calling
    /// this method, so the replacement can start immediately without resetting
    /// the outgoing resonators or doing note initialization in the sample loop.
    pub fn begin_steal(&mut self) {
        if self.stage == VoiceStage::Idle {
            return;
        }
        self.held = false;
        self.sostenuto_captured = false;
        self.stage = VoiceStage::Stealing;
        let fade_samples = (STEAL_FADE_SECONDS * self.sample_rate).round().max(1.0);
        self.release_coefficient = STEAL_SILENCE_GAIN.powf(1.0 / fade_samples);
    }

    /// Voice-stealing priority per spec §4.2. Higher tuples are better
    /// victims. The first field ranks lifecycle and key ownership; the second
    /// chooses the oldest voice within that class without converting the
    /// sample clock to an imprecise loudness proxy.
    pub fn steal_priority(&self) -> (u8, u64) {
        let class = match self.stage {
            VoiceStage::Idle => 4,
            VoiceStage::Releasing => 3,
            VoiceStage::Active if !self.held => 2,
            VoiceStage::Active => 1,
            VoiceStage::Stealing => 0,
        };
        (class, self.age_samples)
    }

    /// Assign this voice to a new note.
    ///
    /// `pitch_ratio` scales the fundamental (1.0 = standard Railsback
    /// tuning, `2^(cents/1200)` for microtuning offsets).
    /// `stiffness_scale` multiplies the hammer stiffness (pedal + preset + model).
    /// `mass_scale` multiplies the hammer mass (piano model).
    pub fn note_on(&mut self, start: PianoVoiceStart) {
        let PianoVoiceStart {
            midi_note,
            channel,
            velocity,
            key,
            pitch_ratio,
            stiffness_scale,
            mass_scale,
            attack_length,
        } = start;
        self.midi_note = midi_note;
        self.channel = channel;
        self.held = true;
        self.sostenuto_captured = false;
        // A fresh strike starts from neutral bend; the controller's
        // opening bend arrives as its own expression message.
        self.expr_bend_ratio = 1.0;
        self.expr_bend_tuned = 1.0;
        self.velocity = velocity.clamp(0.0, 1.0);
        self.age_samples = 0;
        self.amplitude = 1.0;
        self.release_coefficient = 1.0;
        self.decay_envelope = 0.0;
        self.decay_peak = 0.0;
        self.quality = self.configured_quality;
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
        self.arm_attack(key, attack_length);
    }

    /// Begin the release phase. The voice keeps ringing but its amplitude
    /// decays exponentially toward zero.
    pub fn note_off(&mut self) {
        if self.stage == VoiceStage::Idle {
            return;
        }
        self.release_key();
        self.stage = VoiceStage::Releasing;
        // ~300 ms release tail — realistic felt-damper mute time for a grand
        // piano (150 ms was too fast, giving a harpsichord-like cut-off).
        let release_seconds = 0.30_f32;
        self.release_coefficient = (-1.0 / (release_seconds * self.sample_rate)).exp();
    }

    /// End physical-key and per-note-expression ownership without damping the
    /// sounding voice. Pedal-held notes use this transition until the owning
    /// pedal later starts their acoustic release.
    pub fn release_key(&mut self) {
        if self.stage == VoiceStage::Idle {
            return;
        }
        self.held = false;
    }

    /// Latch this exact sounding voice on the sostenuto rising edge.
    pub fn capture_sostenuto(&mut self) {
        if self.stage != VoiceStage::Idle && self.held {
            self.sostenuto_captured = true;
        }
    }

    /// Clear this voice's sostenuto ownership and report whether it had been
    /// captured, so the engine can start the release when no other pedal owns it.
    pub fn release_sostenuto_capture(&mut self) -> bool {
        let was_captured = self.sostenuto_captured;
        self.sostenuto_captured = false;
        was_captured
    }

    pub fn is_sostenuto_captured(&self) -> bool {
        self.sostenuto_captured
    }

    /// Force the voice back to idle immediately.
    pub fn kill(&mut self) {
        self.stage = VoiceStage::Idle;
        self.held = false;
        self.sostenuto_captured = false;
        self.expr_bend_ratio = 1.0;
        self.expr_bend_tuned = 1.0;
        self.amplitude = 0.0;
        self.decay_envelope = 0.0;
        self.decay_peak = 0.0;
        self.age_samples = 0;
        self.attack_position = 0;
        self.attack_length = 0;
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
        self.retune_strings();
    }

    /// This voice's per-note expression address (audit MD-2).
    pub fn channel(&self) -> u8 {
        self.channel
    }

    /// True while the note is held — a ringing release tail is not.
    pub fn is_held(&self) -> bool {
        self.held
    }

    /// Current per-note bend as a frequency ratio; 1.0 is neutral.
    pub fn bend_ratio(&self) -> f32 {
        self.expr_bend_ratio
    }

    /// Set the per-note pitch bend in semitones. Takes effect on the
    /// next block via `apply_pending_bend`.
    pub fn set_expression_bend(&mut self, bend_semitones: f32) {
        self.expr_bend_ratio = (2.0_f32).powf(bend_semitones.clamp(-96.0, 96.0) / 12.0);
    }

    /// Retune the ringing strings to the current fundamental x bend.
    ///
    /// `reset_decay` rewrites c1/c2 only and never touches the biquad
    /// state (x1/x2/y1/y2), which only `reset()` clears — so the string
    /// rings straight through the retune. This is the same primitive the
    /// SS A5.2 pitch glide already uses mid-note.
    fn retune_strings(&mut self) {
        self.strings.reset_decay(
            self.fundamental_hz * self.expr_bend_ratio,
            self.key,
            self.sample_rate,
            self.base_bandwidth,
            self.extra_damping_hz,
        );
        self.expr_bend_tuned = self.expr_bend_ratio;
    }

    /// Block-rate hook: retune only when the bend moved since the last
    /// retune, so an unbent voice costs one comparison.
    ///
    /// Measured cost when it does run: ~3.2 us per voice (3 unisons x 2
    /// polarizations), i.e. ~3.8% of a 128-frame block at 48 kHz with all
    /// 32 voices bending — see
    /// `coupled_strings::tests::measure_block_rate_retune_cost`.
    pub fn apply_pending_bend(&mut self) {
        if self.stage == VoiceStage::Idle {
            return;
        }
        if (self.expr_bend_ratio - self.expr_bend_tuned).abs() < 1.0e-6 {
            return;
        }
        self.retune_strings();
    }

    #[cfg(test)]
    pub(crate) fn string_modal_coefficient_signature(&self) -> u64 {
        self.strings.modal_coefficient_signature()
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
                // Through `retune_strings` so the glide snap-back keeps
                // whatever per-note bend is currently applied.
                self.retune_strings();
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

        // Follow the voice's own output. `amplitude` is pinned at 1.0 for the
        // whole `Active` stage, so it says nothing about how loud a held note
        // still is; this follower does, and it keeps tracking through the
        // release ramp because `output` already carries `amplitude`.
        self.decay_envelope = flush_denormal(
            self.decay_envelope
                + self.decay_follower_coefficient * (output.abs() - self.decay_envelope),
        );
        if self.decay_envelope > self.decay_peak {
            self.decay_peak = self.decay_envelope;
        }

        if self.stage == VoiceStage::Releasing || self.stage == VoiceStage::Stealing {
            self.amplitude *= self.release_coefficient;
            if self.amplitude < STEAL_SILENCE_GAIN {
                self.kill();
                return 0.0;
            }
        }

        // Progressive simplification (§4.1): as the voice ages and quiets
        // down, downgrade it through the quality tiers.
        //
        // The first step reads the follower, as a fraction of this note's own
        // peak, so a long held note that has genuinely quietened gives up the
        // Stulov hammer. That hammer only shapes the ~2 ms of felt contact at
        // the strike, so swapping it out on a decayed note is inaudible.
        //
        // The second step stays on `amplitude`, the release ramp.
        // `CoupledStringAssembly::tick_simplified` drops the aftersound
        // polarization and every unison but the first — an ~80 dB step, not a
        // transparent simplification. It is only safe once the voice is on its
        // way out, which is exactly what `amplitude` below 0.05 means.
        if self.quality == VoiceQuality::High && self.decay_envelope < 0.3 * self.decay_peak {
            self.quality = VoiceQuality::Standard;
        }
        if self.quality == VoiceQuality::Standard && self.amplitude < 0.05 {
            self.quality = VoiceQuality::Simplified;
        }

        self.age_samples = self.age_samples.saturating_add(1);
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_note_restores_the_configured_quality_after_adaptive_demotion() {
        let mut voice = PianoVoice::new(48_000.0);
        voice.set_quality(VoiceQuality::High);
        voice.quality = VoiceQuality::Simplified;

        voice.note_on(PianoVoiceStart {
            midi_note: 60,
            channel: 0,
            velocity: 0.8,
            key: 40,
            pitch_ratio: 1.0,
            stiffness_scale: 1.0,
            mass_scale: 1.0,
            attack_length: 0,
        });

        assert_eq!(voice.quality(), VoiceQuality::High);
    }

    /// F8: the downgrade compared against `amplitude`, which is pinned at 1.0
    /// for the whole `Active` stage, so a held note never gave up the
    /// expensive hammer no matter how far it had decayed.
    #[test]
    fn a_held_voice_downgrades_from_high_as_it_decays() {
        let mut voice = PianoVoice::new(48_000.0);
        voice.set_quality(VoiceQuality::High);
        voice.note_on(PianoVoiceStart {
            midi_note: 60,
            channel: 0,
            velocity: 0.9,
            key: 40,
            pitch_ratio: 1.0,
            stiffness_scale: 1.0,
            mass_scale: 1.0,
            attack_length: 0,
        });
        assert_eq!(voice.quality(), VoiceQuality::High);

        // One second of a held note. The key is never released, so the voice
        // stays `Active` and `amplitude` stays pinned at 1.0 throughout.
        for _ in 0..48_000 {
            let _ = voice.tick();
        }

        assert_eq!(
            voice.stage(),
            VoiceStage::Active,
            "the note is still held: this is not a release-ramp downgrade"
        );
        assert_eq!(voice.amplitude(), 1.0, "amplitude is pinned during Active");
        assert_eq!(
            voice.quality(),
            VoiceQuality::Standard,
            "a decayed held voice must give up the Stulov hammer"
        );
    }

    /// The same decay must not reach the Simplified tier while the note is
    /// still sounding: `tick_simplified` drops the aftersound polarization and
    /// every unison but the first, which is an audible cliff rather than a
    /// transparent simplification.
    #[test]
    fn a_held_voice_never_reaches_the_simplified_tier() {
        let mut voice = PianoVoice::new(48_000.0);
        voice.note_on(PianoVoiceStart {
            midi_note: 69,
            channel: 0,
            velocity: 0.8,
            key: 49,
            pitch_ratio: 1.0,
            stiffness_scale: 1.0,
            mass_scale: 1.0,
            attack_length: 0,
        });

        for _ in 0..(48_000 * 5) {
            let _ = voice.tick();
        }

        assert_eq!(voice.stage(), VoiceStage::Active);
        assert_eq!(voice.quality(), VoiceQuality::Standard);
    }
}
