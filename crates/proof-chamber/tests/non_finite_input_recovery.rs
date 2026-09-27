//! Audit #4591 — one non-finite input sample must not silence the reverb for
//! the rest of the session. The output scrub turns a NaN block into silence,
//! but a NaN that reaches a delay line keeps recirculating, and the dry/wet
//! blend carries it into the dry path too.

use proof_chamber::ProofChamberInstance;

const FRAMES: usize = 128;
const SAMPLE_RATE: f32 = 48_000.0;
const RECOVERY_BLOCKS: usize = 750; // ~2 s at 48 kHz

fn sine_block(block: usize) -> [f32; FRAMES] {
    let mut samples = [0.0_f32; FRAMES];
    for (frame, sample) in samples.iter_mut().enumerate() {
        let absolute = (block * FRAMES + frame) as f32;
        *sample = (absolute * 220.0 * std::f32::consts::TAU / SAMPLE_RATE).sin() * 0.25;
    }
    samples
}

fn left_output_peak(instance: &mut ProofChamberInstance) -> f32 {
    let left_ptr = instance.get_left_ptr();
    // SAFETY: the pointer addresses the instance's fixed output array, FRAMES is
    // in bounds, and the slice does not outlive this exclusive borrow.
    let left = unsafe { std::slice::from_raw_parts(left_ptr, FRAMES) };
    left.iter()
        .fold(0.0_f32, |peak, sample| peak.max(sample.abs()))
}

fn peak_after_one_nan_input(algorithm: f32, mix: f32) -> f32 {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);
    instance.set_param("mix", mix);

    let mut poisoned = sine_block(0);
    poisoned[0] = f32::NAN;
    instance.process(&poisoned, &poisoned, FRAMES as u32);

    let mut peak = 0.0;
    for block in 1..=RECOVERY_BLOCKS {
        let input = sine_block(block);
        instance.process(&input, &input, FRAMES as u32);
        peak = left_output_peak(&mut instance);
    }
    peak
}

#[test]
fn a_single_nan_input_sample_does_not_silence_any_shipped_algorithm() {
    let wedged: Vec<f32> = [0.0_f32, 1.0, 2.0, 3.0, 6.0]
        .into_iter()
        .filter(|&algorithm| peak_after_one_nan_input(algorithm, 0.3) == 0.0)
        .collect();

    assert!(
        wedged.is_empty(),
        "algorithms still silent {RECOVERY_BLOCKS} blocks after one NaN input sample: {wedged:?}"
    );
}

#[test]
fn a_single_nan_input_sample_does_not_silence_the_dry_signal_at_zero_mix() {
    let peak = peak_after_one_nan_input(0.0, 0.0);

    assert!(
        peak > 0.1,
        "dry output peak {peak} after one NaN input sample at mix 0"
    );
}
