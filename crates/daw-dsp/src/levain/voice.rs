//! Voice allocation and sample playback.
//!
//! Voices are pooled and recycled. Each voice renders one sample with
//! cubic Hermite interpolation, per-voice amplitude envelope, and
//! optional loop crossfading. Voice stealing prioritizes: release tails
//! past audibility → lowest energy → oldest.

use super::types::*;
use super::zone::SamplePool;

// ---------------------------------------------------------------------------
// Cubic Hermite interpolation (default realtime quality)
// ---------------------------------------------------------------------------

/// 4-point cubic Hermite interpolation.
/// Good HF response, stable — the default for levain sample playback.
#[inline]
fn cubic_hermite(y0: f32, y1: f32, y2: f32, y3: f32, t: f32) -> f32 {
    let c0 = y1;
    let c1 = 0.5 * (y2 - y0);
    let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    ((c3 * t + c2) * t + c1) * t + c0
}

/// Convert a decibel value to a linear amplitude multiplier.
#[inline]
fn db_to_linear(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

// ---------------------------------------------------------------------------
// One-pole smoother
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub struct OnePoleSmoother {
    pub current: f32,
    pub target: f32,
    alpha: f32,
}

impl OnePoleSmoother {
    pub fn new(initial: f32, tau: f32, sample_rate: f32) -> Self {
        Self {
            current: initial,
            target: initial,
            alpha: if tau > 0.0 {
                1.0 - (-1.0 / (tau * sample_rate)).exp()
            } else {
                1.0
            },
        }
    }

    #[inline]
    pub fn set_target(&mut self, value: f32) {
        self.target = value;
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        self.current += self.alpha * (self.target - self.current);
        self.current
    }

    pub fn snap(&mut self, value: f32) {
        self.current = value;
        self.target = value;
    }
}

// ---------------------------------------------------------------------------
// ADSR envelope
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnvelopeStage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

#[derive(Debug, Clone)]
pub struct AdsrEnvelope {
    stage: EnvelopeStage,
    level: f32,
    attack_rate: f32,
    decay_rate: f32,
    sustain_level: f32,
    release_rate: f32,
    sample_rate: f32,
}

impl AdsrEnvelope {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            stage: EnvelopeStage::Idle,
            level: 0.0,
            attack_rate: 0.0,
            decay_rate: 0.0,
            sustain_level: 1.0,
            release_rate: 0.0,
            sample_rate,
        }
    }

    pub fn configure(&mut self, params: &AdsrParams) {
        self.attack_rate = if params.attack > 0.001 {
            1.0 / (params.attack * self.sample_rate)
        } else {
            1.0 // instant
        };
        self.decay_rate = if params.decay > 0.001 {
            (-1.0 / (params.decay * self.sample_rate)).exp()
        } else {
            0.0
        };
        self.sustain_level = params.sustain;
        self.release_rate = if params.release > 0.001 {
            (-1.0 / (params.release * self.sample_rate)).exp()
        } else {
            0.0
        };
    }

    pub fn trigger(&mut self) {
        self.stage = EnvelopeStage::Attack;
        self.level = 0.0;
    }

    pub fn release(&mut self) {
        if self.stage != EnvelopeStage::Idle {
            self.stage = EnvelopeStage::Release;
        }
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        match self.stage {
            EnvelopeStage::Idle => 0.0,
            EnvelopeStage::Attack => {
                self.level += self.attack_rate;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = EnvelopeStage::Decay;
                }
                self.level
            }
            EnvelopeStage::Decay => {
                self.level =
                    self.sustain_level + (self.level - self.sustain_level) * self.decay_rate;
                if (self.level - self.sustain_level).abs() < 0.001 {
                    self.level = self.sustain_level;
                    self.stage = EnvelopeStage::Sustain;
                }
                self.level
            }
            EnvelopeStage::Sustain => self.level,
            EnvelopeStage::Release => {
                self.level *= self.release_rate;
                if self.level < 1e-5 {
                    self.level = 0.0;
                    self.stage = EnvelopeStage::Idle;
                }
                self.level
            }
        }
    }

    pub fn is_active(&self) -> bool {
        self.stage != EnvelopeStage::Idle
    }

    pub fn is_releasing(&self) -> bool {
        self.stage == EnvelopeStage::Release
    }

    pub fn current_level(&self) -> f32 {
        self.level
    }
}

// ---------------------------------------------------------------------------
// Sample playback state
// ---------------------------------------------------------------------------

/// Playback state for a single sample stream within a voice.
#[derive(Debug, Clone)]
pub struct SamplePlayback {
    pub sample_id: SampleId,
    pub root_key: u8,
    pub tune_cents: i16,
    pub start: u32,
    pub end: u32,
    pub loop_mode: LoopMode,
    pub loop_start: u32,
    pub loop_end: u32,
    pub loop_crossfade: u32,
    /// Current fractional position in the sample.
    pub position: f64,
    /// Effective playback speed ratio used by `read_sample` — equal to
    /// `base_speed` multiplied by any active pitch modulation (vibrato).
    pub speed: f64,
    /// Un-modulated playback speed for the note's pitch correction. Held
    /// separately so vibrato can modulate `speed` per block without losing
    /// the original note-vs-root-key transposition.
    pub base_speed: f64,
    pub active: bool,
    pub gain: f32,
}

impl SamplePlayback {
    pub fn new() -> Self {
        Self {
            sample_id: 0,
            root_key: 60,
            tune_cents: 0,
            start: 0,
            end: 0,
            loop_mode: LoopMode::NoLoop,
            loop_start: 0,
            loop_end: 0,
            loop_crossfade: 0,
            position: 0.0,
            speed: 1.0,
            base_speed: 1.0,
            active: false,
            gain: 1.0,
        }
    }

    /// Apply a pitch modulation in semitones (typically vibrato). The
    /// effective `speed` is recomputed once per block by the engine; the
    /// hot-path `read_sample` is unchanged. `0` semitones is the no-op
    /// case and skips the `exp2`.
    #[inline]
    pub fn apply_pitch_mod(&mut self, semitones: f32) {
        if semitones.abs() < 1e-5 {
            self.speed = self.base_speed;
        } else {
            self.speed = self.base_speed * (semitones as f64 / 12.0).exp2();
        }
    }

    /// Configure playback from a zone's sample ref for a given MIDI note.
    /// If `pool` is provided, resolves end=0 to the actual sample frame count.
    pub fn configure_with_pool(
        &mut self,
        sample: &SampleRef,
        midi_note: u8,
        gain: f32,
        pool: &SamplePool,
    ) {
        self.sample_id = sample.sample_id;
        self.root_key = sample.root_key;
        self.tune_cents = sample.tune_cents;
        self.start = sample.start;
        // Resolve end=0 to actual sample length.
        self.end = if sample.end == 0 {
            pool.get(sample.sample_id)
                .map(|e| e.frame_count)
                .unwrap_or(0)
        } else {
            sample.end
        };
        self.loop_mode = sample.loop_mode;
        self.loop_start = sample.loop_start;
        self.loop_end = sample.loop_end;
        self.loop_crossfade = sample.loop_crossfade;
        self.position = sample.start as f64;
        self.gain = gain;
        self.active = true;

        // Compute playback speed for pitch correction.
        let semitone_diff =
            midi_note as f64 - sample.root_key as f64 + sample.tune_cents as f64 / 100.0;
        self.base_speed = (semitone_diff / 12.0).exp2();
        self.speed = self.base_speed;
    }

    /// Configure playback from a zone's sample ref for a given MIDI note (no pool lookup).
    pub fn configure(&mut self, sample: &SampleRef, midi_note: u8, gain: f32) {
        self.sample_id = sample.sample_id;
        self.root_key = sample.root_key;
        self.tune_cents = sample.tune_cents;
        self.start = sample.start;
        self.end = sample.end;
        self.loop_mode = sample.loop_mode;
        self.loop_start = sample.loop_start;
        self.loop_end = sample.loop_end;
        self.loop_crossfade = sample.loop_crossfade;
        self.position = sample.start as f64;
        self.gain = gain;
        self.active = true;

        let semitone_diff =
            midi_note as f64 - sample.root_key as f64 + sample.tune_cents as f64 / 100.0;
        self.base_speed = (semitone_diff / 12.0).exp2();
        self.speed = self.base_speed;
    }

    /// Leave a sustain loop and let whatever remains of the recording play
    /// out once.
    ///
    /// SFZ names the two loop behaviours separately, and this engine's forward
    /// loop is the second of them. Under `loop_continuous` "the loop repeats if
    /// the loop end is reached during the release phase"; under `loop_sustain`
    /// the player "plays the loop while the note is held" and "during the
    /// release phase, there's no looping" — playback runs on from wherever the
    /// playhead is to the end of the sample, and whichever of the release
    /// envelope or the sample data ends first ends the note. Every Levain bank
    /// in this repo loops the *whole* sustain recording (`loopStart` 0,
    /// `loopEnd` = frame count) with a zero-frame seam crossfade, so a release
    /// that kept looping wraps the playhead straight back onto that
    /// recording's own attack transient underneath the release fade.
    ///
    /// Audio-thread safe: field writes only.
    #[inline]
    pub fn exit_loop(&mut self) {
        if self.loop_mode == LoopMode::NoLoop {
            return;
        }
        self.loop_mode = LoopMode::NoLoop;
        // Defensive, and narrower than it looks. `NoLoop` only ever ends a
        // stream by reaching `end`, so a backwards playhead would never end.
        // A `PingPong` reflection is the only thing that makes `speed`
        // negative, and for `playback` and `crossfade_playback` this flip is
        // redundant: `update_vibrato_block` runs for every active voice at the
        // top of every block and calls `apply_pitch_mod`, which reassigns
        // `speed` from the always-positive `base_speed` before any tick reads
        // it. `layer_secondary` is never pitch-modulated, so there the flip is
        // the only thing that turns the stream around. No shipped bank uses
        // `pingpong` — the 18 banks here declare only `forward` and `none` —
        // but the manifest schema and the worklet both accept it.
        if self.speed < 0.0 {
            self.speed = -self.speed;
        }
    }

    /// Place the playhead at `position`, folded into this stream's own range.
    ///
    /// Used by crossfade legato to start the incoming zone where the outgoing
    /// voice already is, rather than at the zone's first frame. `position` is
    /// in frames of *this* stream, which is what makes it musically right:
    /// wherever the held note had got to, the slurred note is at least that
    /// far past its own recorded onset, so the transition adds no second
    /// attack. Positions past the end fold back into the loop when there is
    /// one; a target zone that does not loop is a short or percussive
    /// articulation, where re-articulating from the start is the correct
    /// reading of a slur into it.
    ///
    /// Known limit of the fold: sustain lengths vary widely inside one bank —
    /// flute runs 5.99 s against violin's 15-16 s — so an outgoing playhead
    /// past the incoming zone's length is routine, and `p % L` then lands
    /// somewhere unrelated to where the player was, including the recording's
    /// own frame 0. It never sounds *worse* than the retrigger this replaces
    /// and costs nothing to compute, but it is arbitrary rather than musical.
    /// Matching the elapsed *fraction* of each recording, or clamping into the
    /// last loop iteration, would both be defensible; neither is implemented
    /// here because no shipped bank has a recorded interval sample to compare
    /// either against.
    #[inline]
    pub fn seek_to(&mut self, position: f64) {
        let start = self.start as f64;
        let end = self.end as f64;
        if end <= start || position <= start {
            self.position = start;
            return;
        }
        if position < end {
            self.position = position;
            return;
        }

        let loop_start = self.loop_start as f64;
        let loop_end = self.loop_end as f64;
        let loop_span = loop_end - loop_start;
        if self.loop_mode != LoopMode::NoLoop && loop_span > 0.0 {
            self.position = loop_start + (position - loop_start) % loop_span;
            return;
        }
        self.position = start;
    }

    /// Read one sample with cubic Hermite interpolation.
    #[inline]
    pub fn read_sample(&mut self, pool: &SamplePool) -> f32 {
        if !self.active {
            return 0.0;
        }

        let entry = match pool.get(self.sample_id) {
            Some(e) => e,
            None => {
                self.active = false;
                return 0.0;
            }
        };

        let data = &entry.data;
        let channels = entry.channels as usize;
        let frame_count = entry.frame_count as usize;

        // Get integer and fractional parts of position.
        let pos_floor = self.position as usize;
        let frac = (self.position - pos_floor as f64) as f32;

        // Read 4 samples for cubic Hermite (mono, channel 0).
        let get = |frame: usize| -> f32 {
            if frame < frame_count {
                data[frame * channels]
            } else {
                0.0
            }
        };

        let y0 = if pos_floor == 0 {
            get(0)
        } else {
            get(pos_floor - 1)
        };
        let y1 = get(pos_floor);
        let y2 = get(pos_floor + 1);
        let y3 = get(pos_floor + 2);

        let mut sample = cubic_hermite(y0, y1, y2, y3, frac);

        // Equal-power loop-seam crossfade (audit F14): as playback approaches
        // `loop_end` inside the last `loop_crossfade` frames of a forward
        // loop, blend in the content the *next* iteration would start with —
        // the mirror offset from `loop_start` — instead of jumping straight
        // to the raw waveform at the seam. The field was stored on every
        // voice and never read, so any loop whose start and end weren't
        // already waveform-continuous clicked on every repeat.
        if self.loop_mode == LoopMode::Forward && self.loop_crossfade > 0 {
            let crossfade_start = self.loop_end.saturating_sub(self.loop_crossfade);
            if pos_floor >= crossfade_start as usize && pos_floor < self.loop_end as usize {
                let progress =
                    (pos_floor as u32 - crossfade_start) as f32 / self.loop_crossfade as f32;
                let shadow_frame = self.loop_start + (pos_floor as u32 - crossfade_start);
                let shadow = get(shadow_frame as usize);
                let angle = progress.clamp(0.0, 1.0) * std::f32::consts::FRAC_PI_2;
                let (gain_shadow, gain_tail) = angle.sin_cos();
                sample = sample * gain_tail + shadow * gain_shadow;
            }
        }

        // Advance position.
        self.position += self.speed;

        // Handle looping.
        match self.loop_mode {
            LoopMode::NoLoop => {
                if self.position >= self.end as f64 {
                    self.active = false;
                }
            }
            LoopMode::Forward => {
                if self.position >= self.loop_end as f64 {
                    let loop_len = (self.loop_end - self.loop_start) as f64;
                    if loop_len > 0.0 {
                        self.position = self.loop_start as f64
                            + (self.position - self.loop_end as f64) % loop_len;
                    }
                }
            }
            LoopMode::PingPong => {
                let loop_len = (self.loop_end - self.loop_start) as f64;
                if loop_len > 0.0 && self.position >= self.loop_end as f64 {
                    // Reflect: reverse direction conceptually.
                    self.position = self.loop_end as f64 - (self.position - self.loop_end as f64);
                    self.speed = -self.speed;
                } else if self.position < self.loop_start as f64 && self.speed < 0.0 {
                    self.position =
                        self.loop_start as f64 + (self.loop_start as f64 - self.position);
                    self.speed = -self.speed;
                }
            }
        }

        sample * self.gain
    }
}

// ---------------------------------------------------------------------------
// Levain voice
// ---------------------------------------------------------------------------

/// Per-sample increment for a crossfade that must span `crossfade_time_secs`.
///
/// The lower bound is the whole point. `tick` advances the crossfade by
/// accumulating this into an `f32` in `[0, 1)`, and an `f32` add is a no-op
/// once the addend falls below half the accumulator's ULP — which near 1.0 is
/// 2.98e-8. A rate under that stalls the ramp *permanently*: the voice stays
/// `crossfading`, never reaches its own zone at full level, and never runs the
/// completion branch that frees `crossfade_playback`. Measured on this code:
/// 300 s completes, 1000 s stops dead at `crossfade_amount == 0.5`, 3000 s at
/// 0.125, 10000 s at 0.0625.
///
/// `f32::EPSILON` (1.19e-7) is the smallest increment that provably advances
/// the accumulator everywhere in `[0, 1)`, since the largest ULP in that range
/// is 5.96e-8. It caps a crossfade at ~175 s at 48 kHz. That ceiling is a
/// representability limit, not a musical opinion: every legato time this
/// engine can otherwise produce is between 20 ms and 150 ms, and an authored
/// `crossfadeOutMs` under ~175 s is honoured exactly as written. Only a value
/// the arithmetic cannot express at all is bent, and it is bent to the longest
/// fade that still completes rather than rejected.
///
/// Reachable from bank data: `crossfadeOutMs` is validated only as a
/// non-negative finite `f32`, so a manifest may legitimately carry `1e9`.
///
/// Audio-thread safe: arithmetic only.
#[inline]
fn crossfade_rate_for(crossfade_time_secs: f32, sample_rate: f32) -> f32 {
    let samples = (crossfade_time_secs * sample_rate).max(1.0);
    (1.0 / samples).max(f32::EPSILON)
}

/// A single levain voice that renders one active note.
/// Heavier than a synth voice: may read from multiple mic streams,
/// crossfade dynamic layers, and run per-voice envelopes.
pub struct LevainVoice {
    pub active: bool,
    pub note: u8,
    /// MIDI channel this voice was triggered on — half of the per-note
    /// expression address (audit MD-2). Under MPE each note owns its own
    /// member channel, so two voices at one pitch are told apart by it.
    pub channel: u8,
    /// True from trigger until release. A voice whose release tail is still
    /// audible stays `active` but is no longer `held`, so a same-pitch
    /// retrigger cannot bend the note the player already let go.
    pub held: bool,
    pub velocity: u8,
    pub age: u32,
    /// Energy estimate (RMS over last N samples) for voice stealing.
    pub energy: f32,
    pub energy_decay: f32,

    /// Primary sample playback stream (current articulation).
    pub playback: SamplePlayback,
    /// Secondary stream for legato transitions (true-legato transition
    /// sample) or a synthetic-glide target zone.
    pub crossfade_playback: SamplePlayback,
    /// Crossfade progress (0.0 = fully primary, 1.0 = fully secondary).
    pub crossfade_amount: f32,
    pub crossfade_rate: f32,
    pub crossfading: bool,

    /// Third stream for the CC1 mod-wheel dynamic-layer crossfade, distinct
    /// from `crossfade_playback` (owned by legato) so the two features never
    /// fight over one stream slot. Active for the life of a note whenever its
    /// trigger velocity landed near the boundary between two authored
    /// dynamic layers.
    pub layer_secondary: SamplePlayback,
    pub layer_active: bool,
    layer_gain_primary: f32,
    layer_gain_secondary: f32,
    /// Indices into the engine's per-block `layer_gains` for the primary
    /// zone and `layer_secondary` above.
    pub dynamic_layer_primary_idx: usize,
    pub dynamic_layer_secondary_idx: usize,

    /// Amplitude envelope.
    pub amp_env: AdsrEnvelope,
    /// The zone's own amplitude envelope, held unmodified so the Attack and
    /// Release macros re-derive from the patch every time rather than
    /// compounding their scaling onto an already-scaled envelope.
    amp_env_patch: AdsrParams,
    /// Current Attack/Release macro scaling. Kept per voice so a macro moved
    /// mid-note reaches the note that is sounding, not only the next one.
    envelope_scaling: EnvelopeScaling,

    /// Per-voice gain (from velocity, expression, humanization).
    pub gain: OnePoleSmoother,

    /// Articulation ID this voice was triggered with.
    pub articulation: ArticulationId,

    /// Zone ID this voice is playing.
    pub zone_id: ZoneId,

    /// Mic ID this voice is playing.
    pub mic: MicId,

    /// Time since note-on (in samples) for legato detection.
    pub samples_since_on: u32,

    /// Per-voice vibrato phase in [0, 1). Initialised from the per-note
    /// humanization at trigger time so each voice in a section has an
    /// independent vibrato cycle (spec §4.2 ensemble decorrelation).
    pub vibrato_phase: f32,
    /// Per-voice vibrato rate scale (around 1.0). Lets each voice's
    /// vibrato run at a slightly different rate, which prevents the
    /// "machine vibrato" lock-step a section of voices would otherwise
    /// produce.
    pub vibrato_rate_scale: f32,

    // MPE per-note expression (audit MD-2). Held for the note's lifetime and
    // read at block rate (bend, pressure) or per sample (slide tilt). Neutral
    // defaults are the identity, so an unexpressive note is bit-unchanged.
    /// Member-channel pitch bend in semitones, summed with vibrato.
    pub expr_bend_semitones: f32,
    /// Channel pressure 0..1, scaling the voice gain on top of velocity.
    pub expr_pressure: f32,
    /// Timbre / CC74 slide, bipolar -1..1 with 0 neutral, driving the tilt.
    pub expr_slide: f32,
    /// Voice gain before pressure is applied, so pressure is re-derivable.
    base_gain: f32,
    /// One-pole state of the timbre tilt filter (audit MD-2).
    tilt_lp: f32,
    /// Tilt one-pole coefficient for a ~1.2 kHz split, fixed at construction.
    tilt_coeff: f32,
}

impl LevainVoice {
    pub fn new(sample_rate: f32) -> Self {
        let energy_decay = (-1.0 / (0.022675 * sample_rate)).exp();
        Self {
            active: false,
            note: 0,
            channel: 0,
            held: false,
            velocity: 0,
            age: 0,
            energy: 0.0,
            energy_decay,
            playback: SamplePlayback::new(),
            crossfade_playback: SamplePlayback::new(),
            crossfade_amount: 0.0,
            crossfade_rate: 0.0,
            crossfading: false,
            layer_secondary: SamplePlayback::new(),
            layer_active: false,
            layer_gain_primary: 1.0,
            layer_gain_secondary: 0.0,
            dynamic_layer_primary_idx: 0,
            dynamic_layer_secondary_idx: 0,
            amp_env: AdsrEnvelope::new(sample_rate),
            amp_env_patch: AdsrParams::default(),
            envelope_scaling: EnvelopeScaling::IDENTITY,
            gain: OnePoleSmoother::new(1.0, 0.01, sample_rate),
            articulation: 0,
            zone_id: 0,
            mic: 0,
            samples_since_on: 0,
            vibrato_phase: 0.0,
            vibrato_rate_scale: 1.0,
            expr_bend_semitones: 0.0,
            expr_pressure: 0.0,
            expr_slide: 0.0,
            base_gain: 1.0,
            tilt_lp: 0.0,
            tilt_coeff: 1.0 - (-std::f32::consts::TAU * 1200.0 / sample_rate.max(1.0)).exp(),
        }
    }

    /// Trigger this voice with a zone. Resolves end=0 to actual sample length.
    pub fn trigger(
        &mut self,
        note: u8,
        channel: u8,
        velocity: u8,
        zone: &Zone,
        articulation: ArticulationId,
        gain: f32,
        pool: &SamplePool,
    ) {
        self.active = true;
        self.note = note;
        self.channel = channel;
        self.held = true;
        self.velocity = velocity;
        self.age = 0;
        self.energy = 0.0;
        self.articulation = articulation;
        self.zone_id = zone.id;
        self.mic = zone.mic;
        self.samples_since_on = 0;

        self.playback
            .configure_with_pool(&zone.sample, note, db_to_linear(zone.gain_db), pool);
        self.crossfading = false;
        self.crossfade_amount = 0.0;
        self.layer_active = false;
        self.layer_gain_primary = 1.0;
        self.layer_gain_secondary = 0.0;
        self.layer_secondary.active = false;

        self.amp_env_patch = zone.amp_env;
        self.amp_env
            .configure(&self.envelope_scaling.apply(&zone.amp_env));
        self.amp_env.trigger();
        // A fresh note starts from neutral expression; the controller's opening
        // bend/pressure/timbre arrives as its own expression message.
        self.expr_bend_semitones = 0.0;
        self.expr_pressure = 0.0;
        self.expr_slide = 0.0;
        self.tilt_lp = 0.0;
        self.base_gain = gain;
        self.gain.snap(gain);
    }

    /// Point this voice at a new Attack/Release macro scaling. A sounding voice
    /// re-derives its envelope from the zone's own ADSR immediately, so a
    /// player dragging Release over a held chord hears it on that chord rather
    /// than on the next one. Stage and level are untouched — only the rates.
    pub fn set_envelope_scaling(&mut self, scaling: EnvelopeScaling) {
        self.envelope_scaling = scaling;
        if self.active {
            self.amp_env.configure(&scaling.apply(&self.amp_env_patch));
        }
    }

    /// Apply MPE per-note expression to this sounding voice (audit MD-2).
    ///
    /// `bend_semitones` is summed into the per-block pitch modulation alongside
    /// vibrato, `pressure` (0..1) scales the voice gain above the trigger gain,
    /// and `slide` (-1..1, 0 neutral) tilts the voice's spectrum. Stores only —
    /// no allocation — so it is safe on the audio thread's message drain.
    pub fn set_expression(&mut self, bend_semitones: f32, pressure: f32, slide: f32) {
        self.expr_bend_semitones = bend_semitones.clamp(-96.0, 96.0);
        self.expr_pressure = pressure.clamp(0.0, 1.0);
        self.expr_slide = slide.clamp(-1.0, 1.0);
        self.gain
            .set_target(self.base_gain * (1.0 + self.expr_pressure));
    }

    /// Start releasing this voice. The tail keeps sounding, but the voice is no
    /// longer held, so per-note expression stops addressing it (audit MD-2).
    ///
    /// Every stream leaves its sustain loop here: with no recorded release
    /// sample to hand over to, the modelled release is the recording's own
    /// remaining tail under the release envelope, which is only reachable once
    /// the loop stops holding the playhead back. See `SamplePlayback::exit_loop`.
    pub fn release(&mut self) {
        self.held = false;
        self.amp_env.release();
        self.playback.exit_loop();
        self.crossfade_playback.exit_loop();
        self.layer_secondary.exit_loop();
    }

    /// Begin a crossfade from this voice's current stream into `new_zone` —
    /// the crossfade-legato fallback for a slur with no recorded interval
    /// sample. `target_start_position` is where the incoming zone's playhead
    /// starts, in that zone's own frames; the caller passes the outgoing
    /// stream's position so the new zone enters past its recorded onset
    /// instead of re-articulating it.
    pub fn start_crossfade(
        &mut self,
        new_zone: &Zone,
        note: u8,
        crossfade_time_secs: f32,
        sample_rate: f32,
        pool: &SamplePool,
        target_start_position: f64,
    ) {
        // Move current playback to crossfade slot.
        self.crossfade_playback = self.playback.clone();
        self.playback.configure_with_pool(
            &new_zone.sample,
            note,
            db_to_linear(new_zone.gain_db),
            pool,
        );
        self.playback.seek_to(target_start_position);

        self.crossfade_amount = 0.0;
        self.crossfade_rate = crossfade_rate_for(crossfade_time_secs, sample_rate);
        self.crossfading = true;
        self.zone_id = new_zone.id;
    }

    /// Begin a true-legato transition. `playback` already holds the freshly
    /// triggered sustain zone (set by `trigger()` just before this call); the
    /// looked-up transition sample goes into the secondary stream and starts
    /// at full weight, so the note begins by sounding the transition and
    /// eases into its own sustain — the mirror image of `start_crossfade`,
    /// which fades a *new* primary in against whatever was already sounding.
    /// Without this, a true-legato result had nothing to crossfade but the
    /// sustain zone against itself.
    pub fn start_legato_transition(
        &mut self,
        transition_sample: &SampleRef,
        note: u8,
        crossfade_time_secs: f32,
        sample_rate: f32,
        pool: &SamplePool,
    ) {
        self.crossfade_playback
            .configure_with_pool(transition_sample, note, 1.0, pool);
        self.crossfade_amount = 0.0;
        self.crossfade_rate = crossfade_rate_for(crossfade_time_secs, sample_rate);
        self.crossfading = true;
    }

    /// Attach a second, velocity-adjacent zone that CC1 can blend towards
    /// (audit F6). Independent of `crossfade_playback`, which legato owns, so
    /// the two features never contend for one stream slot.
    pub fn set_dynamic_layer(&mut self, zone: &Zone, note: u8, pool: &SamplePool) {
        self.layer_secondary
            .configure_with_pool(&zone.sample, note, db_to_linear(zone.gain_db), pool);
        self.layer_active = true;
    }

    /// Update this block's CC1-derived blend weights for the primary zone and
    /// the attached dynamic layer. Set once per block by the engine from its
    /// `layer_gains`; a no-op unless `set_dynamic_layer` attached a second
    /// stream.
    pub fn update_dynamic_layer_gains(&mut self, primary: f32, secondary: f32) {
        self.layer_gain_primary = primary;
        self.layer_gain_secondary = secondary;
    }

    /// Advance this voice's vibrato LFO by one block and write the
    /// resulting pitch modulation into the playback. Called once per
    /// block by the engine — keeping it block-rate (≈ every 2.7 ms at
    /// 48 kHz / 128) is plenty fast for a 5 Hz LFO and avoids paying for
    /// `sin`/`exp2` per audio sample.
    ///
    /// `depth_cents` and `base_rate_hz` come from the engine's shared
    /// vibrato config (typically driven by CC2). Each voice multiplies
    /// the rate by its own `vibrato_rate_scale` and uses its own phase
    /// so the section sounds like independent players, not one player
    /// chorused.
    pub fn update_vibrato_block(
        &mut self,
        depth_cents: f32,
        base_rate_hz: f32,
        onset_delay_secs: f32,
        sample_rate: f32,
        block_size: usize,
    ) {
        if !self.active {
            return;
        }
        // MPE per-note bend rides the same pitch-modulation slot as vibrato
        // (audit MD-2), so a bent note still vibratos and a vibrato-less patch
        // still bends.
        if depth_cents < 0.1 || base_rate_hz <= 0.0 {
            self.playback.apply_pitch_mod(self.expr_bend_semitones);
            self.crossfade_playback
                .apply_pitch_mod(self.expr_bend_semitones);
            return;
        }

        let effective_rate = (base_rate_hz * self.vibrato_rate_scale).max(0.1);
        let time_since_on = self.samples_since_on as f32 / sample_rate;
        let onset_gain = if onset_delay_secs > 0.0 {
            (time_since_on / onset_delay_secs).clamp(0.0, 1.0)
        } else {
            1.0
        };

        // Advance phase by exactly one block — block_size samples at
        // sample_rate Hz of LFO time.
        self.vibrato_phase += effective_rate * (block_size as f32) / sample_rate;
        // Cheap wrap (block_size << sample_rate so phase grows slowly).
        if self.vibrato_phase >= 1.0 {
            self.vibrato_phase -= self.vibrato_phase.floor();
        }

        let lfo = (self.vibrato_phase * std::f32::consts::TAU).sin();
        let semitones = (depth_cents / 100.0) * onset_gain * lfo + self.expr_bend_semitones;

        self.playback.apply_pitch_mod(semitones);
        // The crossfade-in playback (active during legato transitions)
        // must follow the same vibrato so it lines up phase-coherently
        // with the primary stream.
        if self.crossfading {
            self.crossfade_playback.apply_pitch_mod(semitones);
        }
    }

    /// Process one sample, returns mono output.
    #[inline]
    pub fn tick(&mut self, pool: &SamplePool) -> f32 {
        if !self.active {
            return 0.0;
        }

        self.age += 1;
        self.samples_since_on += 1;

        let env = self.amp_env.tick();
        if !self.amp_env.is_active() {
            self.active = false;
            return 0.0;
        }

        let primary = self.playback.read_sample(pool);

        let mut sample = if self.crossfading {
            let secondary = self.crossfade_playback.read_sample(pool);
            self.crossfade_amount += self.crossfade_rate;

            if self.crossfade_amount >= 1.0 {
                self.crossfade_amount = 1.0;
                self.crossfading = false;
                self.crossfade_playback.active = false;
            }

            // Equal-power crossfade. Use sin_cos() for single call.
            let angle = self.crossfade_amount * std::f32::consts::FRAC_PI_2;
            let (gain_new, gain_old) = angle.sin_cos();
            primary * gain_new + secondary * gain_old
        } else {
            primary
        };

        // CC1 mod-wheel dynamic-layer crossfade (audit F6): blend in the
        // velocity-adjacent zone attached by `set_dynamic_layer`, weighted by
        // this block's equal-power layer gains.
        if self.layer_active {
            let layer_sample = self.layer_secondary.read_sample(pool);
            sample = sample * self.layer_gain_primary + layer_sample * self.layer_gain_secondary;
        }

        // Check if sample playback is finished.
        if !self.playback.active && !self.crossfading {
            self.amp_env.release();
            // ...and once no stream has anything left to read, free the slot
            // rather than sit out the rest of the release envelope. Every
            // `read_sample` above returns 0.0 from this point, so the voice can
            // only emit zeros and nothing audible is lost — but the envelope
            // does not reach the `1e-5` that idles it until 11.5 time
            // constants have passed, which on a struck one-shot with a long
            // modelled release is tens of seconds of pool held by silence.
            // `VoicePool::allocate` cannot recover it either: `steal_priority`
            // scores an inaudible release tail `1`, below every sounding
            // voice, so the allocator steals the note still ringing instead.
            let layer_still_sounding = self.layer_active && self.layer_secondary.active;
            if !layer_still_sounding {
                self.active = false;
            }
        }

        // MPE timbre / CC74 (audit MD-2). A one-pole split gives the low band;
        // the residual is the high band, and adding a signed fraction of it
        // back tilts the voice bright (slide > 0) or dark (slide < 0). Neutral
        // slide skips the filter entirely, so the sample is untouched.
        let shaped = if self.expr_slide.abs() > 0.001 {
            self.tilt_lp += self.tilt_coeff * (sample - self.tilt_lp);
            let high = sample - self.tilt_lp;
            sample + self.expr_slide * high
        } else {
            sample
        };

        let gain = self.gain.tick();

        // Track energy for voice stealing (simple exponential RMS).
        let abs_sample = (shaped * env * gain).abs();
        self.energy = self.energy * self.energy_decay + abs_sample * (1.0 - self.energy_decay);

        shaped * env * gain
    }

    /// Voice stealing score: lower = more likely to be stolen.
    pub fn steal_priority(&self) -> u32 {
        if !self.active {
            return 0;
        }
        if self.amp_env.is_releasing() && self.energy < 1e-4 {
            return 1; // release tails past audibility
        }
        // Lower energy = more stealable, older = more stealable.
        let energy_score = ((1.0 - self.energy.min(1.0)) * 1000.0) as u32;
        let age_score = self.age.min(10000);
        2 + energy_score + age_score / 10
    }
}

// ---------------------------------------------------------------------------
// Voice pool
// ---------------------------------------------------------------------------

pub struct VoicePool {
    pub voices: Vec<LevainVoice>,
}

impl VoicePool {
    pub fn new(max_voices: usize, sample_rate: f32) -> Self {
        let voices = (0..max_voices)
            .map(|_| LevainVoice::new(sample_rate))
            .collect();
        Self { voices }
    }

    /// Find a free voice, or steal the best candidate.
    pub fn allocate(&mut self) -> usize {
        // First: find an inactive voice.
        for (i, voice) in self.voices.iter().enumerate() {
            if !voice.active {
                return i;
            }
        }

        // All busy: steal based on priority (highest priority score = best steal target).
        let mut best_idx = 0;
        let mut best_score = 0;
        for (i, voice) in self.voices.iter().enumerate() {
            let score = voice.steal_priority();
            if score > best_score {
                best_score = score;
                best_idx = i;
            }
        }
        best_idx
    }

    /// Count currently active voices.
    pub fn active_count(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count()
    }

    /// Release all voices playing a specific note.
    pub fn release_note(&mut self, note: u8) {
        self.release_note_matching(note, None);
    }

    /// Release the voices playing `note`. `channel` narrows the release to one
    /// MPE member channel; `None` releases every voice at that pitch, which is
    /// the historical behaviour and what channel-unaware callers still get — so
    /// omitting the channel can never leave a voice hanging.
    pub fn release_note_matching(&mut self, note: u8, channel: Option<u8>) {
        for voice in self.voices.iter_mut() {
            if !voice.active || voice.note != note {
                continue;
            }
            if let Some(target) = channel {
                if voice.channel != target {
                    continue;
                }
            }
            voice.release();
        }
    }

    /// Push a new Attack/Release macro scaling to every voice — sounding ones
    /// so the change is audible now, idle ones so the next note they take is
    /// triggered with it.
    pub fn set_envelope_scaling(&mut self, scaling: EnvelopeScaling) {
        for voice in self.voices.iter_mut() {
            voice.set_envelope_scaling(scaling);
        }
    }

    /// Release all voices.
    pub fn release_all(&mut self) {
        for voice in self.voices.iter_mut() {
            if voice.active {
                voice.release();
            }
        }
    }

    /// Apply MPE per-note expression to the voices currently *held* on
    /// `channel` at `note` (audit MD-2). Addressing by note alone would also
    /// bend a still-ringing release tail at that pitch, or the other member
    /// channel of a genuine MPE same-pitch overlap.
    pub fn set_note_expression(
        &mut self,
        note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) {
        for voice in self.voices.iter_mut() {
            if voice.active && voice.held && voice.note == note && voice.channel == channel {
                voice.set_expression(bend_semitones, pressure, slide);
            }
        }
    }
}
