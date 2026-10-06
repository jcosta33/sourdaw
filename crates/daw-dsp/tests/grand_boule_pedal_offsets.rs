//! Grand Boule's offset-queued pedal API: a pushed pedal takes effect on its own
//! sample of the block, in push order with the notes around it, and a refused
//! push is answered rather than dropped.
//!
//! A pedal pressed between two notes of one block has to damp the first and
//! sustain the second. What is only observable through `process` is *where
//! inside the block* the pedal lands, which every spec here reads off the
//! rendered samples.

use daw_dsp::grand_boule::GrandBouleInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const NOTE: u8 = 60;
const VELOCITY: f32 = 0.8;

/// Frames of the block the events are pushed into. Long enough that a pedal can
/// land well after a release: a damper lifted a few frames after a note-off
/// catches almost all of the string's remaining energy, so a contrast between
/// "caught" and "damped" needs a real gap between the two events.
const BLOCK: usize = 4096;
/// Blocks rendered after the first, far enough past the events that a damped
/// string has died away while a sustained one is still ringing.
const TAIL_BLOCKS: usize = 12;
/// Frames from a pedal's own frame within which its effect must already be
/// measurable: a pedal applied late leaves this window identical to a render
/// that never had it, which the whole-tail energy bounds cannot see.
const HEAD_WINDOW: usize = 64;

/// Read one channel back out of the pointer `process` returned.
///
/// # Safety
/// `ptr` must point at `frames` readable `f32`s, which is what `process`
/// returns for a block of `frames` — the instance's own channel buffer.
unsafe fn read_channel(ptr: *const f32, frames: usize) -> Vec<f32> {
    assert!(!ptr.is_null(), "process returned a null buffer");
    (0..frames).map(|index| *ptr.add(index)).collect()
}

/// Render one block and return the left channel, the way a host reads it.
fn render(instance: &mut GrandBouleInstance, frames: usize) -> Vec<f32> {
    let left_ptr = instance.process(frames as u32);
    // SAFETY: the pointer was derived after the render and names the
    // instance's own left channel buffer, which is `GRAND_BOULE_BLOCK_FRAMES`
    // long and never resized; `frames` is well inside that, and nothing
    // mutates the instance between the render and this read.
    unsafe { read_channel(left_ptr, frames) }
}

/// The first block, then `TAIL_BLOCKS` more, as `(first, tail)`.
fn render_with_tail(instance: &mut GrandBouleInstance, frames: usize) -> (Vec<f32>, Vec<f32>) {
    let first = render(instance, frames);
    let mut tail = Vec::with_capacity(frames * TAIL_BLOCKS);
    for _ in 0..TAIL_BLOCKS {
        tail.extend(render(instance, frames));
    }
    (first, tail)
}

fn rms(samples: &[f32]) -> f32 {
    let sum: f32 = samples.iter().map(|sample| sample * sample).sum();
    (sum / samples.len() as f32).sqrt()
}

fn max_abs_difference(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0, f32::max)
}

/// Tail energy of a note struck at 0 and released at frame 64, with the sustain
/// pedal pushed down at `pedal_at` when one is given.
///
/// Events are pushed in frame order, as a host pushes them: a push whose offset
/// is behind an earlier one lands at the render cursor instead.
fn released_note_tail_rms(pedal_at: Option<u32>) -> f32 {
    const NOTE_OFF_AT: u32 = 64;

    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
    assert!(instance.push_note_on(NOTE, VELOCITY, 0, 0));
    if let Some(at) = pedal_at.filter(|at| *at < NOTE_OFF_AT) {
        assert!(instance.push_sustain(1.0, at));
    }
    assert!(instance.push_note_off(NOTE, NOTE_OFF_AT));
    if let Some(at) = pedal_at.filter(|at| *at >= NOTE_OFF_AT) {
        assert!(instance.push_sustain(1.0, at));
    }
    let (_, tail) = render_with_tail(&mut instance, BLOCK);
    rms(&tail)
}

/// A pedal pushed before the note-off catches the note: it keeps ringing long
/// after its key came up.
///
/// An instance that dropped the sustain kind in `apply_event` — or applied it
/// after the note-off — renders the same tail as the plain release.
#[test]
fn a_sustain_pushed_before_the_note_off_keeps_the_note_ringing() {
    let damped = released_note_tail_rms(None);
    let sustained = released_note_tail_rms(Some(32));

    assert!(
        damped > 0.0,
        "the plain release left no tail at all, so the comparison is between silences"
    );
    assert!(
        sustained > damped * 10.0,
        "a note released under a pedal pushed ahead of the note-off rings no louder \
         than a plain release ({sustained} against {damped})"
    );
}

/// A pedal pushed long after the note-off lands after it: the note is damped
/// like a plain release and the sustained case sits far above it.
///
/// The tolerance is a factor of five over the plain release. A pedal does not
/// land exactly nowhere — it lifts the damper from its frame onward and the
/// string still holds whatever energy it kept until then — so the figure is a
/// bound, not an equality; the sustained render is more than ten times the
/// plain one. An instance that ignored the offset and applied the pedal at the
/// head of the block would sustain this note and fail the bound.
#[test]
fn a_sustain_pushed_after_the_note_off_leaves_the_note_damped() {
    const PEDAL_AT: u32 = 3500;
    const TOLERANCE: f32 = 5.0;

    let damped = released_note_tail_rms(None);
    let sustained = released_note_tail_rms(Some(32));
    let late_pedal = released_note_tail_rms(Some(PEDAL_AT));

    assert!(
        late_pedal <= damped * TOLERANCE,
        "a pedal pushed at frame {PEDAL_AT}, after the release, sustained the note \
         ({late_pedal} against a plain release of {damped})"
    );
    assert!(
        late_pedal < sustained / 4.0,
        "a pedal after the release rings almost as loudly as one before it \
         ({late_pedal} against {sustained})"
    );
}

/// A sustain release takes effect from its own frame: the note rings exactly as
/// if the pedal were still down until then, and decays after it.
///
/// The pre-release window is compared sample for sample against a control whose
/// pedal never lifts; an instance that applied the release at the head of the
/// block would have damped the note from its note-off onward and diverge there.
#[test]
fn a_sustain_release_decays_the_note_from_its_frame_and_not_from_the_block_start() {
    const NOTE_ON_AT: u32 = 16;
    const NOTE_OFF_AT: u32 = 512;
    const RELEASE_AT: u32 = 2048;

    let render_pedal_down = |release_at: Option<u32>| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
        instance.set_sustain(1.0);
        assert!(instance.push_note_on(NOTE, VELOCITY, 0, NOTE_ON_AT));
        assert!(instance.push_note_off(NOTE, NOTE_OFF_AT));
        if let Some(at) = release_at {
            assert!(instance.push_sustain(0.0, at));
        }
        render_with_tail(&mut instance, BLOCK)
    };

    let (held_first, held_tail) = render_pedal_down(None);
    let (lifted_first, lifted_tail) = render_pedal_down(Some(RELEASE_AT));

    let held_window = &held_first[NOTE_OFF_AT as usize..RELEASE_AT as usize];
    let lifted_window = &lifted_first[NOTE_OFF_AT as usize..RELEASE_AT as usize];
    assert!(
        rms(held_window) > 0.0,
        "the control note is silent, so the comparison below proves nothing"
    );
    assert!(
        max_abs_difference(held_window, lifted_window) < 1.0e-6,
        "the note between its note-off and the pedal release does not ring as it \
         does with the pedal held, so the release was applied before its frame"
    );
    // Within `HEAD_WINDOW` frames of the release the damper has already bitten:
    // the head renders differ by about 5.9e-3 from the held pedal's, so 1.0e-3
    // is well below it and far above the zero a late release produces.
    let head = RELEASE_AT as usize..RELEASE_AT as usize + HEAD_WINDOW;
    assert!(
        max_abs_difference(&held_first[head.clone()], &lifted_first[head]) > 1.0e-3,
        "the note is not yet damped {HEAD_WINDOW} frames after the pedal release frame, \
         so the release was applied late"
    );
    assert!(
        rms(&lifted_tail) < rms(&held_tail) / 5.0,
        "the note kept ringing after the pedal release ({} against a held pedal's {})",
        rms(&lifted_tail),
        rms(&held_tail)
    );
}

/// Tail energy of a note struck at 0 whose sostenuto and release are pushed in
/// the order given, the sostenuto engaging at `sostenuto_at`.
fn sostenuto_tail_rms(sostenuto_at: Option<u32>, sostenuto_before_release: bool) -> f32 {
    const NOTE_OFF_AT: u32 = 128;
    const FRAMES: usize = 256;

    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
    assert!(instance.push_note_on(NOTE, VELOCITY, 0, 0));
    if let Some(at) = sostenuto_at.filter(|_| sostenuto_before_release) {
        assert!(instance.push_sostenuto(true, at));
    }
    assert!(instance.push_note_off(NOTE, NOTE_OFF_AT));
    if let Some(at) = sostenuto_at.filter(|_| !sostenuto_before_release) {
        assert!(instance.push_sostenuto(true, at));
    }
    render(&mut instance, FRAMES);
    let mut tail = Vec::new();
    for _ in 0..48 {
        tail.extend(render(&mut instance, FRAMES));
    }
    rms(&tail)
}

/// Sostenuto captures what is sounding at its frame: engaged between the
/// note-on and the note-off it holds the note, engaged after the note-off it
/// holds nothing.
#[test]
fn a_sostenuto_takes_effect_at_its_frame() {
    let before_release = sostenuto_tail_rms(Some(64), true);
    let after_release = sostenuto_tail_rms(Some(192), false);
    let never = sostenuto_tail_rms(None, true);

    assert!(
        before_release > never * 2.0,
        "a sostenuto engaged while the key was down did not hold the note \
         ({before_release} against {never} without one)"
    );
    assert!(
        (after_release - never).abs() < never * 0.01,
        "a sostenuto engaged after the note-off changed the tail \
         ({after_release} against {never} without one)"
    );
}

/// A sostenuto release takes effect from its own frame: the captured note rings
/// exactly as if the pedal were still down until then, and decays after it.
///
/// An engage only has to land in push order to capture the right voices, so an
/// instance that ignored the offset of a sostenuto push would still pass the
/// engage specs; the release is where the frame is audible, because the note
/// keeps ringing between its note-off and the frame the pedal comes up.
#[test]
fn a_sostenuto_release_damps_the_captured_note_from_its_frame() {
    const ENGAGE_AT: u32 = 50;
    const NOTE_OFF_AT: u32 = 512;
    const RELEASE_AT: u32 = 2048;

    let render_captured_note = |release_at: Option<u32>| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
        assert!(instance.push_note_on(NOTE, VELOCITY, 0, 0));
        assert!(instance.push_sostenuto(true, ENGAGE_AT));
        assert!(instance.push_note_off(NOTE, NOTE_OFF_AT));
        if let Some(at) = release_at {
            assert!(instance.push_sostenuto(false, at));
        }
        render_with_tail(&mut instance, BLOCK)
    };

    let (held_first, held_tail) = render_captured_note(None);
    let (released_first, released_tail) = render_captured_note(Some(RELEASE_AT));

    let held_window = &held_first[NOTE_OFF_AT as usize..RELEASE_AT as usize];
    let released_window = &released_first[NOTE_OFF_AT as usize..RELEASE_AT as usize];
    assert!(
        rms(held_window) > 0.0,
        "the control note is silent, so the comparison below proves nothing"
    );
    assert!(
        max_abs_difference(held_window, released_window) < 1.0e-6,
        "the captured note does not ring between its note-off and the sostenuto \
         release as it does with the pedal held, so the release was applied early"
    );
    // The head renders differ by about 3.8e-3 within `HEAD_WINDOW` frames of the
    // release; 1.0e-3 is well below that and far above the zero a late release
    // produces.
    let head = RELEASE_AT as usize..RELEASE_AT as usize + HEAD_WINDOW;
    assert!(
        max_abs_difference(&held_first[head.clone()], &released_first[head]) > 1.0e-3,
        "the captured note is not yet damped {HEAD_WINDOW} frames after the sostenuto \
         release frame, so the release was applied late"
    );
    assert!(
        rms(&released_tail) < rms(&held_tail) / 3.0,
        "the captured note kept ringing after the sostenuto release ({} against a \
         held pedal's {})",
        rms(&released_tail),
        rms(&held_tail)
    );
}

/// Two events on one sample apply in push order: a sostenuto pushed ahead of a
/// note-off captures the note, one pushed behind it finds the key already up.
#[test]
fn a_sostenuto_and_a_note_off_on_one_sample_keep_their_push_order() {
    const AT: u32 = 128;

    let captured = sostenuto_tail_rms(Some(AT), true);
    let missed = sostenuto_tail_rms(Some(AT), false);

    assert!(
        captured > missed * 2.0,
        "the sostenuto pushed first did not hold the note ({captured} against {missed} \
         for the opposite order)"
    );
}

/// Una corda changes the strike and the sympathetic coupling from its frame
/// onward, and leaves every frame before it exactly as an unpedalled render.
///
/// The effect on a single note is small, so the observable is the sample-level
/// difference against an unpedalled render, not energy.
#[test]
fn an_una_corda_takes_effect_at_its_frame() {
    const NOTE_ON_AT: u32 = 200;
    const FRAMES: usize = 512;
    const BEFORE_STRIKE: u32 = 100;
    const AFTER_STRIKE: u32 = 300;
    /// Far below the observed differences (about 1.5e-4 and 2.6e-4) and far
    /// above the zero a render without the pedal's effect produces.
    const AUDIBLE: f32 = 1.0e-5;

    let render_una_corda = |engaged_at: Option<u32>| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
        assert!(instance.push_note_on(NOTE, VELOCITY, 0, NOTE_ON_AT));
        if let Some(at) = engaged_at {
            assert!(instance.push_una_corda(true, at));
        }
        render(&mut instance, FRAMES)
    };

    let plain = render_una_corda(None);
    let before_strike = render_una_corda(Some(BEFORE_STRIKE));
    let after_strike = render_una_corda(Some(AFTER_STRIKE));

    let split = NOTE_ON_AT as usize;
    let pedal_after = AFTER_STRIKE as usize;
    assert!(
        max_abs_difference(&before_strike[..split], &plain[..split]) == 0.0,
        "an una corda pushed at frame {BEFORE_STRIKE} changed frames ahead of the note"
    );
    assert!(
        max_abs_difference(
            &before_strike[split..pedal_after],
            &plain[split..pedal_after]
        ) > AUDIBLE,
        "an una corda engaged before the strike left the note unchanged"
    );
    assert!(
        max_abs_difference(&after_strike[..pedal_after], &plain[..pedal_after]) == 0.0,
        "an una corda pushed at frame {AFTER_STRIKE} changed frames ahead of it"
    );
    // Within `HEAD_WINDOW` frames of the engage the difference is already about
    // 1.1e-4, so `AUDIBLE` (1.0e-5) is well below it; an engage landing later
    // leaves this window identical to the plain render.
    let head = pedal_after..pedal_after + HEAD_WINDOW;
    assert!(
        max_abs_difference(&after_strike[head.clone()], &plain[head]) > AUDIBLE,
        "an una corda engaged at frame {AFTER_STRIKE} changed nothing within \
         {HEAD_WINDOW} frames, so it was applied late"
    );
    assert!(
        max_abs_difference(&after_strike[pedal_after..], &plain[pedal_after..]) > AUDIBLE,
        "an una corda engaged after the strike changed nothing from its frame onward"
    );
}

/// The shared list refuses every pedal push past its capacity, and `process`
/// frees it again.
#[test]
fn the_event_list_refuses_pedal_pushes_past_capacity() {
    /// The list's own capacity, spelled independently of the crate's private
    /// constant so this does not agree with the instance by construction.
    const CAPACITY: usize = 256;

    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
    for index in 0..CAPACITY {
        assert!(
            instance.push_sustain(1.0, 0),
            "the list refused pedal event {index}, inside its capacity"
        );
    }
    assert!(
        !instance.push_sustain(1.0, 0),
        "the 257th pedal push was taken, so a full block overwrites or grows"
    );
    assert!(
        !instance.push_sostenuto(true, 0),
        "a sostenuto push was taken by a full list"
    );
    assert!(
        !instance.push_una_corda(true, 0),
        "an una corda push was taken by a full list"
    );

    render(&mut instance, 128);

    assert!(
        instance.push_sustain(1.0, 0),
        "the list stayed full after a render, so every later block would be refused"
    );
}

/// A panic drops the notes that have not sounded but keeps the pedal events
/// queued behind them, because the engine keeps pedal state through a panic and
/// a dropped pedal-down would leave the instrument without the pedal the player
/// pressed.
#[test]
fn a_panic_keeps_the_queued_pedal_and_drops_the_queued_note() {
    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
    assert!(instance.push_note_on(NOTE, VELOCITY, 0, 32));
    assert!(instance.push_sustain(1.0, 64));
    instance.all_notes_off();
    render(&mut instance, 128);
    assert_eq!(
        instance.active_voices(),
        0,
        "the queued note struck after the panic"
    );

    // The pedal that survived the panic sustains a note released afterwards.
    instance.note_on(NOTE, VELOCITY);
    render(&mut instance, 128);
    instance.note_off(NOTE);
    let (_, tail) = render_with_tail(&mut instance, BLOCK);

    let mut control = GrandBouleInstance::new(SAMPLE_RATE, 8);
    control.note_on(NOTE, VELOCITY);
    render(&mut control, 128);
    control.note_off(NOTE);
    let (_, control_tail) = render_with_tail(&mut control, BLOCK);

    assert!(
        rms(&tail) > rms(&control_tail) * 5.0,
        "the pedal queued before the panic was dropped with the notes \
         ({} against {} without a pedal)",
        rms(&tail),
        rms(&control_tail)
    );
}

/// A panic keeps every queued pedal kind, not only the sustain: the engine keeps
/// all three pedals' state through a panic, so a dropped sostenuto move leaves
/// the instrument without the pedal the player pressed.
///
/// The note is struck after the panic, so only the pedal events that survived it
/// can capture it. Between its note-off and the queued release the note rings
/// as it does with the sostenuto held for good, and after the release it decays;
/// an instance that kept only the sustain would damp it at the note-off like a
/// plain release.
#[test]
fn a_panic_keeps_the_queued_sostenuto_engage_and_release() {
    const ENGAGE_AT: u32 = 100;
    const NOTE_OFF_AT: u32 = 300;
    const RELEASE_AT: u32 = 2048;

    let render_after_panic = |engaged: bool, release_at: Option<u32>| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
        if engaged {
            assert!(instance.push_sostenuto(true, ENGAGE_AT));
        }
        if let Some(at) = release_at {
            assert!(instance.push_sostenuto(false, at));
        }
        instance.all_notes_off();
        instance.note_on(NOTE, VELOCITY);
        assert!(instance.push_note_off(NOTE, NOTE_OFF_AT));
        render_with_tail(&mut instance, BLOCK)
    };

    let (control_first, control_tail) = render_after_panic(false, None);
    let (held_first, held_tail) = render_after_panic(true, None);
    let (released_first, released_tail) = render_after_panic(true, Some(RELEASE_AT));

    let window = NOTE_OFF_AT as usize..RELEASE_AT as usize;
    assert!(
        rms(&control_first[window.clone()]) > 0.0,
        "the control note is silent, so the comparisons below prove nothing"
    );
    assert!(
        rms(&held_first[window.clone()]) > rms(&control_first[window.clone()]) * 1.2
            && rms(&held_tail) > rms(&control_tail) * 5.0,
        "the sostenuto queued before the panic did not hold the note struck after it, \
         so the panic dropped the pedal event ({} against {} without a pedal)",
        rms(&held_tail),
        rms(&control_tail)
    );
    assert!(
        max_abs_difference(&held_first[window.clone()], &released_first[window]) < 1.0e-6,
        "the queued sostenuto release was applied before its frame"
    );
    assert!(
        rms(&released_tail) < rms(&held_tail) / 3.0,
        "the note kept ringing after the queued sostenuto release ({} against a held \
         pedal's {}), so the panic dropped the release",
        rms(&released_tail),
        rms(&held_tail)
    );
}

/// A panic keeps a queued una corda move: the note sounding at the panic's end
/// is unchanged until the pedal's frame and changed from it, exactly as without
/// a panic.
#[test]
fn a_panic_keeps_the_queued_una_corda_move() {
    const ENGAGE_AT: u32 = 300;
    const FRAMES: usize = 512;
    /// Far below the observed difference and far above the zero a render without
    /// the pedal's effect produces.
    const AUDIBLE: f32 = 1.0e-5;

    let render_after_panic = |engaged: bool| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
        if engaged {
            assert!(instance.push_una_corda(true, ENGAGE_AT));
        }
        instance.all_notes_off();
        instance.note_on(NOTE, VELOCITY);
        render(&mut instance, FRAMES)
    };

    let plain = render_after_panic(false);
    let pedalled = render_after_panic(true);

    let at = ENGAGE_AT as usize;
    assert!(
        rms(&plain[..at]) > 0.0,
        "the control note is silent before the pedal's frame, so the comparison proves nothing"
    );
    assert!(
        max_abs_difference(&pedalled[..at], &plain[..at]) == 0.0,
        "the queued una corda changed frames ahead of its own"
    );
    assert!(
        max_abs_difference(&pedalled[at..], &plain[at..]) > AUDIBLE,
        "the una corda queued before the panic changed nothing from its frame onward, \
         so the panic dropped it"
    );
}
