//! Voice allocation and sample playback.
//!
//! Voices are pooled and recycled. Each voice renders one sample with
//! cubic Hermite interpolation, per-voice amplitude envelope, and
//! optional loop crossfading. Voice stealing prioritizes: release tails
//! past audibility → lowest energy → oldest.

use crate::types::*;
use crate::zone::SamplePool;

// ---------------------------------------------------------------------------
// Cubic Hermite interpolation (default realtime quality)
// ---------------------------------------------------------------------------

/// 4-point cubic Hermite interpolation.
/// Good HF response, stable — the default for orchestral sample playback.
#[inline]
fn cubic_hermite(y0: f32, y1: f32, y2: f32, y3: f32, t: f32) -> f32 {
    let c0 = y1;
    let c1 = 0.5 * (y2 - y0);
    let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    ((c3 * t + c2) * t + c1) * t + c0
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
                self.level = self.sustain_level
                    + (self.level - self.sustain_level) * self.decay_rate;
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
    /// Playback speed ratio (for pitch correction).
    pub speed: f64,
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
            active: false,
            gain: 1.0,
        }
    }

    /// Configure playback from a zone's sample ref for a given MIDI note.
    /// If `pool` is provided, resolves end=0 to the actual sample frame count.
    pub fn configure_with_pool(&mut self, sample: &SampleRef, midi_note: u8, gain: f32, pool: &crate::zone::SamplePool) {
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
        self.speed = (semitone_diff / 12.0).exp2();
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
        self.speed = (semitone_diff / 12.0).exp2();
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

        let y0 = if pos_floor == 0 { get(0) } else { get(pos_floor - 1) };
        let y1 = get(pos_floor);
        let y2 = get(pos_floor + 1);
        let y3 = get(pos_floor + 2);

        let sample = cubic_hermite(y0, y1, y2, y3, frac);

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
                        self.position =
                            self.loop_start as f64 + (self.position - self.loop_end as f64) % loop_len;
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
// Orchestral voice
// ---------------------------------------------------------------------------

/// A single orchestral voice that renders one active note.
/// Heavier than a synth voice: may read from multiple mic streams,
/// crossfade dynamic layers, and run per-voice envelopes.
pub struct OrchestraVoice {
    pub active: bool,
    pub note: u8,
    pub velocity: u8,
    pub age: u32,
    /// Energy estimate (RMS over last N samples) for voice stealing.
    pub energy: f32,

    /// Primary sample playback stream (current articulation).
    pub playback: SamplePlayback,
    /// Secondary stream for dynamic layer crossfading or legato transitions.
    pub crossfade_playback: SamplePlayback,
    /// Crossfade progress (0.0 = fully primary, 1.0 = fully secondary).
    pub crossfade_amount: f32,
    pub crossfade_rate: f32,
    pub crossfading: bool,

    /// Amplitude envelope.
    pub amp_env: AdsrEnvelope,

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
}

impl OrchestraVoice {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            active: false,
            note: 0,
            velocity: 0,
            age: 0,
            energy: 0.0,
            playback: SamplePlayback::new(),
            crossfade_playback: SamplePlayback::new(),
            crossfade_amount: 0.0,
            crossfade_rate: 0.0,
            crossfading: false,
            amp_env: AdsrEnvelope::new(sample_rate),
            gain: OnePoleSmoother::new(1.0, 0.01, sample_rate),
            articulation: 0,
            zone_id: 0,
            mic: 0,
            samples_since_on: 0,
        }
    }

    /// Trigger this voice with a zone. Resolves end=0 to actual sample length.
    pub fn trigger(
        &mut self,
        note: u8,
        velocity: u8,
        zone: &Zone,
        articulation: ArticulationId,
        gain: f32,
        pool: &crate::zone::SamplePool,
    ) {
        self.active = true;
        self.note = note;
        self.velocity = velocity;
        self.age = 0;
        self.energy = 0.0;
        self.articulation = articulation;
        self.zone_id = zone.id;
        self.mic = zone.mic;
        self.samples_since_on = 0;

        self.playback.configure_with_pool(&zone.sample, note, 1.0, pool);
        self.crossfading = false;
        self.crossfade_amount = 0.0;

        self.amp_env.configure(&zone.amp_env);
        self.amp_env.trigger();
        self.gain.snap(gain);
    }

    /// Start releasing this voice.
    pub fn release(&mut self) {
        self.amp_env.release();
    }

    /// Begin a crossfade to a new sample (for dynamic layer transitions or legato).
    pub fn start_crossfade(&mut self, new_zone: &Zone, note: u8, crossfade_time_secs: f32, sample_rate: f32, pool: &crate::zone::SamplePool) {
        // Move current playback to crossfade slot.
        self.crossfade_playback = self.playback.clone();
        self.playback.configure_with_pool(&new_zone.sample, note, 1.0, pool);

        self.crossfade_amount = 0.0;
        let samples = (crossfade_time_secs * sample_rate).max(1.0);
        self.crossfade_rate = 1.0 / samples;
        self.crossfading = true;
        self.zone_id = new_zone.id;
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

        let sample = if self.crossfading {
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

        // Check if sample playback is finished.
        if !self.playback.active && !self.crossfading {
            self.amp_env.release();
        }

        let gain = self.gain.tick();

        // Track energy for voice stealing (simple exponential RMS).
        let abs_sample = (sample * env * gain).abs();
        self.energy = self.energy * 0.999 + abs_sample * 0.001;

        sample * env * gain
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
    pub voices: Vec<OrchestraVoice>,
}

impl VoicePool {
    pub fn new(max_voices: usize, sample_rate: f32) -> Self {
        let voices = (0..max_voices)
            .map(|_| OrchestraVoice::new(sample_rate))
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
        for voice in self.voices.iter_mut() {
            if voice.active && voice.note == note {
                voice.release();
            }
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
}
