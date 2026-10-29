//! Source-only preservation contracts. These tests were authored before extraction
//! and have not been executed in the draft; the oracle is pinned in support/.
#[path = "support/pitch_baseline/mod.rs"]
mod baseline;

use daw_dsp::knead::pitch_edit::{analyze_pitch_wasm, PitchContour};
use daw_dsp::knead::yin::{yin_frame, YinConfig};
use daw_dsp::primitives::pitch;

fn bits(value: Option<f32>) -> Option<u32> {
    value.map(f32::to_bits)
}

fn frame(sample_rate: f32, frequency: f32, phase: f32, length: usize) -> Vec<f32> {
    (0..length)
        .map(|i| ((i as f32 * frequency * std::f32::consts::TAU / sample_rate) + phase).sin() * 0.5)
        .collect()
}

#[test]
fn knead_compatibility_path_is_the_shared_symbol_and_type() {
    assert_eq!(
        std::any::TypeId::of::<YinConfig>(),
        std::any::TypeId::of::<pitch::YinConfig>()
    );
    type Frame = fn(&[f32], &YinConfig, &mut [f32], &mut [f32]) -> pitch::YinResult;
    assert!(std::ptr::fn_addr_eq(yin_frame as Frame, pitch::yin_frame as Frame));
}

#[test]
fn overlap_arrays_and_result_bits_match_frozen_direct_f32_source() {
    for (sample_rate, low, frequency) in [(44100.0, 30.0, 30.0), (48000.0, 50.0, 220.0), (96000.0, 50.0, 50.0)] {
        for phase in [0.0, 0.37, 1.71] {
            let cfg = YinConfig { sample_rate, f0_min: low, ..YinConfig::default() };
            let old_cfg = baseline::yin::YinConfig { sample_rate, f0_min: low, ..baseline::yin::YinConfig::default() };
            let mut inputs = vec![frame(sample_rate, frequency, phase, 2048), vec![0.0; 2048], vec![0.25; 2048]];
            let mut seed = 0x1234_5678_u32;
            inputs.push((0..2048).map(|i| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                (seed as f32 / u32::MAX as f32 - 0.5) * (i as f32 / 2048.0)
            }).collect());
            for input in inputs {
                let mut d = vec![-7.0; 2048];
                let mut cmnd = vec![-9.0; 2048];
                let mut old_d = d.clone();
                let mut old_cmnd = cmnd.clone();
                let actual = yin_frame(&input, &cfg, &mut d, &mut cmnd);
                let expected = baseline::yin::yin_frame(&input, &old_cfg, &mut old_d, &mut old_cmnd);
                assert_eq!(d.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), old_d.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
                assert_eq!(cmnd.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), old_cmnd.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
                assert_eq!(bits(actual.f0_hz), bits(expected.f0_hz));
                assert_eq!(bits(actual.tau), bits(expected.tau));
                assert_eq!(actual.periodicity.to_bits(), expected.periodicity.to_bits());
            }
        }
    }
}

#[test]
fn crumbs_admission_and_aggregated_readings_match_frozen_consumer() {
    for length in [2047, 2048, 2557, 2558, 2559, 2560, 8192, 32768] {
        for frequency in [30.0, 220.0, 440.0] {
            let input = frame(44100.0, frequency, 0.37, length);
            let actual = daw_dsp::crumbs::analysis::pitch::detect_pitch(&input, 44100.0);
            let expected = baseline::crumbs::detect_pitch(&input, 44100.0);
            assert_eq!(bits(actual.frequency_hz), bits(expected.frequency_hz));
            assert_eq!(actual.midi_note, expected.midi_note);
            assert_eq!(actual.confidence.to_bits(), expected.confidence.to_bits());
            if length < 2558 {
                assert!(actual.frequency_hz.is_none());
            }
        }
    }
}

#[test]
fn contour_times_count_voicing_and_confidence_match_frozen_frame_route() {
    for length in [2048, 2049, 2303, 2304, 4096] {
        let input = frame(48000.0, 220.0, 0.37, length);
        let actual: PitchContour = serde_json::from_str(&analyze_pitch_wasm(&input, 48000.0)).unwrap();
        let count = if length > 2048 { (length - 2048) / 256 } else { 0 };
        assert_eq!(actual.points.len(), count);
        assert_eq!((actual.sample_rate, actual.hop_size, actual.algorithm.as_str()), (48000, 256, "yin"));
        let cfg = baseline::yin::YinConfig { sample_rate: 48000.0, ..baseline::yin::YinConfig::default() };
        let mut d = vec![0.0; 2048];
        let mut cmnd = vec![0.0; 2048];
        for (index, point) in actual.points.iter().enumerate() {
            let offset = index * 256;
            let expected = baseline::yin::yin_frame(&input[offset..offset + 2048], &cfg, &mut d, &mut cmnd);
            assert_eq!(point.time_ms.to_bits(), ((offset as f32 / 48000.0) * 1000.0).to_bits());
            assert_eq!(point.frequency_hz.to_bits(), expected.f0_hz.unwrap_or(0.0).to_bits());
            assert_eq!(point.confidence.to_bits(), expected.periodicity.to_bits());
            assert_eq!(point.voiced, expected.f0_hz.is_some());
        }
    }
}

#[test]
fn active_knead_stereo_output_and_getters_match_frozen_consumer_per_quantum() {
    for sample_rate in [44100.0, 48000.0, 96000.0] {
        let mut actual = daw_dsp::knead::engine::KneadEngine::new(sample_rate);
        let mut expected = baseline::engine::KneadEngine::new(sample_rate);
        actual.set_retune_speed_ms(200.0);
        expected.set_retune_speed_ms(200.0);
        for block in 0..96 {
            if block % 24 == 0 {
                let shift = [4.0, -3.0, 7.0, 0.0][block / 24];
                actual.set_shift_semitones(shift);
                expected.set_shift_semitones(shift);
                actual.set_formant_preserve(block < 48);
                expected.set_formant_preserve(block < 48);
            }
            let mut left = [0.0; 128];
            let mut right = [0.0; 128];
            for i in 0..128 {
                let t = (block * 128 + i) as f32 / sample_rate;
                let frequency = if block < 64 { 220.0 } else { 330.0 };
                left[i] = if (48..64).contains(&block) {
                    0.0
                } else {
                    (t * frequency * std::f32::consts::TAU).sin() * 0.5
                };
                right[i] = left[i] * -0.75;
            }
            let mut old_left = left;
            let mut old_right = right;
            actual.process_block(&mut left, &mut right);
            expected.process_block(&mut old_left, &mut old_right);
            assert_eq!(left.map(f32::to_bits), old_left.map(f32::to_bits));
            assert_eq!(right.map(f32::to_bits), old_right.map(f32::to_bits));
            assert_eq!(bits(actual.get_f0()), bits(expected.get_f0()));
            assert_eq!(actual.get_periodicity().to_bits(), expected.get_periodicity().to_bits());
            assert_eq!(actual.is_voiced(), expected.is_voiced());
            if block == 63 {
                assert!(!actual.is_voiced(), "silent analysis frame must be unvoiced");
                assert!(actual.get_f0().is_none());
            }
            assert_eq!(actual.latency_samples(), 2047);
        }
        assert!(actual.get_f0().is_some(), "analysis must actually execute");
    }
}
