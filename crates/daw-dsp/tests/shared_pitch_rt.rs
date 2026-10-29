//! Dedicated draft contract for actual analysis ticks, not a setter-only guard.
//! UNRUN: debug allocation and output/telemetry obligations remain unverified.
#![cfg(debug_assertions)]
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
                // SAFETY: the instance's fixed input and output buffers each
                // contain at least 128 samples; no borrow spans process().
                unsafe {
                    let left = instance.get_input_left_ptr();
                    let right = instance.get_input_right_ptr();
                    for i in 0..128 {
                        let t = (block * 128 + i) as f32 / sample_rate;
                        let value = (t * 220.0 * std::f32::consts::TAU).sin() * 0.5;
                        *left.add(i) = value;
                        *right.add(i) = value * -0.75;
                        expected_left[i] = value;
                        expected_right[i] = value * -0.75;
                    }
                    expected.process_block(&mut expected_left, &mut expected_right);
                    let output = instance.process(128);
                    let output_right = instance.get_right_ptr();
                    for i in 0..128 {
                        assert!((*output.add(i)).is_finite());
                        assert!((*output_right.add(i)).is_finite());
                        assert_eq!((*output.add(i)).to_bits(), expected_left[i].to_bits());
                        assert_eq!((*output_right.add(i)).to_bits(), expected_right[i].to_bits());
                        peak = peak.max((*output.add(i)).abs());
                    }
                }
                assert_eq!(instance.get_f0().to_bits(), expected.get_f0().unwrap_or(0.0).to_bits());
                assert_eq!(instance.get_periodicity().to_bits(), expected.get_periodicity().to_bits());
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
