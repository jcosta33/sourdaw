//! Audible contract for the two shipped non-modern Dutch Oven character modes.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATES: [f32; 2] = [44_100.0, 48_000.0];
const BLOCK: usize = 128;
const FRAMES: usize = 48_000;

#[derive(Clone, Copy, Debug)]
struct Measurement {
    rms: f32,
    high_frequency_rms: f32,
}

const EXPECTED_SIGNAL: [[Measurement; 3]; 2] = [
    [
        Measurement { rms: 0.303_318_23, high_frequency_rms: 0.388_374_57 },
        Measurement { rms: 0.274_717_24, high_frequency_rms: 0.330_152_12 },
        Measurement { rms: 0.236_572_74, high_frequency_rms: 0.220_032_45 },
    ],
    [
        Measurement { rms: 0.303_324_85, high_frequency_rms: 0.367_476_25 },
        Measurement { rms: 0.272_278_13, high_frequency_rms: 0.306_728_2 },
        Measurement { rms: 0.233_388_59, high_frequency_rms: 0.214_636_03 },
    ],
];
const SEVENTIES_NOISE_RMS: f32 = 0.000_407_652_43;

fn assert_near(name: &str, measured: f32, expected: f32) {
    let error = (measured - expected).abs() / expected.max(1.0e-12);
    assert!(error <= 0.01, "{name} changed: measured {measured:.9}, expected {expected:.9}");
}

fn rms(samples: &[f32]) -> f32 {
    let energy = samples
        .iter()
        .map(|sample| f64::from(*sample) * f64::from(*sample))
        .sum::<f64>();
    (energy / samples.len() as f64).sqrt() as f32
}

fn render(sample_rate: f32, vintage: f32, silent: bool) -> Measurement {
    let mut chamber = ProofChamberInstance::new(sample_rate);
    chamber.set_param("mix", 0.0);
    chamber.set_param("vintage", vintage);

    let mut output = Vec::with_capacity(FRAMES * 2);
    let mut frame = 0;
    while frame < FRAMES {
        let frames = (FRAMES - frame).min(BLOCK);
        let mut input = [0.0_f32; BLOCK];
        if !silent {
            for (offset, sample) in input[..frames].iter_mut().enumerate() {
                let time = (frame + offset) as f32 / sample_rate;
                *sample = 0.25 * (time * 3_000.0 * std::f32::consts::TAU).sin()
                    + 0.25 * (time * 9_000.0 * std::f32::consts::TAU).sin()
                    + 0.25 * (time * 16_000.0 * std::f32::consts::TAU).sin();
            }
        }

        let left = chamber.process(&input[..frames], &input[..frames], frames as u32);
        let right = chamber.get_right_ptr();
        for offset in 0..frames {
            let left_sample = unsafe { *left.add(offset) };
            let right_sample = unsafe { *right.add(offset) };
            assert!(left_sample.is_finite() && right_sample.is_finite());
            output.push(left_sample);
            output.push(right_sample);
        }
        frame += frames;
    }

    let mono: Vec<f32> = output
        .chunks_exact(2)
        .map(|pair| (pair[0] + pair[1]) * 0.5)
        .collect();
    let high_passed: Vec<f32> = mono.windows(2).map(|pair| pair[1] - pair[0]).collect();
    Measurement {
        rms: rms(&mono),
        high_frequency_rms: rms(&high_passed),
    }
}

#[test]
fn vintage_modes_keep_their_bandwidth_and_noise_character() {
    for (rate_index, sample_rate) in SAMPLE_RATES.into_iter().enumerate() {
        let modern = render(sample_rate, 0.0, false);
        let eighties = render(sample_rate, 1.0, false);
        let seventies = render(sample_rate, 2.0, false);
        let modern_silence = render(sample_rate, 0.0, true);
        let seventies_silence = render(sample_rate, 2.0, true);

        let measured = [modern, eighties, seventies];
        for (mode_index, mode) in ["Modern", "Eighties", "Seventies"].into_iter().enumerate() {
            let expected = EXPECTED_SIGNAL[rate_index][mode_index];
            assert_near(&format!("{mode} {sample_rate:.0} Hz RMS"), measured[mode_index].rms, expected.rms);
            assert_near(
                &format!("{mode} {sample_rate:.0} Hz high-frequency RMS"),
                measured[mode_index].high_frequency_rms,
                expected.high_frequency_rms,
            );
        }
        assert_eq!(modern_silence.rms, 0.0, "Modern injected noise into silence");
        assert_near("Seventies noise-floor RMS", seventies_silence.rms, SEVENTIES_NOISE_RMS);
        assert!(
            measured[1].high_frequency_rms < measured[0].high_frequency_rms * 0.9
                && measured[2].high_frequency_rms < measured[1].high_frequency_rms * 0.75,
            "vintage modes no longer darken progressively at {sample_rate:.0} Hz"
        );
    }
}
