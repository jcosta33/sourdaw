/// Smart Loop Points — automatic zero-crossing detection and crossfade
/// length calculation for click-free loops.
///
/// Scans the waveform to find optimal loop start/end positions that land
/// on zero crossings with similar waveform shape, minimizing click artifacts.

/// Result of smart loop point detection.
#[derive(Debug, Clone)]
pub struct LoopPointResult {
    /// Optimal loop start position (frame index).
    pub start_frame: u32,
    /// Optimal loop end position (frame index).
    pub end_frame: u32,
    /// Recommended crossfade length (samples).
    pub crossfade_length: u32,
    /// Quality score (0.0 = poor match, 1.0 = perfect).
    pub quality: f32,
}

/// Configuration for loop point detection.
#[derive(Debug, Clone)]
pub struct LoopPointConfig {
    /// Minimum loop length in seconds.
    pub min_loop_secs: f32,
    /// Search window size around candidate points (samples).
    pub search_window: usize,
    /// Correlation window for matching loop start/end shape (samples).
    pub correlation_window: usize,
    /// Minimum crossfade length (samples).
    pub min_crossfade: u32,
    /// Maximum crossfade length (samples).
    pub max_crossfade: u32,
}

impl Default for LoopPointConfig {
    fn default() -> Self {
        Self {
            min_loop_secs: 0.1,
            search_window: 512,
            correlation_window: 256,
            min_crossfade: 50,
            max_crossfade: 500,
        }
    }
}

/// Ceiling on how many candidate (start, end) pairs the search will consider.
///
/// The pairing is O(crossings²) and every pair costs a normalized correlation
/// over `correlation_window` samples. A bright multi-second sample yields tens
/// of thousands of zero crossings on each side of the midpoint, so the raw
/// pairing runs to hundreds of millions of correlations — and the native command
/// that asks for loop points waits for all of them.
///
/// The value is a budget, not a measurement: it is the work the offline search
/// is allowed to spend, chosen so the worst case stays in the tens of
/// milliseconds at the default 256-sample correlation window.
const MAX_CANDIDATE_PAIRS: usize = 100_000;

/// Strides that bring the pairing of two candidate lists inside
/// [`MAX_CANDIDATE_PAIRS`], as `(start_stride, end_stride)`.
///
/// Candidates are strided rather than truncated, so the survivors stay spread
/// across the whole buffer. Truncation would be cheaper and wrong: it would
/// confine every detectable loop to the earliest region of the sample, which is
/// exactly where a sustained instrument's loop should not be taken from. The
/// strides depend only on the candidate counts, so the search stays
/// deterministic — no sampling, no RNG.
///
/// At most one list is strided. Zero crossings on periodic material fall into
/// phase classes — one crossing per cycle of each waveform feature — and a
/// perfect loop joins two crossings of the *same* class. Striding both lists by
/// one factor `s` makes the reachable crossing-index differences a single
/// residue progression, so whether any same-class pair survives is decided by
/// number theory (`gcd(s, classes) | offset`) rather than by the audio: on a
/// two-class signal, shifting the material by one sample flips the search
/// between finding a perfect loop and finding none. With one list left
/// exhaustive, every kept candidate on the strided side still meets all of its
/// in-phase partners on the other side, so a perfect loop stays reachable
/// whatever the stride. The longer list is the one strided, which keeps the
/// most survivors for the same budget.
///
/// Only when one list is by itself longer than the whole budget — several
/// hundred thousand admissible crossings on one side — does the other list get
/// strided too, trading the reachability guarantee for termination. `(1, 1)`
/// means the budget was never binding and the search below is exhaustive.
fn stride_plan(num_starts: usize, num_ends: usize) -> (usize, usize) {
    if num_starts == 0 || num_ends == 0 || num_starts * num_ends <= MAX_CANDIDATE_PAIRS {
        return (1, 1);
    }

    let (long, short) = if num_starts >= num_ends {
        (num_starts, num_ends)
    } else {
        (num_ends, num_starts)
    };

    // Smallest stride on the longer list that fits the budget with the shorter
    // list exhaustive; `max(1)` guards the short > budget case below.
    let long_kept = (MAX_CANDIDATE_PAIRS / short).max(1);
    let long_stride = long.div_ceil(long_kept);

    // The shorter list alone can exceed the budget; stride it down to fit
    // against the single survivor of the longer list.
    let short_stride = if short > MAX_CANDIDATE_PAIRS {
        short.div_ceil(MAX_CANDIDATE_PAIRS)
    } else {
        1
    };

    if num_starts >= num_ends {
        (long_stride, short_stride)
    } else {
        (short_stride, long_stride)
    }
}

/// Keep every `stride`-th candidate.
///
/// This is the whole of the coverage rule: the kept candidates are spread over
/// the entire list, so the last kept one is always within `stride` positions of
/// the last admissible one. Truncating to a prefix would satisfy the same
/// budget while confining every result to the front of the buffer.
fn strided_candidates(candidates: &[usize], stride: usize) -> Vec<usize> {
    candidates.iter().copied().step_by(stride).collect()
}

/// The best (start, end) pairing the correlation search found.
#[derive(Debug, Clone, Copy, PartialEq)]
struct BestPair {
    start: usize,
    end: usize,
    quality: f32,
}

/// Outcome of [`search_best_pair`], including the work it did.
///
/// `evaluations` is reported rather than discarded so the budget is checkable
/// at the place it is enforced instead of inferred from wall-clock time.
#[derive(Debug, Clone, Copy)]
struct PairSearch {
    /// `None` when no pair was evaluated, or when every evaluated pair scored
    /// at or below the `-1.0` floor of a normalized correlation.
    best: Option<BestPair>,
    /// Number of normalized correlations actually evaluated. Never exceeds the
    /// strided pair count, which never exceeds [`MAX_CANDIDATE_PAIRS`].
    evaluations: usize,
}

/// Score every admissible (start, end) candidate pair and keep the best.
///
/// Candidates come from the zero crossings: loop starts from the prefix that
/// leaves a whole correlation window inside the first half, loop ends from the
/// crossings past the midpoint that leave one inside the buffer. Ties keep the
/// earliest pair in ascending (end, start) order.
fn search_best_pair(
    samples: &[f32],
    crossings: &[usize],
    half: usize,
    corr_win: usize,
    min_loop_frames: usize,
) -> PairSearch {
    // `crossings` is ascending, so the admissible starts are a prefix.
    let starts: Vec<usize> = crossings
        .iter()
        .copied()
        .take_while(|&pos| pos + corr_win < half)
        .collect();
    let ends: Vec<usize> = crossings
        .iter()
        .copied()
        .filter(|&pos| pos >= half && pos + corr_win < samples.len())
        .collect();

    let (start_stride, end_stride) = stride_plan(starts.len(), ends.len());
    let starts = strided_candidates(&starts, start_stride);
    let ends = strided_candidates(&ends, end_stride);

    let mut best: Option<BestPair> = None;
    let mut best_quality = -1.0f32;
    let mut evaluations = 0usize;

    for &end_pos in &ends {
        for &start_pos in &starts {
            // Every start is below `half` and every end is at or above it, so
            // this cannot underflow.
            if end_pos - start_pos < min_loop_frames {
                continue;
            }

            // Normalized cross-correlation between waveform shapes.
            let quality = normalized_correlation(
                &samples[start_pos..start_pos + corr_win],
                &samples[end_pos..end_pos + corr_win],
            );
            evaluations += 1;

            if quality > best_quality {
                best_quality = quality;
                best = Some(BestPair {
                    start: start_pos,
                    end: end_pos,
                    quality,
                });
            }
        }
    }

    PairSearch { best, evaluations }
}

/// Find optimal loop points by locating zero-crossings with similar waveform shape.
///
/// Strategy:
/// 1. Find all zero-crossings in the sample.
/// 2. For candidate loop-end positions (in the second half of the sample),
///    find the best matching loop-start position (in the first half) using
///    normalized cross-correlation of the surrounding waveform.
/// 3. Select the pair with the highest correlation.
/// 4. Calculate crossfade length based on the local waveform period.
///
/// Step 2 is bounded by [`MAX_CANDIDATE_PAIRS`]; below that bound it is the
/// exhaustive pairing.
pub fn detect_loop_points(
    samples: &[f32],
    sample_rate: u32,
    config: &LoopPointConfig,
) -> Option<LoopPointResult> {
    let min_loop_frames = (config.min_loop_secs * sample_rate as f32) as usize;
    if samples.len() < min_loop_frames * 2 {
        return None;
    }

    // Find zero crossings.
    let crossings = find_zero_crossings(samples);
    if crossings.len() < 4 {
        return None;
    }

    let half = samples.len() / 2;
    let search = search_best_pair(
        samples,
        &crossings,
        half,
        config.correlation_window,
        min_loop_frames,
    );
    debug_assert!(
        search.evaluations <= MAX_CANDIDATE_PAIRS,
        "the loop-point search ran {} correlations against a budget of {MAX_CANDIDATE_PAIRS}",
        search.evaluations
    );

    // A negative best correlation means the closest match found was still an
    // inversion; that is reported as "no loop points" rather than as a poor one.
    let best = search.best.filter(|pair| pair.quality >= 0.0)?;

    // Calculate crossfade length based on local zero-crossing period.
    let local_period = estimate_local_period(samples, best.end, config.search_window);
    let crossfade = (local_period as u32).clamp(config.min_crossfade, config.max_crossfade);

    Some(LoopPointResult {
        start_frame: best.start as u32,
        end_frame: best.end as u32,
        crossfade_length: crossfade,
        quality: best.quality,
    })
}

/// Find all positive-going zero crossings in the sample.
fn find_zero_crossings(samples: &[f32]) -> Vec<usize> {
    let mut crossings = Vec::new();
    for i in 0..samples.len() - 1 {
        // Positive-going zero crossing.
        if samples[i] <= 0.0 && samples[i + 1] > 0.0 {
            crossings.push(i + 1);
        }
    }
    crossings
}

/// Normalized cross-correlation between two equal-length slices.
/// Returns a value between -1.0 (inverse) and 1.0 (perfect match).
fn normalized_correlation(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    if n == 0 {
        return 0.0;
    }

    let mut sum_ab = 0.0f32;
    let mut sum_aa = 0.0f32;
    let mut sum_bb = 0.0f32;

    for i in 0..n {
        sum_ab += a[i] * b[i];
        sum_aa += a[i] * a[i];
        sum_bb += b[i] * b[i];
    }

    let denom = (sum_aa * sum_bb).sqrt();
    if denom < 1e-10 {
        return 0.0;
    }

    sum_ab / denom
}

/// Estimate the local waveform period by finding the distance between
/// zero crossings near a given position.
fn estimate_local_period(samples: &[f32], position: usize, window: usize) -> usize {
    let start = position.saturating_sub(window);
    let end = (position + window).min(samples.len() - 1);

    let mut prev_crossing = None;
    let mut periods = Vec::new();

    for i in start..end {
        if i + 1 >= samples.len() {
            break;
        }
        if samples[i] <= 0.0 && samples[i + 1] > 0.0 {
            if let Some(prev) = prev_crossing {
                periods.push(i - prev);
            }
            prev_crossing = Some(i);
        }
    }

    if periods.is_empty() {
        return 128; // Fallback default
    }

    // Return median period.
    periods.sort_unstable();
    periods[periods.len() / 2]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A sine whose amplitude drifts across the buffer, so candidate windows
    /// genuinely score differently and the search has an ordering it can get
    /// wrong. One positive-going zero crossing per `period`.
    fn drifting_sine(len: usize, period: usize) -> Vec<f32> {
        (0..len)
            .map(|i| {
                let phase = 2.0 * std::f32::consts::PI * i as f32 / period as f32;
                let envelope = 0.4 + 0.6 * (i as f32 / len as f32);
                phase.sin() * envelope
            })
            .collect()
    }

    /// The exhaustive nested scan the bounded search must reproduce whenever
    /// the budget is not binding, written out here so the equivalence claim
    /// does not depend on the code it is checking.
    fn exhaustive_best(
        samples: &[f32],
        crossings: &[usize],
        half: usize,
        corr_win: usize,
        min_loop_frames: usize,
    ) -> (Option<BestPair>, usize) {
        let mut best: Option<BestPair> = None;
        let mut best_quality = -1.0f32;
        let mut evaluations = 0usize;

        for &end_pos in crossings {
            if end_pos < half || end_pos + corr_win >= samples.len() {
                continue;
            }
            for &start_pos in crossings {
                if start_pos + corr_win >= half {
                    break;
                }
                if end_pos - start_pos < min_loop_frames {
                    continue;
                }
                let quality = normalized_correlation(
                    &samples[start_pos..start_pos + corr_win],
                    &samples[end_pos..end_pos + corr_win],
                );
                evaluations += 1;
                if quality > best_quality {
                    best_quality = quality;
                    best = Some(BestPair {
                        start: start_pos,
                        end: end_pos,
                        quality,
                    });
                }
            }
        }

        (best, evaluations)
    }

    /// Count the candidates on each side under the search's own admissibility
    /// rules, so a fixture's raw pairing size can be stated independently.
    fn candidate_counts(
        samples: &[f32],
        crossings: &[usize],
        half: usize,
        corr_win: usize,
    ) -> (usize, usize) {
        let starts = crossings
            .iter()
            .take_while(|&&pos| pos + corr_win < half)
            .count();
        let ends = crossings
            .iter()
            .filter(|&&pos| pos >= half && pos + corr_win < samples.len())
            .count();
        (starts, ends)
    }

    #[test]
    fn below_the_budget_the_search_is_exactly_the_exhaustive_one() {
        const LEN: usize = 2_000;
        const CORR_WIN: usize = 64;

        let samples = drifting_sine(LEN, 64);
        let crossings = find_zero_crossings(&samples);
        let half = samples.len() / 2;

        let (starts, ends) = candidate_counts(&samples, &crossings, half, CORR_WIN);
        assert!(
            starts * ends <= MAX_CANDIDATE_PAIRS,
            "fixture must fit the budget to test the unstrided path, had {starts}×{ends} pairs"
        );
        assert_eq!(
            stride_plan(starts, ends),
            (1, 1),
            "an unbinding budget must not stride"
        );

        let search = search_best_pair(&samples, &crossings, half, CORR_WIN, 128);
        let (expected, expected_evaluations) =
            exhaustive_best(&samples, &crossings, half, CORR_WIN, 128);

        assert!(expected.is_some(), "fixture produced no candidate pair");
        assert_eq!(
            search.best, expected,
            "the bounded search picked a different pair than the exhaustive scan"
        );
        assert_eq!(
            search.evaluations, expected_evaluations,
            "the bounded search skipped pairs the exhaustive scan evaluated"
        );
    }

    #[test]
    fn a_dense_signal_is_searched_inside_the_pair_budget() {
        const LEN: usize = 8_000;
        const CORR_WIN: usize = 16;

        let samples = drifting_sine(LEN, 8);
        let crossings = find_zero_crossings(&samples);
        let half = samples.len() / 2;

        let (starts, ends) = candidate_counts(&samples, &crossings, half, CORR_WIN);
        assert!(
            starts * ends > MAX_CANDIDATE_PAIRS,
            "fixture must exceed the budget to test the strided path, had {starts}×{ends} pairs"
        );
        assert!(
            stride_plan(starts, ends) != (1, 1),
            "a binding budget must stride a candidate list"
        );

        let search = search_best_pair(&samples, &crossings, half, CORR_WIN, 0);

        assert!(
            search.evaluations <= MAX_CANDIDATE_PAIRS,
            "the search ran {} correlations against a budget of {MAX_CANDIDATE_PAIRS}",
            search.evaluations
        );
        assert!(
            search.best.is_some(),
            "the bounded search must still return a pair"
        );
    }

    /// The budget could equally be met by truncating each candidate list to a
    /// prefix, which would confine every detectable loop to the opening of the
    /// sample. Striding is the reason it is not: the surviving candidates run
    /// to the far end of the list.
    #[test]
    fn striding_spreads_coverage_instead_of_truncating() {
        let candidates: Vec<usize> = (0..1_000).map(|index| index * 3).collect();
        let kept = strided_candidates(&candidates, 7);

        assert_eq!(kept.len(), 1_000usize.div_ceil(7), "wrong number kept");
        assert_eq!(kept[0], candidates[0], "coverage must start at the first");
        let last = *kept.last().expect("stride kept nothing");
        let last_candidate = *candidates.last().expect("empty fixture");
        assert!(
            last_candidate - last < 7 * 3,
            "coverage stopped at {last} of a list reaching {last_candidate}"
        );
    }

    /// Zero crossings on periodic material fall into phase classes, and a
    /// perfect loop joins two crossings of the same class. Striding *both*
    /// candidate lists by one factor `s` restricts the reachable crossing-index
    /// differences to a single residue progression, so on a two-class signal
    /// the outcome flips with the parity of the crossing counts — shift the
    /// material by one sample and a perfect loop becomes unreachable. The
    /// fixture is a fundamental plus a strong second harmonic (two
    /// positive-going crossings per cycle); both one-sample shifts must find a
    /// near-perfect loop.
    #[test]
    fn a_two_class_signal_finds_its_loop_at_either_parity() {
        const LEN: usize = 40_000;
        const PERIOD: f32 = 25.0;
        const CORR_WIN: usize = 128;

        for shift in 0..2usize {
            let samples: Vec<f32> = (0..LEN)
                .map(|i| {
                    let t = (i + shift) as f32 * 2.0 * std::f32::consts::PI / PERIOD;
                    let envelope = 0.4 + 0.6 * (i as f32 / LEN as f32);
                    (t.sin() + 0.85 * (2.0 * t + 0.6).sin()) * envelope
                })
                .collect();
            let crossings = find_zero_crossings(&samples);
            let half = samples.len() / 2;

            let (starts, ends) = candidate_counts(&samples, &crossings, half, CORR_WIN);
            assert!(
                starts * ends > MAX_CANDIDATE_PAIRS,
                "fixture must bind the budget to exercise striding, had {starts}×{ends} pairs"
            );

            let search = search_best_pair(&samples, &crossings, half, CORR_WIN, 0);
            assert!(
                search.evaluations <= MAX_CANDIDATE_PAIRS,
                "shift {shift}: ran {} correlations against the budget",
                search.evaluations
            );
            let best = search
                .best
                .unwrap_or_else(|| panic!("shift {shift}: search found no pair at all"));
            assert!(
                best.quality > 0.9,
                "shift {shift}: best quality was {}; a perfect in-phase pair exists but the \
                 stride cannot reach it",
                best.quality
            );
        }
    }

    /// End to end: the public entry point still reports loop points on a
    /// signal dense enough to bind the budget.
    #[test]
    fn detection_still_reports_loop_points_on_a_dense_signal() {
        const SAMPLE_RATE: u32 = 8_000;

        let samples = drifting_sine(8_000, 8);
        let config = LoopPointConfig::default();
        let result = detect_loop_points(&samples, SAMPLE_RATE, &config);

        let result = result.expect("a dense periodic signal must yield loop points");
        assert!(
            result.end_frame > result.start_frame,
            "loop end {} must follow loop start {}",
            result.end_frame,
            result.start_frame
        );
        assert!(
            result.quality >= 0.0,
            "reported quality {} must be the non-negative correlation it claims",
            result.quality
        );
    }
}
