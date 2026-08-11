//! Which of Gluten's shared controls each topology can actually hear.
//!
//! `GlutenEngine::set_param` handles the device-level names itself and forwards
//! **everything else to all four topology structs at once** (`engine.rs`, the
//! `_ =>` arm). Each struct then drops what it has no arm for through its own
//! `_ => {}`. So "the engine accepted the name" carries no information about
//! whether the topology the user is listening to did anything with it, and the
//! panel had no way to know: it rendered a live 25–5000 ms Release knob and a
//! live Auto-rel chip on Diode, whose release coefficient is recomputed from
//! the Recovery position on every change.
//!
//! `src/modules/Gluten/models/GlutenTopologyGating.ts` is the table the panel
//! gates from, and `glutenTopologyGating.spec.ts` welds that table to the Rust
//! `set_param` arms so a closed gap cannot leave a control greyed out. Both of
//! those read *source text*. This file is the measurement underneath them:
//! every row is two renders of the real crate that differ in exactly one
//! parameter, compared sample for sample. A row claiming a control is inert
//! shows `0` — bit-identical output — and every such row is paired with a
//! topology where the same parameter moves the output, so a stimulus too weak
//! to show anything cannot pass as proof of inertness.
//!
//! ## Two ways an "inert" control is still audible
//!
//! Both are measured here rather than argued, because the gate would be lying
//! without them.
//!
//! * **Stage two.** `process_block` runs the blend topology on the primary's
//!   output whenever `blend_amount > 0.001` and the two differ, so Release on
//!   Diode is audible the moment Stage 2 is turned up with VCA behind it.
//! * **Auto gain.** The makeup stage reads the active topology's actual curve.
//!   A shared Ratio write therefore remains inert on Opto, whose cell derives
//!   its own ratio, while Amount and direct threshold/ratio writes stay
//!   equivalent on the topologies that implement both controls.

use daw_dsp::gluten::GlutenInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 512;
const BLOCKS: usize = 100;

const TOPOLOGY_VCA: f32 = 0.0;
const TOPOLOGY_OPTO: f32 = 1.0;
const TOPOLOGY_FET: f32 = 2.0;
const TOPOLOGY_DIODE: f32 = 3.0;

const ALL_TOPOLOGIES: [(&str, f32); 4] = [
    ("vca", TOPOLOGY_VCA),
    ("opto", TOPOLOGY_OPTO),
    ("fet", TOPOLOGY_FET),
    ("diode", TOPOLOGY_DIODE),
];

/// A gated tone: 60 ms loud, 60 ms quiet, repeating.
///
/// A steady sine would settle every envelope follower to the same value and
/// make release times unreadable — the control would measure as inert on the
/// topologies that do implement it, which is the failure mode that would turn
/// this whole file into a rubber stamp. The gate keeps a release tail in every
/// window, and the quiet section stays above silence so a feedback detector
/// never falls into a dead zone.
fn stimulus(index: usize) -> (f32, f32) {
    let t = index as f32 / SAMPLE_RATE;
    let loud = (index / (SAMPLE_RATE as usize / 1000 * 60)) % 2 == 0;
    let amp = if loud { 0.9 } else { 0.05 };
    (
        amp * (std::f32::consts::TAU * 220.0 * t).sin(),
        amp * (std::f32::consts::TAU * 330.0 * t).sin(),
    )
}

/// Render the whole run and keep every output sample, interleaved.
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

/// The largest absolute difference between two renders. Exactly `0.0` means the
/// parameter reached nothing at all.
fn max_delta(left: &[f32], right: &[f32]) -> f32 {
    assert_eq!(left.len(), right.len(), "renders must be the same length");
    left.iter()
        .zip(right.iter())
        .map(|(a, b)| (a - b).abs())
        .fold(0.0_f32, f32::max)
}

/// Every shared control the panel renders, stated once, so each guard varies
/// exactly one name and nothing is left at a default it did not choose.
///
/// `auto_makeup` is off here: it is the one engine-level stage that reads a
/// forwarded name (`ratio`) behind the topologies' backs, and leaving it on
/// would make every `ratio` row measure as audible for a reason that has
/// nothing to do with the topology. It gets its own guard below.
fn base(topology: f32) -> impl Fn(&mut GlutenInstance) {
    move |i: &mut GlutenInstance| {
        i.set_param("topology", topology);
        i.set_param("blend_amount", 0.0);
        i.set_param("threshold", -24.0);
        i.set_param("ratio", 4.0);
        i.set_param("attack", 1.0);
        i.set_param("release", 200.0);
        i.set_param("auto_release", 0.0);
        i.set_param("knee", 6.0);
        i.set_param("range", 60.0);
        i.set_param("recovery", 3.0);
        i.set_param("oversampling", 2.0);
        i.set_param("mix", 1.0);
        i.set_param("makeup", 0.0);
        i.set_param("auto_makeup", 0.0);
        i.set_param("lookahead", 0.0);
    }
}

/// Render one topology twice, changing `name` from `low` to `high`.
fn delta_for(topology: f32, name: &'static str, low: f32, high: f32) -> f32 {
    let configure = base(topology);
    let a = render(|i| {
        configure(i);
        i.set_param(name, low);
    });
    let b = render(|i| {
        configure(i);
        i.set_param(name, high);
    });
    max_delta(&a, &b)
}

/// Assert one parameter against every topology at once.
///
/// `audible_on` names the topologies whose output must move; every other
/// topology must be bit-identical. Both halves are required: a guard that only
/// checked the silent side would pass on a stimulus that says nothing.
fn assert_reach(name: &'static str, low: f32, high: f32, audible_on: &[&str]) {
    for (label, topology) in ALL_TOPOLOGIES {
        let delta = delta_for(topology, name, low, high);
        if audible_on.contains(&label) {
            assert!(
                delta > 0.0,
                "`{name}` must reach the {label} topology, but {low} and {high} rendered identically"
            );
        } else {
            assert_eq!(
                delta, 0.0,
                "`{name}` must not reach the {label} topology, but {low} and {high} rendered a max delta of {delta:e}"
            );
        }
    }
}

#[test]
fn release_reaches_vca_and_fet_only() {
    // The issue's claim, measured. Opto's release is the CdS cell's own charge
    // memory and Diode's is recomputed from Recovery, so neither struct has an
    // arm for the name.
    assert_reach("release", 50.0, 3000.0, &["vca", "fet"]);
}

#[test]
fn auto_release_reaches_vca_only() {
    assert_reach("auto_release", 0.0, 1.0, &["vca"]);
}

#[test]
fn knee_reaches_vca_only() {
    // FET and diode both call the shared gain computer with a *literal* knee
    // width (3.0 and 4.0), so the name is one field away rather than a
    // category error — which is why the table calls those two rows `unbuilt`.
    assert_reach("knee", 0.0, 30.0, &["vca"]);
}

#[test]
fn range_reaches_vca_only() {
    // Same shape: `apply_range(gc, 60.0)` in the FET, `apply_range(gc, 40.0)`
    // in the diode, and no call at all in the opto.
    assert_reach("range", 3.0, 60.0, &["vca"]);
}

#[test]
fn oversampling_reaches_fet_and_diode_only() {
    // The default topology is VCA, so the OS chips are dead in a freshly
    // opened panel. The VCA row is `unbuilt` rather than structural: the VCA
    // stage runs its own k2 waveshaper, so there is aliasing for an
    // oversampled path to move.
    assert_reach("oversampling", 1.0, 4.0, &["fet", "diode"]);
}

#[test]
fn attack_reaches_every_topology_except_opto() {
    // 0.5 and 2.0 are inside every topology's clamp — the FET tops out at
    // 2 ms and the diode starts at 0.5 ms — so a null result cannot be an
    // artefact of two values clamping to the same number.
    assert_reach("attack", 0.5, 2.0, &["vca", "fet", "diode"]);
}

#[test]
fn ratio_reaches_every_topology_except_opto() {
    // 1.5 and 6.0 are the diode's own clamp bounds.
    assert_reach("ratio", 1.5, 6.0, &["vca", "fet", "diode"]);
}

#[test]
fn threshold_reaches_every_topology() {
    // The control pin. Every topology has a `threshold` arm, so a change in
    // the harness that made renders identical for the wrong reason reds here
    // before it can certify anything as inert.
    assert_reach("threshold", -36.0, -6.0, &["vca", "opto", "fet", "diode"]);
}

#[test]
fn amount_and_direct_threshold_ratio_render_identically_with_auto_gain() {
    for (label, topology) in ALL_TOPOLOGIES {
        let amount = render(|i| {
            base(topology)(i);
            i.set_param("auto_makeup", 1.0);
            i.set_param("amount", 100.0);
        });
        let direct = render(|i| {
            base(topology)(i);
            i.set_param("auto_makeup", 1.0);
            i.set_param("threshold", -40.0);
            i.set_param("ratio", 8.0);
        });

        assert_eq!(
            max_delta(&amount, &direct),
            0.0,
            "Amount 100% and its exact threshold/ratio expansion must have identical Auto gain on {label}"
        );
    }
}

#[test]
fn auto_gain_uses_diodes_clamped_ratio() {
    let with_auto_gain = |ratio: f32| {
        render(|i| {
            base(TOPOLOGY_DIODE)(i);
            i.set_param("auto_makeup", 1.0);
            i.set_param("ratio", ratio);
        })
    };

    assert_eq!(
        max_delta(&with_auto_gain(6.0), &with_auto_gain(20.0)),
        0.0,
        "Auto gain must use Diode's clamped ratio rather than the raw control value"
    );
}

#[test]
fn stage_two_makes_release_audible_on_diode() {
    // The escape the panel's gate has to respect. With VCA behind it, Diode's
    // Release knob is live again — so gating on the primary topology alone
    // would grey out a control the user can hear.
    let with_blend = |release: f32| {
        render(|i| {
            base(TOPOLOGY_DIODE)(i);
            i.set_param("blend_topology", TOPOLOGY_VCA);
            i.set_param("blend_amount", 0.5);
            i.set_param("release", release);
        })
    };
    let delta = max_delta(&with_blend(50.0), &with_blend(3000.0));
    assert!(
        delta > 0.0,
        "Stage two running VCA behind Diode must make `release` audible again"
    );

    // …and the same patch with Stage 2 at zero is still bit-identical, so the
    // difference above is the blend stage and not the stimulus.
    assert_eq!(delta_for(TOPOLOGY_DIODE, "release", 50.0, 3000.0), 0.0);
}

#[test]
fn a_release_set_on_diode_is_still_there_after_switching_to_vca() {
    // What happens to a value the user already set.
    //
    // Gluten is not shaped like the Dutch Oven, whose `set_param` *constructs*
    // a new engine when the selector moves and replays nothing into it — there,
    // a round trip resets the device. `GlutenEngine` owns all four topology
    // structs for its whole life and broadcasts every forwarded name to all
    // four at once, so a `release` written while Diode was live has already
    // landed in `VcaCompressor::release_ms`. Switching topology writes nothing
    // but `topology`.
    //
    // So: identical to an engine that was on VCA the whole time, and different
    // from one carrying the other release. Nothing is lost and nothing has to
    // be replayed.
    let switched = render(|i| {
        base(TOPOLOGY_DIODE)(i);
        i.set_param("release", 3000.0);
        i.set_param("topology", TOPOLOGY_VCA);
    });
    let never_left = render(|i| {
        base(TOPOLOGY_VCA)(i);
        i.set_param("release", 3000.0);
    });
    assert_eq!(max_delta(&switched, &never_left), 0.0);

    let other_release = render(|i| {
        base(TOPOLOGY_VCA)(i);
        i.set_param("release", 50.0);
    });
    assert!(
        max_delta(&switched, &other_release) > 0.0,
        "the presence pin: two different release times must not render identically on VCA"
    );
}

#[test]
fn auto_gain_does_not_make_ratio_audible_on_opto() {
    // The opto cell derives its own ratio from signal excess. Auto gain must
    // compensate that curve, not revive the shared Ratio control behind the
    // topology's back.
    let with_auto_gain = |ratio: f32| {
        render(|i| {
            base(TOPOLOGY_OPTO)(i);
            i.set_param("auto_makeup", 1.0);
            i.set_param("ratio", ratio);
        })
    };
    let delta = max_delta(&with_auto_gain(1.5), &with_auto_gain(6.0));
    assert_eq!(
        delta, 0.0,
        "Auto gain must not make `ratio` audible on Opto"
    );

    assert_eq!(delta_for(TOPOLOGY_OPTO, "ratio", 1.5, 6.0), 0.0);
}
