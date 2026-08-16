/// Core types and constants for the Unified Crumbs Suite.

// ── DSP Constants ──────────────────────────────────────────────────────

/// Pre-allocated voice pool size.
pub const MAX_VOICES: usize = 128;

/// Pre-allocated sample pool slot count.
///
/// The pool is sized once, at construction, because `CrumbsCommand::AddSample`
/// is drained inside the audio callback: growing the slot vector there would
/// allocate on the render thread. Sample ids are allocated monotonically by
/// the host and never reclaimed — every load and every committed recording
/// take consumes one — so this bounds a session's churn, not a kit's size: a
/// slot is one `Option<Arc>`, making headroom nearly free. Ids at or beyond
/// the bound are refused rather than stored, counted by
/// `SamplePool::dropped_write_count`.
pub const MAX_POOL_SAMPLES: usize = 4096;

/// RAM-cached attack per sample (bytes). ~68ms at 44.1kHz mono f32.
pub const PRELOAD_SIZE: usize = 12 * 1024;

/// Per-voice ring buffer capacity (bytes). ~186ms at 44.1kHz mono f32.
pub const STREAM_BUF_SIZE: usize = 64 * 1024;

/// Phase Vocoder STFT window size.
pub const FFT_SIZE_PV: usize = 2048;

/// WSOLA frame length.
pub const WSOLA_FRAME: usize = 1024;

/// WSOLA search window (delta_max).
pub const WSOLA_TOLERANCE: usize = 256;

/// AHDSR target ratio for exponential curve shape.
pub const ENV_TARGET_EXP: f32 = 0.0001;

/// Linear fade-out duration for stolen voices (in seconds).
pub const FADE_STOLEN_SECS: f32 = 0.003;

/// Inverse ramp length for buffer underrun (samples).
pub const FADE_UNDERRUN_SAMPLES: usize = 64;

/// Default crossfade length at loop boundaries (samples).
pub const LOOP_CROSSFADE_DEFAULT: u32 = 256;

/// Minimum crossfade length (samples).
pub const LOOP_CROSSFADE_MIN: u32 = 50;

/// Maximum crossfade length (samples).
pub const LOOP_CROSSFADE_MAX: u32 = 500;

/// Waveform mipmap base block size (samples per min/max pair at level 0).
pub const MIPMAP_BASE_BLOCK: usize = 64;

// ── Enumerations ───────────────────────────────────────────────────────

/// Top-level crumbs operating mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrumbsMode {
    /// Chromatic playback across the keyboard.
    Quick,
    /// MPC-style pad grid with choke groups and one-shots.
    Drum,
    /// Marker-based slicing mapped to pads/keys.
    Slice,
    /// Granular / time-stretch / warp playback.
    Warp,
    /// SP-404 style threshold-triggered recording into pads.
    Record,
}

impl Default for CrumbsMode {
    fn default() -> Self {
        Self::Quick
    }
}

/// Voice-level playback mode (how a single voice behaves).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybackMode {
    /// Play once, then stop.
    OneShot,
    /// Sustain while key held, release on note-off.
    Sustain,
}

impl Default for PlaybackMode {
    fn default() -> Self {
        Self::Sustain
    }
}

/// Loop behavior within a voice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopMode {
    /// No looping — play through and stop.
    Off,
    /// Loop forward continuously.
    Forward,
    /// Bounce back and forth at loop boundaries.
    PingPong,
    /// Play in reverse.
    Reverse,
}

impl Default for LoopMode {
    fn default() -> Self {
        Self::Off
    }
}

/// Filter mode selector.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterType {
    Lowpass,
    Highpass,
    Bandpass,
    Notch,
}

impl Default for FilterType {
    fn default() -> Self {
        Self::Lowpass
    }
}

/// Sample content classification for auto-mode detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleCategory {
    /// Percussive / transient-heavy content.
    Percussive,
    /// Looped / rhythmic content.
    Loop,
    /// Tonal / melodic content.
    Tonal,
    /// Unknown — user must choose mode.
    Unknown,
}

impl Default for SampleCategory {
    fn default() -> Self {
        Self::Unknown
    }
}

// ── Data Structures ────────────────────────────────────────────────────

/// Unique identifier for a loaded sample in the pool.
pub type SampleId = u32;

/// Unique identifier for a voice in the pool.
pub type VoiceId = u8;

/// A slice marker position within a sample.
#[derive(Debug, Clone, Copy)]
pub struct SliceMarker {
    /// Frame index where the slice begins.
    pub start_frame: u32,
    /// Frame index where the slice ends.
    pub end_frame: u32,
    /// MIDI note this slice is mapped to (for Slice mode).
    pub mapped_note: u8,
}

/// Per-pad configuration in Drum mode.
#[derive(Debug, Clone)]
pub struct PadConfig {
    /// Which sample this pad plays (`None` = unassigned).
    pub sample_id: Option<SampleId>,
    /// Playback mode for this pad.
    pub playback_mode: PlaybackMode,
    /// Choke group (0 = no choke group).
    pub choke_group: u8,
    /// Root note for pitch calculation.
    pub root_note: u8,
    /// Gain applied to this pad (0.0–1.0).
    pub gain: f32,
    /// Panning (-1.0 left, 0.0 center, 1.0 right).
    pub pan: f32,
    /// Envelope attack time in seconds.
    pub attack: f32,
    /// Envelope decay time in seconds.
    pub decay: f32,
    /// Envelope sustain level (0.0–1.0).
    pub sustain: f32,
    /// Envelope release time in seconds.
    pub release: f32,
    /// Filter cutoff frequency in Hz.
    pub filter_cutoff: f32,
    /// Filter resonance (0.0–1.0).
    pub filter_resonance: f32,
    /// Filter type.
    pub filter_type: FilterType,
    /// Sample start offset (frames).
    pub start_offset: u32,
    /// Sample end offset (frames, 0 = use full sample).
    pub end_offset: u32,
}

impl Default for PadConfig {
    fn default() -> Self {
        Self {
            sample_id: None,
            playback_mode: PlaybackMode::OneShot,
            choke_group: 0,
            root_note: 60,
            gain: 1.0,
            pan: 0.0,
            attack: 0.001,
            decay: 0.0,
            sustain: 1.0,
            release: 0.01,
            filter_cutoff: 20000.0,
            filter_resonance: 0.0,
            filter_type: FilterType::Lowpass,
            start_offset: 0,
            end_offset: 0,
        }
    }
}

/// Metadata about a loaded sample (analysis results).
#[derive(Debug, Clone)]
pub struct SampleMeta {
    /// Sample rate of the source file.
    pub sample_rate: u32,
    /// Number of channels (1 = mono, 2 = stereo).
    pub channels: u32,
    /// Total number of frames.
    pub frame_count: u32,
    /// Duration in seconds.
    pub duration_secs: f64,
    /// Detected root MIDI note (via pitch detection), if any.
    pub detected_root: Option<u8>,
    /// Detected BPM, if any.
    pub detected_bpm: Option<f32>,
    /// Content classification.
    pub category: SampleCategory,
}

/// Recording state for the Recorder mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordState {
    /// Waiting for input signal to exceed threshold.
    Armed,
    /// Actively recording.
    Recording,
    /// Not recording.
    Idle,
}

impl Default for RecordState {
    fn default() -> Self {
        Self::Idle
    }
}

/// Commands sent from the non-RT management thread to the RT audio thread.
#[derive(Debug)]
pub enum CrumbsCommand {
    NoteOn {
        note: u8,
        velocity: u8,
    },
    NoteOff {
        note: u8,
    },
    SetMode(CrumbsMode),
    SetParam {
        param: CrumbsParam,
        value: f32,
    },
    /// Load a sample into the pool.
    AddSample {
        id: SampleId,
        data: std::sync::Arc<super::sample::SampleData>,
    },
    /// Load a sample into the pool (the data is already in SamplePool;
    /// this command tells the engine to update its active sample reference).
    SetActiveSample(SampleId),
    AllNotesOff,
    AllSoundOff,
    /// Arm the recorder — start watching for threshold.
    ArmRecording {
        /// Amplitude threshold (0.0–1.0) to trigger recording.
        threshold: f32,
        /// Target pad index to record into.
        target_pad: u8,
        /// Maximum recording length in seconds (0 = unlimited until stop).
        max_duration_secs: f32,
    },
    /// Stop recording and commit buffer to sample pool.
    StopRecording,
}

/// Crumbs-wide parameters that can be set from the UI thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrumbsParam {
    MasterGain,
    Attack,
    Hold,
    Decay,
    Sustain,
    Release,
    FilterCutoff,
    FilterResonance,
    FilterType,
    LoopMode,
    LoopStart,
    LoopEnd,
    LoopCrossfade,
    PlaybackMode,
    RootNote,
    Tune,
    Pan,
    /// Number of stacked voices (1 = no stacking, 2-8 = unison).
    StackCount,
    /// Detune spread in cents across stacked voices.
    DetuneSpread,
    /// Stereo spread for stacked voices (0.0 = mono, 1.0 = full stereo).
    StackSpread,
}

/// Resolve a `CrumbsParam` from the parameter id the product uses.
///
/// The names are the `CrumbsDescriptor` parameter ids, so one spelling serves
/// the native `set_crumbs_param` command and the wasm `CrumbsInstance` binding.
/// Keeping the table here rather than beside each caller is deliberate: the
/// live (native) and offline (wasm) paths reading two hand-maintained name maps
/// is precisely how a device ends up honouring a parameter in playback and
/// ignoring it in a render.
pub fn parse_crumbs_param(name: &str) -> Option<CrumbsParam> {
    match name {
        "masterGain" => Some(CrumbsParam::MasterGain),
        "attack" => Some(CrumbsParam::Attack),
        "hold" => Some(CrumbsParam::Hold),
        "decay" => Some(CrumbsParam::Decay),
        "sustain" => Some(CrumbsParam::Sustain),
        "release" => Some(CrumbsParam::Release),
        "filterCutoff" => Some(CrumbsParam::FilterCutoff),
        "filterResonance" => Some(CrumbsParam::FilterResonance),
        "filterType" => Some(CrumbsParam::FilterType),
        "loopMode" => Some(CrumbsParam::LoopMode),
        "loopStart" => Some(CrumbsParam::LoopStart),
        "loopEnd" => Some(CrumbsParam::LoopEnd),
        "loopCrossfade" => Some(CrumbsParam::LoopCrossfade),
        "playbackMode" => Some(CrumbsParam::PlaybackMode),
        "rootNote" => Some(CrumbsParam::RootNote),
        "tune" => Some(CrumbsParam::Tune),
        "pan" => Some(CrumbsParam::Pan),
        "stackCount" => Some(CrumbsParam::StackCount),
        "detuneSpread" => Some(CrumbsParam::DetuneSpread),
        "stackSpread" => Some(CrumbsParam::StackSpread),
        _ => None,
    }
}

/// Resolve a `CrumbsMode` from the mode name the product uses.
///
/// Shared with `set_crumbs_mode` for the same reason as `parse_crumbs_param`.
pub fn parse_crumbs_mode(name: &str) -> Option<CrumbsMode> {
    match name {
        "quick" => Some(CrumbsMode::Quick),
        "drum" => Some(CrumbsMode::Drum),
        "slice" => Some(CrumbsMode::Slice),
        "warp" => Some(CrumbsMode::Warp),
        "record" => Some(CrumbsMode::Record),
        _ => None,
    }
}

/// LFO wave shape for modulation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LfoShape {
    Sine,
    Triangle,
    Saw,
    Square,
    SampleAndHold,
}

impl Default for LfoShape {
    fn default() -> Self {
        Self::Sine
    }
}

/// Per-pad/slice articulator group — independent modulation per voice source.
/// FL Studio-style: each pad gets its own envelope, filter, and LFO settings.
#[derive(Debug, Clone)]
pub struct ArticulatorGroup {
    /// Envelope overrides (None = use global defaults).
    pub attack: Option<f32>,
    pub hold: Option<f32>,
    pub decay: Option<f32>,
    pub sustain: Option<f32>,
    pub release: Option<f32>,
    /// Filter overrides.
    pub filter_cutoff: Option<f32>,
    pub filter_resonance: Option<f32>,
    pub filter_type: Option<FilterType>,
    /// LFO parameters.
    pub lfo_rate: f32,
    pub lfo_depth: f32,
    pub lfo_shape: LfoShape,
    /// LFO target (which parameter the LFO modulates).
    pub lfo_target: LfoTarget,
}

/// What parameter an LFO modulates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LfoTarget {
    None,
    Pitch,
    FilterCutoff,
    Pan,
    Volume,
}

impl Default for LfoTarget {
    fn default() -> Self {
        Self::None
    }
}

impl Default for ArticulatorGroup {
    fn default() -> Self {
        Self {
            attack: None,
            hold: None,
            decay: None,
            sustain: None,
            release: None,
            filter_cutoff: None,
            filter_resonance: None,
            filter_type: None,
            lfo_rate: 1.0,
            lfo_depth: 0.0,
            lfo_shape: LfoShape::Sine,
            lfo_target: LfoTarget::None,
        }
    }
}

/// Maximum number of articulator groups (one per pad in drum mode).
pub const MAX_ARTICULATOR_GROUPS: usize = 8;

/// Maximum number of stacked unison voices.
pub const MAX_STACK_VOICES: u8 = 8;

/// Mod X/Y crossfade state — dual-deck morphing between sample states.
#[derive(Debug, Clone)]
pub struct ModXYState {
    /// Sample ID for deck A.
    pub deck_a_sample: Option<SampleId>,
    /// Sample ID for deck B.
    pub deck_b_sample: Option<SampleId>,
    /// Crossfade position (0.0 = deck A, 1.0 = deck B).
    pub crossfade: f32,
}

impl Default for ModXYState {
    fn default() -> Self {
        Self {
            deck_a_sample: None,
            deck_b_sample: None,
            crossfade: 0.0,
        }
    }
}

/// Per-pad channel strip configuration (Drum Rack-style nesting).
#[derive(Debug, Clone)]
pub struct PadChannelStrip {
    /// Gain (0.0 – 2.0).
    pub gain: f32,
    /// Pan (-1.0 to 1.0).
    pub pan: f32,
    /// Mute state.
    pub muted: bool,
    /// Solo state.
    pub solo: bool,
    /// Send levels (reverb, delay, etc.).
    pub sends: [f32; 4],
    /// Per-pad articulator group.
    pub articulator: ArticulatorGroup,
}

impl Default for PadChannelStrip {
    fn default() -> Self {
        Self {
            gain: 1.0,
            pan: 0.0,
            muted: false,
            solo: false,
            sends: [0.0; 4],
            articulator: ArticulatorGroup::default(),
        }
    }
}
