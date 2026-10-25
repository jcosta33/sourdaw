use daw_dsp::proof::true_peak::TruePeakUpsampler;

const SAMPLE_RATE: f64 = 48_000.0;
const DURATION_SECONDS: f64 = 0.1;
const FADE_SECONDS: f64 = 0.01;
const TAIL_FRAMES: usize = 11;
const LOWER_ERROR_DB: f64 = -0.4;
const UPPER_ERROR_DB: f64 = 0.2;

struct ReferenceCase {
    number: u8,
    frequency_divisor: f64,
    amplitude_ffs: f64,
    phase_degrees: f64,
    reference_dbtp: f64,
}

const CASES: [ReferenceCase; 5] = [
    ReferenceCase {
        number: 15,
        frequency_divisor: 4.0,
        amplitude_ffs: 0.5,
        phase_degrees: 0.0,
        reference_dbtp: -6.0,
    },
    ReferenceCase {
        number: 16,
        frequency_divisor: 4.0,
        amplitude_ffs: 0.5,
        phase_degrees: 45.0,
        reference_dbtp: -6.0,
    },
    ReferenceCase {
        number: 17,
        frequency_divisor: 6.0,
        amplitude_ffs: 0.5,
        phase_degrees: 60.0,
        reference_dbtp: -6.0,
    },
    ReferenceCase {
        number: 18,
        frequency_divisor: 8.0,
        amplitude_ffs: 0.5,
        phase_degrees: 67.5,
        reference_dbtp: -6.0,
    },
    ReferenceCase {
        number: 19,
        frequency_divisor: 4.0,
        amplitude_ffs: 1.41,
        phase_degrees: 45.0,
        reference_dbtp: 3.0,
    },
];

fn reference_tone(case: &ReferenceCase) -> Vec<f32> {
    let frame_count = (SAMPLE_RATE * DURATION_SECONDS) as usize;
    let fade_frames = SAMPLE_RATE * FADE_SECONDS;
    let frequency = SAMPLE_RATE / case.frequency_divisor;
    let phase = case.phase_degrees.to_radians();

    (0..frame_count)
        .map(|frame| {
            let fade_in = (frame as f64 / fade_frames).min(1.0);
            let fade_out = ((frame_count - 1 - frame) as f64 / fade_frames).min(1.0);
            let envelope = fade_in.min(fade_out);
            let angle = 2.0 * std::f64::consts::PI * frequency * frame as f64 / SAMPLE_RATE + phase;
            (case.amplitude_ffs * envelope * angle.sin()) as f32
        })
        .collect()
}

fn detected_peak(samples: &[f32]) -> f32 {
    let mut detector = TruePeakUpsampler::new();
    let mut peak = 0.0_f32;

    for &sample in samples {
        peak = peak.max(detector.push_max_abs(sample));
    }
    for _ in 0..TAIL_FRAMES {
        peak = peak.max(detector.push_max_abs(0.0));
    }

    peak
}

#[test]
fn matches_ebu_tech_3341_table_1_reference_cases_15_through_19() {
    for case in &CASES {
        let left = reference_tone(case);
        let right = reference_tone(case);
        let measured_linear = detected_peak(&left).max(detected_peak(&right));
        let measured_dbtp = 20.0 * f64::from(measured_linear).log10();
        let error_db = measured_dbtp - case.reference_dbtp;

        println!(
            "EBU Tech 3341 case {}: linear={measured_linear:.8}, measured={measured_dbtp:.4} dBTP, reference={:.1} dBTP, error={error_db:+.4} dB",
            case.number, case.reference_dbtp
        );

        assert!(
            (LOWER_ERROR_DB..=UPPER_ERROR_DB).contains(&error_db),
            "case {} measured {measured_dbtp:.4} dBTP ({measured_linear:.8} linear), reference {:.1} dBTP, error {error_db:+.4} dB",
            case.number,
            case.reference_dbtp
        );

        if case.number == 19 {
            assert!(
                measured_linear > 1.0,
                "case 19 reference is above full scale, got {measured_linear:.8} linear"
            );
        }
    }
}
