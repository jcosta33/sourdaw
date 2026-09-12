//! Integration tests for Gluten Delta listen with lookahead delay.
//!
//! Issue #3719: Align Delta reference with the lookahead delay.
//! When Mix = 0 and lookahead > 0, Gluten Delta listen must output silence (< 1e-5),
//! not a comb-filtered difference between delayed and undelayed audio.

use daw_dsp::gluten::GlutenInstance;

const SAMPLE_RATE: f32 = 48_000.0;

fn run_simulation(
    instance: &mut GlutenInstance,
    block_size: usize,
    num_blocks: usize,
    stimulus: impl Fn(usize) -> (f32, f32),
) -> Vec<(f32, f32)> {
    let mut output = Vec::with_capacity(num_blocks * block_size);
    for block in 0..num_blocks {
        let base = block * block_size;
        let left_ptr = instance.get_input_left_ptr();
        let right_ptr = instance.get_input_right_ptr();
        for n in 0..block_size {
            let (l, r) = stimulus(base + n);
            unsafe {
                *left_ptr.add(n) = l;
                *right_ptr.add(n) = r;
            }
        }

        let out_left = instance.process(block_size as u32);
        let out_right = instance.get_right_ptr();
        for n in 0..block_size {
            output.push(unsafe { (*out_left.add(n), *out_right.add(n)) });
        }
    }
    output
}

fn max_settled_peak(output: &[(f32, f32)], block_size: usize, start_block: usize) -> f32 {
    let start_idx = start_block * block_size;
    assert!(start_idx < output.len(), "start_block out of range");
    let mut peak = 0.0_f32;
    for &(l, r) in &output[start_idx..] {
        peak = peak.max(l.abs()).max(r.abs());
    }
    peak
}

#[test]
fn fully_dry_delta_nulls_at_all_lookaheads() {
    let lookaheads = [0.0_f32, 1.0, 2.0, 5.0];
    let block_size = 128;
    let num_blocks = 100;
    let peak_in = 0.1_f32;

    for &lookahead in &lookaheads {
        let mut instance = GlutenInstance::new(SAMPLE_RATE);
        instance.set_param("mix", 0.0);
        instance.set_param("delta_listen", 1.0);
        instance.set_param("lookahead", lookahead);

        let output = run_simulation(&mut instance, block_size, num_blocks, |idx| {
            let t = idx as f32 / SAMPLE_RATE;
            let s = peak_in * (2.0 * std::f32::consts::PI * 100.0 * t).sin();
            (s, s)
        });

        let peak = max_settled_peak(&output, block_size, 51);
        assert!(
            peak < 1e-5,
            "lookahead {} ms: expected settled peak < 1e-5, got {}",
            lookahead,
            peak
        );
    }
}

#[test]
fn fully_dry_delta_nulls_in_all_stereo_modes() {
    // 0.0 = Stereo, 1.0 = Mid, 2.0 = Side, 3.0 = Dual Mono
    let stereo_modes = [
        ("Stereo", 0.0_f32),
        ("Mid", 1.0),
        ("Side", 2.0),
        ("DualMono", 3.0),
    ];
    let block_size = 128;
    let num_blocks = 100;
    let peak_in = 0.1_f32;

    for (name, mode) in stereo_modes {
        let mut instance = GlutenInstance::new(SAMPLE_RATE);
        instance.set_param("mix", 0.0);
        instance.set_param("delta_listen", 1.0);
        instance.set_param("lookahead", 5.0);
        instance.set_param("stereo_mode", mode);

        let output = run_simulation(&mut instance, block_size, num_blocks, |idx| {
            let t = idx as f32 / SAMPLE_RATE;
            let l = peak_in * (2.0 * std::f32::consts::PI * 100.0 * t).sin();
            // Give right channel a phase offset so both Mid and Side have non-zero energy
            let r = peak_in * (2.0 * std::f32::consts::PI * 100.0 * t + 0.5).sin();
            (l, r)
        });

        let peak = max_settled_peak(&output, block_size, 51);
        assert!(
            peak < 1e-5,
            "stereo mode {} ({}): expected settled peak < 1e-5, got {}",
            name,
            mode,
            peak
        );
    }
}

#[test]
fn delta_with_active_compression_produces_difference_signal() {
    let mut instance = GlutenInstance::new(SAMPLE_RATE);
    instance.set_param("mix", 1.0);
    instance.set_param("threshold", -20.0);
    instance.set_param("ratio", 4.0);
    instance.set_param("lookahead", 5.0);
    instance.set_param("delta_listen", 1.0);

    let block_size = 128;
    let num_blocks = 100;
    let input_peak = 0.5_f32;

    let output = run_simulation(&mut instance, block_size, num_blocks, |idx| {
        let t = idx as f32 / SAMPLE_RATE;
        let s = input_peak * (2.0 * std::f32::consts::PI * 100.0 * t).sin();
        (s, s)
    });

    let settled_peak = max_settled_peak(&output, block_size, 51);

    // Active compression must produce an audible difference signal
    assert!(
        settled_peak > 0.01,
        "expected audible delta signal > 0.01, got {}",
        settled_peak
    );

    // Difference signal must be bounded by input peak
    assert!(
        settled_peak <= input_peak + 1e-5,
        "delta signal peak {} exceeded input peak {}",
        settled_peak,
        input_peak
    );
}

#[test]
fn fully_dry_delta_nulls_across_varying_block_sizes() {
    let block_sizes = [64, 128, 256, 512];
    let num_blocks = 100;
    let peak_in = 0.1_f32;

    for &block_size in &block_sizes {
        let mut instance = GlutenInstance::new(SAMPLE_RATE);
        instance.set_param("mix", 0.0);
        instance.set_param("delta_listen", 1.0);
        instance.set_param("lookahead", 5.0);

        let output = run_simulation(&mut instance, block_size, num_blocks, |idx| {
            let t = idx as f32 / SAMPLE_RATE;
            let s = peak_in * (2.0 * std::f32::consts::PI * 100.0 * t).sin();
            (s, s)
        });

        let peak = max_settled_peak(&output, block_size, 51);
        assert!(
            peak < 1e-5,
            "block size {}: expected settled peak < 1e-5, got {}",
            block_size,
            peak
        );
    }
}
