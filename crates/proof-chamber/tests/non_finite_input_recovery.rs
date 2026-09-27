//! Audit #4591 — one non-finite input sample must not silence the reverb for
//! the rest of the session. The input scrub in `process_outputs` maps a
//! non-finite input sample to silence before any engine state can see it; a
//! NaN that reaches a delay line instead keeps recirculating in the tank, and
//! the wet path stays dead for the rest of the session while the dry blend
//! keeps sounding normal.
//!
//! That defect shape dictates where this audit may look. The algorithm sweep
//! runs at mix 1.0, where the dry path has zero weight and the output is the
//! wet path alone: at any lower mix the dry blend alone crosses every level
//! this file asserts, so a reverted scrub — wet dead, dry healthy — would
//! pass unnoticed. The zero-mix case keeps its own subject, that the dry
//! signal itself must survive a poisoned block untouched.
//!
//! The audit measures the whole recovery window three ways, because each
//! bound alone admits a wedge: one peak aggregated across every block on both
//! channels (an engine silent for 700 of the 750 blocks that leaks audio in
//! the last one has not recovered), a bound on the first block allowed to
//! carry recovered audio (an engine whose tank still recirculates the poison
//! hundreds of blocks in has not recovered late), and a liveness bound on the
//! window's final blocks (an engine that recovers and then goes permanently
//! silent still owns a healthy window aggregate — only its end exposes it).

use proof_chamber::ProofChamberInstance;

const FRAMES: usize = 128;
const SAMPLE_RATE: f32 = 48_000.0;
const RECOVERY_BLOCKS: usize = 750; // ~2 s at 48 kHz

/// What counts as recovered audio in one block, on either channel.
///
/// The sweep runs at mix 1.0, so the levels it judges are wet-only renders of
/// the test sine: the quietest recovered window peak measured across the five
/// shipped algorithms is the reverse engine's 0.166, with the FDN pair at
/// 0.24, the plate at 0.28 and the spring at 0.52, so this sits under a third
/// of the quietest level recovered audio reaches, while the delay lines'
/// magnitude-truncation residue (below 1e-18) sits fifteen decades under it.
/// The zero-mix dry case reuses the same threshold against the dry sine's
/// 0.25 peak, where it is equally far under the level recovered audio
/// reaches. An engine whose whole output stays under it is silent.
const RECOVERED_THRESHOLD: f32 = 0.05;

/// What counts as still alive in the window's final blocks, on either
/// channel.
///
/// Lower than [`RECOVERED_THRESHOLD`] on purpose: the liveness bound has to
/// sit under the block-to-block dips of a healthy wet render — the FDN-16's
/// right channel measures as low as 0.039 across the final eight blocks at
/// mix 1.0 — while a wedged engine's final blocks are exactly zero and the
/// delay lines' truncation residue sits sixteen decades below that. There is
/// nothing between.
const END_LIVENESS_THRESHOLD: f32 = 0.02;

/// How many blocks at the window's end the liveness bound reads.
///
/// Eight blocks (~21 ms at 48 kHz) smooths a single quiet block without
/// reaching back toward the first-recovery verdict: the tank algorithms are
/// bound to have recovered by block 160 and the reverse engine by 575, so a
/// final window this small only ever judges steady state.
const END_LIVENESS_BLOCKS: usize = 8;

/// The last recovery block allowed to be the first one carrying recovered
/// audio.
///
/// Justified by the engines' own memory, because that is what a recovery has
/// to flush: the longest input→output path any shipped algorithm owns is the
/// plate's deepest output tap — pre-delay (15 ms), the four input diffusers
/// (~30 ms at 48 kHz), then the left tank's 4453-sample line, 1800-sample
/// allpass and 3720-sample line (150, 60 and 125 ms scaled to 48 kHz) — about
/// 19.4k samples, 0.40 s, 152 of these 128-frame blocks at 48 kHz. Every other
/// algorithm's longest path is shorter: the spring's 150 ms loop plus
/// pre-delay, and the FDN's longest 0.5-size line (55 ms) plus pre-delay. The
/// reverse engine is bounded separately below, because at mix 1.0 its wet
/// onset is not a delay-line path but its grain scheduler. An engine that has
/// not produced above-threshold audio one longest-path later has not
/// recovered late — its tank is still recirculating the poison, which is the
/// defect this audit exists to catch. 160 blocks keeps that verdict clear of
/// the window's end, where the liveness filter runs.
const FIRST_RECOVERY_BLOCK_LIMIT: usize = 160;

/// The last recovery block allowed to be the first one carrying recovered
/// wet audio from the reverse engine.
///
/// The reverse engine emits no wet at all for its first grain: the
/// constructor arms the first reverse grain only after a full default 1.5 s
/// grain (72,000 samples, 563 of these blocks at 48 kHz), and the grain's
/// 720-sample boundary ramp needs a few more blocks to carry a sample past
/// [`RECOVERED_THRESHOLD`] — measured, the first above-threshold wet block is
/// 565. 575 bounds that structural onset with slack; a first recovery later
/// than one grain plus its ramp means the grain reader stopped rendering the
/// capture, which is this engine's shape of the poison defect. Like the tank
/// bound above it, it stays well clear of the window's end, where the
/// liveness filter runs.
const REVERSE_WET_ONSET_BLOCK_LIMIT: usize = 575;

/// Wire id of the reverse-envelope engine — see `lib.rs`'s algorithm table.
const REVERSE_ALGORITHM: f32 = 6.0;

/// The first-recovery bound for one algorithm: the tank algorithms' longest
/// delay-line path, and the reverse engine's structural grain onset.
fn first_recovery_block_limit(algorithm: f32) -> usize {
    if algorithm == REVERSE_ALGORITHM {
        REVERSE_WET_ONSET_BLOCK_LIMIT
    } else {
        FIRST_RECOVERY_BLOCK_LIMIT
    }
}

fn sine_block(block: usize) -> [f32; FRAMES] {
    let mut samples = [0.0_f32; FRAMES];
    for (frame, sample) in samples.iter_mut().enumerate() {
        let absolute = (block * FRAMES + frame) as f32;
        *sample = (absolute * 220.0 * std::f32::consts::TAU / SAMPLE_RATE).sin() * 0.25;
    }
    samples
}

fn channel_peak(samples: &[f32]) -> f32 {
    samples
        .iter()
        .fold(0.0_f32, |peak, sample| peak.max(sample.abs()))
}

/// Both output-channel peaks of one block.
fn stereo_output_peak(instance: &mut ProofChamberInstance) -> (f32, f32) {
    let left_ptr = instance.get_left_ptr();
    let right_ptr = instance.get_right_ptr();
    // SAFETY: the pointers address the instance's fixed output arrays, FRAMES
    // is in bounds, and the slices do not outlive this exclusive borrow.
    let left = unsafe { std::slice::from_raw_parts(left_ptr, FRAMES) };
    let right = unsafe { std::slice::from_raw_parts(right_ptr, FRAMES) };
    (channel_peak(left), channel_peak(right))
}

/// What one poisoned-input run produced across the whole recovery window.
struct Recovery {
    /// Largest output sample either channel reached in any recovery block.
    left_peak: f32,
    right_peak: f32,
    /// 1-based index of the first block whose two-channel peak crossed
    /// [`RECOVERED_THRESHOLD`], `RECOVERY_BLOCKS + 1` if none ever did.
    first_recovered_block: usize,
    /// Largest output sample either channel reached in the window's final
    /// [`END_LIVENESS_BLOCKS`] blocks.
    end_left_peak: f32,
    end_right_peak: f32,
}

impl Recovery {
    fn recovered(&self) -> bool {
        self.left_peak > RECOVERED_THRESHOLD && self.right_peak > RECOVERED_THRESHOLD
    }

    fn recovered_in_time(&self, limit: usize) -> bool {
        self.first_recovered_block <= limit
    }

    fn alive_at_end(&self) -> bool {
        self.end_left_peak > END_LIVENESS_THRESHOLD && self.end_right_peak > END_LIVENESS_THRESHOLD
    }
}

fn recovery_after_one_nan_input(algorithm: f32, mix: f32) -> Recovery {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);
    instance.set_param("mix", mix);

    let mut poisoned = sine_block(0);
    poisoned[0] = f32::NAN;
    instance.process(&poisoned, &poisoned, FRAMES as u32);

    let mut recovery = Recovery {
        left_peak: 0.0,
        right_peak: 0.0,
        first_recovered_block: RECOVERY_BLOCKS + 1,
        end_left_peak: 0.0,
        end_right_peak: 0.0,
    };
    for block in 1..=RECOVERY_BLOCKS {
        let input = sine_block(block);
        instance.process(&input, &input, FRAMES as u32);
        let (left_peak, right_peak) = stereo_output_peak(&mut instance);
        recovery.left_peak = recovery.left_peak.max(left_peak);
        recovery.right_peak = recovery.right_peak.max(right_peak);
        if block + END_LIVENESS_BLOCKS > RECOVERY_BLOCKS {
            recovery.end_left_peak = recovery.end_left_peak.max(left_peak);
            recovery.end_right_peak = recovery.end_right_peak.max(right_peak);
        }
        if recovery.first_recovered_block > RECOVERY_BLOCKS
            && left_peak.max(right_peak) > RECOVERED_THRESHOLD
        {
            recovery.first_recovered_block = block;
        }
    }
    recovery
}

#[test]
fn a_single_nan_input_sample_does_not_silence_any_shipped_algorithm() {
    let wedged: Vec<String> = [0.0_f32, 1.0, 2.0, 3.0, REVERSE_ALGORITHM]
        .into_iter()
        .filter_map(|algorithm| {
            let recovery = recovery_after_one_nan_input(algorithm, 1.0);
            let limit = first_recovery_block_limit(algorithm);
            let silence = (!recovery.recovered()).then(|| {
                "a channel never exceeded the threshold anywhere in the window".to_string()
            });
            let late = (!recovery.recovered_in_time(limit)).then(|| {
                format!(
                    "first recovered block {} exceeds the limit {limit}",
                    recovery.first_recovered_block
                )
            });
            let wedge = (!recovery.alive_at_end()).then(|| {
                format!(
                    "the final {END_LIVENESS_BLOCKS} blocks peak at ({:.4}, {:.4}) — the \
                     engine recovered, then went silent again",
                    recovery.end_left_peak, recovery.end_right_peak
                )
            });
            (silence.is_some() || late.is_some() || wedge.is_some()).then(|| {
                format!(
                    "algorithm {algorithm}: left peak {:.4}, right peak {:.4}, first \
                     recovered block {} — {}",
                    recovery.left_peak,
                    recovery.right_peak,
                    recovery.first_recovered_block,
                    silence.or(late).or(wedge).unwrap_or_default()
                )
            })
        })
        .collect();

    assert!(
        wedged.is_empty(),
        "algorithms not recovered {RECOVERY_BLOCKS} blocks after one NaN input sample: \
         {wedged:#?}"
    );
}

#[test]
fn a_single_nan_input_sample_does_not_silence_the_dry_signal_at_zero_mix() {
    let recovery = recovery_after_one_nan_input(0.0, 0.0);

    assert!(
        recovery.left_peak > 0.1 && recovery.right_peak > 0.1,
        "dry output peaks ({:.4}, {:.4}) after one NaN input sample at mix 0",
        recovery.left_peak,
        recovery.right_peak
    );
    assert!(
        recovery.recovered_in_time(FIRST_RECOVERY_BLOCK_LIMIT),
        "the dry path's first above-threshold block was {} of {RECOVERY_BLOCKS} — the \
         tank is recirculating the poison, not recovering from it",
        recovery.first_recovered_block
    );
    assert!(
        recovery.alive_at_end(),
        "the dry path's final {END_LIVENESS_BLOCKS} blocks peak at ({:.4}, {:.4}) — the \
         dry signal recovered, then went silent again",
        recovery.end_left_peak,
        recovery.end_right_peak
    );
}
