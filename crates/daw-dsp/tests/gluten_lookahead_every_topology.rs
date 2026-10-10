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

fn first_gain_reduction(render: &Render) -> Option<usize> {
    render.gr_db.iter().position(|&gr| gr < 0.0)
}

fn settled_gr_db(render: &Render) -> f32 {
    let tail = &render.gr_db[FRAMES - 2_400..];
    tail.iter().sum::<f32>() / tail.len() as f32
}

/// The delayed burst must reach the output exactly the reported latency late,
/// with gain reduction already under way — begun as the burst entered.
fn late_detection(label: &str, render: &Render) -> Option<String> {
    let delayed_burst = first_audible_output(render);
    let Some(first_reduction) = first_gain_reduction(render) else {
        return Some(format!(
            "{label}: the burst, far over threshold, was never reduced"
        ));
    };
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

/// Stage two is an Opto at −30 dB behind a stage one that passes the burst
/// without reducing it, so every bit of reduction comes from stage two and it
/// can only detect ahead through stage one's output estimate. Each stage one is
/// idled by a control only it reads, set before the Opto's own threshold.
fn idle_into_opto(stage_one: f32, idling: (&'static str, f32)) -> Vec<(&'static str, f32)> {
    vec![
        ("topology", stage_one),
        ("threshold", -30.0),
        ("ratio", 4.0),
        idling,
        ("peak_reduction", 60.0),
        ("blend_topology", OPTO),
        ("blend_amount", 1.0),
    ]
}

#[test]
fn lookahead_reduces_gain_before_the_delayed_burst_reaches_the_output_on_every_topology() {
    let mut cases: Vec<_> = TOPOLOGIES
        .iter()
        .map(|&(label, topology)| (label.to_string(), single_stage(topology)))
        .collect();
    let mut feed_forward = single_stage(VCA);
    feed_forward.push(("feed_forward", 1.0));
    cases.push(("VCA feed-forward".to_string(), feed_forward));
    assert_detects_ahead(&cases);
}

#[test]
fn lookahead_reduces_gain_before_the_delayed_burst_reaches_the_output_in_stage_two() {
    let mut cases: Vec<_> = [("VCA", VCA), ("FET", FET), ("Diode", DIODE)]
        .iter()
        .map(|&(label, topology)| (format!("idle Opto into {label}"), idle_opto_into(topology)))
        .collect();
    cases.extend([
        // Range 0 caps VCA's reduction at nothing.
        (
            "idle VCA into Opto".to_string(),
            idle_into_opto(VCA, ("range", 0.0)),
        ),
        // Ratio 1 is unity gain; the Opto has no ratio control.
        (
            "idle FET into Opto".to_string(),
            idle_into_opto(FET, ("ratio", 1.0)),
        ),
        // A 0 dB threshold sits above the burst; the Opto's is set after it.
        (
            "idle Diode into Opto".to_string(),
            idle_into_opto(DIODE, ("threshold", 0.0)),
        ),
    ]);
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

const MINUS_6_DBFS: f32 = 0.501_187_2;
const SETTLE_FRAMES: usize = 24_000;
/// The last quarter second, long after every topology's attack has settled.
const SETTLE_TAIL: usize = 12_000;
const SETTLE_BLOCK: usize = 120;
const OVERSAMPLING_FACTORS: [f32; 3] = [1.0, 2.0, 4.0];

fn sine(frequency_hz: f32) -> Vec<f32> {
    (0..SETTLE_FRAMES)
        .map(|frame| {
            let t = frame as f32 / SAMPLE_RATE;
            MINUS_6_DBFS * (std::f32::consts::TAU * frequency_hz * t).sin()
        })
        .collect()
}

/// Uniform white noise peaking at −6 dBFS, from a fixed xorshift seed so both
/// renders of a pair hear the same programme.
fn white_noise() -> Vec<f32> {
    let mut state = 0x9E37_79B9_u32;
    (0..SETTLE_FRAMES)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            MINUS_6_DBFS * (state as f32 / u32::MAX as f32 * 2.0 - 1.0)
        })
        .collect()
}

/// Mean gain reduction over the tail. Each block's meter is that block's mean,
/// and the blocks tile the tail, so this is the per-sample mean.
fn settled_reduction(params: &[(&str, f32)], lookahead_ms: f32, programme: &[f32]) -> f32 {
    let mut engine = GlutenEngine::new(SAMPLE_RATE);
    for &(name, value) in params {
        engine.set_param(name, value);
    }
    engine.set_param("lookahead", lookahead_ms);

    let mut tail_sum = 0.0_f32;
    for (index, block) in programme.chunks(SETTLE_BLOCK).enumerate() {
        let mut left = block.to_vec();
        let mut right = block.to_vec();
        engine.process_block(&mut left, &mut right);
        if index * SETTLE_BLOCK >= SETTLE_FRAMES - SETTLE_TAIL {
            tail_sum += engine.current_gr_db();
        }
    }
    tail_sum / (SETTLE_TAIL / SETTLE_BLOCK) as f32
}

fn treble_chain(
    stage_one: f32,
    stage_two: Option<f32>,
    oversampling: f32,
) -> Vec<(&'static str, f32)> {
    let mut params = vec![
        ("topology", stage_one),
        ("threshold", -20.0),
        ("ratio", 4.0),
        ("oversampling", oversampling),
    ];
    if let Some(stage_two) = stage_two {
        params.extend([("blend_topology", stage_two), ("blend_amount", 1.0)]);
    }
    params
}

/// FET and Diode colour their output at an oversampled rate, and the
/// oversampler's half-band filters cut the treble they pass — about 3 dB at
/// 16 kHz. A lookahead estimate that skipped them would let a feedback
/// detector hear more treble than the output carries, and settle deeper on
/// bright programme than the same compressor without lookahead. Every
/// topology, alone and as either stage of a chain, must settle at the same
/// depth with lookahead as without, at every oversampling factor.
#[test]
fn lookahead_keeps_treble_and_noise_settling_at_the_same_reduction_at_every_oversampling() {
    let programmes = [
        ("16 kHz", sine(16_000.0)),
        ("12 kHz", sine(12_000.0)),
        ("white noise", white_noise()),
    ];
    let mut chains: Vec<(String, f32, Option<f32>)> = TOPOLOGIES
        .iter()
        .map(|&(label, topology)| (label.to_string(), topology, None))
        .collect();
    for (one_label, stage_one) in TOPOLOGIES {
        for (two_label, stage_two) in TOPOLOGIES {
            if stage_one != stage_two {
                chains.push((
                    format!("{one_label} into {two_label}"),
                    stage_one,
                    Some(stage_two),
                ));
            }
        }
    }

    let mut failures = Vec::new();
    for oversampling in OVERSAMPLING_FACTORS {
        for (chain_label, stage_one, stage_two) in &chains {
            let params = treble_chain(*stage_one, *stage_two, oversampling);
            for (programme_label, programme) in &programmes {
                let without = settled_reduction(&params, 0.0, programme);
                let with = settled_reduction(&params, LOOKAHEAD_MS, programme);
                let label = format!("{chain_label}, {oversampling}x, {programme_label}");
                println!(
                    "{label}: {without:.3} dB without, {:+.3} dB moved",
                    with - without
                );
                if (with - without).abs() >= 0.05 {
                    failures.push(format!(
                        "{label}: settled reduction moved from {without} dB to {with} dB \
                         with lookahead"
                    ));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
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
