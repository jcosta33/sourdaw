// Frozen test-only source oracle from cdf56ae23082998f2f3be0264309ca2c6025dee2.
// The config, span core and Hann helper retain their exact pre-extraction source.
// No post-extraction production PSOLA code is imported by this oracle.
#![allow(dead_code)]

use std::f32::consts::PI;

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

/// Span-aware PSOLA core shared by the offline path and the RT engine.
///
/// Synthesis centers are *output coordinates* walking `[coord_start,
/// coord_end)` at the local target period. Input (span) coordinates are
/// `output coordinate + input_offset`; output buffer indices are
/// `output coordinate + out_offset`. This lets the RT engine render a
/// history margin (negative coordinates) so frame boundaries overlap-add
/// seamlessly. `pitch_marks`, `target_f0_curve` and `grain_rate_curve` are
/// in input coordinates. Grains are written with src/dst in lockstep
/// (`dst − src == center − pm`), so edge-clamped grains stay aligned.
///
/// `grain_rate_curve` is parallel to `input` and carries each grain's source
/// read rate, relative to output time, at that position. `1.0` is textbook
/// TD-PSOLA: grains copied unresampled, only their spacing changes, so the
/// spectral envelope — the formants — stays where the singer put it while
/// the fundamental moves (formant correction ON). The pitch ratio makes each
/// grain read `ratio` source samples per output sample, which scales the
/// grain's whole spectrum by `ratio` — formants included — the
/// varispeed/"chipmunk" relation (formant correction OFF). Level is
/// unaffected either way: the Hann window is still applied in output
/// coordinates at width 2·P_t and hop P_t, so COLA still sums to 1.
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
    pitch_marks: &[usize],    // epoch indices, input coordinates
    target_f0_curve: &[f32],  // parallel to input
    grain_rate_curve: &[f32], // parallel to input
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

        // Formant-tracking grain: read the source at the local grain rate —
        // samples of source per output sample — instead of one-for-one. The
        // rate comes from the curve at this grain's source center, so the
        // formant coupling can ride the retune glide instead of being fixed
        // per render. Driven from the *output* offset `d` rather than the
        // source index, because the grain's output width is still 2·P_t
        // while the span of source it consumes is 2·P_t·rate.
        // Bounds-skipped, not clamped, so the edge behaviour matches the
        // unresampled path (a clamp would smear the first/last sample across
        // the whole overhang).
        let grain_rate = grain_rate_curve[src_center.min(grain_rate_curve.len().saturating_sub(1))];
        if grain_rate != 1.0 {
            for d in -half_grain..half_grain {
                let pos = pm as f32 + d as f32 * grain_rate;
                if pos < 0.0 || pos >= (input.len() - 1) as f32 {
                    continue;
                }
                let base = pos.floor();
                let index = base as usize;
                let frac = pos - base;
                let sample = input[index] * (1.0 - frac) + input[index + 1] * frac;
                let win = window[((d + half_grain) as usize).min(full_len - 1)];
                let dst_idx = center + d + out_offset;
                if dst_idx >= 0 && (dst_idx as usize) < out.len() {
                    out[dst_idx as usize] += sample * win;
                }
            }
            out_t += target_period_samples;
            continue;
        }

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

/// Populates the provided slice with a Hann window.
pub fn hann_window_inplace(window: &mut [f32]) {
    let n = window.len();
    if n == 0 {
        return;
    }
    if n == 1 {
        window[0] = 1.0;
        return;
    }
    for (i, val) in window.iter_mut().enumerate() {
        *val = 0.5 * (1.0 - (2.0 * PI * i as f32 / (n - 1) as f32).cos());
    }
}
