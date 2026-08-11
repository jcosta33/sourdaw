//! Rendered contract for the Dutch Oven's shipped Infinite space.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: usize = 48_000;
const BLOCK: usize = 128;
const RENDER_SECONDS: usize = 20;
const BURST_FRAMES: usize = SAMPLE_RATE / 10;
const INFINITE_PATCH: [(&str, f32); 28] = [
    ("algorithm", 0.0),
    ("mix", 0.3),
    ("decay", 0.999),
    ("damping", 0.0),
    ("predelay", 0.0),
    ("size", 0.6),
    ("mod_rate", 1.0),
    ("mod_depth", 0.0),
    ("diffusion", 0.75),
    ("high_cut", 12_000.0),
    ("low_cut", 80.0),
    ("width", 1.0),
    ("freeze", 0.0),
    ("shimmer", 0.0),
    ("shimmer_amount", 0.2),
    ("shimmer_pitch", 1.0),
    ("gravity", 0.5),
    ("saturation", 0.0),
    ("saturation_type", 0.0),
    ("early_late", 0.4),
    ("density", 1.0),
    ("decay_eq_0", 1.0),
    ("decay_eq_1", 1.0),
    ("decay_eq_2", 1.0),
    ("decay_eq_3", 1.0),
    ("decay_eq_4", 1.0),
    ("decay_eq_5", 1.0),
    ("vintage", 0.0),
];

#[test]
fn infinite_space_is_still_sounding_twenty_seconds_after_selection() {
    let mut chamber = ProofChamberInstance::new(SAMPLE_RATE as f32);
    for (name, value) in INFINITE_PATCH {
        chamber.set_param(name, value);
    }

    let mut peak_by_second = [0.0_f32; RENDER_SECONDS];
    let mut sum_squares_by_second = [0.0_f64; RENDER_SECONDS];
    let mut frame = 0;
    while frame < SAMPLE_RATE * RENDER_SECONDS {
        let mut input = [0.0_f32; BLOCK];
        for (offset, sample) in input.iter_mut().enumerate() {
            let sample_frame = frame + offset;
            if sample_frame < BURST_FRAMES {
                let phase =
                    sample_frame as f32 * 220.0 * std::f32::consts::TAU / SAMPLE_RATE as f32;
                *sample = 0.5 * phase.sin();
            }
        }

        let left = chamber.process(&input, &input, BLOCK as u32);
        let right = chamber.get_right_ptr();
        for offset in 0..BLOCK {
            let sample_frame = frame + offset;
            if sample_frame >= SAMPLE_RATE * RENDER_SECONDS {
                break;
            }
            let sample = unsafe { (*left.add(offset)).abs().max((*right.add(offset)).abs()) };
            assert!(
                sample.is_finite(),
                "non-finite output at frame {sample_frame}"
            );
            let second = sample_frame / SAMPLE_RATE;
            peak_by_second[second] = peak_by_second[second].max(sample);
            sum_squares_by_second[second] += f64::from(sample * sample);
        }
        frame += BLOCK;
    }

    let final_peak = peak_by_second[RENDER_SECONDS - 1];
    let final_rms = (sum_squares_by_second[RENDER_SECONDS - 1] / SAMPLE_RATE as f64).sqrt() as f32;
    assert!(
        final_peak >= 0.01 && final_rms >= 0.001,
        "Infinite space died before second {RENDER_SECONDS}: peak {final_peak}, RMS {final_rms}"
    );
}
