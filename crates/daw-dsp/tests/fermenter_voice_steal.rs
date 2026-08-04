//! Fermenter voice stealing must not step the output.
//!
//! Fermenter's layer pool is a fixed 16 slots. The 17th simultaneous note
//! steals one, and the stolen note has to leave without a jump-cut: a
//! sample-to-sample step in the summed output is a click, and it lands on every
//! steal, which is every time polyphony is exceeded.
//!
//! # How the discontinuity is measured
//!
//! Two identically driven instances are rendered. The *reference* holds 16
//! notes and nothing else happens. The *steal* instance is byte-identical up to
//! the same sample `k`, where a 17th note-on is queued. Subtracting the two
//! isolates exactly what the steal did to the output:
//!
//! - for `n < k` the difference is exactly zero — the runs have not diverged;
//! - at `n == k` the incoming note contributes essentially nothing (it starts
//!   from zero through its attack), so the difference is the *missing* sample of
//!   the voice that was taken away.
//!
//! So `|difference[k]|` is the height of the step, in the same units as the
//! signal it replaced, with no dependence on where in its cycle the stolen
//! oscillator happened to be. `k` is chosen as the loudest sample of the
//! reference block so the stolen voice is near its peak — the worst case, and
//! the one a player hears.
//!
//! The held pool is deliberately lopsided: one loud low note (the one the
//! quietest-voice rule always picks, since it is voice 0 and every envelope is
//! level-tied) against fifteen near-silent ones. That makes the removed voice
//! dominate the reference block, so the ratio below is a claim about the stolen
//! voice and not about the pool average.

use daw_dsp::fermenter::FermenterInstance;
use daw_dsp::primitives::ProcessLifecycle;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
/// `Layer::MAX_VOICES_PER_LAYER`. One layer is active by default, so this is
/// the whole pool.
const POOL: usize = 16;
/// ~170 ms: long past the 1 ms attack, so every held voice sits at sustain.
const WARMUP_BLOCKS: usize = 64;

/// Sixteen notes fill the pool exactly. The first one is the victim: with every
/// envelope at the same sustain level, `note_on_with_channel`'s quietest-voice
/// scan keeps index 0, because it takes a strictly-lower amplitude to displace
/// the incumbent.
const HELD_NOTES: [u8; POOL] = [
    24, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74,
];
/// Loud victim, near-silent filler: see the module note.
const VICTIM_VELOCITY: u8 = 127;
const FILLER_VELOCITY: u8 = 1;
/// The 17th note. Velocity 1 keeps its own attack out of the measurement.
const INTRUDER_NOTE: u8 = 84;
const INTRUDER_VELOCITY: u8 = 1;

/// A steal may cost at most this fraction of the sample it replaced. The 10 ms
/// one-pole fade in `Voice::render` removes `1 - exp(-1/(0.01 * 48000))`
/// = 0.21 % per sample, so the true budget is two orders of magnitude under
/// this; a jump-cut costs ~90 %.
const MAX_STEP_FRACTION: f32 = 0.02;

fn configure_dry_sine_patch(instance: &mut FermenterInstance) {
    // One plain sine oscillator per voice, no modulation, so the only thing
    // that can move the output between the two runs is the steal itself.
    instance.set_param("engine", 0.0);
    instance.set_param("osc_waveform", 0.0);
    instance.set_param("osc_level", 1.0);
    instance.set_param("unison_voices", 1.0);
    instance.set_param("noise_level", 0.0);
    instance.set_param("drift", 0.0);
    instance.set_param("voice_drive", 0.0);
    instance.set_param("filter_drive", 0.0);
    instance.set_param("cutoff", 20_000.0);
    instance.set_param("resonance", 0.5);
    instance.set_param("mod_env_to_filter", 0.0);
    instance.set_param("mod_lfo_to_pitch", 0.0);
    instance.set_param("lfo_filter_amount", 0.0);
    instance.set_param("mseg_to_filter", 0.0);
    instance.set_param("seq_to_pitch", 0.0);
    instance.set_param("chaos_amount", 0.0);
    instance.set_param("warp_amount", 0.0);
    instance.set_param("audio_mod_depth", 0.0);

    // Flat-topped amplitude envelope: attack fast, sustain full, so a held
    // voice is at a constant level when the steal lands.
    instance.set_param("amp_attack", 0.001);
    instance.set_param("amp_decay", 5.0);
    instance.set_param("amp_sustain", 1.0);
    instance.set_param("amp_release", 5.0);

    // Dry master chain. A compressor or a wet effect would smear the step
    // across neighbouring samples and understate it.
    instance.set_param("dist_mix", 0.0);
    instance.set_param("comp_mix", 0.0);
    instance.set_param("delay_mix", 0.0);
    instance.set_param("chorus_mix", 0.0);
    instance.set_param("phaser_mix", 0.0);
    instance.set_param("reverb_mix", 0.0);
    instance.set_param("eq_low_gain", 0.0);
    instance.set_param("eq_mid_gain", 0.0);
    instance.set_param("eq_high_gain", 0.0);
    instance.set_param("master_gain", 1.0);
}

fn velocity_for(index: usize) -> u8 {
    if index == 0 {
        return VICTIM_VELOCITY;
    }
    FILLER_VELOCITY
}

/// An instance holding all 16 notes, warmed up to sustain, one block short of
/// the block under test.
fn saturated_instance() -> FermenterInstance {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, POOL as u32);
    configure_dry_sine_patch(&mut instance);
    for (index, note) in HELD_NOTES.iter().enumerate() {
        instance.note_on(*note, velocity_for(index));
    }
    for _ in 0..WARMUP_BLOCKS {
        instance.process(BLOCK as u32);
    }
    instance
}

fn render_block(instance: &mut FermenterInstance) -> Vec<f32> {
    let pointer = instance.process(BLOCK as u32);
    // SAFETY: `process` returns its own left buffer, which is 128 frames long,
    // and `BLOCK` is 128.
    unsafe { std::slice::from_raw_parts(pointer, BLOCK) }.to_vec()
}

fn loudest_sample_index(block: &[f32]) -> usize {
    let mut best_index = 1;
    let mut best_magnitude = 0.0_f32;
    // Skip sample 0: the step needs a predecessor inside the same block.
    for (index, sample) in block.iter().enumerate().skip(1) {
        if sample.abs() > best_magnitude {
            best_magnitude = sample.abs();
            best_index = index;
        }
    }
    best_index
}

#[test]
fn stealing_a_voice_does_not_step_the_output() {
    let mut reference = saturated_instance();
    assert_eq!(
        reference.active_voices(),
        POOL as u32,
        "the pool was not saturated, so the 17th note would find a free slot \
         and never steal"
    );
    let reference_block = render_block(&mut reference);

    let steal_offset = loudest_sample_index(&reference_block);
    let replaced_sample = reference_block[steal_offset];
    assert!(
        replaced_sample.abs() > 0.05,
        "the reference block peaks at {replaced_sample}, too quiet to tell a \
         step from rounding"
    );

    let mut stealing = saturated_instance();
    assert!(
        stealing.push_note_on(INTRUDER_NOTE, INTRUDER_VELOCITY, 0, steal_offset as u32),
        "the event list rejected the 17th note"
    );
    let steal_block = render_block(&mut stealing);
    assert_eq!(
        stealing.active_voices(),
        POOL as u32,
        "the pool is no longer full, so no steal happened"
    );

    let difference: Vec<f32> = steal_block
        .iter()
        .zip(reference_block.iter())
        .map(|(stolen, reference)| stolen - reference)
        .collect();

    // Presence pin: the two runs must be identical right up to the event, or
    // the subtraction is measuring drift instead of the steal.
    for (index, value) in difference.iter().enumerate().take(steal_offset) {
        assert_eq!(
            *value, 0.0,
            "the runs diverged at sample {index}, before the note-on at \
             {steal_offset}"
        );
    }

    let step = difference[steal_offset].abs();
    let step_fraction = step / replaced_sample.abs();
    assert!(
        step_fraction <= MAX_STEP_FRACTION,
        "voice stealing cut {:.1} % out of the output in one sample \
         (step {step:.6} against a replaced sample of {replaced_sample:.6}); \
         budget is {:.1} %",
        step_fraction * 100.0,
        MAX_STEP_FRACTION * 100.0
    );
}

/// An instance holding only the victim note, warmed up identically. Every stage
/// left in the signal path is linear and dry, so this renders exactly the
/// victim's contribution to `saturated_instance`'s output and lets the fade be
/// recovered from the difference of the two runs.
fn victim_only_instance() -> FermenterInstance {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, POOL as u32);
    configure_dry_sine_patch(&mut instance);
    instance.note_on(HELD_NOTES[0], VICTIM_VELOCITY);
    for _ in 0..WARMUP_BLOCKS {
        instance.process(BLOCK as u32);
    }
    instance
}

/// `Voice::render`'s de-click fade, in samples: `steal_fade *= exp(-1 / tau)`
/// once per sample, applied before the sample it gates.
const FADE_TAU_SAMPLES: f32 = 0.01 * SAMPLE_RATE;

fn expected_fade(samples_since_steal: usize) -> f32 {
    (-(samples_since_steal as f32) / FADE_TAU_SAMPLES).exp()
}

/// The stolen note must keep sounding *through* its fade, decaying on the
/// documented curve. Test one only pins the transition; a fix that dropped the
/// tail a sample later, recycled its slot, or let the lifecycle sleep mid-fade
/// would still pass it.
///
/// The measurement inverts the superposition above:
///
/// ```text
/// reference[n] - steal[n] = (1 - fade[n]) * victim[n] - intruder[n]
/// ```
///
/// so dividing by the separately rendered `victim[n]` recovers the fade
/// directly. It is read at the loudest victim sample of the block *after* the
/// steal, which both maximises the signal and keeps the ignored intruder term
/// (velocity 1, so at most 1/127 of full scale) under 2 % of the result.
#[test]
fn a_stolen_voice_fades_on_the_documented_curve() {
    let mut reference = saturated_instance();
    let reference_block = render_block(&mut reference);
    let steal_offset = loudest_sample_index(&reference_block);

    let mut stealing = saturated_instance();
    assert!(stealing.push_note_on(INTRUDER_NOTE, INTRUDER_VELOCITY, 0, steal_offset as u32));
    render_block(&mut stealing);

    let mut victim = victim_only_instance();
    render_block(&mut victim);

    // The block after the one carrying the steal: 128..256 samples in.
    let reference_after = render_block(&mut reference);
    let steal_after = render_block(&mut stealing);
    let victim_after = render_block(&mut victim);

    let probe = loudest_sample_index(&victim_after);
    let victim_sample = victim_after[probe];
    assert!(
        victim_sample.abs() > 0.3,
        "the victim voice is only at {victim_sample} a block after the steal, \
         too quiet to divide by"
    );

    let measured_fade = 1.0 - (reference_after[probe] - steal_after[probe]) / victim_sample;
    let elapsed = BLOCK + probe - steal_offset + 1;
    let predicted_fade = expected_fade(elapsed);

    assert!(
        (measured_fade - predicted_fade).abs() < 0.05,
        "{elapsed} samples after the steal the outgoing voice was at \
         {measured_fade:.4} of its level; the 10 ms one-pole fade predicts \
         {predicted_fade:.4}. A jump-cut reads 0.0 and an absent fade reads 1.0."
    );
}

/// The per-sample budget from test one must hold at *every* sample of the fade,
/// not only at the transition. This is what catches a tail whose crossfade slot
/// is recycled underneath it, or a render path that stops calling it.
#[test]
fn no_sample_of_the_fade_steps_the_output() {
    let mut reference = saturated_instance();
    let reference_block = render_block(&mut reference);
    let steal_offset = loudest_sample_index(&reference_block);
    let peak = reference_block
        .iter()
        .fold(0.0_f32, |best, sample| best.max(sample.abs()));

    let mut stealing = saturated_instance();
    assert!(stealing.push_note_on(INTRUDER_NOTE, INTRUDER_VELOCITY, 0, steal_offset as u32));
    let steal_block = render_block(&mut stealing);

    // Six blocks is 16 ms — past the point where the fade reaches -60 dB and
    // the crossfade slot is retired, which is itself a place a step could
    // appear.
    let mut reference_run = reference_block;
    let mut steal_run = steal_block;
    for _ in 0..6 {
        reference_run.extend(render_block(&mut reference));
        steal_run.extend(render_block(&mut stealing));
    }

    let difference: Vec<f32> = steal_run
        .iter()
        .zip(reference_run.iter())
        .map(|(stolen, plain)| stolen - plain)
        .collect();

    let mut worst_step = 0.0_f32;
    let mut worst_index = 0;
    for index in 1..difference.len() {
        let step = (difference[index] - difference[index - 1]).abs();
        if step > worst_step {
            worst_step = step;
            worst_index = index;
        }
    }

    let step_fraction = worst_step / peak;
    assert!(
        step_fraction <= MAX_STEP_FRACTION,
        "the fade stepped {:.1} % of full output at sample {worst_index} \
         (steal was at {steal_offset}); budget is {:.1} %",
        step_fraction * 100.0,
        MAX_STEP_FRACTION * 100.0
    );
}

/// A fade the host stops rendering is a cut. While a crossfade slot is still
/// sounding the engine owes unconditional processing, even after every playable
/// voice has gone — otherwise the only thing keeping the tail alive is the
/// discretionary "continue if the output is not quiet" state, which is decided
/// on the *previous* block's level.
#[test]
fn a_fading_steal_tail_keeps_the_engine_unconditionally_awake() {
    let mut instance = saturated_instance();
    assert!(instance.push_note_on(INTRUDER_NOTE, INTRUDER_VELOCITY, 0, 0));
    instance.process(BLOCK as u32);

    // Shortest release the layer allows. Its one-pole reaches the idle
    // threshold in ~880 samples, so ten blocks retire every playable voice
    // while the 10 ms fade — which needs 26 blocks to reach -60 dB — is still
    // running.
    instance.set_param("amp_release", 0.001);
    instance.process(BLOCK as u32);
    for note in HELD_NOTES {
        instance.note_off(note);
    }
    instance.note_off(INTRUDER_NOTE);
    for _ in 0..10 {
        instance.process(BLOCK as u32);
    }

    assert_eq!(
        instance.active_voices(),
        0,
        "playable voices are still sounding, so this is not testing the tail"
    );
    assert_eq!(
        instance.lifecycle_state(),
        ProcessLifecycle::CONTINUE_CODE,
        "the engine offered to stop rendering while a steal fade was still \
         outstanding"
    );
}
