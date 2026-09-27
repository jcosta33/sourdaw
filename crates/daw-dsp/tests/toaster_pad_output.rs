use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use daw_dsp::toaster::{
    engine::ToasterEngine,
    engines::{DrumEngineResources, DrumEngineType},
    pad::Pad,
    voice::DrumVoice,
    ToasterInstance,
};

#[cfg(debug_assertions)]
#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

const FRAMES: usize = 128;
const MAX_BLOCK_SIZE: usize = 4096;
const PADS: usize = 16;

fn energy(samples: &[f32]) -> f32 {
    samples.iter().map(|sample| sample.abs()).sum()
}

fn assert_bit_identical(actual: &[f32], expected: &[f32]) {
    for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
        assert_eq!(actual.to_bits(), expected.to_bits(), "sample {index}");
    }
}

fn first_hit_tail_energy(decay: f32) -> f32 {
    let mut engine = ToasterEngine::new(48_000.0, PADS);
    engine.set_pad_param(0, "engine_type", 14.0);
    engine.set_pad_param(0, "decay", decay);
    engine.note_on(0, 127.0, 60);

    let mut left = [0.0; FRAMES];
    let mut right = [0.0; FRAMES];
    let mut tail_energy = 0.0;
    for block in 0..160 {
        engine.process_block(&mut left, &mut right);
        if block >= 80 {
            tail_energy += energy(&left) + energy(&right);
        }
    }
    tail_energy
}

fn tom_first_block(midi_note: u8) -> [f32; FRAMES] {
    let mut engine = ToasterEngine::new(48_000.0, PADS);
    engine.note_on(6, 127.0, midi_note);

    let mut left = [0.0; FRAMES];
    let mut right = [0.0; FRAMES];
    engine.process_block(&mut left, &mut right);
    left
}

#[test]
fn first_hit_uses_pad_decay_before_the_voice_is_triggered() {
    let short_tail = first_hit_tail_energy(0.0);
    let long_tail = first_hit_tail_energy(1.0);

    assert!(
        long_tail > short_tail * 4.0,
        "first-hit decay must shape the triggered envelope: short={short_tail}, long={long_tail}"
    );
}

// ---------------------------------------------------------------------------
// Decay response — every engine, both sample rates.
//
// Each engine's DECAY arm maps the 0-1 control onto its own declared envelope
// range (0.02-2.0 s for FM Perc, 0.5-8.0 s for the cymbal, 90-600 ms for the
// 808 hat, ...). The guard renders the hit and compares energy at Decay 0
// against Decay 1: a strictly longer envelope holds strictly more energy, so
// an engine that ignores the control — as FM Perc did, until its trigger
// stopped overwriting the DECAY arm's value with a fixed 200 ms — renders
// both settings identical and fails here. Both sample rates are rendered
// because one engine computed its coefficient against a hardcoded 44100.0
// and ran decays short everywhere else.
//
// One observable cannot be honest about the whole fleet, so the fleet is read
// through its declared contracts:
// - Modal and CR-78 Drum keep total energy roughly constant while Decay moves
//   it in time (Modal's higher-Q modes capture less from the short noise
//   burst; the CR-78's longer tail sits under a loud early body — measured
//   total ratios 0.98 and 1.10). Their guard reads the late window
//   (~213-427 ms), where the effect is unambiguous (measured 182x-296x and
//   18x-24x).
// - The 808 and 909 hats ring a closed hit for a fixed ~50 ms — their
//   declared circuit contract — and map Decay onto the open voice only
//   ("Closed hat: fixed 50ms decay; Open hat: adjustable"), so the sweep
//   opens the hat before comparing.
// - The 808 cowbell, clave, and rimshot decay over fixed per-mode constants
//   (`Perc808Engine::trigger`; only its Maracas mode maps Decay), matching a
//   circuit with no decay control for those voices. Their pinned contract
//   lives in `perc808_fixed_voices_keep_their_circuit_fixed_decay` below.
// ---------------------------------------------------------------------------

const MODAL_ENGINE: usize = DrumEngineType::Modal as usize;
const CR78_DRUM_ENGINE: usize = DrumEngineType::Cr78Drum as usize;
const OPEN_HAT_ENGINES: [usize; 2] = [
    DrumEngineType::HiHat808 as usize,
    DrumEngineType::HiHat909 as usize,
];
const FIXED_DECAY_ENGINES: [usize; 3] = [
    DrumEngineType::Cowbell808 as usize,
    DrumEngineType::Clave808 as usize,
    DrumEngineType::Rimshot808 as usize,
];

/// Names for the `engine_type` ids `Pad::set_param` accepts, indexed by id.
/// Typed against `DrumEngineType::COUNT` so adding an engine without naming
/// it here is a compile error, not a silent gap in the sweep below.
const ENGINE_NAMES: [&str; DrumEngineType::COUNT] = [
    "Kick",
    "Snare",
    "HiHat",
    "Clap",
    "Perc",
    "Tom",
    "Cymbal",
    "Modal",
    "FM Perc",
    "Cowbell",
    "Clave",
    "Shaker",
    "Rim",
    "Kick 808",
    "Kick 909",
    "Snare 808",
    "HiHat 808",
    "HiHat 909",
    "Clap 808",
    "Clap 909",
    "Tom 808 Low",
    "Tom 808 Mid",
    "Tom 808 High",
    "Cowbell 808",
    "Clave 808",
    "Rimshot 808",
    "Maracas 808",
    "CR-78 Drum",
    "CR-78 Metallic",
];

/// One full hit (~427 ms at 48 kHz) on pad 0, concatenated L,R.
fn render_hit(engine_type: usize, decay: f32, sample_rate: f32, open: bool) -> Vec<f32> {
    let mut engine = ToasterEngine::new(sample_rate, PADS);
    engine.set_pad_param(0, "engine_type", engine_type as f32);
    if open {
        engine.set_pad_param(0, "open", 1.0);
    }
    engine.set_pad_param(0, "decay", decay);
    engine.note_on(0, 127.0, 60);

    let mut left = [0.0; FRAMES];
    let mut right = [0.0; FRAMES];
    let mut out = Vec::with_capacity(160 * FRAMES * 2);
    for _ in 0..160 {
        engine.process_block(&mut left, &mut right);
        out.extend_from_slice(&left);
        out.extend_from_slice(&right);
    }
    out
}

fn hit_energy(engine_type: usize, decay: f32, sample_rate: f32, open: bool) -> f32 {
    energy(&render_hit(engine_type, decay, sample_rate, open))
}

/// The gate is a clear response, not a magnitude: the widest declared ranges
/// bound how large this fixed window can make the ratio (cymbal 0.5-8.0 s and
/// snare 808 50-300 ms measure 1.44x-1.49x, matching the integrals of their
/// decay exponentials), so 1.2x separates an inert control from the fleet's
/// honest physics with margin on both sides. Magnitude claims for
/// narrow-range engines live in the audit spec.
#[test]
fn every_engine_renders_a_longer_tail_at_maximum_decay_than_at_minimum() {
    for engine_type in 0..DrumEngineType::COUNT {
        if engine_type == MODAL_ENGINE || engine_type == CR78_DRUM_ENGINE {
            continue; // total energy is the wrong observable here; checked below
        }
        if FIXED_DECAY_ENGINES.contains(&engine_type) {
            continue; // circuit-fixed decay, pinned in its own test below
        }
        let open = OPEN_HAT_ENGINES.contains(&engine_type);
        for sample_rate in [44_100.0, 48_000.0] {
            let short = hit_energy(engine_type, 0.0, sample_rate, open);
            let long = hit_energy(engine_type, 1.0, sample_rate, open);
            assert!(
                long > short * 1.2,
                "{}{} at {sample_rate} Hz must ring longer at decay 1.0 than at 0.0: \
                 short={short}, long={long}",
                ENGINE_NAMES[engine_type],
                if open { " (open)" } else { "" },
            );
        }
    }
}

/// The 808 cowbell, clave, and rimshot carry no decay control on the hardware
/// they model, and `Perc808Engine::trigger` decays them over fixed per-mode
/// constants whatever the pad's Decay reads — only Maracas maps it. This pins
/// that declared contract bit for bit: if the product later decides these
/// pads must honour Decay, this assertion and `perc_808.rs`'s `trigger`
/// change together in that fix.
#[test]
fn perc808_fixed_voices_keep_their_circuit_fixed_decay() {
    for engine_type in FIXED_DECAY_ENGINES {
        for sample_rate in [44_100.0, 48_000.0] {
            let short = render_hit(engine_type, 0.0, sample_rate, false);
            let long = render_hit(engine_type, 1.0, sample_rate, false);
            assert_eq!(
                energy(&long),
                energy(&short),
                "{} at {sample_rate} Hz decays over a fixed constant: \
                 decay 1.0 must not change the render",
                ENGINE_NAMES[engine_type],
            );
            assert_bit_identical(&long, &short);
        }
    }
}

/// Energy of one hit from ~213 ms to ~427 ms after the note.
fn late_tail_energy(engine_type: usize, decay: f32, sample_rate: f32) -> f32 {
    let mut engine = ToasterEngine::new(sample_rate, PADS);
    engine.set_pad_param(0, "engine_type", engine_type as f32);
    engine.set_pad_param(0, "decay", decay);
    engine.note_on(0, 127.0, 60);

    let mut left = [0.0; FRAMES];
    let mut right = [0.0; FRAMES];
    let mut late = 0.0;
    for block in 0..160 {
        engine.process_block(&mut left, &mut right);
        if block >= 64 {
            late += energy(&left) + energy(&right);
        }
    }
    late
}

/// Modal and CR-78 Drum shift energy later in time rather than holding more
/// of it overall, so their Decay is read where that shift lands.
#[test]
fn modal_and_cr78_drum_decay_fill_the_late_tail() {
    for engine_type in [MODAL_ENGINE, CR78_DRUM_ENGINE] {
        for sample_rate in [44_100.0, 48_000.0] {
            let short = late_tail_energy(engine_type, 0.0, sample_rate);
            let long = late_tail_energy(engine_type, 1.0, sample_rate);
            assert!(
                long > short * 4.0,
                "{} at {sample_rate} Hz must still be ringing late at decay 1.0 \
                 when decay 0.0 has already fallen silent: short={short}, long={long}",
                ENGINE_NAMES[engine_type],
            );
        }
    }
}

#[test]
fn explicit_tom_base_frequency_preserves_midi_note_pitch() {
    let root = tom_first_block(60);
    let octave = tom_first_block(72);
    let difference = root
        .iter()
        .zip(octave)
        .map(|(root, octave)| (root - octave).abs())
        .sum::<f32>();

    assert!(
        difference > 1.0,
        "the explicit tom base frequency must still be transposed by the MIDI note: difference={difference}"
    );
}

fn fm_first_block(configure: impl FnOnce(&mut ToasterEngine)) -> [f32; FRAMES] {
    let mut engine = ToasterEngine::new(48_000.0, PADS);
    engine.set_pad_param(0, "engine_type", 8.0);
    configure(&mut engine);
    engine.note_on(0, 127.0, 60);

    let mut left = [0.0; FRAMES];
    let mut right = [0.0; FRAMES];
    engine.process_block(&mut left, &mut right);
    left
}

#[test]
fn fm_pad_voicing_reaches_the_triggered_voice() {
    let default = fm_first_block(|_| {});
    let voiced = fm_first_block(|engine| {
        engine.set_pad_param(0, "mod_ratio", 7.1);
        engine.set_pad_param(0, "mod_amount", 5.0);
        engine.set_pad_param(0, "feedback", 0.5);
    });
    let difference = default
        .iter()
        .zip(voiced)
        .map(|(default, voiced)| (default - voiced).abs())
        .sum::<f32>();

    assert!(
        difference > 1.0,
        "FM kit voicing must change the rendered hit: difference={difference}"
    );
}

#[test]
fn fm_tone_remains_audible_without_an_explicit_mod_amount() {
    let dark = fm_first_block(|engine| engine.set_pad_param(0, "tone", 0.2));
    let bright = fm_first_block(|engine| engine.set_pad_param(0, "tone", 0.9));
    let difference = dark
        .iter()
        .zip(bright)
        .map(|(dark, bright)| (dark - bright).abs())
        .sum::<f32>();

    assert!(
        difference > 1.0,
        "FM tone must remain effective when the kit has no mod_amount override: difference={difference}"
    );
}

#[test]
fn engine_type_rehydration_resets_fm_voicing_before_overrides() {
    let expected = fm_first_block(|_| {});
    let actual = fm_first_block(|engine| {
        engine.set_pad_param(0, "mod_ratio", 7.1);
        engine.set_pad_param(0, "mod_amount", 5.0);
        engine.set_pad_param(0, "feedback", 0.5);
        engine.set_pad_param(0, "engine_type", 8.0);
    });

    assert_bit_identical(&actual, &expected);
}

#[test]
fn recycled_fm_voice_does_not_inherit_another_pads_voicing() {
    let resources = DrumEngineResources::new();
    let mut reused = DrumVoice::new(48_000.0, &resources);
    let mut voiced_pad = Pad::new(DrumEngineType::FmPerc);
    voiced_pad.set_param("mod_ratio", 7.1);
    voiced_pad.set_param("mod_amount", 5.0);
    voiced_pad.set_param("feedback", 0.5);
    reused.trigger(0, &voiced_pad, 1.0, 60, 48_000.0);
    for _ in 0..FRAMES {
        let _ = reused.tick(48_000.0);
    }

    let default_pad = Pad::new(DrumEngineType::FmPerc);
    reused.trigger(1, &default_pad, 1.0, 60, 48_000.0);
    let actual: [f32; FRAMES] = std::array::from_fn(|_| reused.tick(48_000.0));

    let mut fresh = DrumVoice::new(48_000.0, &resources);
    fresh.trigger(1, &default_pad, 1.0, 60, 48_000.0);
    let expected: [f32; FRAMES] = std::array::from_fn(|_| fresh.tick(48_000.0));

    assert_bit_identical(&actual, &expected);
}

#[test]
fn engine_switching_note_on_does_not_allocate() {
    let mut engine = ToasterEngine::new(48_000.0, PADS);
    engine.set_pad_param(0, "engine_type", 17.0);

    assert_no_alloc(|| engine.note_on(0, 127.0, 60));
}

#[test]
fn reused_percussion_voice_does_not_inherit_another_pads_base_frequency() {
    let mut reused = ToasterEngine::new(48_000.0, PADS);
    reused.set_pad_param(0, "engine_type", 4.0);
    reused.set_pad_param(0, "base_freq", 240.0);
    reused.set_pad_param(0, "decay", 0.0);
    reused.note_on(0, 127.0, 60);

    let mut discarded_left = [0.0; FRAMES];
    let mut discarded_right = [0.0; FRAMES];
    for _ in 0..64 {
        reused.process_block(&mut discarded_left, &mut discarded_right);
    }

    let mut fresh = ToasterEngine::new(48_000.0, PADS);
    for engine in [&mut reused, &mut fresh] {
        engine.set_pad_param(1, "engine_type", 4.0);
        engine.set_pad_param(1, "decay", 0.0);
        engine.note_on(1, 127.0, 60);
    }

    let mut reused_left = [0.0; FRAMES];
    let mut reused_right = [0.0; FRAMES];
    let mut fresh_left = [0.0; FRAMES];
    let mut fresh_right = [0.0; FRAMES];
    reused.process_block(&mut reused_left, &mut reused_right);
    fresh.process_block(&mut fresh_left, &mut fresh_right);

    assert_bit_identical(&reused_left, &fresh_left);
    assert_bit_identical(&reused_right, &fresh_right);
}

#[test]
fn reused_tom_voice_does_not_inherit_another_pads_base_frequency() {
    let mut reused = ToasterEngine::new(48_000.0, PADS);
    reused.set_pad_param(0, "engine_type", 5.0);
    reused.set_pad_param(0, "base_freq", 240.0);
    reused.set_pad_param(0, "decay", 0.0);
    reused.note_on(0, 127.0, 60);
    reused.note_off(0);

    let mut discarded_left = [0.0; FRAMES];
    let mut discarded_right = [0.0; FRAMES];
    for _ in 0..16 {
        reused.process_block(&mut discarded_left, &mut discarded_right);
    }

    let mut fresh = ToasterEngine::new(48_000.0, PADS);
    for engine in [&mut reused, &mut fresh] {
        engine.set_pad_param(1, "engine_type", 5.0);
        engine.set_pad_param(1, "decay", 0.0);
        engine.note_on(1, 127.0, 60);
    }

    let mut reused_left = [0.0; FRAMES];
    let mut reused_right = [0.0; FRAMES];
    let mut reused_pads = [0.0; PADS * 2 * FRAMES];
    let mut fresh_left = [0.0; FRAMES];
    let mut fresh_right = [0.0; FRAMES];
    let mut fresh_pads = [0.0; PADS * 2 * FRAMES];
    reused.process_block_with_pad_outputs(
        &mut reused_left,
        &mut reused_right,
        &mut reused_pads,
        FRAMES,
    );
    fresh.process_block_with_pad_outputs(
        &mut fresh_left,
        &mut fresh_right,
        &mut fresh_pads,
        FRAMES,
    );

    let pad_one = 2 * FRAMES..4 * FRAMES;
    assert_bit_identical(&reused_pads[pad_one.clone()], &fresh_pads[pad_one]);
}

#[test]
fn parent_mix_is_bit_identical_to_legacy_processing_across_blocks() {
    let mut legacy = ToasterEngine::new(48_000.0, PADS);
    let mut tapped = ToasterEngine::new(48_000.0, PADS);
    for engine in [&mut legacy, &mut tapped] {
        engine.set_pad_param(0, "send_reverb", 0.8);
        engine.set_pad_param(1, "send_delay", 0.6);
        engine.set_param("master_gain", 0.63);
        engine.note_on(0, 127.0, 60);
    }

    let mut legacy_left = [0.0; FRAMES];
    let mut legacy_right = [0.0; FRAMES];
    let mut tapped_left = [0.0; FRAMES];
    let mut tapped_right = [0.0; FRAMES];
    let mut pad_outputs = [0.0; PADS * 2 * FRAMES];
    for block in 0..20 {
        if block == 5 {
            legacy.note_on(1, 96.0, 64);
            tapped.note_on(1, 96.0, 64);
        }
        legacy.process_block(&mut legacy_left, &mut legacy_right);
        tapped.process_block_with_pad_outputs(
            &mut tapped_left,
            &mut tapped_right,
            &mut pad_outputs,
            FRAMES,
        );
        assert_bit_identical(&tapped_left, &legacy_left);
        assert_bit_identical(&tapped_right, &legacy_right);
    }
}

#[test]
fn routed_pad_relinquishes_only_parent_dry_ownership() {
    let mut legacy = ToasterEngine::new(48_000.0, PADS);
    let mut routed = ToasterEngine::new(48_000.0, PADS);
    for engine in [&mut legacy, &mut routed] {
        engine.set_pad_param(0, "send_reverb", 1.0);
        engine.note_on(0, 127.0, 60);
    }
    routed.set_pad_dry_routed(0, true);

    let mut legacy_left = [0.0; FRAMES];
    let mut legacy_right = [0.0; FRAMES];
    let mut routed_left = [0.0; FRAMES];
    let mut routed_right = [0.0; FRAMES];
    let mut legacy_pads = [0.0; PADS * 2 * FRAMES];
    let mut routed_pads = [0.0; PADS * 2 * FRAMES];
    let mut routed_parent_energy = 0.0;

    for block in 0..20 {
        if block == 12 {
            routed.set_pad_dry_routed(0, false);
        }
        legacy.process_block_with_pad_outputs(
            &mut legacy_left,
            &mut legacy_right,
            &mut legacy_pads,
            FRAMES,
        );
        routed.process_block_with_pad_outputs(
            &mut routed_left,
            &mut routed_right,
            &mut routed_pads,
            FRAMES,
        );

        assert_bit_identical(&routed_pads, &legacy_pads);
        if block == 0 {
            assert_eq!(energy(&routed_left) + energy(&routed_right), 0.0);
            assert!(energy(&legacy_left) + energy(&legacy_right) > 0.0);
        }
        if block < 12 {
            routed_parent_energy += energy(&routed_left) + energy(&routed_right);
        } else {
            assert_bit_identical(&routed_left, &legacy_left);
            assert_bit_identical(&routed_right, &legacy_right);
        }
    }

    assert!(
        routed_parent_energy > 0.0,
        "the routed pad's shared reverb send must remain in the parent output"
    );
}

#[test]
fn invalid_pad_and_reset_leave_legacy_parent_output_unchanged() {
    let mut legacy = ToasterEngine::new(48_000.0, PADS);
    let mut reset = ToasterEngine::new(48_000.0, PADS);
    reset.set_pad_dry_routed(PADS as u8, true);
    reset.set_pad_dry_routed(0, true);
    reset.reset_pad_dry_routing();
    legacy.note_on(0, 127.0, 60);
    reset.note_on(0, 127.0, 60);

    let mut legacy_left = [0.0; FRAMES];
    let mut legacy_right = [0.0; FRAMES];
    let mut reset_left = [0.0; FRAMES];
    let mut reset_right = [0.0; FRAMES];
    legacy.process_block(&mut legacy_left, &mut legacy_right);
    reset.process_block(&mut reset_left, &mut reset_right);

    assert_bit_identical(&reset_left, &legacy_left);
    assert_bit_identical(&reset_right, &legacy_right);
}

#[test]
fn stems_follow_transient_pan_and_master_without_shared_fx() {
    let mut unshaped = ToasterEngine::new(48_000.0, PADS);
    let mut shaped = ToasterEngine::new(48_000.0, PADS);
    for engine in [&mut unshaped, &mut shaped] {
        engine.set_pad_param(0, "pan", 1.0);
        engine.note_on(0, 127.0, 60);
    }
    unshaped.set_param("master_gain", 1.0);
    shaped.set_pad_param(0, "transient_attack", 0.5);
    shaped.set_pad_param(0, "transient_sustain", 0.5);
    shaped.set_pad_param(0, "send_reverb", 1.0);
    shaped.set_param("master_gain", 0.25);

    let mut unshaped_left = [0.0; FRAMES];
    let mut unshaped_right = [0.0; FRAMES];
    let mut unshaped_pads = [0.0; PADS * 2 * FRAMES];
    let mut shaped_left = [0.0; FRAMES];
    let mut shaped_right = [0.0; FRAMES];
    let mut shaped_pads = [0.0; PADS * 2 * FRAMES];
    let mut shared_fx_left_energy = 0.0;

    for block in 0..16 {
        unshaped.process_block_with_pad_outputs(
            &mut unshaped_left,
            &mut unshaped_right,
            &mut unshaped_pads,
            FRAMES,
        );
        shaped.process_block_with_pad_outputs(
            &mut shaped_left,
            &mut shaped_right,
            &mut shaped_pads,
            FRAMES,
        );

        assert_eq!(
            energy(&shaped_pads[..FRAMES]),
            0.0,
            "hard-left stem block {block}"
        );
        assert_eq!(
            energy(&shaped_pads[2 * FRAMES..]),
            0.0,
            "inactive stems block {block}"
        );
        for frame in 0..FRAMES {
            assert_eq!(
                shaped_pads[FRAMES + frame].to_bits(),
                (unshaped_pads[FRAMES + frame] * 0.5 * 0.25).to_bits(),
                "transient-shaped and mastered frame {frame} in block {block}"
            );
            if block == 0 {
                assert_eq!(
                    shaped_right[frame].to_bits(),
                    shaped_pads[FRAMES + frame].to_bits(),
                    "parent and routed tap must share one master gain"
                );
            }
        }
        shared_fx_left_energy += energy(&shaped_left);
    }

    assert!(energy(&shaped_pads[FRAMES..2 * FRAMES]) > 0.0);
    assert!(
        shared_fx_left_energy > 0.0,
        "shared reverb must stay in the parent mix only"
    );
}

#[test]
fn production_instance_offsets_stay_stable_and_processing_does_not_allocate() {
    let mut instance = ToasterInstance::new(48_000.0, PADS as u32);
    let base = instance.process(0);
    let right = instance.get_right_ptr();
    assert_eq!(unsafe { right.offset_from(base) }, MAX_BLOCK_SIZE as isize);

    instance.note_on(0, 127.0, 60);
    assert_no_alloc(|| {
        for _ in 0..8 {
            instance.set_pad_dry_routed(0, true);
            assert_eq!(instance.process(FRAMES as u32), base);
            assert_eq!(instance.get_right_ptr(), right);
            instance.set_pad_dry_routed(0, false);
        }
        instance.reset_pad_dry_routing();
    });

    let pad_zero_left = unsafe { std::slice::from_raw_parts(base.add(2 * MAX_BLOCK_SIZE), FRAMES) };
    let pad_zero_right =
        unsafe { std::slice::from_raw_parts(base.add(3 * MAX_BLOCK_SIZE), FRAMES) };
    assert!(energy(pad_zero_left) + energy(pad_zero_right) > 0.0);
    for channel in 4..2 + PADS * 2 {
        let inactive =
            unsafe { std::slice::from_raw_parts(base.add(channel * MAX_BLOCK_SIZE), FRAMES) };
        assert_eq!(energy(inactive), 0.0, "inactive channel {channel}");
    }
}

// ---------------------------------------------------------------------------
// Pad gating — solo and choke groups.
//
// Both controls are decided in `ToasterEngine::note_on`, and both used to be
// decided wrongly: there was no `soloed` arm at all, and `choke_group` was read
// from a construction default keyed on pad index because no kit message ever
// carried the real grouping. These guards render, because "the parameter is
// stored" is exactly the assertion that passed while nothing was audible.
// ---------------------------------------------------------------------------

/// Concatenated L,R of `blocks` render blocks, so a delta can be compared
/// sample-for-sample rather than through a summary number.
fn render_main(configure: impl FnOnce(&mut ToasterEngine), hits: &[u8], blocks: usize) -> Vec<f32> {
    let mut engine = ToasterEngine::new(48_000.0, PADS);
    configure(&mut engine);
    for &pad in hits {
        engine.note_on(pad, 127.0, 60);
    }

    let mut left = [0.0; FRAMES];
    let mut right = [0.0; FRAMES];
    let mut out = Vec::with_capacity(blocks * FRAMES * 2);
    for _ in 0..blocks {
        engine.process_block(&mut left, &mut right);
        out.extend_from_slice(&left);
        out.extend_from_slice(&right);
    }
    out
}

/// Energy of one pad's own stereo tap, measured only over the blocks rendered
/// *after* an optional second pad is struck. Reading the tap rather than the
/// parent mix is what keeps the choke measurement about the choked pad instead
/// of about the total of two drums.
fn tap_energy_after_second_hit(
    configure: impl FnOnce(&mut ToasterEngine),
    first: u8,
    second: Option<u8>,
    measured: usize,
) -> f32 {
    let mut engine = ToasterEngine::new(48_000.0, PADS);
    configure(&mut engine);
    engine.note_on(first, 127.0, 60);

    let mut left = [0.0; FRAMES];
    let mut right = [0.0; FRAMES];
    let mut pad_outputs = vec![0.0; PADS * 2 * FRAMES];
    for _ in 0..4 {
        engine.process_block_with_pad_outputs(&mut left, &mut right, &mut pad_outputs, FRAMES);
    }

    if let Some(second) = second {
        engine.note_on(second, 127.0, 60);
    }

    let tap = 2 * first as usize * FRAMES;
    let mut measured_energy = 0.0;
    for _ in 0..measured {
        engine.process_block_with_pad_outputs(&mut left, &mut right, &mut pad_outputs, FRAMES);
        measured_energy += energy(&pad_outputs[tap..tap + 2 * FRAMES]);
    }
    measured_energy
}

/// The shipped state of every kit: no pad soloed. A guard that only ever renders
/// with a solo engaged cannot tell a working gate from one that silences the
/// device outright, so the default is asserted first and for every pad.
#[test]
fn every_pad_sounds_while_no_pad_is_soloed() {
    for pad in 0..PADS as u8 {
        let rendered = render_main(|_| {}, &[pad], 8);
        assert!(
            energy(&rendered) > 0.0,
            "pad {pad} must sound when no pad is soloed"
        );
    }
}

/// Every pad, not one of them. The gate is a single comparison against a set,
/// so a version that hard-coded "pad 0 is the soloed one" — or that compared the
/// wrong index — would pass a single-pad guard and fail here.
#[test]
fn soloing_a_pad_silences_every_other_pad_and_leaves_that_pad_untouched() {
    for soloed in 0..PADS as u8 {
        let alone = render_main(|_| {}, &[soloed], 8);
        let alone_and_soloed = render_main(
            |engine| engine.set_pad_param(soloed, "soloed", 1.0),
            &[soloed],
            8,
        );
        assert_bit_identical(&alone_and_soloed, &alone);

        for other in 0..PADS as u8 {
            if other == soloed {
                continue;
            }
            let gated = render_main(
                |engine| engine.set_pad_param(soloed, "soloed", 1.0),
                &[other],
                8,
            );
            assert_eq!(
                energy(&gated),
                0.0,
                "pad {other} must be silent while pad {soloed} is soloed"
            );
        }
    }
}

/// Solo is a set decision, not a per-pad flag: two soloed pads both play.
#[test]
fn two_soloed_pads_both_play_and_the_rest_stay_gated() {
    let configure = |engine: &mut ToasterEngine| {
        engine.set_pad_param(0, "soloed", 1.0);
        engine.set_pad_param(5, "soloed", 1.0);
    };

    assert!(energy(&render_main(configure, &[0], 8)) > 0.0);
    assert!(energy(&render_main(configure, &[5], 8)) > 0.0);
    assert_eq!(energy(&render_main(configure, &[9], 8)), 0.0);
}

/// Mute wins over solo, which is the rule `applySoloLogic` already applies at
/// track level. Both halves are asserted, because a gate that dropped the mute
/// check entirely would still pass the "muted pad is silent" case on its own.
#[test]
fn a_muted_pad_stays_silent_even_when_it_is_the_soloed_one() {
    let muted_and_soloed = render_main(
        |engine| {
            engine.set_pad_param(3, "muted", 1.0);
            engine.set_pad_param(3, "soloed", 1.0);
        },
        &[3],
        8,
    );
    assert_eq!(energy(&muted_and_soloed), 0.0);

    let soloed_only = render_main(|engine| engine.set_pad_param(3, "soloed", 1.0), &[3], 8);
    assert!(energy(&soloed_only) > 0.0);
}

/// Solo gates the trigger, not the pad's output — Event Mute, the behaviour
/// Toaster's own mute already had. Engaging solo must leave a voice that is
/// already sounding bit-identical, and must stop the next hit on that pad
/// entirely. Asserting only the second half would pass for an output gate too.
#[test]
fn engaging_solo_spares_a_sounding_voice_and_stops_the_next_hit() {
    fn tail(engage_solo: bool, retrigger: bool) -> Vec<f32> {
        let mut engine = ToasterEngine::new(48_000.0, PADS);
        engine.set_pad_param(0, "decay", 1.0);
        engine.note_on(0, 127.0, 60);

        let mut left = [0.0; FRAMES];
        let mut right = [0.0; FRAMES];
        for _ in 0..4 {
            engine.process_block(&mut left, &mut right);
        }

        if engage_solo {
            engine.set_pad_param(1, "soloed", 1.0);
        }
        if retrigger {
            engine.note_on(0, 127.0, 60);
        }

        let mut out = Vec::with_capacity(16 * FRAMES * 2);
        for _ in 0..16 {
            engine.process_block(&mut left, &mut right);
            out.extend_from_slice(&left);
            out.extend_from_slice(&right);
        }
        out
    }

    let untouched = tail(false, false);
    assert!(energy(&untouched) > 0.0, "the tail under test must exist");

    // The sounding voice is not cut when another pad is soloed.
    assert_bit_identical(&tail(true, false), &untouched);

    // A fresh hit on the now-gated pad adds nothing at all...
    assert_bit_identical(&tail(true, true), &untouched);

    // ...whereas without the solo the same retrigger plainly changes the render.
    let retriggered = tail(false, true);
    assert!(
        energy(&retriggered) > energy(&untouched),
        "the retrigger must be audible without a solo: {} vs {}",
        energy(&retriggered),
        energy(&untouched)
    );
}

/// A choke group the old construction default could not express. Pads 9 and 10
/// are cymbals with no default grouping, so any choke here came from the kit
/// message — and the group number is 3, not the single hard-coded 1.
#[test]
fn a_kit_sent_choke_group_cuts_a_ringing_pad_at_a_group_the_default_never_set() {
    let choked = tap_energy_after_second_hit(
        |engine| {
            engine.set_pad_param(9, "decay", 1.0);
            engine.set_pad_param(9, "choke_group", 3.0);
            engine.set_pad_param(10, "choke_group", 3.0);
        },
        9,
        Some(10),
        16,
    );
    let separate = tap_energy_after_second_hit(
        |engine| {
            engine.set_pad_param(9, "decay", 1.0);
            engine.set_pad_param(9, "choke_group", 3.0);
            engine.set_pad_param(10, "choke_group", 4.0);
        },
        9,
        Some(10),
        16,
    );

    assert!(separate > 0.0, "the ringing tail under test must exist");
    assert!(
        choked < separate * 0.5,
        "a shared choke group must cut pad 9's tail: choked={choked}, separate={separate}"
    );
}

/// Group 0 is a statement, not an absence. Sending it has to clear a grouping
/// the engine already holds, or a kit without hats inherits the previous kit's.
#[test]
fn sending_choke_group_zero_clears_an_existing_grouping() {
    let grouped = tap_energy_after_second_hit(
        |engine| {
            engine.set_pad_param(2, "decay", 1.0);
        },
        2,
        Some(3),
        16,
    );
    let cleared = tap_energy_after_second_hit(
        |engine| {
            engine.set_pad_param(2, "decay", 1.0);
            engine.set_pad_param(2, "choke_group", 0.0);
            engine.set_pad_param(3, "choke_group", 0.0);
        },
        2,
        Some(3),
        16,
    );

    assert!(
        cleared > grouped * 2.0,
        "clearing the group must let pad 2 ring through pad 3: grouped={grouped}, cleared={cleared}"
    );
}

/// The construction default is now keyed on the pad's engine rather than on its
/// index. It has to still select exactly the two hi-hat pads of the default
/// layout, and no one else — a `matches!` that caught the wrong variant would
/// either lose the hat pair or group every cymbal with it.
#[test]
fn the_construction_default_groups_the_hi_hat_pair_and_nothing_else() {
    let hat_alone =
        tap_energy_after_second_hit(|engine| engine.set_pad_param(2, "decay", 1.0), 2, None, 16);
    let hat_choked = tap_energy_after_second_hit(
        |engine| engine.set_pad_param(2, "decay", 1.0),
        2,
        Some(3),
        16,
    );
    assert!(
        hat_choked < hat_alone * 0.5,
        "pads 2 and 3 must choke by default: alone={hat_alone}, choked={hat_choked}"
    );

    for other in 0..PADS as u8 {
        if other == 2 || other == 3 {
            continue;
        }
        let alone = tap_energy_after_second_hit(
            |engine| engine.set_pad_param(other, "decay", 1.0),
            other,
            None,
            16,
        );
        let with_neighbour = tap_energy_after_second_hit(
            |engine| engine.set_pad_param(other, "decay", 1.0),
            other,
            Some(if other == 0 { 1 } else { 0 }),
            16,
        );
        assert_eq!(
            with_neighbour.to_bits(),
            alone.to_bits(),
            "pad {other} must not be choked by default"
        );
    }
}
