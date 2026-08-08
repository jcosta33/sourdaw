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
///
/// Operates on detector *levels*, in whatever domain the caller measures them
/// (Gluten reads it in dB). The lerp at link 1 is written as an exact return of
/// the linked level rather than `level + 1.0 * (linked - level)`, because that
/// expression is only approximately the linked level in f32 and the detector
/// relies on the two channels agreeing bit-for-bit to take its single-gain-path
/// fast route.
#[inline]
pub fn stereo_link(level_l: f32, level_r: f32, link: f32) -> (f32, f32) {
    let linked_level = level_l.max(level_r);
    if link >= 1.0 {
        return (linked_level, linked_level);
    }
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
