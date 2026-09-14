//! Automating `size` must not splice the delay-line reads.
//!
//! `size` retunes every line's length at block rate. Following the new length
//! instantly jumps each read index tens to hundreds of samples in one sample,
//! which splices two decorrelated stretches of the ring buffer together — one
//! hard discontinuity per block for the length of the gesture. Finiteness, the
//! assertion `fdn_size_automation_rt.rs` makes, cannot see a click.
//!
//! The discriminator: steps landing exactly on the size-write boundaries,
//! against the render's own intra-block steps. A splice is concentrated where
//! the writes land — every block whose retune moves a line onto a new prime —
//! while a continuous read makes boundary steps statistically ordinary. The
//! tail is driven by a pure tone, and the comparison is medians, so one large
//! step cannot decide the verdict in either direction.

use proof_chamber::fdn::FdnReverb;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
/// Half a second of warm-up at the starting size, so the measurement window
/// begins on a running tank and outside the mix smoothing ramp.
const WARM_BLOCKS: usize = 187;
/// The sweep itself: a full-range triangle at block rate, ~0.7 s.
const SWEEP_BLOCKS: usize = 340;

/// A full-range triangle that starts and ends at the warmed size, the shape a
/// real envelope draws: automation passes through intermediate values, so the
/// only steps the tank ever sees are the per-block ones this file exists to
/// judge. (An opening jump from the warm size straight to an extreme would
/// measure the one intentional 30 ms glide, not the per-block splices.)
fn triangle_sweep() -> [f32; SWEEP_BLOCKS] {
    let mut sizes = [0.5_f32; SWEEP_BLOCKS];
    for (block, size) in sizes.iter_mut().enumerate() {
        let phase = (block as f32 / (SWEEP_BLOCKS - 1) as f32) * 4.0;
        let triangle = if phase <= 1.0 {
            phase
        } else if phase <= 3.0 {
            2.0 - phase
        } else {
            phase - 4.0
        };
        *size = 0.5 + 0.5 * triangle;
    }
    sizes
}

/// Render the tank fed a 330 Hz tone, and return the left wet tail — one
/// sample per frame, so a window of `N` below is N frames of output.
///
/// `early_late` pins the output to the late tank, exactly as in
/// `fdn_size_tuning.rs`: the early reflections track `size` too, and this file
/// makes a claim about the delay-line reads the issue names.
fn render(sizes: &[f32; SWEEP_BLOCKS]) -> Vec<f32> {
    let mut reverb = FdnReverb::new(SAMPLE_RATE, 8);
    reverb.set_param("mix", 1.0);
    reverb.set_param("early_late", 1.0);
    reverb.set_param("decay", 0.7);

    let mut frame = 0_usize;
    let mut output = Vec::with_capacity((WARM_BLOCKS + SWEEP_BLOCKS) * BLOCK);
    for _ in 0..WARM_BLOCKS {
        push_block(&mut reverb, &mut frame, &mut output);
    }
    for size in sizes {
        reverb.set_param("size", *size);
        push_block(&mut reverb, &mut frame, &mut output);
    }
    output
}

fn push_block(reverb: &mut FdnReverb, frame: &mut usize, output: &mut Vec<f32>) {
    const STIMULUS_HZ: f32 = 330.0;
    let mut left = [0.0_f32; BLOCK];
    let mut right = [0.0_f32; BLOCK];
    for i in 0..BLOCK {
        let sample =
            0.5 * ((*frame + i) as f32 * STIMULUS_HZ * std::f32::consts::TAU / SAMPLE_RATE).sin();
        left[i] = sample;
        right[i] = sample;
    }
    reverb.process(&mut left, &mut right);
    output.extend_from_slice(&left);
    *frame += BLOCK;
}

/// The median sample-to-sample step landing exactly on a `size`-write
/// boundary, and the median step inside a block, of one swept render.
///
/// `size` is written once per block, and the tuning moves a line onto a new
/// prime at nearly every block of a full-range sweep, so an instant retune
/// splices at most boundaries — the read jumps to the new length the sample
/// the write lands. Medians, not maxima: a continuous read makes boundary
/// steps statistically ordinary steps of the tail, and ordinary statistics
/// survive the isolated large steps any dense reverb tail produces.
fn median_boundary_and_intra_step(samples: &[f32]) -> (f32, f32) {
    fn median(mut values: Vec<f32>) -> f32 {
        values.sort_by(f32::total_cmp);
        values[values.len() / 2]
    }

    let mut boundary = Vec::new();
    let mut intra = Vec::new();
    for n in 1..samples.len() {
        let step = (samples[n] - samples[n - 1]).abs();
        if n % BLOCK == 0 {
            boundary.push(step);
        } else {
            intra.push(step);
        }
    }
    (median(boundary), median(intra))
}

#[test]
fn a_block_rate_size_sweep_does_not_splice_the_wet_tail() {
    let swept = render(&triangle_sweep());
    let window = &swept[WARM_BLOCKS * BLOCK..];
    let peak = window.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
    assert!(
        peak > 1e-2,
        "the sweep rendered a silent tank (peak {peak}); the comparison below \
         would then bound nothing"
    );

    let (boundary, intra) = median_boundary_and_intra_step(window);
    assert!(
        boundary < 2.0 * intra,
        "the median step at size-write boundaries is {boundary} against a \
         median intra-block step of {intra} — the read jumps to the new length \
         the sample the write lands, which is the splice this file keeps out"
    );
}
