//! Gluten's lookahead detects ahead of the delayed audio on every topology.
//!
//! Lookahead delays the audio by the latency Gluten reports, and its whole
//! point is that the detector hears a transient that much before the transient
//! reaches the output. Before #4958 only Diode did: VCA, Opto and FET detected
//! from audio that was already delayed, so lookahead cost latency and caught
//! nothing earlier.
//!
//! Each render here runs one sample per block, so `current_gr_db` reads that
//! sample's own reduction rather than a block average.

use daw_dsp::gluten::engine::GlutenEngine;
use daw_dsp::gluten::GlutenInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const LOOKAHEAD_MS: f32 = 5.0;
const LOOKAHEAD_SAMPLES: usize = 240;
const ONSET: usize = 480;
const FRAMES: usize = 9_600;
const BURST_PEAK: f32 = 0.5;
/// Samples the detector may take to cross threshold once the burst enters it.
const DETECTOR_RISE: usize = 8;

const VCA: f32 = 0.0;
const OPTO: f32 = 1.0;
const FET: f32 = 2.0;
const DIODE: f32 = 3.0;

const TOPOLOGIES: [(&str, f32); 4] = [("Diode", DIODE), ("VCA", VCA), ("Opto", OPTO), ("FET", FET)];

/// A 1 kHz burst at full level from its first sample, like a snare hit.
fn burst(frame: usize) -> f32 {
    if frame < ONSET {
        return 0.0;
    }
    let t = (frame - ONSET) as f32 / SAMPLE_RATE;
    BURST_PEAK * (std::f32::consts::TAU * 1_000.0 * t).cos()
}

struct Render {
    output: Vec<f32>,
    gr_db: Vec<f32>,
    latency: usize,
}

fn render(params: &[(&str, f32)], lookahead_ms: f32) -> Render {
    let mut engine = GlutenEngine::new(SAMPLE_RATE);
    for &(name, value) in params {
        engine.set_param(name, value);
    }
    engine.set_param("lookahead", lookahead_ms);

    let mut output = Vec::with_capacity(FRAMES);
    let mut gr_db = Vec::with_capacity(FRAMES);
    for frame in 0..FRAMES {
        let mut left = [burst(frame)];
        let mut right = [burst(frame)];
        engine.process_block(&mut left, &mut right);
        output.push(left[0]);
        gr_db.push(engine.current_gr_db());
    }
    Render {
        output,
        gr_db,
        latency: engine.latency_samples() as usize,
    }
}

fn single_stage(topology: f32) -> Vec<(&'static str, f32)> {
    vec![("topology", topology), ("threshold", -30.0), ("ratio", 4.0)]
}

/// Stage one is an Opto whose threshold sits above the burst, so every bit of
/// reduction comes from stage two.
fn idle_opto_into(stage_two: f32) -> Vec<(&'static str, f32)> {
    vec![
        ("topology", OPTO),
        ("threshold", -30.0),
        ("ratio", 4.0),
        ("peak_reduction", 0.0),
        ("blend_topology", stage_two),
        ("blend_amount", 1.0),
    ]
}

fn first_audible_output(render: &Render) -> usize {
    render
        .output
        .iter()
        .position(|sample| sample.abs() > 1e-6)
        .expect("the burst reaches the output")
}

fn first_gain_reduction(render: &Render) -> usize {
    render
        .gr_db
        .iter()
        .position(|&gr| gr < 0.0)
        .expect("the burst is far enough over threshold to be reduced")
}

fn settled_gr_db(render: &Render) -> f32 {
    let tail = &render.gr_db[FRAMES - 2_400..];
    tail.iter().sum::<f32>() / tail.len() as f32
}

/// The delayed burst must reach the output exactly the reported latency late,
/// with gain reduction already under way — begun as the burst entered.
fn late_detection(label: &str, render: &Render) -> Option<String> {
    let delayed_burst = first_audible_output(render);
    let first_reduction = first_gain_reduction(render);
    if render.latency != LOOKAHEAD_SAMPLES || delayed_burst != ONSET + render.latency {
        return Some(format!(
            "{label}: reported latency {} with the burst reaching the output at sample \
             {delayed_burst}; both must be the lookahead time",
            render.latency
        ));
    }
    if first_reduction > delayed_burst || first_reduction > ONSET + DETECTOR_RISE {
        return Some(format!(
            "{label}: gain reduction began at sample {first_reduction}, the delayed burst \
             reached the output at sample {delayed_burst}; the detector must hear the \
             burst as it enters at sample {ONSET}"
        ));
    }
    None
}

/// Every topology is checked before failing, so a regression names them all.
fn assert_detects_ahead(cases: &[(String, Vec<(&str, f32)>)]) {
    let failures: Vec<String> = cases
        .iter()
        .filter_map(|(label, params)| late_detection(label, &render(params, LOOKAHEAD_MS)))
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn lookahead_reduces_gain_before_the_delayed_burst_reaches_the_output_on_every_topology() {
    let cases: Vec<_> = TOPOLOGIES
        .iter()
        .map(|&(label, topology)| (label.to_string(), single_stage(topology)))
        .collect();
    assert_detects_ahead(&cases);
}

#[test]
fn lookahead_reduces_gain_before_the_delayed_burst_reaches_the_output_in_stage_two() {
    let cases: Vec<_> = [("VCA", VCA), ("FET", FET), ("Diode", DIODE)]
        .iter()
        .map(|&(label, topology)| (format!("idle Opto into {label}"), idle_opto_into(topology)))
        .collect();
    assert_detects_ahead(&cases);
}

/// VCA (in its default feedback mode), Opto and FET sense their own output.
/// Under lookahead they sense it ahead of the delay, so the level they settle
/// at — the feedback character — must not move. A detector that read the raw
/// programme instead would settle near Diode's feed-forward depth, about 6 dB
/// deeper here.
#[test]
fn lookahead_keeps_every_topology_settling_at_the_same_reduction() {
    for (label, topology) in TOPOLOGIES {
        let without = settled_gr_db(&render(&single_stage(topology), 0.0));
        let with = settled_gr_db(&render(&single_stage(topology), LOOKAHEAD_MS));
        assert!(
            (with - without).abs() < 0.05,
            "{label}: settled reduction moved from {without} dB to {with} dB with lookahead"
        );
    }
}

#[test]
fn reported_latency_is_the_lookahead_time() {
    for (lookahead_ms, expected) in [(0.0, 0), (LOOKAHEAD_MS, 240), (20.0, 960)] {
        for (label, topology) in TOPOLOGIES {
            let mut instance = GlutenInstance::new(SAMPLE_RATE);
            instance.set_param("topology", topology);
            instance.set_param("lookahead", lookahead_ms);
            assert_eq!(
                instance.get_latency_samples(),
                expected,
                "{label} at {lookahead_ms} ms"
            );
        }
    }
}

/// `(output, gain reduction dB)` at `REFERENCE_FRAMES` with lookahead off,
/// captured from the implementation before #4958. Lookahead off must keep
/// detecting exactly as it did.
const REFERENCE_FRAMES: [usize; 5] = [
    ONSET + 3,
    ONSET + 30,
    ONSET + 300,
    ONSET + 3_000,
    FRAMES - 1,
];

#[test]
fn lookahead_off_matches_the_captured_reference() {
    let cases: [(&str, Vec<(&str, f32)>, [(f32, f32); 5]); 5] = [
        (
            "Diode",
            single_stage(DIODE),
            [
                (0.45603088, -0.024727345),
                (-0.42635408, -0.8258949),
                (0.058903456, -10.296183),
                (-0.07552669, -15.728811),
                (0.07064318, -15.750739),
            ],
        ),
        (
            "VCA",
            single_stage(VCA),
            [
                (0.4623689, -0.0039586145),
                (-0.34327662, -0.24721114),
                (-2.1438152e-7, -4.6832542),
                (-0.1662539, -9.558799),
                (0.16837946, -9.384205),
            ],
        ),
        (
            "Opto",
            single_stage(OPTO),
            [
                (0.46181655, -0.0023172316),
                (-0.34373537, -0.24461406),
                (-2.0683186e-7, -4.9946523),
                (-0.15799135, -10.006734),
                (0.15803003, -9.929988),
            ],
        ),
        (
            "FET",
            single_stage(FET),
            [
                (0.57541686, 0.0),
                (-0.47087398, -2.7393541),
                (0.08749012, -9.947927),
                (-0.20025478, -10.316352),
                (0.18800776, -10.316272),
            ],
        ),
        (
            "VCA into Opto",
            {
                let mut params = single_stage(VCA);
                params.extend([("blend_topology", OPTO), ("blend_amount", 0.6)]);
                params
            },
            [
                (0.46229374, -0.00537084),
                (-0.33758447, -0.39326656),
                (-1.6137696e-7, -7.451378),
                (-0.10805125, -14.123061),
                (0.1107309, -13.790121),
            ],
        ),
    ];

    for (label, params, expected) in cases {
        let render = render(&params, 0.0);
        for (&frame, &(output, gr_db)) in REFERENCE_FRAMES.iter().zip(expected.iter()) {
            assert!(
                (render.output[frame] - output).abs() < 1e-5,
                "{label} output at {frame}: {} vs reference {output}",
                render.output[frame]
            );
            assert!(
                (render.gr_db[frame] - gr_db).abs() < 1e-4,
                "{label} gain reduction at {frame}: {} vs reference {gr_db}",
                render.gr_db[frame]
            );
        }
    }
}
