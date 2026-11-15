//! Debug allocation and frozen-consumer parity contract for active 128-frame processing.
#![cfg(debug_assertions)]
#![allow(clippy::unwrap_used, reason = "tests assert by unwrapping")]
#[path = "support/pitch_baseline/mod.rs"]
mod baseline;

use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use daw_dsp::knead::KneadInstance;

#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

#[test]
fn shared_overlap_analysis_runs_in_active_128_frame_instance_without_allocation() {
    for sample_rate in [44100.0, 48000.0, 96000.0] {
        let mut instance = KneadInstance::new(sample_rate);
        instance.set_shift_semitones(4.0);
        instance.set_formant_preserve(false);
        instance.set_retune_speed_ms(200.0);
        let mut expected = baseline::engine::KneadEngine::new(sample_rate);
        expected.set_shift_semitones(4.0);
        expected.set_formant_preserve(false);
        expected.set_retune_speed_ms(200.0);
        let mut peak = 0.0_f32;
        let mut analyzed_frames = 0;
        assert_no_alloc(|| {
            for block in 0..96 {
                if block == 32 {
                    instance.set_shift_semitones(-3.0);
                    expected.set_shift_semitones(-3.0);
                }
                if block == 64 {
                    instance.set_shift_semitones(7.0);
                    expected.set_shift_semitones(7.0);
                }
                let mut expected_left = [0.0; 128];
                let mut expected_right = [0.0; 128];
                let left = instance.get_input_left_ptr();
                let right = instance.get_input_right_ptr();
                for i in 0..128 {
                    let t = (block * 128 + i) as f32 / sample_rate;
                    let value = (t * 220.0 * std::f32::consts::TAU).sin() * 0.5;
                    // SAFETY: `left` is the instance's input-left buffer, which `KneadInstance::new`
                    // allocates at 4096 samples and nothing resizes; `i < 128`, so the offset stays
                    // inside it.
                    let left_slot = unsafe { left.add(i) };
                    // SAFETY: `left_slot` is in bounds of that initialised buffer, and no borrow
                    // of the instance is live while the slot is written.
                    unsafe { *left_slot = value };
                    // SAFETY: `right` is the input-right buffer, also 4096 samples from `new`, and
                    // `i < 128`, so the offset stays inside it.
                    let right_slot = unsafe { right.add(i) };
                    // SAFETY: `right_slot` is in bounds of that initialised buffer, and no borrow
                    // of the instance is live while the slot is written.
                    unsafe { *right_slot = value * -0.75 };
                    expected_left[i] = value;
                    expected_right[i] = value * -0.75;
                }
                expected.process_block(&mut expected_left, &mut expected_right);
                let output = instance.process(128);
                let output_right = instance.get_right_ptr();
                for i in 0..128 {
                    // SAFETY: `output` is the left buffer `process` returned, 4096 samples from
                    // `new` and never resized; `i < 128`, so the offset stays inside it.
                    let output_left_slot = unsafe { output.add(i) };
                    // SAFETY: `output_left_slot` is in bounds of that buffer, whose first 128
                    // samples `process(128)` just wrote; nothing has touched the instance since.
                    let output_left_sample = unsafe { *output_left_slot };
                    // SAFETY: `output_right` is the right buffer from `get_right_ptr`, 4096 samples
                    // from `new`; `i < 128`, so the offset stays inside it.
                    let output_right_slot = unsafe { output_right.add(i) };
                    // SAFETY: `output_right_slot` is in bounds of that buffer, written by the same
                    // `process(128)` call; nothing has touched the instance since.
                    let output_right_sample = unsafe { *output_right_slot };
                    assert!(output_left_sample.is_finite());
                    assert!(output_right_sample.is_finite());
                    assert_eq!(output_left_sample.to_bits(), expected_left[i].to_bits());
                    assert_eq!(output_right_sample.to_bits(), expected_right[i].to_bits());
                    peak = peak.max(output_left_sample.abs());
                }
                assert_eq!(
                    instance.get_f0().to_bits(),
                    expected.get_f0().unwrap_or(0.0).to_bits()
                );
                assert_eq!(
                    instance.get_periodicity().to_bits(),
                    expected.get_periodicity().to_bits()
                );
                assert_eq!(instance.is_voiced(), expected.is_voiced());
                if (block + 1) % 16 == 0 {
                    assert!(instance.get_f0() > 0.0);
                    assert!(instance.get_periodicity() > 0.7);
                    assert!(instance.is_voiced());
                    analyzed_frames += 1;
                }
            }
        });
        assert_eq!(analyzed_frames, 6);
        assert_eq!(instance.get_latency_samples(), 2047);
        assert!(peak > 1e-4, "active shifted output must sound");
    }
}
