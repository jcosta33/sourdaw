//! Core types for the levain sample playback engine.
//!
//! All types are allocation-free and Copy where possible for use in
//! the audio hot path. Modeled with constraints similar to the SFZ spec
//! (region/group inheritance, ADSR opcodes, round-robin via seq_length/seq_position).

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Identifiers (dense indices for O(1) lookup)
// ---------------------------------------------------------------------------

pub type SampleId = u32;
pub type ZoneId = u32;
pub type ArticulationId = u16;
pub type MicId = u8;

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct KeyRange {
    pub lo: u8,
    pub hi: u8,
}

impl KeyRange {
    pub fn contains(self, note: u8) -> bool {
        note >= self.lo && note <= self.hi
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct VelRange {
    pub lo: u8,
    pub hi: u8,
}

impl VelRange {
    pub fn contains(self, vel: u8) -> bool {
        vel >= self.lo && vel <= self.hi
    }
}

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InstrumentFamily {
    Strings,
    Brass,
    Woodwinds,
    Percussion,
    Choir,
}

impl InstrumentFamily {
    /// Classify a frontend `instrumentId` slug. Mirrors `getInstrumentFamily`
    /// in `src/modules/Levain/models/LevainPatch.ts`, including its ordering
    /// traps: choir before strings so `bass-voice` doesn't match `bass`, and
    /// woodwinds before brass so `english-horn` doesn't match `horn`.
    ///
    /// This is a second classifier over the same input as
    /// `realism::Instrument::from_id`, deliberately: that one picks body
    /// resonance, sympathetic strings and breath colour per *instrument*,
    /// while this one is the coarse family the release model needs.
    pub fn from_instrument_id(id: &str) -> Self {
        if matches!(id, "soprano" | "alto" | "tenor" | "bass-voice") {
            return InstrumentFamily::Choir;
        }
        if id.contains("flute")
            || id.contains("oboe")
            || id.contains("clarinet")
            || id.contains("bassoon")
            || id.contains("piccolo")
            || id == "english-horn"
        {
            return InstrumentFamily::Woodwinds;
        }
        if id.contains("violin")
            || id.contains("viola")
            || id.contains("cello")
            || id == "double-bass"
        {
            return InstrumentFamily::Strings;
        }
        if id.contains("trumpet")
            || id.contains("horn")
            || id.contains("trombone")
            || id.contains("tuba")
        {
            return InstrumentFamily::Brass;
        }
        InstrumentFamily::Percussion
    }

    /// Multiplicative scaling applied to a zone's own release time when the
    /// bank ships no recorded release samples, so the modelled release stops
    /// like the instrument rather than like a gate.
    ///
    /// **Why a ratio, and why in the engine.** The per-zone `release` in every
    /// shipped manifest is emitted by `scripts/download-levain-samples.ts` from
    /// articulation type alone — `sustain || tremolo ? 0.5 : 0.15` — so it
    /// carries no instrument information at all, and a marimba and a horn get
    /// the same number. The manifest is still the right *override* channel and
    /// stays authoritative for a bank that authors real per-zone values, so the
    /// family model scales that value rather than replacing it: the same
    /// multiplicative-on-time convention `EnvelopeScaling` already documents
    /// for the Attack/Release macros, which keeps a patch's relative shaping
    /// (a staccato stays far shorter than a sustain) and moves the whole
    /// instrument in one direction.
    ///
    /// **Where the numbers come from.** Measured off this repo's own shipped
    /// recordings: the median time from envelope peak to −40 dB (10 ms RMS
    /// window) over every distinct file of each bank's shortest recorded
    /// articulation, which is exactly a recording of the instrument being
    /// excited and then left to ring.
    ///
    /// | family     | measured basis                                    | median  | ÷ 0.5 s |
    /// | ---------- | ------------------------------------------------- | ------- | ------- |
    /// | Percussion | struck one-shots: marimba 2.31, glock 2.50, timp 1.74 | 2.31 s  | 4.6     |
    /// | Strings    | pizzicato: cello 1.14, d-bass 1.67, viola 0.57, vln 0.72/0.39 | 0.72 s  | 1.4     |
    /// | Brass      | staccato: horn 0.34, trombone 0.43, trumpet 0.54, tuba 0.45 | 0.45 s  | 0.9     |
    /// | Woodwinds  | staccato: bassoon 0.39, clarinet 0.33, flute 0.36, oboe 0.38 | 0.36 s  | 0.7     |
    ///
    /// The divisor is the 0.5 s the generator writes for every sustaining
    /// zone, which is what makes the ratio a correction of that constant.
    /// **Choir is deliberately `1.0`**: no choir bank ships here, so there is
    /// nothing to measure and a number would be an invention.
    pub fn release_scale(self) -> f32 {
        match self {
            InstrumentFamily::Percussion => 4.6,
            InstrumentFamily::Strings => 1.4,
            InstrumentFamily::Brass => 0.9,
            InstrumentFamily::Woodwinds => 0.7,
            InstrumentFamily::Choir => 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LoopMode {
    NoLoop,
    Forward,
    PingPong,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum Dynamic {
    PP = 0,
    P = 1,
    MP = 2,
    MF = 3,
    F = 4,
    FF = 5,
}

impl Dynamic {
    pub fn from_index(i: u8) -> Self {
        match i {
            0 => Dynamic::PP,
            1 => Dynamic::P,
            2 => Dynamic::MP,
            3 => Dynamic::MF,
            4 => Dynamic::F,
            _ => Dynamic::FF,
        }
    }

    pub fn index(self) -> usize {
        self as usize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransitionType {
    /// Fingered legato — same bow, add/remove finger
    Slurred,
    /// Pitch glide between notes
    Portamento,
    /// Fast passage — abbreviated transition
    Run,
    /// Brass rip upward
    Rip,
    /// Brass fall downward
    Fall,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum ArticulationType {
    Sustain = 0,
    SustainNonVib = 1,
    ConSordino = 2,
    Flautando = 3,
    SulTasto = 4,
    SulPonticello = 5,
    Harmonics = 6,
    Spiccato = 7,
    Staccato = 8,
    Staccatissimo = 9,
    Pizzicato = 10,
    BartokPizz = 11,
    ColLegno = 12,
    Tremolo = 13,
    TrillHalf = 14,
    TrillWhole = 15,
    Legato = 16,
    LegatoPortamento = 17,
    Marcato = 18,
    Sforzando = 19,
    FlutterTongue = 20,
    MutedStraight = 21,
    MutedCup = 22,
    MutedHarmon = 23,
    MutedPlunger = 24,
    Crescendo = 25,
    Decrescendo = 26,
    Runs = 27,
}

impl ArticulationType {
    pub fn is_sustaining(self) -> bool {
        matches!(
            self,
            ArticulationType::Sustain
                | ArticulationType::SustainNonVib
                | ArticulationType::ConSordino
                | ArticulationType::Flautando
                | ArticulationType::SulTasto
                | ArticulationType::SulPonticello
                | ArticulationType::Harmonics
                | ArticulationType::Tremolo
                | ArticulationType::Legato
                | ArticulationType::LegatoPortamento
                | ArticulationType::Crescendo
                | ArticulationType::Decrescendo
        )
    }

    pub fn is_legato_capable(self) -> bool {
        matches!(
            self,
            ArticulationType::Legato | ArticulationType::LegatoPortamento
        )
    }
}

// ---------------------------------------------------------------------------
// Sample and Zone structures
// ---------------------------------------------------------------------------

/// Reference to a loaded sample in the sample pool.
#[derive(Debug, Clone, Copy)]
pub struct SampleRef {
    pub sample_id: SampleId,
    pub root_key: u8,
    pub tune_cents: i16,
    pub start: u32,
    pub end: u32,
    pub loop_mode: LoopMode,
    pub loop_start: u32,
    pub loop_end: u32,
    pub loop_crossfade: u32,
}

/// Maximum microphone positions per zone.
pub const MAX_MICS: usize = 8;

/// Maximum velocity layers per articulation.
pub const MAX_VEL_LAYERS: usize = 12;

/// Maximum round-robin groups per dynamic layer.
pub const MAX_RR: usize = 12;

/// Maximum articulations per instrument.
pub const MAX_ARTICULATIONS: usize = 32;

/// Maximum legato transition intervals (+/- semitones).
pub const MAX_LEGATO_INTERVAL: i8 = 12;

/// Maximum voices for WASM target.
pub const MAX_VOICES_WASM: usize = 64;

/// Maximum voices for native target.
pub const MAX_VOICES_NATIVE: usize = 512;

/// A single sample zone — the fundamental unit of the sample map.
#[derive(Debug, Clone, Copy)]
pub struct Zone {
    pub id: ZoneId,
    pub key: KeyRange,
    pub vel: VelRange,
    pub articulation: ArticulationId,
    pub rr_pos: u8,
    pub rr_len: u8,
    pub mic: MicId,
    pub is_release: bool,
    pub sample: SampleRef,
    pub amp_env: AdsrParams,
    pub gain_db: f32,
}

/// ADSR envelope parameters.
#[derive(Debug, Clone, Copy)]
pub struct AdsrParams {
    pub attack: f32,
    pub decay: f32,
    pub sustain: f32,
    pub release: f32,
}

impl Default for AdsrParams {
    fn default() -> Self {
        Self {
            attack: 0.005,
            decay: 0.1,
            sustain: 1.0,
            release: 0.2,
        }
    }
}

/// What the Attack and Release macros do to a zone's own ADSR.
///
/// The offset is **multiplicative on time**, which is the convention shipping
/// samplers use (Kontakt's envelope modulation and Orchestral Tools' Capsule
/// both scale the per-articulation envelope rather than replace it). It has to
/// be: a patch's attack ranges over three orders of magnitude between a 1 ms
/// staccato and a 400 ms swell, so an additive offset in seconds would erase
/// the staccato and barely touch the swell. A ratio keeps the patch's own
/// relative shaping intact and moves the whole instrument in one direction.
///
/// `IDENTITY` — both `1.0` — is the centred macro, and it is exact: the
/// envelope the patch defined, unmultiplied.
#[derive(Debug, Clone, Copy)]
pub struct EnvelopeScaling {
    pub attack: f32,
    pub release: f32,
}

impl EnvelopeScaling {
    pub const IDENTITY: Self = Self {
        attack: 1.0,
        release: 1.0,
    };

    /// Apply the scaling to a zone's envelope. Times only — decay and sustain
    /// are the patch's shaping and neither macro claims them.
    pub fn apply(&self, params: &AdsrParams) -> AdsrParams {
        AdsrParams {
            attack: params.attack * self.attack,
            decay: params.decay,
            sustain: params.sustain,
            release: params.release * self.release,
        }
    }
}

impl Default for EnvelopeScaling {
    fn default() -> Self {
        Self::IDENTITY
    }
}

/// Map a 0..1 macro position onto a multiplicative time scaling. `0.5` is
/// exactly `1.0`, and the extremes are a quarter and four times the patch's own
/// value — two octaves of envelope time either way, which is the usual travel
/// for a macro that has to stay musical across a whole library.
pub fn macro_time_scale(position: f32) -> f32 {
    let centred = position.clamp(0.0, 1.0) - 0.5;
    (centred * 4.0).exp2()
}

// ---------------------------------------------------------------------------
// Mic position
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub struct MicPosition {
    pub id: MicId,
    pub volume: f32,
    pub pan: f32,
    pub delay_samples: u32,
    pub enabled: bool,
    pub stereo_width: f32,
    pub phase_invert: bool,
    /// Pre-computed constant-power pan gains (avoid sqrt per sample).
    pub cached_pan_l: f32,
    pub cached_pan_r: f32,
}

impl MicPosition {
    /// Recompute cached pan gains. Call after changing `pan`.
    pub fn update_pan_cache(&mut self) {
        self.cached_pan_l = ((1.0 - self.pan) * 0.5).sqrt();
        self.cached_pan_r = ((1.0 + self.pan) * 0.5).sqrt();
    }
}

impl Default for MicPosition {
    fn default() -> Self {
        let mut pos = Self {
            id: 0,
            volume: 1.0,
            pan: 0.0,
            delay_samples: 0,
            enabled: true,
            stereo_width: 1.0,
            phase_invert: false,
            cached_pan_l: 0.707,
            cached_pan_r: 0.707,
        };
        pos.update_pan_cache();
        pos
    }
}

// ---------------------------------------------------------------------------
// Dynamic layer and articulation structures
// ---------------------------------------------------------------------------

/// One dynamic layer within an articulation (e.g., pp, mf, ff).
#[derive(Debug, Clone, Copy)]
pub struct DynamicLayer {
    pub dynamic: Dynamic,
    pub vel_range: VelRange,
    /// CC1 range for crossfading (0.0 - 1.0).
    pub cc1_lo: f32,
    pub cc1_hi: f32,
    /// Number of round-robin groups available.
    pub rr_count: u8,
}

/// Legato transition sample reference.
#[derive(Debug, Clone, Copy)]
pub struct LegatoTransition {
    /// Interval in semitones (new_note - old_note).
    pub interval: i8,
    pub transition_type: TransitionType,
    pub dynamic: Dynamic,
    pub sample_id: SampleId,
    /// Time to crossfade from sustain into transition.
    pub crossfade_in_ms: f32,
    /// Time to crossfade from transition into new sustain.
    pub crossfade_out_ms: f32,
}

/// CC curve shape for mapping CC values to dynamic layers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CcCurve {
    Linear,
    SCurve,
    Logarithmic,
}

// ---------------------------------------------------------------------------
// Expression configuration
// ---------------------------------------------------------------------------

/// Per-instrument expression and control mapping.
#[derive(Debug, Clone, Copy)]
pub struct ExpressionConfig {
    pub cc1_curve: CcCurve,
    /// Crossfade time between dynamic layers when CC1 moves (seconds).
    pub dynamic_crossfade_time: f32,
    /// Vibrato LFO rate range (Hz).
    pub vibrato_rate_min: f32,
    pub vibrato_rate_max: f32,
    /// Vibrato depth range (cents).
    pub vibrato_depth_min: f32,
    pub vibrato_depth_max: f32,
    /// Vibrato onset delay (seconds).
    pub vibrato_onset_delay: f32,
}

impl Default for ExpressionConfig {
    fn default() -> Self {
        Self {
            cc1_curve: CcCurve::SCurve,
            dynamic_crossfade_time: 0.1,
            vibrato_rate_min: 4.0,
            vibrato_rate_max: 7.0,
            vibrato_depth_min: 0.0,
            vibrato_depth_max: 40.0,
            vibrato_onset_delay: 0.2,
        }
    }
}

// ---------------------------------------------------------------------------
// Humanization
// ---------------------------------------------------------------------------

/// Humanization parameters — all scaled by a single 0-1 "humanize" amount.
#[derive(Debug, Clone, Copy)]
pub struct HumanizeConfig {
    /// Maximum timing offset in seconds.
    pub timing_max: f32,
    /// Maximum tuning offset in cents.
    pub tuning_max: f32,
    /// Maximum dynamic variation (0-1 scale).
    pub dynamic_max: f32,
    /// Maximum vibrato rate/depth variation (0-1 fraction).
    pub vibrato_var_max: f32,
    /// RNG seed for deterministic renders.
    pub seed: u64,
}

impl Default for HumanizeConfig {
    fn default() -> Self {
        Self {
            timing_max: 0.015,
            tuning_max: 5.0,
            dynamic_max: 0.08,
            vibrato_var_max: 0.15,
            seed: 42,
        }
    }
}

// ---------------------------------------------------------------------------
// Release trigger info
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub struct ReleaseTriggerInfo {
    /// Scale volume by how long the note was held (seconds, clamped).
    pub duration_scale_max: f32,
    /// Scale volume by the current dynamic level (CC1).
    pub dynamic_scale: bool,
}

impl Default for ReleaseTriggerInfo {
    fn default() -> Self {
        Self {
            duration_scale_max: 2.0,
            dynamic_scale: true,
        }
    }
}
