//! UNRUN draft preservation contracts against pre-extraction source, not
//! generated numerical goldens. Frozen sources identify their exact base.
#[path = "support/pitch_baseline/mod.rs"]
mod baseline;

use daw_dsp::primitives::pitch;
use scoring::{mpm::MpmDetector, yin::YinDetector, ScoringInstance};

fn frame(sample_rate: f32, frequency: f32, phase: f32, length: usize) -> Vec<f32> {
    (0..length).map(|i| ((i as f32 * frequency * std::f32::consts::TAU / sample_rate) + phase).sin() * 0.5).collect()
}

fn pair_bits(pair: (f32, f32)) -> (u32, u32) {
    (pair.0.to_bits(), pair.1.to_bits())
}

#[test]
fn public_detector_paths_are_shared_nominal_types() {
    assert_eq!(std::any::TypeId::of::<YinDetector>(), std::any::TypeId::of::<pitch::YinDetector>());
    assert_eq!(std::any::TypeId::of::<MpmDetector>(), std::any::TypeId::of::<pitch::MpmDetector>());
}

#[test]
fn scoring_yin_mpm_and_cached_pair_match_frozen_source_and_failure_state() {
    for sample_rate in [44100.0, 48000.0, 96000.0] {
        let length = pitch::max_analysis_window(sample_rate, 40.0);
        let mut yin = YinDetector::new(sample_rate, 40.0, 5000.0);
        let mut mpm = MpmDetector::new(sample_rate, 40.0, 5000.0);
        let mut standalone = MpmDetector::new(sample_rate, 40.0, 5000.0);
        let mut old_yin = baseline::yin::YinDetector::new(sample_rate, 40.0, 5000.0);
        let mut old_mpm = baseline::mpm::MpmDetector::new(sample_rate, 40.0, 5000.0);
        let mut old_standalone = baseline::mpm::MpmDetector::new(sample_rate, 40.0, 5000.0);
        for frequency in [41.2, 82.41, 440.0, 4500.0] {
            for phase in [0.0, 0.37] {
                let input = frame(sample_rate, frequency, phase, length);
                let expected_yin = old_yin.detect(&input);
                let expected_mpm = old_mpm.detect_from_autocorr(&input, &old_yin.autocorr);
                let (actual_yin, actual_mpm) = yin.detect_with_mpm(&input, &mut mpm);
                assert_eq!(pair_bits(actual_yin), pair_bits(expected_yin));
                assert_eq!(pair_bits(actual_mpm), pair_bits(expected_mpm));
                assert_eq!(yin.period.to_bits(), old_yin.period.to_bits());
                assert_eq!(pair_bits(standalone.detect(&input)), pair_bits(old_standalone.detect(&input)));
            }
        }
        assert!(yin.period > 0.0, "successful frame must establish period before failures");
        for input in [vec![0.0; length], vec![0.25; length], vec![0.0; 1], Vec::new()] {
            let period = yin.period.to_bits();
            assert_eq!(pair_bits(yin.detect(&input)), pair_bits(old_yin.detect(&input)));
            assert_eq!(yin.period.to_bits(), old_yin.period.to_bits());
            // A failed/short detection clears readings, but retains last period.
            if input.len() < 2 || yin.frequency == 0.0 {
                assert_eq!(yin.period.to_bits(), period);
                assert_eq!(yin.confidence.to_bits(), 0.0_f32.to_bits());
            }
        }
    }
}

#[test]
fn mono_poly_calibration_release_and_passthrough_match_frozen_consumers() {
    for (sample_rate, frequency, instrument) in [(44100.0, 82.41, 0.0), (48000.0, 329.63, 0.0), (96000.0, 41.2, 1.0)] {
        let mut actual = ScoringInstance::new(sample_rate);
        let mut expected = baseline::ScoringInstance::new(sample_rate);
        for (name, value) in [("poly", 1.0), ("instrument", instrument), ("tone", 0.0)] {
            actual.set_param(name, value);
            expected.set_param(name, value);
        }
        let mut observed_mono = false;
        let mut observed_poly = false;
        for block in 0..2048 {
            if block < 768 && block % 192 == 0 {
                let reference = [415.0, 440.0, 466.0, 440.0][block / 192];
                actual.set_param("a4_hz", reference);
                expected.set_param("a4_hz", reference);
            }
            let mut left = [0.0; 128];
            let mut right = [0.0; 128];
            if block < 512 {
                for i in 0..128 {
                    let t = (block * 128 + i) as f32 / sample_rate;
                    left[i] = (t * frequency * std::f32::consts::TAU).sin() * 0.7;
                    right[i] = left[i] * 0.8;
                }
            }
            let actual_left = actual.process(&left, &right, 128);
            let expected_left = expected.process(&left, &right, 128);
            // SAFETY: each process result owns a fixed buffer containing 128
            // samples; neither instance is mutated while these slices exist.
            unsafe {
                let output = std::slice::from_raw_parts(actual_left, 128);
                let old_output = std::slice::from_raw_parts(expected_left, 128);
                assert_eq!(output, old_output);
                assert_eq!(output, left);
            }
            assert_eq!(actual.get_frequency().to_bits(), expected.get_frequency().to_bits());
            assert_eq!(actual.get_confidence().to_bits(), expected.get_confidence().to_bits());
            assert_eq!(actual.get_cents().to_bits(), expected.get_cents().to_bits());
            assert_eq!(actual.get_midi_note(), expected.get_midi_note());
            assert_eq!(actual.is_active(), expected.is_active());
            observed_mono |= actual.is_active();
            assert_eq!(actual.get_poly_string_count(), expected.get_poly_string_count());
            for index in 0..actual.get_poly_string_count() {
                assert_eq!(actual.get_poly_string_cents(index).to_bits(), expected.get_poly_string_cents(index).to_bits());
                assert_eq!(actual.get_poly_string_confidence(index).to_bits(), expected.get_poly_string_confidence(index).to_bits());
                assert_eq!(actual.is_poly_string_active(index), expected.is_poly_string_active(index));
                observed_poly |= actual.is_poly_string_active(index);
            }
        }
        assert!(observed_mono, "actual mono analysis must become active");
        assert!(observed_poly, "actual poly analysis must become active");
        assert!(!actual.is_active(), "silence must release the actual tuner");
    }
}
