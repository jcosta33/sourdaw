//! Pitch-Synchronous Overlap-Add (PSOLA) Shifter

use crate::knead::utils::hann_window_inplace;

pub struct PsolaConfig {
    pub sample_rate: f32,
    pub max_semitones_transparent: f32,
}

impl Default for PsolaConfig {
    fn default() -> Self {
        Self {
            sample_rate: 44100.0,
            max_semitones_transparent: 4.0,
        }
    }
}

/// Offline PSOLA processing over a pre-computed array of pitch marks and target f0 curve.
/// Writes the result into the provided `out` slice.
///
/// Synthesis marks walk the output at the local *target* period, so the full
/// duration stays covered for both up- and down-shifts (pitch shift without
/// time stretch). Each synthesis grain is taken from the analysis mark
/// nearest to its output position (duration preserved ⇒ source time ==
/// output time) with a width of ≈ 2 target periods, so the Hann overlap-add
/// sums to ≈1 (COLA) and the level stays shift-independent.
pub fn psola_process_offline_inplace(
    input: &[f32],
    pitch_marks: &[usize],   // array of epoch indices
    target_f0_curve: &[f32], // parallel to input length
    cfg: &PsolaConfig,
    window_scratchpad: &mut [f32], // Passed in to avoid stack/heap allocation
    out: &mut [f32],
) {
    // Zero out the output buffer first
    for sample in out.iter_mut() {
        *sample = 0.0;
    }

    if pitch_marks.len() < 3 {
        let len = input.len().min(out.len());
        out[..len].copy_from_slice(&input[..len]);
        return;
    }

    let coord_end = out.len().min(input.len()) as f32;
    psola_process_span(
        input,
        pitch_marks,
        target_f0_curve,
        cfg,
        window_scratchpad,
        out,
        0,
        0,
        pitch_marks[0] as f32,
        coord_end,
    );
}

/// Span-aware PSOLA core shared by the offline path and the RT engine.
///
/// Synthesis centers are *output coordinates* walking `[coord_start,
/// coord_end)` at the local target period. Input (span) coordinates are
/// `output coordinate + input_offset`; output buffer indices are
/// `output coordinate + out_offset`. This lets the RT engine render a
/// history margin (negative coordinates) so frame boundaries overlap-add
/// seamlessly. `pitch_marks` and `target_f0_curve` are in input
/// coordinates. Grains are written with src/dst in lockstep
/// (`dst − src == center − pm`), so edge-clamped grains stay aligned.
///
/// `coord_start` may be negative and should carry the synthesis phase from
/// the previous frame so the center lattice stays continuous across frames
/// (a per-frame restart misaligns the lattice whenever frame_size is not a
/// multiple of the target period). Returns the final synthesis pointer —
/// subtract the frame length to get the next frame's phase.
///
/// `out` is fully overwritten. `pitch_marks` must hold ≥ 3 marks.
#[allow(clippy::too_many_arguments)]
pub(crate) fn psola_process_span(
    input: &[f32],
    pitch_marks: &[usize],   // epoch indices, input coordinates
    target_f0_curve: &[f32], // parallel to input
    cfg: &PsolaConfig,
    window_scratchpad: &mut [f32],
    out: &mut [f32],
    input_offset: isize,
    out_offset: isize,
    coord_start: f32,
    coord_end: f32,
) -> f32 {
    for sample in out.iter_mut() {
        *sample = 0.0;
    }

    let mut out_t = coord_start;
    // Synthesis centers increase monotonically, so the nearest analysis mark
    // never moves backwards — resume the scan where the last one landed.
    let mut mark_hint = 0usize;

    while out_t < coord_end {
        let center = out_t.round() as isize;
        if center as f32 >= coord_end {
            break;
        }
        let src_center =
            (center + input_offset).clamp(0, input.len().saturating_sub(1) as isize) as usize;

        // Nearest analysis mark to this output position.
        let mut nearest_idx = mark_hint;
        let mut nearest_dist = usize::MAX;
        for idx in mark_hint..pitch_marks.len() {
            let dist = pitch_marks[idx].abs_diff(src_center);
            if dist < nearest_dist {
                nearest_dist = dist;
                nearest_idx = idx;
            } else if pitch_marks[idx] > src_center {
                break; // marks are sorted; distance only grows from here
            }
        }
        mark_hint = nearest_idx;
        let pm = pitch_marks[nearest_idx];

        // Local source period. Interior marks average both neighbours; the
        // first/last mark must use a one-sided period — averaging with
        // itself (p_prev == pm at index 0) halves the period and shrinks
        // the edge grains, which produced per-frame dropouts.
        let p_prev = pitch_marks[nearest_idx.saturating_sub(1)];
        let p_next = pitch_marks[(nearest_idx + 1).min(pitch_marks.len() - 1)];
        let period_samples = if nearest_idx == 0 {
            (p_next - pm) as f32
        } else if nearest_idx == pitch_marks.len() - 1 {
            (pm - p_prev) as f32
        } else {
            (p_next - p_prev) as f32 * 0.5
        }
        .max(1.0);

        // Fetch target pitch for this output position first: the grain
        // width follows the *synthesis* period (classic TD-PSOLA ≈ 2·P_t
        // output-side). Hann grains of width 2·P_t at hop P_t sum to ≈1 by
        // construction (COLA), so level stays shift-independent without a
        // normalization factor.
        let f0_t = target_f0_curve[src_center.min(target_f0_curve.len() - 1)];
        let target_period_samples = if f0_t > 0.0 {
            cfg.sample_rate / f0_t
        } else {
            period_samples
        };

        let half_grain = target_period_samples.round() as isize;
        let start = (pm as isize - half_grain).max(0) as usize;
        let end = (pm as isize + half_grain)
            .min(input.len() as isize - 1)
            .max(0) as usize;

        if end <= start {
            out_t += target_period_samples;
            continue;
        }

        // Window over the FULL intended grain width, indexed by absolute
        // position within the grain (src − pm + half). Building it over the
        // clamped slice instead rescales the window at the edges and spikes
        // the COLA sum (~1.5x peak at the boundaries).
        let full_len = (2 * half_grain).max(1) as usize;
        if full_len > window_scratchpad.len() {
            out_t += target_period_samples;
            continue;
        }

        let window = &mut window_scratchpad[..full_len];
        hann_window_inplace(window);

        for src_idx in start..end {
            let win_idx = (src_idx as isize - pm as isize + half_grain) as usize;
            let win = window[win_idx.min(full_len - 1)];
            // src/dst in lockstep: dst − src == center − pm, also for
            // edge-clamped grains (the previous center − half + i mapping
            // lost alignment whenever start was clamped).
            let dst_idx = center + src_idx as isize - pm as isize + out_offset;

            if dst_idx >= 0 && (dst_idx as usize) < out.len() {
                out[dst_idx as usize] += input[src_idx] * win;
            }
        }

        // Advance to the next synthesis mark at the target period
        out_t += target_period_samples;
    }

    out_t
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    /// Full-scale harmonically rich periodic signal (PSOLA needs epochs).
    fn pitched(freq: f32, sample_rate: f32, len: usize, peak: f32) -> Vec<f32> {
        let raw: Vec<f32> = (0..len)
            .map(|n| {
                let mut s = 0.0_f32;
                for h in 1..=8 {
                    s += (TAU * freq * h as f32 * n as f32 / sample_rate).sin() / h as f32;
                }
                s
            })
            .collect();
        let max = raw.iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
        raw.iter().map(|s| s / max * peak).collect()
    }

    /// Analysis marks every source period; target curve filled with the
    /// shifted fundamental.
    fn marks_and_curve(
        f0: f32,
        target_f0: f32,
        sample_rate: f32,
        len: usize,
    ) -> (Vec<usize>, Vec<f32>) {
        let period = sample_rate / f0;
        let mut marks = Vec::new();
        let mut m = 0.0_f32;
        while (m as usize) < len {
            marks.push(m as usize);
            m += period;
        }
        (marks, vec![target_f0; len])
    }

    fn run_psola(input: &[f32], f0: f32, target_f0: f32, sample_rate: f32) -> Vec<f32> {
        let (marks, curve) = marks_and_curve(f0, target_f0, sample_rate, input.len());
        let cfg = PsolaConfig {
            sample_rate,
            max_semitones_transparent: 12.0,
        };
        let mut scratch = vec![0.0_f32; (sample_rate / 20.0) as usize * 4];
        let mut out = vec![0.0_f32; input.len()];
        psola_process_offline_inplace(input, &marks, &curve, &cfg, &mut scratch, &mut out);
        out
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    fn peak(x: &[f32]) -> f32 {
        x.iter().map(|s| s.abs()).fold(0.0_f32, f32::max)
    }

    /// Longest run of near-silence (< -60 dBFS) — the dropout signature.
    fn longest_near_zero_run(x: &[f32]) -> usize {
        let mut longest = 0usize;
        let mut run = 0usize;
        for &s in x {
            if s.abs() < 0.001 {
                run += 1;
                longest = longest.max(run);
            } else {
                run = 0;
            }
        }
        longest
    }

    const SR: f32 = 44100.0;
    const SKIP: usize = 4096; // edge warm-up on both ends

    #[test]
    fn unity_shift_is_transparent() {
        let input = pitched(220.0, SR, SR as usize, 1.0);
        let out = run_psola(&input, 220.0, 220.0, SR);
        let mut num = 0.0_f32;
        let mut den = 0.0_f32;
        for i in SKIP..input.len() - SKIP {
            num += (out[i] - input[i]).powi(2);
            den += input[i].powi(2);
        }
        let rel_err = (num / den.max(1e-9)).sqrt();
        assert!(
            rel_err < 0.1,
            "unity shift diverged from input (rel err {rel_err:.3})"
        );
    }

    /// Regression (PR #532 review): grain width pinned to the source period
    /// with norm = target/source mis-normalized level — measured +12 st at
    /// −6.4 dB, −12 st at +2.5 dB with 2x peak overshoot.
    #[test]
    fn octave_shifts_hold_rms_within_1db_and_do_not_overshoot() {
        let input = pitched(220.0, SR, SR as usize, 1.0);
        let rms_in = rms(&input[SKIP..input.len() - SKIP]);
        let peak_in = peak(&input);

        for (target, label) in [(440.0, "+12 st"), (110.0, "-12 st")] {
            let out = run_psola(&input, 220.0, target, SR);
            let rms_out = rms(&out[SKIP..out.len() - SKIP]);
            let db = 20.0 * (rms_out / rms_in).log10();
            assert!(
                db.abs() < 1.0,
                "{label} rms deviation {db:+.2} dB, expected |dB| < 1"
            );
            let peak_out = peak(&out);
            assert!(
                peak_out <= peak_in * 1.01,
                "{label} peak overshoot: out {peak_out:.2} vs in {peak_in:.2}"
            );
        }
    }

    /// Regression (PR #532 review): half-period edge grains caused dropouts.
    /// Interior output must never go near-silent for more than a fraction of
    /// a target period (grain edges can legitimately approach zero between
    /// epochs of a periodic signal, so bound the *run*, not the minima).
    #[test]
    fn no_zero_run_dropouts() {
        let input = pitched(220.0, SR, SR as usize, 1.0);
        for (target, label) in [(440.0, "+12 st"), (110.0, "-12 st"), (220.0, "unity")] {
            let out = run_psola(&input, 220.0, target, SR);
            let run = longest_near_zero_run(&out[SKIP..out.len() - SKIP]);
            let bound = (SR / target) as usize; // one target period
            assert!(
                run <= bound,
                "{label} dropout run {run} samples, bound {bound} (one target period)"
            );
        }
    }
}
