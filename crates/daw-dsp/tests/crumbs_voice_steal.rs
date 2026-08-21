//! Crumbs voice stealing must not step the output.
//!
//! Crumbs' pool is a fixed 128 slots. The 129th simultaneous note steals one,
//! and the stolen note has to leave without a jump-cut: a sample-to-sample step
//! in the summed output is a click, and it lands on every steal.
//!
//! # How the discontinuity is measured
//!
//! Three identically configured engines are driven in lockstep.
//!
//! - *reference* holds all 128 notes and nothing else happens to it;
//! - *stealing* is byte-identical up to sample `k`, where a 129th note-on lands;
//! - *victim* holds only the note that the steal takes away.
//!
//! Every stage left in the signal path is linear and dry — the per-voice filter
//! is bypassed at the shipped 20 kHz / zero-resonance default and the master
//! gain smoother sits at unity — so superposition is exact and
//!
//! ```text
//! reference[n] - stealing[n] = (1 - fade[n]) * victim[n] - intruder[n]
//! ```
//!
//! At `n == k` the incoming note has rendered exactly one sample of a 1 ms
//! attack at velocity 1, so it contributes essentially nothing and the
//! difference *is* the missing sample of the voice that was taken away. Dividing
//! by the separately rendered `victim[n]` states the step as a fraction of the
//! sample it replaced, with no dependence on where in its cycle the stolen voice
//! happened to be and no dependence on how loud the rest of the pool is.
//!
//! The pool is deliberately lopsided: one full-velocity victim against 127
//! velocity-1 fillers. The fillers are bit-identical between the two runs and
//! cancel in the subtraction, but keeping them quiet also keeps the *absolute*
//! numbers in the failure messages readable as a claim about the stolen voice.
//!
//! `k` is chosen at the loudest sample of the victim's own block, which is the
//! worst case and the one a player hears.

use std::sync::Arc;

use daw_dsp::crumbs::engine::CrumbsEngine;
use daw_dsp::crumbs::sample::SampleData;
use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsParam, MAX_VOICES};

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

/// 9600 frames carrying exactly five cycles of a 25 Hz sine, so
/// `LoopMode::Forward` — which wraps from the frame count back to frame 0 —
/// rejoins the waveform seamlessly and no voice contributes a wrap
/// discontinuity of its own to the measurement.
const SAMPLE_FRAMES: usize = 9_600;
const SAMPLE_CYCLES: f32 = 5.0;
const SAMPLE_PEAK: f32 = 0.9;

/// The victim plays at the root note, so its playback speed is exactly 1.0 and
/// its pitch is the sample's own 25 Hz. That keeps the waveform's natural
/// sample-to-sample slope (0.33 % of peak) well inside the step budget below,
/// so a failure of `no_sample_of_the_fade_steps_the_output` is the fade and not
/// the signal.
const VICTIM_NOTE: u8 = 60;
const VICTIM_VELOCITY: u8 = 127;
const FILLER_VELOCITY: u8 = 1;
/// The 129th note retriggers the victim's pitch, which is `StealPriority::
/// SameNote` and therefore picks voice 0 — the victim — deterministically.
/// Velocity 1 keeps the incoming voice's own attack out of the measurement.
const INTRUDER_VELOCITY: u8 = 1;

/// Samples rendered before the block under test. Puts the block's centre on the
/// victim sine's peak (frame 480 of a 1920-frame period) so the stolen voice is
/// near maximum when it is taken, and leaves the 1 ms attack far behind.
const WARMUP_SAMPLES: usize = 416;

/// A steal may cost at most this fraction of the sample it replaced.
/// `FADE_STOLEN_SECS` is 3 ms, so the linear fade removes 1/144 = 0.69 % per
/// sample and the true budget is a third of this; a jump-cut costs ~100 %.
const MAX_STEP_FRACTION: f32 = 0.02;

/// `FADE_STOLEN_SECS * SAMPLE_RATE`: the fade is linear over this many samples.
const FADE_SAMPLES: f32 = 0.003 * SAMPLE_RATE;

fn pooled_sine() -> Arc<SampleData> {
    let pcm: Vec<f32> = (0..SAMPLE_FRAMES)
        .map(|frame| {
            let phase = frame as f32 / SAMPLE_FRAMES as f32 * SAMPLE_CYCLES * std::f32::consts::TAU;
            phase.sin() * SAMPLE_PEAK
        })
        .collect();
    Arc::new(SampleData::from_mono(pcm, SAMPLE_RATE as u32))
}

/// An engine with the sine pooled and selected, looping forward so no voice
/// runs off the end of the sample mid-measurement and quietly changes the pool
/// occupancy underneath the steal.
fn configured_engine(release_secs: f32) -> CrumbsEngine {
    let mut engine = CrumbsEngine::new(SAMPLE_RATE);
    let sample_id = engine.add_sample(pooled_sine());
    engine.set_active_sample(sample_id);
    engine.handle_command(CrumbsCommand::SetParam {
        param: CrumbsParam::LoopMode,
        value: 1.0,
    });
    engine.handle_command(CrumbsCommand::SetParam {
        param: CrumbsParam::Release,
        value: release_secs,
    });
    engine
}

fn note_on(engine: &mut CrumbsEngine, note: u8, velocity: u8) {
    engine.handle_command(CrumbsCommand::NoteOn { note, velocity });
}

/// All 128 slots filled, warmed past the attack.
///
/// The victim is triggered first so it lands in slot 0; `find_steal_target`
/// scans in index order and returns the first `StealPriority::SameNote` match,
/// which makes the intruder's target unambiguous.
fn saturated_engine(release_secs: f32) -> CrumbsEngine {
    let mut engine = configured_engine(release_secs);
    note_on(&mut engine, VICTIM_NOTE, VICTIM_VELOCITY);
    for index in 0..127_usize {
        let note = (index % 59) as u8;
        note_on(&mut engine, note, FILLER_VELOCITY);
    }
    assert_eq!(
        engine.playable_voice_count(),
        MAX_VOICES,
        "the pool was not saturated, so the 129th note would find a free slot \
         and never steal"
    );
    render(&mut engine, WARMUP_SAMPLES);
    engine
}

/// The same engine holding only the victim. Linear, dry chain, so this is
/// exactly the victim's contribution to `saturated_engine`'s output.
fn victim_only_engine() -> CrumbsEngine {
    let mut engine = configured_engine(0.01);
    note_on(&mut engine, VICTIM_NOTE, VICTIM_VELOCITY);
    render(&mut engine, WARMUP_SAMPLES);
    engine
}

/// Render `count` samples one at a time.
///
/// `process_block` carries no per-block state — it loops per sample and every
/// smoother ticks inside that loop — so a run of one-sample calls is the same
/// audio as one call of the same length, and it is the only way to place a
/// note-on at an exact sample offset through an API that applies notes
/// immediately.
fn render(engine: &mut CrumbsEngine, count: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let mut left = [0.0_f32];
        let mut right = [0.0_f32];
        engine.process_block(&mut left, &mut right);
        out.push(left[0]);
    }
    out
}

fn loudest_index(block: &[f32]) -> usize {
    let mut best_index = 1;
    let mut best_magnitude = 0.0_f32;
    // Skip sample 0: a step needs a predecessor inside the same run.
    for (index, sample) in block.iter().enumerate().skip(1) {
        if sample.abs() > best_magnitude {
            best_magnitude = sample.abs();
            best_index = index;
        }
    }
    best_index
}

/// Reference, victim and stealing runs of `length` samples starting from the
/// same warmed-up state, with the first 129th note-on landing at `steal_offset`
/// and any further ones at `steal_offset + delay` for each requested delay.
struct StealRuns {
    reference: Vec<f32>,
    victim: Vec<f32>,
    stealing: Vec<f32>,
    steal_offset: usize,
    /// Fades still in flight in the stealing engine when the run ends. Lets a
    /// test state how many *distinct* slots a burst occupied, which the summed
    /// output cannot show on its own.
    fading_tails_at_end: usize,
}

fn steal_runs(length: usize) -> StealRuns {
    steal_runs_with_extra_steals(length, &[])
}

/// `extra_steal_delays` are measured from the first steal, must be strictly
/// increasing and must be non-zero: each one lands another 129th note-on that
/// many samples after the first, so a burst can be placed inside a fade that is
/// still running.
fn steal_runs_with_extra_steals(length: usize, extra_steal_delays: &[usize]) -> StealRuns {
    let mut victim_engine = victim_only_engine();
    let victim = render(&mut victim_engine, length);
    let steal_offset = loudest_index(&victim[..BLOCK]);
    assert!(
        victim[steal_offset].abs() > 0.5,
        "the victim is only at {} when it is stolen, too quiet to tell a step \
         from rounding",
        victim[steal_offset]
    );

    let mut reference_engine = saturated_engine(0.01);
    let reference = render(&mut reference_engine, length);

    let mut stealing_engine = saturated_engine(0.01);
    let mut stealing = render(&mut stealing_engine, steal_offset);
    note_on(&mut stealing_engine, VICTIM_NOTE, INTRUDER_VELOCITY);

    let mut rendered = steal_offset;
    for delay in extra_steal_delays {
        let next_steal = steal_offset + delay;
        assert!(
            next_steal > rendered,
            "extra steal delays must be strictly increasing and non-zero; \
             {delay} lands at {next_steal}, at or before the previous steal at \
             {rendered}"
        );
        stealing.extend(render(&mut stealing_engine, next_steal - rendered));
        rendered = next_steal;
        note_on(&mut stealing_engine, VICTIM_NOTE, INTRUDER_VELOCITY);
    }
    stealing.extend(render(&mut stealing_engine, length - rendered));

    StealRuns {
        reference,
        victim,
        stealing,
        steal_offset,
        fading_tails_at_end: stealing_engine.fading_steal_tail_count(),
    }
}

/// Worst per-sample step in `stealing - reference`, as a fraction of the
/// stolen voice's own peak, together with where it landed.
fn worst_step_fraction(runs: &StealRuns) -> (f32, usize) {
    let peak = runs
        .victim
        .iter()
        .fold(0.0_f32, |best, sample| best.max(sample.abs()));

    let difference: Vec<f32> = runs
        .stealing
        .iter()
        .zip(runs.reference.iter())
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

    (worst_step / peak, worst_index)
}

#[test]
fn stealing_a_voice_does_not_step_the_output() {
    let runs = steal_runs(BLOCK);
    let steal_offset = runs.steal_offset;
    let replaced_sample = runs.victim[steal_offset];

    let difference: Vec<f32> = runs
        .stealing
        .iter()
        .zip(runs.reference.iter())
        .map(|(stolen, plain)| stolen - plain)
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
        "voice stealing cut {:.1} % out of the output in one sample (step \
         {step:.6} against a replaced sample of {replaced_sample:.6}); budget \
         is {:.1} %",
        step_fraction * 100.0,
        MAX_STEP_FRACTION * 100.0
    );
}

/// The stolen note must keep sounding *through* its fade, on the documented
/// linear curve. The test above only pins the transition: a fix that dropped
/// the tail a sample later, recycled its slot, or stopped rendering it would
/// still pass it.
#[test]
fn a_stolen_voice_fades_on_the_documented_curve() {
    let length = 2 * BLOCK;
    let runs = steal_runs(length);
    let steal_offset = runs.steal_offset;

    // Halfway through the 144-sample fade, where the expected value is far from
    // both 0.0 (a jump-cut) and 1.0 (no fade at all).
    let elapsed = 72_usize;
    let probe = steal_offset + elapsed - 1;
    let victim_sample = runs.victim[probe];
    assert!(
        victim_sample.abs() > 0.5,
        "the victim is only at {victim_sample} {elapsed} samples after the \
         steal, too quiet to divide by"
    );

    let measured_fade = 1.0 - (runs.reference[probe] - runs.stealing[probe]) / victim_sample;
    let predicted_fade = 1.0 - elapsed as f32 / FADE_SAMPLES;

    assert!(
        (measured_fade - predicted_fade).abs() < 0.05,
        "{elapsed} samples after the steal the outgoing voice was at \
         {measured_fade:.4} of its level; the 3 ms linear fade predicts \
         {predicted_fade:.4}. A jump-cut reads 0.0 and an absent fade reads 1.0."
    );
}

/// The per-sample budget must hold at *every* sample of the transition, not
/// only at the first one. This is what catches a fade slot recycled underneath
/// a tail that is still sounding, or a render path that stops calling it
/// partway through.
#[test]
fn no_sample_of_the_fade_steps_the_output() {
    // 3.5 blocks is 448 samples: past the 144-sample fade and past the point
    // where the slot is retired, which is itself a place a step could appear.
    let length = 448;
    let runs = steal_runs(length);
    let (step_fraction, worst_index) = worst_step_fraction(&runs);

    assert!(
        step_fraction <= MAX_STEP_FRACTION,
        "the fade stepped {:.1} % of the stolen voice's peak at sample \
         {worst_index} (the steal was at {}); budget is {:.1} %",
        step_fraction * 100.0,
        runs.steal_offset,
        MAX_STEP_FRACTION * 100.0
    );
}

/// The fade pool has to be a *pool*.
///
/// Every guard above performs exactly one steal, so one slot and 128 slots are
/// indistinguishable to them: the idle-first scan and the quietest-victim
/// fallback in `select_steal_tail_slot` can both be replaced by a hard-coded
/// slot 0 without reddening any of them. That is the claim the struct doc makes
/// — "a burst of steals can displace the whole pool before the first fade has
/// finished, and reusing a slot that is still sounding is the very click this
/// exists to remove" — and it needs a second steal *inside* the first fade to
/// be measured at all.
///
/// 30 samples is a fifth of the 144-sample fade, so a slot recycled here
/// truncates fade #1 with ~79 % of its amplitude still to go.
#[test]
fn a_second_steal_inside_the_first_fade_does_not_step_the_output() {
    const SECOND_STEAL_DELAY: usize = 30;

    let length = 448;
    let runs = steal_runs_with_extra_steals(length, &[SECOND_STEAL_DELAY]);
    let (step_fraction, worst_index) = worst_step_fraction(&runs);

    assert!(
        step_fraction <= MAX_STEP_FRACTION,
        "a second steal {SECOND_STEAL_DELAY} samples into the first fade \
         stepped {:.1} % of the stolen voice's peak at sample {worst_index} \
         (the first steal was at {}); budget is {:.1} %",
        step_fraction * 100.0,
        runs.steal_offset,
        MAX_STEP_FRACTION * 100.0
    );

    // Companion, not the guard: it says the two fades occupied two slots, which
    // is *why* neither was truncated. On its own it would prove nothing
    // audible, which is what the step check above is for.
    assert_eq!(
        runs.fading_tails_at_end, 0,
        "both fades should have retired within {length} samples; a slot still \
         in flight means the run was too short to have measured their overlap"
    );
}

/// Two steals 30 samples apart must occupy two distinct slots while they
/// overlap. Measured at the moment of the second steal rather than at the end
/// of the run, so a pool that recycles slot 0 is visible as an occupancy of 1.
#[test]
fn overlapping_steals_occupy_distinct_fade_slots() {
    let mut engine = saturated_engine(0.01);
    render(&mut engine, 8);
    note_on(&mut engine, VICTIM_NOTE, INTRUDER_VELOCITY);
    render(&mut engine, 30);
    note_on(&mut engine, VICTIM_NOTE, INTRUDER_VELOCITY);

    assert_eq!(
        engine.fading_steal_tail_count(),
        2,
        "the second steal landed inside the first 3 ms fade, so both should be \
         sounding; one means the second reused a slot that was still audible"
    );
}

/// A fade nobody is told about is a fade a host can cut short.
///
/// Crumbs has no `ProcessLifecycle`; the one thing it publishes about whether it
/// is still making sound is the metered voice count, which is also its wasm
/// `active_voices()` export. A stolen voice that has left the playable pool but
/// is still sounding has to be in that number, or the only signal a caller has
/// says the device fell silent while it demonstrably had not.
#[test]
fn a_fading_steal_tail_is_still_reported_as_sounding() {
    // 0.5 ms release: every playable voice is idle within ~24 samples, well
    // inside the 3 ms fade, so what is left sounding is the tail and only the
    // tail.
    let mut engine = saturated_engine(0.0005);
    note_on(&mut engine, VICTIM_NOTE, INTRUDER_VELOCITY);
    engine.handle_command(CrumbsCommand::AllNotesOff);

    let after = render(&mut engine, 80);

    assert_eq!(
        engine.playable_voice_count(),
        0,
        "playable voices are still sounding, so this is not testing the tail"
    );
    assert!(
        engine.fading_steal_tail_count() > 0,
        "the steal fade had already finished, so the count below proves nothing"
    );
    assert!(
        after[70..].iter().any(|sample| sample.abs() > 1e-4),
        "the engine went silent while a steal fade was still outstanding"
    );
    assert_eq!(
        usize::from(engine.read_active_voice_count()),
        engine.fading_steal_tail_count(),
        "the engine reported no voices sounding while a stolen voice was still \
         fading out audibly"
    );
}

// ── Stacked note-on ────────────────────────────────────────────────────

/// A saturated pool of 128 equally quiet notes, so a steal removes a known,
/// negligible amount of signal and whatever the incoming note adds is
/// measurable against it. `saturated_engine` deliberately holds one loud victim
/// instead, which is right for measuring the *outgoing* voice and wrong for
/// measuring the incoming one.
fn uniformly_quiet_saturated_engine() -> CrumbsEngine {
    let mut engine = configured_engine(0.01);
    for index in 0..MAX_VOICES {
        let note = (index % 59) as u8;
        note_on(&mut engine, note, FILLER_VELOCITY);
    }
    assert_eq!(
        engine.playable_voice_count(),
        MAX_VOICES,
        "the pool was not saturated, so the stacked note would find free slots \
         and never steal"
    );
    render(&mut engine, WARMUP_SAMPLES);
    engine
}

/// A stacked note-on on a saturated pool must deliver its *whole* stack.
///
/// `note_on` picks a steal target once per stack voice, and the voice the
/// previous iteration just triggered plays the same note, is not yet fading and
/// therefore scores `StealPriority::SameNote` — the top priority. Left
/// unguarded, iterations 2..n steal the stack's own freshly triggered voices:
/// one voice of the stack survives, and the rest become 3 ms fades of notes
/// that never sounded.
///
/// Measured as level rather than as slot bookkeeping: with detune and pan
/// spread at their defaults of zero every stack voice is bit-identical to a
/// single voice of the same note and velocity, so the stack's contribution over
/// the summed output is exactly `STACK_UNDER_TEST` times one voice. The 128
/// displaced fillers are at velocity 1 against the stack's 127, so their
/// removal moves this by well under a percent.
#[test]
fn a_stacked_note_on_delivers_its_whole_stack_on_a_saturated_pool() {
    const STACK_UNDER_TEST: usize = 4;
    // Past the 144-sample fades of the displaced fillers, so what is left in
    // the difference is the stack and nothing else.
    const SETTLED: usize = 200;
    let length = 448;

    let mut reference_engine = uniformly_quiet_saturated_engine();
    let reference = render(&mut reference_engine, length);

    let mut stacking_engine = uniformly_quiet_saturated_engine();
    stacking_engine.handle_command(CrumbsCommand::SetParam {
        param: CrumbsParam::StackCount,
        value: STACK_UNDER_TEST as f32,
    });
    note_on(&mut stacking_engine, VICTIM_NOTE, VICTIM_VELOCITY);
    let stacking = render(&mut stacking_engine, length);

    // One voice of the same note and velocity, started at the same instant, is
    // the unit the stack is counted in.
    let mut solo_engine = configured_engine(0.01);
    note_on(&mut solo_engine, VICTIM_NOTE, VICTIM_VELOCITY);
    let solo = render(&mut solo_engine, length);

    let stack_peak = stacking
        .iter()
        .zip(reference.iter())
        .skip(SETTLED)
        .fold(0.0_f32, |best, (stacked, plain)| {
            best.max((stacked - plain).abs())
        });
    let solo_peak = solo
        .iter()
        .skip(SETTLED)
        .fold(0.0_f32, |best, sample| best.max(sample.abs()));
    assert!(
        solo_peak > 0.1,
        "the single reference voice is only at {solo_peak}, too quiet to count \
         a stack against"
    );

    let delivered = stack_peak / solo_peak;
    assert!(
        (delivered - STACK_UNDER_TEST as f32).abs() < 0.25,
        "a stack of {STACK_UNDER_TEST} delivered {delivered:.2} voices' worth \
         of level on a saturated pool; a stack that steals the voices it has \
         just triggered reads ~1.0"
    );

    assert_eq!(
        stacking_engine.active_voices_with_note(VICTIM_NOTE),
        STACK_UNDER_TEST,
        "the playable pool does not hold the whole stack, so the note-on stole \
         voices it had triggered itself"
    );
}

// ── All Sound Off ──────────────────────────────────────────────────────

/// `AllSoundOff` starts a fade on every voice and then releases every allocator
/// slot, so the very next note-on is handed a slot whose voice is still
/// sounding. `trigger` overwrites it in place — the same release-then-
/// reallocate defect the steal path was fixed for, on a path that is one
/// `crumbs_all_sound_off` IPC call away.
#[test]
fn a_note_on_inside_an_all_sound_off_fade_does_not_step_the_output() {
    let length = 448;

    let mut victim_engine = victim_only_engine();
    let victim = render(&mut victim_engine, length);
    let event_offset = loudest_index(&victim[..BLOCK]);
    let peak = victim
        .iter()
        .fold(0.0_f32, |best, sample| best.max(sample.abs()));

    let mut reference_engine = saturated_engine(0.01);
    reference_engine.handle_command(CrumbsCommand::AllSoundOff);
    let reference = render(&mut reference_engine, length);

    let mut intruding_engine = saturated_engine(0.01);
    intruding_engine.handle_command(CrumbsCommand::AllSoundOff);
    let mut intruding = render(&mut intruding_engine, event_offset);
    note_on(&mut intruding_engine, VICTIM_NOTE, INTRUDER_VELOCITY);
    intruding.extend(render(&mut intruding_engine, length - event_offset));

    let difference: Vec<f32> = intruding
        .iter()
        .zip(reference.iter())
        .map(|(intruded, plain)| intruded - plain)
        .collect();

    // Presence pin: the runs must be identical up to the note-on, or the
    // subtraction is measuring drift.
    for (index, value) in difference.iter().enumerate().take(event_offset) {
        assert_eq!(
            *value, 0.0,
            "the runs diverged at sample {index}, before the note-on at \
             {event_offset}"
        );
    }

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
        "a note-on {event_offset} samples into the all-sound-off fade stepped \
         {:.1} % of a held voice's peak at sample {worst_index}; budget is \
         {:.1} %",
        step_fraction * 100.0,
        MAX_STEP_FRACTION * 100.0
    );
}

/// The structural half of the claim above: `AllSoundOff` has to move every
/// sounding voice out of the playable pool, not merely mark it fading and hand
/// its slot back.
#[test]
fn all_sound_off_moves_every_sounding_voice_out_of_the_playable_pool() {
    let mut engine = saturated_engine(0.01);
    engine.handle_command(CrumbsCommand::AllSoundOff);

    assert_eq!(
        engine.playable_voice_count(),
        0,
        "a voice left sounding in the playable pool is a voice the next \
         allocation can overwrite mid-fade"
    );
    assert_eq!(
        engine.fading_steal_tail_count(),
        MAX_VOICES,
        "every one of the 128 sounding voices should be carrying its fade in a \
         tail slot"
    );

    note_on(&mut engine, VICTIM_NOTE, INTRUDER_VELOCITY);

    assert_eq!(
        engine.playable_voice_count(),
        1,
        "the note-on should have taken a free slot"
    );
    assert_eq!(
        engine.fading_steal_tail_count(),
        MAX_VOICES,
        "the note-on landed on top of a voice that was still fading out"
    );
}

/// Saturate the pool *and* every fade slot, with nothing rendered in between so
/// no fade retires.
fn engine_with_pool_and_fades_all_busy() -> CrumbsEngine {
    let mut engine = saturated_engine(0.01);
    render(&mut engine, 8);
    // 128 steals inside one 3 ms fade: every tail slot ends up in flight, and
    // the pool refills behind them.
    for index in 0..MAX_VOICES {
        let note = (index % 59) as u8;
        note_on(&mut engine, note, FILLER_VELOCITY);
    }
    assert_eq!(
        engine.fading_steal_tail_count(),
        MAX_VOICES,
        "the fade slots are not all busy, so the recycle branch is not reached"
    );
    engine
}

/// `AllSoundOff` with every fade slot already busy has to recycle one per
/// voice, and what a recycle swaps back into the playable pool is the voice
/// that was occupying the slot. Silencing it is the only thing standing
/// between that and a still-sounding voice sitting in a slot the allocator has
/// just been told is free.
#[test]
fn all_sound_off_leaves_nothing_sounding_when_every_fade_slot_is_busy() {
    let mut engine = engine_with_pool_and_fades_all_busy();
    engine.handle_command(CrumbsCommand::AllSoundOff);

    assert_eq!(
        engine.playable_voice_count(),
        0,
        "a recycled fade slot handed a still-sounding voice back to the pool, \
         where the next note-on will overwrite it mid-fade"
    );
}

/// The published voice count must not be clamped by its own storage.
///
/// `AllSoundOff` moves all 128 voices into fades and the notes that follow
/// refill all 128 playable slots, so 256 voices really are sounding at once.
/// A `u8` reports 255 for that, and 255 is also what it reports for 300 — a
/// counter that saturates cannot be reasoned about at its own limit.
#[test]
fn the_reported_voice_count_is_not_clamped_by_its_storage() {
    let mut engine = saturated_engine(0.01);
    engine.handle_command(CrumbsCommand::AllSoundOff);
    for index in 0..MAX_VOICES {
        let note = (index % 59) as u8;
        note_on(&mut engine, note, FILLER_VELOCITY);
    }
    render(&mut engine, 1);

    assert_eq!(
        engine.playable_voice_count() + engine.fading_steal_tail_count(),
        2 * MAX_VOICES,
        "the scenario did not actually put 256 voices in flight"
    );
    assert_eq!(
        usize::from(engine.read_active_voice_count()),
        2 * MAX_VOICES,
        "the metered count saturated below the number of voices actually \
         sounding"
    );
}
