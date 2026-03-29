//! Stereo processing — M/S encoding, stereo linking, parallel mix.

/// Encode L/R to Mid/Side with energy-preserving normalization.
#[inline]
pub fn encode_ms(l: f32, r: f32) -> (f32, f32) {
    let inv_sqrt2 = std::f32::consts::FRAC_1_SQRT_2;
    let m = (l + r) * inv_sqrt2;
    let s = (l - r) * inv_sqrt2;
    (m, s)
}

/// Decode Mid/Side back to L/R.
#[inline]
pub fn decode_ms(m: f32, s: f32) -> (f32, f32) {
    let inv_sqrt2 = std::f32::consts::FRAC_1_SQRT_2;
    let l = (m + s) * inv_sqrt2;
    let r = (m - s) * inv_sqrt2;
    (l, r)
}

/// Stereo link — blend between dual-mono and fully linked.
/// Uses max-based linking to avoid phase cancellation issues.
#[inline]
pub fn stereo_link(level_l: f32, level_r: f32, link: f32) -> (f32, f32) {
    let linked_level = level_l.max(level_r);
    let final_l = level_l + link * (linked_level - level_l);
    let final_r = level_r + link * (linked_level - level_r);
    (final_l, final_r)
}

/// Parallel (dry/wet) mix.
#[inline]
pub fn parallel_mix(dry: f32, wet: f32, mix: f32) -> f32 {
    let dry_gain = 1.0 - mix.min(1.0);
    dry_gain * dry + mix * wet
}

/// Stereo processing mode.
#[derive(Clone, Copy, PartialEq)]
pub enum StereoMode {
    /// Normal stereo (L/R linked)
    Stereo,
    /// Mid channel only
    Mid,
    /// Side channel only
    Side,
    /// Dual mono (independent L/R)
    DualMono,
}
