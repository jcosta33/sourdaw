//! Reachable level and settling guard for the Plate shimmer feedback path.
//!
//! The panel exposes `shimmer_amount` over 0.0..=1.0 and `decay` through 0.999,
//! while its shipped Shimmer space tile selects 0.3 and 0.75 respectively.
//! Both renders are therefore user-reachable rather than internal parameter
//! corners.
//!
//! Everything above is a *stability* claim, and stability is all this file
//! asserts. `assert_settles`'s first-tail-second floor in particular says only
//! that the plate is still ringing a second after the burst — which it is with
//! the granular shifter deleted, since Shimmer sits inside a tank that has its
//! own tail. The delta row at the bottom is what makes Amount a control here
//! rather than a name; what the *interval* does is measured in
//! `plate_shimmer_render_contract.rs`, which the shipped engine fails.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: usize = 48_000;
const BLOCK: usize = 128;
const RENDER_SECONDS: usize = 20;
const BURST_FRAMES: usize = SAMPLE_RATE / 10;
const OUTPUT_CEILING: f32 = 2.0;
const MIN_AUDIBLE_TAIL_PEAK: f32 = 0.01;
const SETTLING_RATIO: f32 = 0.01;

/// The window the delta row compares: the burst is over 100 ms in, so from one
/// second onwards nothing is sounding but the tank and whatever Shimmer has put
/// into it.
const TAIL_START_SECOND: usize = 1;
const TAIL_END_SECOND: usize = 5;

struct RenderMetrics {
    peak: f32,
    peak_by_second: [f32; RENDER_SECONDS],
    /// Left-channel samples over `TAIL_START_SECOND..TAIL_END_SECOND`, kept so
    /// two renders can be compared sample for sample rather than only through
    /// their envelopes.
    tail: Vec<f32>,
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
    let mut tail = Vec::with_capacity((TAIL_END_SECOND - TAIL_START_SECOND) * SAMPLE_RATE);
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
            if (TAIL_START_SECOND..TAIL_END_SECOND).contains(&second) {
                tail.push(unsafe { *left_ptr.add(offset) });
            }
        }
        frame += BLOCK;
    }

    RenderMetrics {
        peak,
        peak_by_second,
        tail,
    }
}

fn rms(samples: &[f32]) -> f32 {
    let energy: f64 = samples
        .iter()
        .map(|sample| f64::from(*sample) * f64::from(*sample))
        .sum();
    (energy / samples.len() as f64).sqrt() as f32
}

/// RMS of the difference between two renders over the RMS of the louder one.
/// 0 means the two are the same signal; 1 means they differ by as much as
/// either one is large.
fn normalised_difference(a: &[f32], b: &[f32]) -> f32 {
    assert_eq!(a.len(), b.len(), "tails must cover the same window");
    let difference: Vec<f32> = a.iter().zip(b.iter()).map(|(x, y)| x - y).collect();
    rms(&difference) / rms(a).max(rms(b)).max(1e-12)
}

fn assert_settles(metrics: &RenderMetrics, label: &str) {
    let first_tail_peak = metrics.peak_by_second[1];
    let final_peak = metrics.peak_by_second[RENDER_SECONDS - 1];
    assert!(
        first_tail_peak >= MIN_AUDIBLE_TAIL_PEAK,
        "{label} was effectively silent after the input ended: first tail-second peak {first_tail_peak}, per-second {:?}",
        metrics.peak_by_second
    );
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

/// Amount at 0 is an exact bypass of the granular stage — `process` returns
/// `(input + shifted * 0) / (1 + 0)` — so this row is the one assertion in this
/// file that cannot pass with the stage removed, and the one that says the
/// panel's Amount slider reaches the audio.
///
/// The bound is on the *tail*, not on the whole render: the burst itself is
/// mostly dry-path and early reflections, and a difference measured across it
/// would be dominated by material the shifter never touched.
#[test]
fn shimmer_amount_changes_the_tail_it_is_named_for() {
    let inert = render_shimmer(0.0, 0.75);
    let full = render_shimmer(1.0, 0.75);

    for (metrics, label) in [(&inert, "Amount 0.0"), (&full, "Amount 1.0")] {
        assert!(
            rms(&metrics.tail) > 1e-4,
            "{label} left nothing in seconds {TAIL_START_SECOND}..{TAIL_END_SECOND} to compare \
             (tail RMS {:e}), so a difference between the two would not mean what this row \
             claims",
            rms(&metrics.tail)
        );
    }

    let difference = normalised_difference(&inert.tail, &full.tail);
    assert!(
        difference > 0.1,
        "Amount 0.0 and Amount 1.0 render tails that differ by only {difference:.4} of their \
         own amplitude (RMS {:e} against {:e}). Amount 0.0 bypasses the granular stage \
         exactly, so a tail this close means the stage is contributing nothing at full \
         Amount either.",
        rms(&inert.tail),
        rms(&full.tail)
    );
}
