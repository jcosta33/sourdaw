//! The two ways a Gluten control reaches nothing that a `set_param` arm scan
//! cannot see.
//!
//! `gluten_topology_param_reach.rs` measures one population: names the topology
//! structs have no arm for. That census is derived from the arms, which makes
//! it blind by construction to anything the *engine* drops on the floor after
//! accepting the name. Two whole classes live in that blind spot, and both are
//! measured here.
//!
//! * **Detector routing.** `process_block` filters the detector signal — SC
//!   HPF, SC LPF, the SC EQ, Thrust and the external sidechain — and every
//!   topology must use that signal whenever the shared detector chain is active.
//! * **Patch state.** Three controls are switched off by *another control's
//!   value* rather than by the topology: Link under Dual mono, Stage 2 when
//!   both stages name the same topology, and the SC EQ's frequency and width
//!   while its gain is 0 dB.
//!
//! Every row is two renders of the real crate differing in exactly one
//! parameter, compared sample for sample, and every claim of inertness is
//! paired with a configuration where the same parameter moves the output.

use daw_dsp::gluten::GlutenInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 512;
const BLOCKS: usize = 100;

const TOPOLOGY_VCA: f32 = 0.0;
const TOPOLOGY_OPTO: f32 = 1.0;
const TOPOLOGY_FET: f32 = 2.0;
const TOPOLOGY_DIODE: f32 = 3.0;

const STEREO_MODE_STEREO: f32 = 0.0;
const STEREO_MODE_SIDE: f32 = 2.0;
const STEREO_MODE_DUAL_MONO: f32 = 3.0;

const TOPOLOGIES: [(&str, f32); 4] = [
    ("vca", TOPOLOGY_VCA),
    ("opto", TOPOLOGY_OPTO),
    ("fet", TOPOLOGY_FET),
    ("diode", TOPOLOGY_DIODE),
];

/// See `gluten_topology_param_reach.rs` — a steady sine settles every envelope
/// follower and would make timing controls measure as inert on the topologies
/// that do implement them.
fn stimulus(index: usize) -> (f32, f32) {
    let t = index as f32 / SAMPLE_RATE;
    let loud = (index / (SAMPLE_RATE as usize / 1000 * 60)) % 2 == 0;
    let amp = if loud { 0.9 } else { 0.05 };
    (
        amp * (std::f32::consts::TAU * 220.0 * t).sin(),
        amp * (std::f32::consts::TAU * 330.0 * t).sin(),
    )
}

fn render(configure: impl Fn(&mut GlutenInstance)) -> Vec<f32> {
    let mut instance = GlutenInstance::new(SAMPLE_RATE);
    configure(&mut instance);

    let mut captured = Vec::with_capacity(BLOCKS * BLOCK * 2);
    for block in 0..BLOCKS {
        let base = block * BLOCK;
        let left_ptr = instance.get_input_left_ptr();
        let right_ptr = instance.get_input_right_ptr();
        for n in 0..BLOCK {
            let (left, right) = stimulus(base + n);
            unsafe {
                *left_ptr.add(n) = left;
                *right_ptr.add(n) = right;
            }
        }

        let out_left = instance.process(BLOCK as u32);
        let out_right = instance.get_right_ptr();
        for n in 0..BLOCK {
            captured.push(unsafe { *out_left.add(n) });
            captured.push(unsafe { *out_right.add(n) });
        }
    }
    captured
}

fn max_delta(left: &[f32], right: &[f32]) -> f32 {
    assert_eq!(left.len(), right.len(), "renders must be the same length");
    left.iter()
        .zip(right.iter())
        .map(|(a, b)| (a - b).abs())
        .fold(0.0_f32, f32::max)
}

/// A compressing device with **every detector stage switched on and doing
/// something**, so that a null result is the routing and not a stage sitting at
/// a setting where it happens to be transparent.
///
/// The SC EQ carries +18 dB of gain here for the same reason: its frequency and
/// its width have nothing to shape while the bell is flat, which is a real
/// property of the filter and would otherwise be mistaken for the routing gap.
fn detector_base(topology: f32) -> impl Fn(&mut GlutenInstance) {
    move |i: &mut GlutenInstance| {
        i.set_param("topology", topology);
        i.set_param("blend_amount", 0.0);
        i.set_param("threshold", -24.0);
        i.set_param("ratio", 4.0);
        i.set_param("attack", 1.0);
        i.set_param("release", 200.0);
        i.set_param("recovery", 3.0);
        i.set_param("oversampling", 2.0);
        i.set_param("mix", 1.0);
        i.set_param("makeup", 0.0);
        i.set_param("auto_makeup", 0.0);
        i.set_param("stereo_mode", STEREO_MODE_STEREO);
        i.set_param("stereo_link", 1.0);
        i.set_param("sc_hpf_enabled", 1.0);
        i.set_param("sc_hpf_freq", 200.0);
        i.set_param("sc_lpf_enabled", 1.0);
        i.set_param("sc_lpf_freq", 3000.0);
        i.set_param("sc_eq_enabled", 1.0);
        i.set_param("sc_eq_freq", 300.0);
        i.set_param("sc_eq_gain", 18.0);
        i.set_param("sc_eq_q", 2.0);
        i.set_param("thrust", 0.0);
        i.set_param("ext_sidechain", 0.0);
    }
}

fn detector_delta(topology: f32, name: &'static str, low: f32, high: f32) -> f32 {
    let configure = detector_base(topology);
    let render_value = |value| {
        render(|i| {
            configure(i);
            i.set_param(name, f32::NAN);
            i.process(1);
            i.set_param(name, value);
        })
    };
    max_delta(&render_value(low), &render_value(high))
}

/// Every name the sidechain chain configures, with a pair of values far enough
/// apart to be unmissable on a topology that reads them.
const DETECTOR_NAMES: [(&str, f32, f32); 10] = [
    ("sc_hpf_freq", 20.0, 500.0),
    ("sc_hpf_enabled", 0.0, 1.0),
    ("sc_lpf_freq", 1000.0, 20000.0),
    ("sc_lpf_enabled", 0.0, 1.0),
    ("sc_eq_freq", 200.0, 5000.0),
    ("sc_eq_gain", -18.0, 18.0),
    ("sc_eq_q", 0.5, 8.0),
    ("sc_eq_enabled", 0.0, 1.0),
    ("thrust", 0.0, 2.0),
    ("ext_sidechain", 0.0, 1.0),
];

#[test]
fn the_filtered_detector_reaches_every_topology() {
    for (name, low, high) in DETECTOR_NAMES {
        for (label, topology) in TOPOLOGIES {
            let delta = detector_delta(topology, name, low, high);
            assert!(
                delta > 1.0e-6,
                "`{name}` must reach the {label} topology's detector, but rendered a max delta of {delta:e}"
            );
        }
    }
}

#[test]
fn stage_two_uses_the_same_shared_detector_chain() {
    for (name, low, high) in DETECTOR_NAMES {
        let with_diode_stage_two = |value: f32| {
            render(|i| {
                detector_base(TOPOLOGY_VCA)(i);
                i.set_param("blend_topology", TOPOLOGY_DIODE);
                i.set_param("blend_amount", 0.5);
                i.set_param(name, value);
            })
        };
        let delta = max_delta(&with_diode_stage_two(low), &with_diode_stage_two(high));
        assert!(delta > 0.0, "`{name}` must be audible through both stages");
    }
}

fn render_right_with_left_level(left_level: f32) -> Vec<f32> {
    let mut instance = GlutenInstance::new(SAMPLE_RATE);
    detector_base(TOPOLOGY_DIODE)(&mut instance);
    instance.set_param("stereo_link", 0.0);
    instance.set_param("sc_hpf_enabled", 0.0);
    instance.set_param("sc_lpf_enabled", 0.0);
    instance.set_param("sc_eq_enabled", 1.0);
    instance.set_param("sc_eq_gain", 12.0);
    instance.set_param("sc_eq_freq", 400.0);
    instance.set_param("sc_eq_q", 1.5);
    instance.set_param("thrust", 2.0);

    let mut captured = Vec::with_capacity(BLOCKS * BLOCK);
    for block in 0..BLOCKS {
        let base = block * BLOCK;
        let left_ptr = instance.get_input_left_ptr();
        let right_ptr = instance.get_input_right_ptr();
        for n in 0..BLOCK {
            let t = (base + n) as f32 / SAMPLE_RATE;
            unsafe {
                *left_ptr.add(n) = left_level * (std::f32::consts::TAU * 180.0 * t).sin();
                *right_ptr.add(n) = 0.35 * (std::f32::consts::TAU * 630.0 * t).sin();
            }
        }

        instance.process(BLOCK as u32);
        let out_right = instance.get_right_ptr();
        for n in 0..BLOCK {
            captured.push(unsafe { *out_right.add(n) });
        }
    }
    captured
}

#[test]
fn detector_filters_keep_unlinked_channel_state_isolated() {
    let quiet_left = render_right_with_left_level(0.0);
    let loud_left = render_right_with_left_level(0.9);
    let delta = max_delta(&quiet_left, &loud_left);

    assert!(
        delta < 1.0e-6,
        "the right detector must not inherit left-channel EQ or Thrust state, but moved by {delta:e}"
    );
}

fn render_side_mode_with_external_sidechain(sc_left_level: f32, sc_right_level: f32) -> Vec<f32> {
    let mut instance = GlutenInstance::new(SAMPLE_RATE);
    detector_base(TOPOLOGY_VCA)(&mut instance);
    instance.set_param("stereo_mode", STEREO_MODE_SIDE);
    instance.set_param("ext_sidechain", 1.0);

    let mut captured = Vec::with_capacity(BLOCKS * BLOCK);
    for block in 0..BLOCKS {
        let base = block * BLOCK;
        let left_ptr = instance.get_input_left_ptr();
        let right_ptr = instance.get_input_right_ptr();
        let sc_left_ptr = instance.get_sc_left_ptr();
        let sc_right_ptr = instance.get_sc_right_ptr();
        for n in 0..BLOCK {
            let t = (base + n) as f32 / SAMPLE_RATE;
            let main = 0.35 * (std::f32::consts::TAU * 220.0 * t).sin();
            let detector = (std::f32::consts::TAU * 110.0 * t).sin();
            unsafe {
                *left_ptr.add(n) = main;
                *right_ptr.add(n) = -main;
                *sc_left_ptr.add(n) = sc_left_level * detector;
                *sc_right_ptr.add(n) = sc_right_level * detector;
            }
        }

        let out_left = instance.process(BLOCK as u32);
        for n in 0..BLOCK {
            captured.push(unsafe { *out_left.add(n) });
        }
    }
    captured
}

#[test]
fn external_sidechain_is_encoded_before_side_only_detection() {
    let silent = render_side_mode_with_external_sidechain(0.0, 0.0);
    let centered = render_side_mode_with_external_sidechain(0.9, 0.9);
    assert_eq!(
        max_delta(&silent, &centered),
        0.0,
        "a centered external signal has no Side component"
    );

    let anti_phase = render_side_mode_with_external_sidechain(0.9, -0.9);
    assert!(
        max_delta(&silent, &anti_phase) > 1.0e-4,
        "the presence pin: an anti-phase external signal must drive Side detection"
    );
}

fn render_diode_step(lookahead_ms: f32) -> Vec<f32> {
    const FRAMES: usize = 1024;
    let mut instance = GlutenInstance::new(SAMPLE_RATE);
    detector_base(TOPOLOGY_DIODE)(&mut instance);
    instance.set_param("limiter_threshold", 0.0);
    instance.set_param("lookahead", lookahead_ms);

    let left_ptr = instance.get_input_left_ptr();
    let right_ptr = instance.get_input_right_ptr();
    for n in 0..FRAMES {
        unsafe {
            *left_ptr.add(n) = 0.9;
            *right_ptr.add(n) = 0.9;
        }
    }

    let out_left = instance.process(FRAMES as u32);
    (0..FRAMES).map(|n| unsafe { *out_left.add(n) }).collect()
}

#[test]
fn diode_lookahead_drives_detection_from_the_undelayed_program() {
    const LOOKAHEAD_MS: f32 = 10.0;
    const ONSET_WINDOW: usize = 24;
    let no_lookahead = render_diode_step(0.0);
    let with_lookahead = render_diode_step(LOOKAHEAD_MS);
    let latency = (LOOKAHEAD_MS * 0.001 * SAMPLE_RATE) as usize;
    let no_lookahead_peak = no_lookahead[..ONSET_WINDOW]
        .iter()
        .map(|sample| sample.abs())
        .fold(0.0_f32, f32::max);
    let lookahead_peak = with_lookahead[latency..latency + ONSET_WINDOW]
        .iter()
        .map(|sample| sample.abs())
        .fold(0.0_f32, f32::max);

    assert!(
        lookahead_peak < no_lookahead_peak * 0.8,
        "the detector must use the undelayed program: lookahead onset {lookahead_peak} vs immediate onset {no_lookahead_peak}"
    );
}

// ── Patch state ──────────────────────────────────────────────────────────────

/// The plain configuration the patch-state guards vary one field of.
fn patch_base(topology: f32) -> impl Fn(&mut GlutenInstance) {
    move |i: &mut GlutenInstance| {
        i.set_param("topology", topology);
        i.set_param("threshold", -24.0);
        i.set_param("ratio", 4.0);
        i.set_param("attack", 1.0);
        i.set_param("release", 200.0);
        i.set_param("mix", 1.0);
        i.set_param("makeup", 0.0);
        i.set_param("auto_makeup", 0.0);
        i.set_param("blend_amount", 0.0);
        i.set_param("stereo_mode", STEREO_MODE_STEREO);
        i.set_param("stereo_link", 1.0);
    }
}

#[test]
fn link_does_nothing_under_dual_mono() {
    // `apply_detector_settings` (`engine.rs`) forces the link to 0 whenever the
    // stereo mode is Dual mono, because dual mono *is* an unlinked detector.
    // Nothing in any topology's `set_param` says so, which is why the arm-scan
    // census cannot see this row.
    let under_dual_mono = |link: f32| {
        render(|i| {
            patch_base(TOPOLOGY_VCA)(i);
            i.set_param("stereo_mode", STEREO_MODE_DUAL_MONO);
            i.set_param("stereo_link", link);
        })
    };
    assert_eq!(max_delta(&under_dual_mono(0.0), &under_dual_mono(1.0)), 0.0);

    let under_stereo = |link: f32| {
        render(|i| {
            patch_base(TOPOLOGY_VCA)(i);
            i.set_param("stereo_link", link);
        })
    };
    assert!(
        max_delta(&under_stereo(0.0), &under_stereo(1.0)) > 0.0,
        "the presence pin: Link must move the output in an ordinary stereo mode"
    );
}

#[test]
fn stage_two_does_nothing_while_both_stages_name_one_topology() {
    // `process_block` runs the blend only when `blend_topology !=
    // active_topology`. The panel filters the primary out of the Stage-two
    // chooser, so this state is reached by moving the *primary* onto whatever
    // Stage two already held — and `blendTopology` defaults to Opto, so
    // selecting Opto as the primary is enough.
    let matched = |amount: f32| {
        render(|i| {
            patch_base(TOPOLOGY_OPTO)(i);
            i.set_param("blend_topology", TOPOLOGY_OPTO);
            i.set_param("blend_amount", amount);
        })
    };
    assert_eq!(max_delta(&matched(0.0), &matched(1.0)), 0.0);

    let differing = |amount: f32| {
        render(|i| {
            patch_base(TOPOLOGY_OPTO)(i);
            i.set_param("blend_topology", TOPOLOGY_FET);
            i.set_param("blend_amount", amount);
        })
    };
    assert!(
        max_delta(&differing(0.0), &differing(1.0)) > 0.0,
        "the presence pin: Stage 2 must move the output once the two stages differ"
    );
}

#[test]
fn the_sc_eq_frequency_and_width_do_nothing_at_zero_gain() {
    // A bell at 0 dB is a wire. Measured on the diode, the only topology whose
    // detector reads the SC EQ at all, so the null is the flat bell and not the
    // routing gap the first half of this file establishes.
    let flat = |name: &'static str, value: f32| {
        render(|i| {
            detector_base(TOPOLOGY_DIODE)(i);
            i.set_param("sc_eq_gain", 0.0);
            i.set_param(name, value);
        })
    };
    assert_eq!(
        max_delta(&flat("sc_eq_freq", 200.0), &flat("sc_eq_freq", 5000.0)),
        0.0
    );
    assert_eq!(max_delta(&flat("sc_eq_q", 0.5), &flat("sc_eq_q", 8.0)), 0.0);

    // The presence pin for both, with the bell doing something.
    assert!(detector_delta(TOPOLOGY_DIODE, "sc_eq_freq", 200.0, 5000.0) > 0.0);
    assert!(detector_delta(TOPOLOGY_DIODE, "sc_eq_q", 0.5, 8.0) > 0.0);
}

// ── The Character card's own controls, on a blend stage ───────────────────────

#[test]
fn a_stage_two_topology_hears_its_own_character_controls() {
    // Why the Character card is rendered for the blend stage as well as the
    // primary. `GlutenEngine` owns all four topology structs and every write
    // lands in all of them, so the stage-two FET reads `input_gain` and the
    // stage-two diode reads `recovery` exactly as a primary would — while the
    // panel's `patch.topology === …` conditionals put both controls off screen.
    let with_fet_stage_two = |input_gain: f32| {
        render(|i| {
            patch_base(TOPOLOGY_VCA)(i);
            i.set_param("blend_topology", TOPOLOGY_FET);
            i.set_param("blend_amount", 0.5);
            i.set_param("input_gain", input_gain);
        })
    };
    assert!(
        max_delta(&with_fet_stage_two(-12.0), &with_fet_stage_two(24.0)) > 0.0,
        "a FET stage two must hear `input_gain`"
    );

    let with_diode_stage_two = |recovery: f32| {
        render(|i| {
            patch_base(TOPOLOGY_VCA)(i);
            i.set_param("blend_topology", TOPOLOGY_DIODE);
            i.set_param("blend_amount", 0.5);
            i.set_param("recovery", recovery);
        })
    };
    assert!(
        max_delta(&with_diode_stage_two(1.0), &with_diode_stage_two(5.0)) > 0.0,
        "a diode stage two must hear `recovery` — its only release control"
    );
}
