//! Reachable level and settling guard for the Plate shimmer feedback path.
//!
//! The panel exposes `shimmer_amount` over 0.0..=1.0 and `decay` through 0.999,
//! while its shipped Shimmer space tile selects 0.3 and 0.75 respectively.
//! Both renders are therefore user-reachable rather than internal parameter
//! corners.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: usize = 48_000;
const BLOCK: usize = 128;
const RENDER_SECONDS: usize = 20;
const BURST_FRAMES: usize = SAMPLE_RATE / 10;
const OUTPUT_CEILING: f32 = 2.0;
const SETTLING_RATIO: f32 = 0.01;

struct RenderMetrics {
    peak: f32,
    peak_by_second: [f32; RENDER_SECONDS],
}

fn render_shimmer(amount: f32, decay: f32) -> RenderMetrics {
    let mut chamber = ProofChamberInstance::new(SAMPLE_RATE as f32);
    chamber.set_param("algorithm", 0.0);
    chamber.set_param("mix", 1.0);
    chamber.set_param("size", 0.8);
    chamber.set_param("decay", decay);
    chamber.set_param("damping", 0.1);
    chamber.set_param("diffusion", 0.8);
    chamber.set_param("mod_depth", 0.5);
    chamber.set_param("predelay", 25.0);
    chamber.set_param("shimmer", 1.0);
    chamber.set_param("shimmer_amount", amount);
    chamber.set_param("shimmer_pitch", 1.0);

    let mut peak = 0.0_f32;
    let mut peak_by_second = [0.0_f32; RENDER_SECONDS];
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

        let left_ptr = chamber.process(&input, &input, BLOCK as u32);
        let right_ptr = chamber.get_right_ptr();
        assert!(!left_ptr.is_null());
        assert!(!right_ptr.is_null());

        for offset in 0..BLOCK {
            let sample_frame = frame + offset;
            if sample_frame >= SAMPLE_RATE * RENDER_SECONDS {
                break;
            }
            let sample_peak = unsafe {
                (*left_ptr.add(offset))
                    .abs()
                    .max((*right_ptr.add(offset)).abs())
            };
            assert!(
                sample_peak.is_finite(),
                "non-finite output at frame {sample_frame}"
            );
            peak = peak.max(sample_peak);
            let second = sample_frame / SAMPLE_RATE;
            peak_by_second[second] = peak_by_second[second].max(sample_peak);
        }
        frame += BLOCK;
    }

    RenderMetrics {
        peak,
        peak_by_second,
    }
}

fn assert_settles(metrics: &RenderMetrics, label: &str) {
    let first_tail_peak = metrics.peak_by_second[1];
    let final_peak = metrics.peak_by_second[RENDER_SECONDS - 1];
    assert!(
        final_peak <= first_tail_peak * SETTLING_RATIO,
        "{label} did not settle below {:.0}% of its first tail second: first {}, final {}, per-second {:?}",
        SETTLING_RATIO * 100.0,
        first_tail_peak,
        final_peak,
        metrics.peak_by_second
    );
}

#[test]
fn plate_shimmer_stays_bounded_at_the_shipped_and_panel_max_amounts() {
    let shipped = render_shimmer(0.3, 0.75);
    let panel_max = render_shimmer(1.0, 0.999);

    assert!(
        shipped.peak <= OUTPUT_CEILING,
        "shipped Shimmer tile exceeded {OUTPUT_CEILING}: peak {}, per-second {:?}",
        shipped.peak,
        shipped.peak_by_second
    );
    assert!(
        panel_max.peak <= OUTPUT_CEILING,
        "panel-max Shimmer exceeded {OUTPUT_CEILING}: peak {}, per-second {:?}",
        panel_max.peak,
        panel_max.peak_by_second
    );
    assert_settles(&shipped, "shipped Shimmer tile");
    assert_settles(&panel_max, "panel-max Shimmer");
}
