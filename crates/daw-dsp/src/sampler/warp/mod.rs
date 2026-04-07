/// Warp engine — time-stretching and pitch-shifting algorithms.
///
/// Provides multiple algorithms suited for different content types:
///   - Repitch: simple rate change (pitch + duration coupled)
///   - WSOLA: time-domain, best for transients/percussion
///   - Phase Vocoder (IPL): frequency-domain, best for tonal content
///   - Granular: grain-based, best for textures and sound design
pub mod granular;
pub mod phase_vocoder;
pub mod repitch;
pub mod wsola;
