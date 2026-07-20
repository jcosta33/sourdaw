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
/// output time). Grain gain is normalized by target/source period: Hann
/// grains of width ≈ 2·period overlap-added at hop = target period sum to
/// ≈ source/(2·target), so the normalization keeps the level shift-independent.
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

    let out_len = out.len().min(input.len());
    let mut out_t = pitch_marks[0] as f32;
    // Synthesis centers increase monotonically, so the nearest analysis mark
    // never moves backwards — resume the scan where the last one landed.
    let mut mark_hint = 0usize;

    while out_t < out_len as f32 {
        let center = out_t.round() as usize;
        if center >= out_len {
            break;
        }

        // Nearest analysis mark to this output position.
        let mut nearest_idx = mark_hint;
        let mut nearest_dist = usize::MAX;
        for idx in mark_hint..pitch_marks.len() {
            let dist = pitch_marks[idx].abs_diff(center);
            if dist < nearest_dist {
                nearest_dist = dist;
                nearest_idx = idx;
            } else if pitch_marks[idx] > center {
                break; // marks are sorted; distance only grows from here
            }
        }
        mark_hint = nearest_idx;
        let pm = pitch_marks[nearest_idx];

        // Local source period from the surrounding marks.
        let p_prev = pitch_marks[nearest_idx.saturating_sub(1)];
        let p_next = pitch_marks[(nearest_idx + 1).min(pitch_marks.len() - 1)];
        let period_samples = ((p_next - p_prev) as f32 * 0.5).max(1.0);
        let half_grain = period_samples.round() as isize;
        let start = (pm as isize - half_grain).max(0) as usize;
        let end = (pm as isize + half_grain).min(input.len() as isize - 1) as usize;

        if end <= start {
            out_t += period_samples;
            continue;
        }

        let grain_len = end - start;
        if grain_len > window_scratchpad.len() {
            out_t += period_samples;
            continue;
        }

        let window = &mut window_scratchpad[..grain_len];
        hann_window_inplace(window);

        // Fetch target pitch for this output position
        let f0_t = target_f0_curve[center.min(target_f0_curve.len() - 1)];
        let target_period_samples = if f0_t > 0.0 {
            cfg.sample_rate / f0_t
        } else {
            period_samples
        };
        let norm = target_period_samples / period_samples;

        for (i, &win) in window.iter().enumerate() {
            let src_idx = start + i;
            let dst_idx = (center as isize - half_grain + i as isize) as usize;

            if dst_idx < out.len() {
                out[dst_idx] += input[src_idx] * win * norm;
            }
        }

        // Advance to the next synthesis mark at the target period
        out_t += target_period_samples;
    }
}
