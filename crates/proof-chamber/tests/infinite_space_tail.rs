//! Rendered contract for the Dutch Oven's shipped Infinite space.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: usize = 48_000;
const BLOCK: usize = 128;
const RENDER_SECONDS: usize = 20;
const BURST_FRAMES: usize = SAMPLE_RATE / 10;

#[test]
fn infinite_space_is_still_sounding_twenty_seconds_after_selection() {
    let mut chamber = ProofChamberInstance::new(SAMPLE_RATE as f32);
    chamber.set_param("algorithm", 0.0);
    chamber.set_param("mix", 1.0);
    chamber.set_param("size", 0.6);
    chamber.set_param("decay", 0.999);
    chamber.set_param("damping", 0.0);
    chamber.set_param("diffusion", 0.75);
    chamber.set_param("mod_depth", 0.0);
    chamber.set_param("predelay", 0.0);
    chamber.set_param("freeze", 0.0);

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
