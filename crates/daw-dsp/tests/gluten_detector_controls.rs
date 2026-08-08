//! Gluten's Link, Detection and Dual-mono controls have to change what comes
//! out of the compressor.
//!
//! All three were declared end-to-end and connected to nothing. `set_param`
//! stored `stereo_link` and `detection_mode` in fields the render loop never
//! read (rustc said so itself: `fields rms_l and rms_r are never read`), and
//! `StereoMode::DualMono` was constructed by the `stereo_mode` arm and then
//! matched by no arm anywhere — every branch sent it to the same `_` case as
//! plain stereo, so value 3 was bit-identical to value 0. Detection was
//! hard-wired peak-of-`max(|l|, |r|)` inside each of the four topologies.
//!
//! Every guard here drives a real `GlutenInstance` through `set_param` — the
//! same wire the worklet writes on — and measures **rendered output**, because
//! the failure being guarded against is precisely a parameter that is stored,
//! listed, and inaudible. A guard that asserted "the setter was called" or
//! "the name is in the table" is the guard that let this ship.
//!
//! Two blindnesses are called out rather than left to inference:
//!
//! * **Interior points.** Link is asserted at 0.25/0.5/0.75 as well as at the
//!   ends. A detector that ignored the blend and hard-switched at 0.5 would
//!   satisfy both ends and fail the middle. So would one whose response was
//!   reshaped or shrunk.
//! * **Every topology.** VCA is the default and the only one anybody would
//!   test by hand; the controls are asserted against all four, because the
//!   dead detection lived in four separate copies.

use daw_dsp::gluten::GlutenInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 512;

/// Long enough for a 100 ms release to settle and for the RMS detector's 10 ms
/// window to fill several times over.
const BLOCKS: usize = 120;

/// Blocks discarded before measuring, so nothing reads the attack transient.
const SETTLE_BLOCKS: usize = 60;

const TOPOLOGY_VCA: f32 = 0.0;
const TOPOLOGY_OPTO: f32 = 1.0;
const TOPOLOGY_FET: f32 = 2.0;
const TOPOLOGY_DIODE: f32 = 3.0;

const DETECTION_RMS: f32 = 0.0;
const DETECTION_PEAK: f32 = 1.0;

const STEREO_MODE_STEREO: f32 = 0.0;
const STEREO_MODE_DUAL_MONO: f32 = 3.0;

const ALL_TOPOLOGIES: [(&str, f32); 4] = [
    ("vca", TOPOLOGY_VCA),
    ("opto", TOPOLOGY_OPTO),
    ("fet", TOPOLOGY_FET),
    ("diode", TOPOLOGY_DIODE),
];

/// Settled RMS of each output channel, in dB.
struct Rendered {
    left_db: f32,
    right_db: f32,
}

fn db(rms: f32) -> f32 {
    if rms > 1e-10 {
        20.0 * rms.log10()
    } else {
        -200.0
    }
}

/// Render a stereo sine pair through a configured instance and return the
/// settled per-channel level.
///
/// `configure` receives the instance before any audio runs, so a guard states
/// its whole configuration in one place and nothing is left at a default it
/// did not choose.
fn render(configure: impl Fn(&mut GlutenInstance), left_amp: f32, right_amp: f32) -> Rendered {
    let mut instance = GlutenInstance::new(SAMPLE_RATE);
    configure(&mut instance);

    let mut left_sq = 0.0_f64;
    let mut right_sq = 0.0_f64;
    let mut counted = 0_usize;

    for block in 0..BLOCKS {
        let base = block * BLOCK;
        let left_ptr = instance.get_input_left_ptr();
        let right_ptr = instance.get_input_right_ptr();
        for n in 0..BLOCK {
            let t = (base + n) as f32 / SAMPLE_RATE;
            // Two different frequencies so a channel's own content is
            // distinguishable, and neither is a multiple of the other.
            let left = left_amp * (std::f32::consts::TAU * 220.0 * t).sin();
            let right = right_amp * (std::f32::consts::TAU * 990.0 * t).sin();
            unsafe {
                *left_ptr.add(n) = left;
                *right_ptr.add(n) = right;
            }
        }

        let out_left = instance.process(BLOCK as u32);
        let out_right = instance.get_right_ptr();
        if block < SETTLE_BLOCKS {
            continue;
        }
        for n in 0..BLOCK {
            let l = unsafe { *out_left.add(n) };
            let r = unsafe { *out_right.add(n) };
            left_sq += f64::from(l) * f64::from(l);
            right_sq += f64::from(r) * f64::from(r);
            counted += 1;
        }
    }

    let n = counted as f64;
    Rendered {
        left_db: db((left_sq / n).sqrt() as f32),
        right_db: db((right_sq / n).sqrt() as f32),
    }
}

/// A compressor that is actually compressing, with every time constant and
/// every shared control stated. Written as a closure factory so each guard
/// varies exactly one thing.
fn compressing(topology: f32) -> impl Fn(&mut GlutenInstance) {
    move |i: &mut GlutenInstance| {
        i.set_param("topology", topology);
        i.set_param("threshold", -18.0);
        i.set_param("ratio", 4.0);
        i.set_param("attack", 5.0);
        i.set_param("release", 100.0);
        i.set_param("auto_release", 0.0);
        i.set_param("knee", 0.0);
        i.set_param("range", 60.0);
        i.set_param("mix", 1.0);
        i.set_param("makeup", 0.0);
    }
}

/// Loud left, quiet right.
///
/// The quiet channel is deliberately kept *above* the −18 dB threshold rather
/// than under it (0.3 is −10.5 dB peak). Three of the four topologies are
/// feedback designs, and a feedback compressor holding a channel just below
/// threshold has a genuine dead zone: ducking the detector drops it under the
/// threshold, which un-ducks it, and the loop settles at zero gain reduction
/// for a whole stretch of the Link knob. That is correct behaviour, not a dead
/// control, but it makes the low end of the travel unreadable — so the
/// stimulus is placed where every part of the travel is on the compressing
/// side of the knee and the taper is actually observable.
const LOUD: f32 = 0.9;
const QUIET: f32 = 0.3;

fn right_level_at_link(topology: f32, link: f32) -> f32 {
    let base = compressing(topology);
    render(
        move |i| {
            base(i);
            i.set_param("detection", DETECTION_PEAK);
            i.set_param("stereo_link", link);
        },
        LOUD,
        QUIET,
    )
    .right_db
}

#[test]
fn stereo_link_moves_the_quiet_channel_on_every_topology() {
    // The whole claim of the control: at full link the quiet channel is ducked
    // by the loud one, at zero link it is left alone. Before this landed the
    // knob wrote a field and the two renders were bit-identical on all four.
    for (name, topology) in ALL_TOPOLOGIES {
        let linked = right_level_at_link(topology, 1.0);
        let unlinked = right_level_at_link(topology, 0.0);
        assert!(
            unlinked - linked > 3.0,
            "{name}: link 0 left the quiet channel at {unlinked:.2} dB and link 1 at \
             {linked:.2} dB — a gap of {:.2} dB, which is not a working link",
            unlinked - linked
        );
    }
}

#[test]
fn stereo_link_blends_across_its_travel_rather_than_switching_at_an_end() {
    // Interior points. A detector that ignored the blend and hard-switched
    // anywhere in the middle, or that saturated early, passes the ends-only
    // assertion above and fails here. Each quarter of travel has to move the
    // ducked channel, in the same direction, by a share of the total.
    for (name, topology) in ALL_TOPOLOGIES {
        let levels: Vec<f32> = [0.0_f32, 0.25, 0.5, 0.75, 1.0]
            .iter()
            .map(|link| right_level_at_link(topology, *link))
            .collect();

        let total = levels[0] - levels[4];
        for (index, pair) in levels.windows(2).enumerate() {
            let step = pair[0] - pair[1];
            assert!(
                step > 0.0,
                "{name}: quarter {index} of Link travel moved the ducked channel by \
                 {step:.3} dB — the response is not monotonic"
            );
            assert!(
                step > total * 0.05,
                "{name}: quarter {index} of Link travel moved the ducked channel by \
                 {step:.3} dB out of {total:.2} dB total — that quarter of the knob is \
                 effectively dead"
            );
        }
    }
}

#[test]
fn stereo_link_leaves_the_loud_channel_where_it_was() {
    // A link implementation that blended *outputs* instead of detector levels
    // would move both channels. The control blends detection, so the channel
    // that is setting the level should barely notice: it is the louder side,
    // so `max` picks it at every link value.
    for (name, topology) in ALL_TOPOLOGIES {
        let base = compressing(topology);
        let linked = render(
            |i| {
                base(i);
                i.set_param("detection", DETECTION_PEAK);
                i.set_param("stereo_link", 1.0);
            },
            LOUD,
            QUIET,
        )
        .left_db;
        let base = compressing(topology);
        let unlinked = render(
            |i| {
                base(i);
                i.set_param("detection", DETECTION_PEAK);
                i.set_param("stereo_link", 0.0);
            },
            LOUD,
            QUIET,
        )
        .left_db;

        assert!(
            (linked - unlinked).abs() < 0.5,
            "{name}: the loud channel moved {:.2} dB between link 1 and link 0 \
             ({linked:.2} vs {unlinked:.2}) — link is being applied to the audio, not \
             to the detector",
            (linked - unlinked).abs()
        );
    }
}

#[test]
fn dual_mono_is_the_unlinked_detector_and_not_a_relabelled_stereo() {
    // `StereoMode::DualMono` used to be constructed and never matched, so the
    // chip labelled "Dual mono" rendered exactly what "Stereo" rendered. Both
    // halves are asserted: it has to differ from stereo, and it has to *be*
    // the unlinked detector rather than some third thing.
    for (name, topology) in ALL_TOPOLOGIES {
        let measure = |stereo_mode: f32, link: f32| {
            let base = compressing(topology);
            render(
                move |i| {
                    base(i);
                    i.set_param("detection", DETECTION_PEAK);
                    i.set_param("stereo_link", link);
                    i.set_param("stereo_mode", stereo_mode);
                },
                LOUD,
                QUIET,
            )
            .right_db
        };

        // Link stays at 1 in both, so stereo mode is the only thing moving.
        let stereo = measure(STEREO_MODE_STEREO, 1.0);
        let dual_mono = measure(STEREO_MODE_DUAL_MONO, 1.0);
        assert!(
            dual_mono - stereo > 3.0,
            "{name}: dual mono rendered {dual_mono:.2} dB against stereo's {stereo:.2} dB \
             — the mode is still a relabelled stereo"
        );

        let unlinked = measure(STEREO_MODE_STEREO, 0.0);
        assert!(
            (dual_mono - unlinked).abs() < 0.05,
            "{name}: dual mono ({dual_mono:.2} dB) and link 0 ({unlinked:.2} dB) should be \
             the same detector"
        );
    }
}

#[test]
fn detection_mode_changes_how_hard_a_steady_tone_is_compressed() {
    // Peak and RMS readings of a sine differ by its crest factor, 3.01 dB, and
    // the gain computer passes that difference on scaled by the ratio slope.
    // So RMS detection has to compress a sine *less* than peak detection, and
    // by an amount in the region of 3.01 * (1 - 1/4) = 2.26 dB.
    //
    // The bound below is deliberately one-sided-plus-ceiling rather than a
    // point value: three of the four topologies detect from their own output,
    // so the loop shifts the operating point and the delivered gap is not the
    // open-loop 2.26 dB. What no correct implementation can do is deliver
    // *zero*, which is what a stored-and-never-read `detection_mode` delivered.
    for (name, topology) in ALL_TOPOLOGIES {
        let measure = |detection: f32| {
            let base = compressing(topology);
            render(
                move |i| {
                    base(i);
                    i.set_param("stereo_link", 1.0);
                    i.set_param("detection", detection);
                },
                LOUD,
                LOUD,
            )
            .left_db
        };

        let peak = measure(DETECTION_PEAK);
        let rms = measure(DETECTION_RMS);
        let gap = rms - peak;
        assert!(
            gap > 0.5,
            "{name}: RMS detection rendered {rms:.2} dB and peak {peak:.2} dB — a gap of \
             {gap:.2} dB. RMS reads a sine 3.01 dB lower than peak does, so RMS must \
             compress it less"
        );
        assert!(
            gap < 3.01,
            "{name}: RMS detection rendered {gap:.2} dB above peak — more than the \
             3.01 dB crest factor of the stimulus itself, which no ratio can produce"
        );
    }
}

#[test]
fn detection_mode_tracks_the_ratio_the_gain_computer_is_set_to() {
    // A shape claim, not a point claim. The detection gap is the stimulus crest
    // factor put through the gain computer's slope, so raising the ratio has to
    // widen it: slope goes 0.5 -> 0.875 between 2:1 and 8:1. A detector that
    // was merely *different* — a fixed offset, a wrong window, a swapped
    // branch — would show a gap that did not move with the ratio at all.
    //
    // Diode is the topology this is read on because it is the only
    // feed-forward one, so its gap is not muddied by a feedback loop moving
    // the operating point.
    let gap_at_ratio = |ratio: f32| {
        let measure = |detection: f32| {
            render(
                move |i| {
                    i.set_param("topology", TOPOLOGY_DIODE);
                    i.set_param("threshold", -18.0);
                    i.set_param("ratio", ratio);
                    i.set_param("attack", 5.0);
                    i.set_param("release", 100.0);
                    i.set_param("mix", 1.0);
                    i.set_param("makeup", 0.0);
                    i.set_param("stereo_link", 1.0);
                    i.set_param("detection", detection);
                },
                LOUD,
                LOUD,
            )
            .left_db
        };
        measure(DETECTION_RMS) - measure(DETECTION_PEAK)
    };

    let shallow = gap_at_ratio(2.0);
    let steep = gap_at_ratio(8.0);
    assert!(
        steep > shallow * 1.3,
        "the detection gap was {shallow:.3} dB at 2:1 and {steep:.3} dB at 8:1 — it is \
         not tracking the gain computer's slope"
    );
}

#[test]
fn a_gluten_that_is_sent_no_detector_settings_uses_the_ones_it_declares() {
    // Every other guard states `detection` and `stereo_link` explicitly, which
    // leaves the *shipped* configuration untested — a mutation that dropped the
    // constructor's push of the declared defaults down into the topologies
    // passed the entire rest of this file.
    //
    // The declared defaults are `detection: 0` (rms) and `stereoLink: 1`
    // (GlutenDescriptor.ts, DEFAULT_GLUTEN_PATCH). A device that is added and
    // never patched has to render as those, not as whatever the topologies
    // happened to be constructed with.
    let untouched = render(
        |i| {
            i.set_param("topology", TOPOLOGY_VCA);
            i.set_param("threshold", -18.0);
            i.set_param("ratio", 4.0);
            i.set_param("attack", 5.0);
            i.set_param("release", 100.0);
            i.set_param("auto_release", 0.0);
            i.set_param("knee", 0.0);
            i.set_param("mix", 1.0);
        },
        LOUD,
        QUIET,
    );

    let base = compressing(TOPOLOGY_VCA);
    let declared = render(
        |i| {
            base(i);
            i.set_param("detection", DETECTION_RMS);
            i.set_param("stereo_link", 1.0);
        },
        LOUD,
        QUIET,
    );
    let base = compressing(TOPOLOGY_VCA);
    let peak_instead = render(
        |i| {
            base(i);
            i.set_param("detection", DETECTION_PEAK);
            i.set_param("stereo_link", 1.0);
        },
        LOUD,
        QUIET,
    );

    assert!(
        (untouched.left_db - declared.left_db).abs() < 0.01
            && (untouched.right_db - declared.right_db).abs() < 0.01,
        "an unpatched Gluten rendered ({:.3}, {:.3}) dB where its declared defaults render \
         ({:.3}, {:.3}) dB",
        untouched.left_db,
        untouched.right_db,
        declared.left_db,
        declared.right_db
    );
    assert!(
        (untouched.left_db - peak_instead.left_db).abs() > 0.5,
        "the declared default and peak detection render the same ({:.3} dB), so this guard \
         cannot tell which one the constructor chose",
        untouched.left_db
    );
}

#[test]
fn an_unlinked_detector_still_reaches_the_ceiling_the_linked_one_does() {
    // The dual gain path is new state, and new state is where a NaN or a
    // runaway hides. Drive both channels hard, unlinked, through every
    // topology and require finite, bounded output.
    for (name, topology) in ALL_TOPOLOGIES {
        let base = compressing(topology);
        let rendered = render(
            |i| {
                base(i);
                i.set_param("detection", DETECTION_RMS);
                i.set_param("stereo_link", 0.4);
                i.set_param("makeup", 12.0);
            },
            1.0,
            1.0,
        );
        assert!(
            rendered.left_db.is_finite() && rendered.right_db.is_finite(),
            "{name}: unlinked render produced a non-finite level \
             ({}, {})",
            rendered.left_db,
            rendered.right_db
        );
        assert!(
            rendered.left_db < 12.0 && rendered.right_db < 12.0,
            "{name}: unlinked render ran away to ({:.2}, {:.2}) dB",
            rendered.left_db,
            rendered.right_db
        );
    }
}
