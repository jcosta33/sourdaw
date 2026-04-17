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

    // output time pointer for the next grain
    let mut current_out_t = pitch_marks[0] as f32;

    for n in 1..pitch_marks.len() - 1 {
        let pm = pitch_marks[n];
        let p_prev = pitch_marks[n - 1];
        let p_next = pitch_marks[n + 1];

        // Determine source period roughly
        let period_samples = (p_next - p_prev) as f32 * 0.5;
        let half_grain = period_samples.round() as isize;
        let start = (pm as isize - half_grain).max(0) as usize;
        let end = (pm as isize + half_grain).min(input.len() as isize - 1) as usize;

        if end <= start {
            continue;
        }

        let grain_len = end - start;
        if grain_len > window_scratchpad.len() {
            continue; // Safety bail
        }
        
        let window = &mut window_scratchpad[..grain_len];
        hann_window_inplace(window);

        // Fetch target pitch for this pitch mark
        let f0_t = target_f0_curve[pm];
        let target_period_samples = if f0_t > 0.0 {
            cfg.sample_rate / f0_t
        } else {
            period_samples
        };

        // Determine where this grain lands in the output
        let dst_center = current_out_t.round() as isize;

        let out_start = dst_center - half_grain;

        for (i, &win) in window.iter().enumerate() {
            let src_idx = start + i;
            let dst_idx = (out_start + i as isize) as usize;

            if dst_idx < out.len() {
                out[dst_idx] += input[src_idx] * win;
            }
        }

        // Advance output pointers by the new period
        current_out_t += target_period_samples;
    }
}
