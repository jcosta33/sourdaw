//! NaN/Inf output-boundary guard (DSP-8).
//!
//! A single non-finite sample (NaN, +Inf, -Inf) in a WebAudio output buffer
//! propagates through every downstream node and can silence the whole graph.
//! Each device family scrubs its output block with [`sanitize_block`]
//! immediately before returning the buffer pointer to the AudioWorklet: every
//! non-finite sample is replaced with silence (`0.0`) and the count is reported
//! so a poisoned block *surfaces* through a telemetry counter rather than being
//! scrubbed silently.
//!
//! RT-safe: no allocation, no locking, one `is_finite` branch per sample.

/// Replace every non-finite sample (NaN, +Inf, -Inf) in `block` with `0.0`.
///
/// Returns the number of samples that were scrubbed so a caller can surface a
/// poisoned block through a telemetry counter. Finite samples are left
/// bit-identical — the guard is transparent for well-behaved signals.
#[inline]
pub fn sanitize_block(block: &mut [f32]) -> usize {
    let mut scrubbed = 0;
    for sample in block.iter_mut() {
        if !sample.is_finite() {
            *sample = 0.0;
            scrubbed += 1;
        }
    }
    scrubbed
}

#[cfg(test)]
mod tests {
    use super::sanitize_block;

    #[test]
    fn scrubs_nan_inf_and_neg_inf_to_zero() {
        let mut block = [0.5, f32::NAN, -0.25, f32::INFINITY, f32::NEG_INFINITY, 1.0];
        let scrubbed = sanitize_block(&mut block);
        assert_eq!(scrubbed, 3, "three non-finite samples must be counted");
        assert_eq!(block, [0.5, 0.0, -0.25, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn finite_block_is_bit_identical_and_reports_zero() {
        let original = [0.0, -1.0, 0.123_456_79, 0.999_999, -0.5, f32::MIN, f32::MAX];
        let mut block = original;
        let scrubbed = sanitize_block(&mut block);
        assert_eq!(scrubbed, 0, "a finite block scrubs nothing");
        for (out, expected) in block.iter().zip(original.iter()) {
            assert_eq!(
                out.to_bits(),
                expected.to_bits(),
                "finite samples stay bit-exact"
            );
        }
    }

    #[test]
    fn empty_block_is_a_noop() {
        let mut block: [f32; 0] = [];
        assert_eq!(sanitize_block(&mut block), 0);
    }
}
