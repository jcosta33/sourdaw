//! Rendered contract for the Dutch Oven's shipped Infinite space.

#![allow(clippy::unwrap_used, reason = "tests assert by unwrapping")]

use std::collections::BTreeMap;

use proof_chamber::ProofChamberInstance;
use serde::Deserialize;

const SAMPLE_RATE: usize = 48_000;
const BLOCK: usize = 128;
const RENDER_SECONDS: usize = 20;
const BURST_FRAMES: usize = SAMPLE_RATE / 10;

#[derive(Deserialize)]
struct InfinitePatch {
    space: String,
    parameters: BTreeMap<String, f32>,
}

#[test]
fn infinite_space_is_still_sounding_twenty_seconds_after_selection() {
    let patch: InfinitePatch =
        serde_json::from_str(include_str!("fixtures/infinite_space_patch.json"))
            .expect("Infinite patch fixture must be valid JSON");
    assert_eq!(patch.space, "infinite");
    assert_eq!(patch.parameters.len(), 28);

    let mut chamber = ProofChamberInstance::new(SAMPLE_RATE as f32);
    for (name, value) in patch.parameters {
        chamber.set_param(&name, value);
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
            // SAFETY: `left` is the instance's `out_left`, allocated at
            // `PROOF_CHAMBER_BLOCK_FRAMES` samples by `ProofChamberInstance::new`
            // and never resized, and `offset < BLOCK`, which is inside that
            // capacity.
            let left_slot = unsafe { left.add(offset) };
            // SAFETY: `left_slot` is in bounds of that initialised buffer, and
            // nothing writes the instance between `process` and this read.
            let left_sample = unsafe { *left_slot };
            // SAFETY: `right` is the instance's `out_right`, sized and bounded
            // exactly as `out_left` above.
            let right_slot = unsafe { right.add(offset) };
            // SAFETY: `right_slot` is in bounds of that initialised buffer,
            // which nothing writes before this read.
            let right_sample = unsafe { *right_slot };
            let sample = left_sample.abs().max(right_sample.abs());
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
