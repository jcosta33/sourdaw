/// Sampler operating modes.
///
/// Each mode defines how MIDI notes map to sample playback:
///   - Quick: chromatic pitch mapping across the keyboard
///   - Drum: per-pad configuration with choke groups
///   - Slice: marker-defined regions mapped to sequential notes

pub mod drum;
pub mod quick;
pub mod slice;
