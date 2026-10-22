//! Each offline ordinal must reach the same actual reverb control as a named
//! write, and the control must change finite, audible PCM on its supported engine.
//! These source tests require a fresh matching WASM build for the worklet probe.

use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use proof_chamber::ProofChamberInstance;

#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

const RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const BLOCKS: usize = 560;
const MOVE_BLOCK: usize = 96;

struct Probe {
    name: &'static str,
    ordinal: u32,
    from: f32,
    to: f32,
    prelude: &'static [(&'static str, f32)],
    reason: &'static str,
}

const PROBES: &[Probe] = &[
    Probe {
        name: "damping",
        ordinal: 2,
        from: 0.1,
        to: 0.9,
        prelude: &[],
        reason: "charged plate tank and broadband tail",
    },
    Probe {
        name: "predelay",
        ordinal: 3,
        from: 0.0,
        to: 80.0,
        prelude: &[],
        reason: "wet onset delay on a broadband burst",
    },
    Probe {
        name: "size",
        ordinal: 4,
        from: 0.2,
        to: 0.9,
        prelude: &[],
        reason: "early reflection spacing",
    },
    Probe {
        name: "mod_rate",
        ordinal: 5,
        from: 0.2,
        to: 4.0,
        prelude: &[("mod_depth", 0.8)],
        reason: "nonzero tank modulation depth",
    },
    Probe {
        name: "mod_depth",
        ordinal: 6,
        from: 0.0,
        to: 0.9,
        prelude: &[("mod_rate", 3.0)],
        reason: "tank modulation at nonzero rate",
    },
    Probe {
        name: "diffusion",
        ordinal: 7,
        from: 0.2,
        to: 0.9,
        prelude: &[],
        reason: "input allpass gains",
    },
    Probe {
        name: "high_cut",
        ordinal: 8,
        from: 2_000.0,
        to: 18_000.0,
        prelude: &[],
        reason: "broadband output-stage high frequencies",
    },
    Probe {
        name: "low_cut",
        ordinal: 9,
        from: 30.0,
        to: 1_200.0,
        prelude: &[],
        reason: "broadband output-stage low frequencies",
    },
    Probe {
        name: "width",
        ordinal: 10,
        from: 0.0,
        to: 2.0,
        prelude: &[],
        reason: "asymmetric stereo input and separate wet channels",
    },
    Probe {
        name: "freeze",
        ordinal: 11,
        from: 0.0,
        to: 1.0,
        prelude: &[],
        reason: "charged tank then input/decay gate",
    },
    Probe {
        name: "shimmer",
        ordinal: 12,
        from: 0.0,
        to: 1.0,
        prelude: &[("shimmer_amount", 0.9)],
        reason: "charged tail with shimmer amount enabled",
    },
    Probe {
        name: "shimmer_amount",
        ordinal: 13,
        from: 0.0,
        to: 0.9,
        prelude: &[("shimmer", 1.0)],
        reason: "enabled pitch-shift feedback",
    },
    Probe {
        name: "gravity",
        ordinal: 14,
        from: -1.0,
        to: 1.0,
        prelude: &[],
        reason: "tilted tank diffusion in charged tail",
    },
    Probe {
        name: "early_late",
        ordinal: 15,
        from: 0.0,
        to: 1.0,
        prelude: &[],
        reason: "early reflection against late tail",
    },
    Probe {
        name: "density",
        ordinal: 16,
        from: 0.0,
        to: 1.0,
        prelude: &[],
        reason: "tank cross-coupling",
    },
    Probe {
        name: "decay_eq_0",
        ordinal: 17,
        from: 0.25,
        to: 4.0,
        prelude: &[],
        reason: "100 Hz recirculating band below decay ceiling",
    },
    Probe {
        name: "decay_eq_1",
        ordinal: 18,
        from: 0.25,
        to: 4.0,
        prelude: &[],
        reason: "400 Hz recirculating band below decay ceiling",
    },
    Probe {
        name: "decay_eq_2",
        ordinal: 19,
        from: 0.25,
        to: 4.0,
        prelude: &[],
        reason: "1.2 kHz recirculating band below decay ceiling",
    },
    Probe {
        name: "decay_eq_3",
        ordinal: 20,
        from: 0.25,
        to: 4.0,
        prelude: &[],
        reason: "3.5 kHz recirculating band below decay ceiling",
    },
    Probe {
        name: "decay_eq_4",
        ordinal: 21,
        from: 0.25,
        to: 4.0,
        prelude: &[],
        reason: "8 kHz recirculating band below decay ceiling",
    },
    Probe {
        name: "decay_eq_5",
        ordinal: 22,
        from: 0.25,
        to: 4.0,
        prelude: &[],
        reason: "12 kHz recirculating band below decay ceiling",
    },
];

fn render(probe: &Probe, moving: bool, by_id: bool) -> Vec<f32> {
    let mut instance = ProofChamberInstance::new(RATE);
    instance.set_param("algorithm", 0.0);
    for (name, value) in [
        ("mix", 1.0),
        ("decay", 0.6),
        ("damping", 0.3),
        ("high_cut", 20_000.0),
        ("low_cut", 20.0),
        ("early_late", 0.8),
    ] {
        instance.set_param(name, value);
    }
    for &(name, value) in probe.prelude {
        instance.set_param(name, value);
    }
    instance.set_param(probe.name, probe.from);
    let mut pcm = Vec::with_capacity(BLOCKS * BLOCK * 2);
    let mut state = 0x2545_f491_u32;
    for block in 0..BLOCKS {
        if moving && block == MOVE_BLOCK {
            if by_id {
                assert_no_alloc(|| instance.set_param_by_id(probe.ordinal, probe.to));
            } else {
                instance.set_param(probe.name, probe.to);
            }
        }
        let mut left = [0.0_f32; BLOCK];
        let mut right = [0.0_f32; BLOCK];
        if block < 100 {
            for frame in 0..BLOCK {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let noise = ((state >> 8) as f32 / 8_388_608.0 - 1.0) * 0.35;
                left[frame] = noise;
                right[frame] = noise * 0.37;
            }
        }
        let left_ptr = instance.process(&left, &right, BLOCK as u32);
        let right_ptr = instance.get_right_ptr();
        assert!(!left_ptr.is_null() && !right_ptr.is_null());
        for frame in 0..BLOCK {
            let pair = unsafe { [*left_ptr.add(frame), *right_ptr.add(frame)] };
            assert!(
                pair.iter().all(|sample| sample.is_finite()),
                "{} non-finite PCM",
                probe.name
            );
            pcm.extend(pair);
        }
    }
    pcm
}

#[test]
fn every_additive_ordinal_matches_the_named_setter_and_moves_real_pcm() {
    for probe in PROBES {
        assert!(
            !probe.reason.is_empty(),
            "{} needs an audible fixture explanation",
            probe.name
        );
        let static_pcm = render(probe, false, false);
        let named_pcm = render(probe, true, false);
        let ordinal_pcm = render(probe, true, true);
        assert!(
            named_pcm.iter().any(|sample| sample.abs() > 1.0e-7),
            "{} produced silence: {}",
            probe.name,
            probe.reason
        );
        assert_ne!(
            named_pcm, static_pcm,
            "{} is an inert fixture: {}",
            probe.name, probe.reason
        );
        assert_eq!(
            ordinal_pcm, named_pcm,
            "ordinal {} does not name {}",
            probe.ordinal, probe.name
        );
    }
}

#[test]
fn existing_ordinals_and_unknown_id_retain_their_contract() {
    for (id, name, value) in [(0, "mix", 0.7), (1, "decay", 0.4)] {
        let mut named = ProofChamberInstance::new(RATE);
        let mut by_id = ProofChamberInstance::new(RATE);
        named.set_param(name, value);
        by_id.set_param_by_id(id, value);
        let left = [0.3; BLOCK];
        let right = [0.1; BLOCK];
        let named_ptr = named.process(&left, &right, BLOCK as u32);
        let by_id_ptr = by_id.process(&left, &right, BLOCK as u32);
        for frame in 0..BLOCK {
            assert_eq!(unsafe { *named_ptr.add(frame) }, unsafe {
                *by_id_ptr.add(frame)
            });
        }
    }
    let mut untouched = ProofChamberInstance::new(RATE);
    let mut unknown = ProofChamberInstance::new(RATE);
    unknown.set_param_by_id(u32::MAX, 0.9);
    let input = [0.3; BLOCK];
    let a = untouched.process(&input, &input, BLOCK as u32);
    let b = unknown.process(&input, &input, BLOCK as u32);
    for frame in 0..BLOCK {
        assert_eq!(unsafe { *a.add(frame) }, unsafe { *b.add(frame) });
    }
}
