//! Parameter laws shared by more than one device family: the ranges a
//! `set_param` arm clamps into when several families must agree on them, and
//! the wire names most-duplicated match arms read.
//!
//! The wire names below are the ten names restated by the most `set_param`
//! arms across the crate. Every dispatch arm that reads one of them matches
//! on the const, so one family's rename cannot silently strand another's
//! arm; sites that forward a name rather than dispatch on it — style
//! presets, display-name to wire-name maps, advertised-name tables — spell
//! it literally. Engines outside this crate (`proof-chamber`) cannot import
//! the consts; their `set_param` restatements carry a pointer comment back
//! to this file.

/// Lowest threshold the dB-domain dynamics stages (gluten's topologies,
/// proof's multiband and dynamic EQ, fermenter's synth compressor) accept.
/// Below −60 dBFS a threshold acts on hiss and room rather than programme, so
/// no family offers it.
pub const THRESHOLD_MIN_DB: f32 = -60.0;

/// Highest threshold those stages accept. 0 dBFS is unity: a threshold above
/// it could only compress inter-sample peaks, which the true-peak limiter owns.
pub const THRESHOLD_MAX_DB: f32 = 0.0;

// Wire names, one per most-duplicated `set_param` arm.
pub const DECAY: &str = "decay";
pub const MIX: &str = "mix";
pub const THRESHOLD: &str = "threshold";
pub const TUNE: &str = "tune";
pub const TONE: &str = "tone";
pub const DRIVE: &str = "drive";
pub const ATTACK: &str = "attack";
pub const RELEASE: &str = "release";
pub const MASTER_GAIN: &str = "master_gain";
pub const LIM_LOOKAHEAD: &str = "lim_lookahead";
