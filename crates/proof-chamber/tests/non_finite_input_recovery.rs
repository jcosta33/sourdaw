//! Audit #4591 — one non-finite input sample must not silence the reverb for
//! the rest of the session. The output scrub turns a NaN block into silence,
//! but a NaN that reaches a delay line keeps recirculating, and the dry/wet
//! blend carries it into the dry path too (NaN × anything is NaN at any mix,
//! so the scrub then zeroes the poisoned output block whole).
//!
//! The audit therefore measures the whole recovery window, not its last block:
//! an engine that stays silent for 700 of the 750 blocks and leaks audio in
//! the last one has not recovered, and a left channel that recovers while the
//! right stays wedged is still a wedged reverb. Both are pinned here — one
//! peak aggregated across every block on both channels, and a bound on the
//! first block allowed to carry recovered audio.

use proof_chamber::ProofChamberInstance;

const FRAMES: usize = 128;
const SAMPLE_RATE: f32 = 48_000.0;
const RECOVERY_BLOCKS: usize = 750; // ~2 s at 48 kHz

/// What counts as recovered audio in one block, on either channel.
///
/// At mix 0.3 the dry blend alone carries the sine at a 0.7 × 0.25 = 0.175
/// peak, so this sits under a third of the level recovered audio reaches
/// without any wet contribution at all, while the delay lines'
/// magnitude-truncation residue (below 1e-18) sits fifteen decades under it.
/// An engine whose whole output stays under it is silent, and one that only
/// crosses it in the window's final blocks is leaking, not recovering.
const RECOVERED_THRESHOLD: f32 = 0.05;

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
/// pre-delay, the FDN's longest 0.5-size line (55 ms) plus pre-delay, and the
/// reverse engine's dry path, which is immediate. An engine that has not
/// produced above-threshold audio one longest-path later has not recovered
/// late — its tank is still recirculating the poison, which is the defect this
/// audit exists to catch. 160 blocks keeps that verdict clear of the window's
/// end, where a final-block filter cannot see it.
const FIRST_RECOVERY_BLOCK_LIMIT: usize = 160;

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
}

impl Recovery {
    fn recovered(&self) -> bool {
        self.left_peak > RECOVERED_THRESHOLD && self.right_peak > RECOVERED_THRESHOLD
    }

    fn recovered_in_time(&self) -> bool {
        self.first_recovered_block <= FIRST_RECOVERY_BLOCK_LIMIT
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
    };
    for block in 1..=RECOVERY_BLOCKS {
        let input = sine_block(block);
        instance.process(&input, &input, FRAMES as u32);
        let (left_peak, right_peak) = stereo_output_peak(&mut instance);
        recovery.left_peak = recovery.left_peak.max(left_peak);
        recovery.right_peak = recovery.right_peak.max(right_peak);
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
    let wedged: Vec<String> = [0.0_f32, 1.0, 2.0, 3.0, 6.0]
        .into_iter()
        .filter_map(|algorithm| {
            let recovery = recovery_after_one_nan_input(algorithm, 0.3);
            let silence = (!recovery.recovered()).then(|| {
                "a channel never exceeded the threshold anywhere in the window".to_string()
            });
            let late = (!recovery.recovered_in_time()).then(|| {
                format!(
                    "first recovered block {} exceeds the limit {FIRST_RECOVERY_BLOCK_LIMIT}",
                    recovery.first_recovered_block
                )
            });
            (silence.is_some() || late.is_some()).then(|| {
                format!(
                    "algorithm {algorithm}: left peak {:.4}, right peak {:.4}, first \
                     recovered block {} — {}",
                    recovery.left_peak,
                    recovery.right_peak,
                    recovery.first_recovered_block,
                    silence.or(late).unwrap_or_default()
                )
            })
        })
        .collect();

    assert!(
        wedged.is_empty(),
        "algorithms still silent {RECOVERY_BLOCKS} blocks after one NaN input sample: \
         {wedged:#?}"
    );
}

#[test]
fn a_single_nan_input_sample_does_not_silence_the_dry_signal_at_zero_mix() {
    let recovery = recovery_after_one_nan_input(0.0, 0.0);

    assert!(
        recovery.left_peak > 0.1 && recovery.right_peak > 0.1,
        "wet output peaks ({:.4}, {:.4}) after one NaN input sample at mix 0",
        recovery.left_peak,
        recovery.right_peak
    );
    assert!(
        recovery.recovered_in_time(),
        "the wet path's first above-threshold block was {} of {RECOVERY_BLOCKS} — the \
         tank is recirculating the poison, not recovering from it",
        recovery.first_recovered_block
    );
}
