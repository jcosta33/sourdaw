//! What a VST3 processor says back through `process`, observed at the
//! plugin-facing boundary: the emitter class of the dylib `cargo test` just
//! built, loaded as a `.vst3` bundle through the real module loader and
//! `Vst3Wrapper`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "tests assert by unwrapping"
)]

mod support;

use daw_plugin_host::output_notes::OUTPUT_NOTE_CAPACITY;
use daw_plugin_host::traits::MAX_MIDI_EVENTS_PER_BLOCK;
use daw_plugin_host::{
    take_pending_parameter_flush_signal, AudioPlugin, HostMidiEvent, HostParameterUpdate,
    HostedPluginRuntime, PluginParameterEvent, ProcessMode, Vst3Wrapper,
};
use sourdaw_harness_fx::{
    DRIVE_CEILING, DRIVE_MARKER_PITCH, DRIVE_PARAM_ID, EMITTED_DELAY_FRAMES, EMITTED_TRANSPOSE,
    EMPTY_CLAIM_PARAM_ID, METER_PARAM_ID, MODULATED_PARAM_ID, REFUSED_REPORT, REFUSE_PARAM_ID,
    VST3_EMITTER_CLASS_ID,
};
use std::cell::Cell;
use std::sync::Mutex;
use support::InstalledPlugin;

const BLOCK_FRAMES: usize = 64;
const PEAK: f32 = 0.5;

/// The parameter-flush hint is process-wide, so every test here that raises
/// or reads it takes this first.
static FLUSH_HINT: Mutex<()> = Mutex::new(());

fn flush_hint_guard() -> std::sync::MutexGuard<'static, ()> {
    let guard = FLUSH_HINT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    take_pending_parameter_flush_signal();
    guard
}

fn emitter(plugin: &InstalledPlugin) -> Vst3Wrapper {
    plugin.vst3_class(&VST3_EMITTER_CLASS_ID, ProcessMode::Realtime)
}

/// One block whose input peaks at [`PEAK`], carrying `midi` and `updates`.
fn process(wrapper: &mut Vst3Wrapper, midi: &[HostMidiEvent], updates: &[HostParameterUpdate]) {
    let left: Vec<f32> = (0..BLOCK_FRAMES)
        .map(|frame| if frame == 7 { PEAK } else { 0.1 })
        .collect();
    let right = vec![-0.2f32; BLOCK_FRAMES];
    let inputs: [&[f32]; 2] = [&left, &right];
    let (mut out_left, mut out_right) = (vec![0.0f32; BLOCK_FRAMES], vec![0.0f32; BLOCK_FRAMES]);
    let mut outputs: [&mut [f32]; 2] = [&mut out_left, &mut out_right];
    wrapper.process_with_midi_and_parameters(&inputs, &mut outputs, BLOCK_FRAMES, midi, updates);
}

fn drive(value: f64) -> HostParameterUpdate {
    HostParameterUpdate {
        param_id: DRIVE_PARAM_ID,
        value,
    }
}

fn refuse() -> HostParameterUpdate {
    HostParameterUpdate {
        param_id: REFUSE_PARAM_ID,
        value: 1.0,
    }
}

fn controller_value(wrapper: &Vst3Wrapper, id: u32) -> f64 {
    wrapper
        .get_parameters()
        .into_iter()
        .find(|parameter| parameter.id == id)
        .expect("the emitter publishes the parameter")
        .value
}

fn observed(wrapper: &Vst3Wrapper) -> Vec<PluginParameterEvent> {
    let mut events = Vec::new();
    wrapper.parameter_event_queue().drain(&mut events);
    events
}

fn note(note: u8, is_note_on: bool, frame_offset: u32) -> HostMidiEvent {
    HostMidiEvent {
        note,
        velocity: 100,
        channel: 0,
        is_note_on,
        frame_offset,
    }
}

// ── Allocation counting ─────────────────────────────────────────────────

/// This test binary's global allocator, counting per thread so tests running
/// concurrently do not count each other's allocations. The counter is a
/// `const`-initialised thread-local `Cell`, which neither allocates nor
/// recurses into the allocator.
struct CountingAllocator;

thread_local! {
    static ALLOCATIONS: Cell<u64> = const { Cell::new(0) };
}

fn allocation_count() -> u64 {
    ALLOCATIONS.with(Cell::get)
}

/// `try_with`: an allocation during thread teardown finds the thread local
/// destroyed, and panicking there would abort the process.
fn count_allocation() {
    let _ = ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
}

// SAFETY: every method forwards the caller's layout and pointer unchanged to
// `std::alloc::System`, which upholds the `GlobalAlloc` contract; the only
// extra work is the non-allocating, non-panicking counter above.
unsafe impl std::alloc::GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        count_allocation();
        // SAFETY: the caller's layout, which `alloc` requires to be non-zero.
        unsafe { std::alloc::System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: std::alloc::Layout) {
        // SAFETY: only `System` blocks are handed out, with this same layout.
        unsafe { std::alloc::System.dealloc(pointer, layout) }
    }

    unsafe fn realloc(
        &self,
        pointer: *mut u8,
        layout: std::alloc::Layout,
        new_size: usize,
    ) -> *mut u8 {
        count_allocation();
        // SAFETY: a `System` block with `layout`; `new_size` is the caller's.
        unsafe { std::alloc::System.realloc(pointer, layout, new_size) }
    }
}

#[global_allocator]
static COUNTING_ALLOCATOR: CountingAllocator = CountingAllocator;

// ── Output parameter changes (#6562) ────────────────────────────────────

/// The reporting path runs on the audio thread, so a block whose processor
/// reports parameters and writes notes allocates nothing — measured on a block
/// that did both, so a zero is not the count of a block that reported nothing.
#[test]
fn a_block_that_reports_parameters_and_notes_performs_no_heap_allocation() {
    let _hint = flush_hint_guard();
    let plugin = InstalledPlugin::create("vst3-output-no-allocation");
    let mut wrapper = emitter(&plugin);
    let notes = wrapper.output_note_queue();
    process(&mut wrapper, &[], &[]);
    observed(&wrapper);

    let left = vec![0.5f32; BLOCK_FRAMES];
    let right = vec![-0.2f32; BLOCK_FRAMES];
    let (mut out_left, mut out_right) = (vec![0.0f32; BLOCK_FRAMES], vec![0.0f32; BLOCK_FRAMES]);
    let midi = [note(60, true, 3)];
    let updates = [drive(0.8)];
    let inputs: [&[f32]; 2] = [&left, &right];
    let mut outputs: [&mut [f32]; 2] = [&mut out_left, &mut out_right];

    let before = allocation_count();
    wrapper.process_with_midi_and_parameters(&inputs, &mut outputs, BLOCK_FRAMES, &midi, &updates);
    let after = allocation_count();

    assert_eq!(
        observed(&wrapper),
        [PluginParameterEvent::value(MODULATED_PARAM_ID, 0.4)],
        "the measured block was the one that reported"
    );
    let mut captured = Vec::new();
    notes.drain(&mut captured);
    assert_eq!(captured.len(), 2, "and the one that wrote notes");
    assert_eq!(
        after - before,
        0,
        "the reporting block allocated {} times",
        after - before
    );
}

/// A queue the processor claims and never adds a point to carries no value,
/// so nothing is reported for it rather than a move to zero.
#[test]
fn an_output_queue_claimed_without_a_point_reports_nothing() {
    let _hint = flush_hint_guard();
    let plugin = InstalledPlugin::create("vst3-output-empty-claim");
    let mut wrapper = emitter(&plugin);
    observed(&wrapper);

    process(&mut wrapper, &[], &[drive(0.8)]);

    let events = observed(&wrapper);
    assert!(
        events
            .iter()
            .all(|event| event.param_id != EMPTY_CLAIM_PARAM_ID),
        "an empty claim reached the observers: {events:?}"
    );
    assert!(
        events.contains(&PluginParameterEvent::value(MODULATED_PARAM_ID, 0.4)),
        "the block that claimed the queue did report"
    );
}

/// A block the processor refuses is not its output: what it reported and the
/// notes it wrote on the way to failing reach neither the observers, the
/// controller nor the note capture — not in that block, and not carried into
/// the next one, which delivers only its own.
#[test]
fn a_refused_block_forwards_nothing_the_processor_reported() {
    let _hint = flush_hint_guard();
    let plugin = InstalledPlugin::create("vst3-output-refused");
    let mut wrapper = emitter(&plugin);
    let notes = wrapper.output_note_queue();
    observed(&wrapper);

    process(&mut wrapper, &[note(60, true, 3)], &[refuse()]);

    assert_eq!(
        observed(&wrapper),
        [],
        "observers hear nothing of a refused block"
    );
    let mut captured = Vec::new();
    notes.drain(&mut captured);
    assert_eq!(captured, [], "a refused block's notes are not captured");

    process(&mut wrapper, &[note(64, true, 5)], &[]);

    assert_eq!(observed(&wrapper), [], "nor carried into the next block");
    notes.drain(&mut captured);
    assert_eq!(
        captured,
        [note(
            64 + EMITTED_TRANSPOSE as u8,
            true,
            5 + EMITTED_DELAY_FRAMES as u32
        )],
        "the next block delivers only its own note"
    );
    wrapper.flush_parameters_off_audio_thread();
    assert_ne!(
        controller_value(&wrapper, MODULATED_PARAM_ID),
        REFUSED_REPORT,
        "the controller is not told a refused block's report"
    );
}

/// The project hears what the processor moved on its own and nothing else:
/// its echo of the value the host just wrote is dropped (#6956), and a
/// read-only meter never reaches the observers, so neither can dirty the
/// project or write an automation point.
#[test]
fn observers_hear_the_processors_own_moves_and_neither_its_echo_nor_its_meter() {
    let _hint = flush_hint_guard();
    let plugin = InstalledPlugin::create("vst3-output-observed");
    let mut wrapper = emitter(&plugin);
    observed(&wrapper);

    process(&mut wrapper, &[], &[drive(0.8)]);

    assert_eq!(
        observed(&wrapper),
        [PluginParameterEvent::value(MODULATED_PARAM_ID, 0.4)]
    );

    process(&mut wrapper, &[], &[]);
    assert_eq!(
        observed(&wrapper),
        [],
        "a block that moves only the meter tells the project nothing"
    );
}

/// A value the processor corrects is its own move, not an echo: the host wrote
/// Drive above the ceiling, the processor kept the ceiling, and both the
/// controller and the observers learn what it kept.
#[test]
fn a_processor_correction_of_a_host_written_value_reaches_the_controller_and_observers() {
    let _hint = flush_hint_guard();
    let plugin = InstalledPlugin::create("vst3-output-correction");
    let mut wrapper = emitter(&plugin);
    observed(&wrapper);

    process(&mut wrapper, &[], &[drive(0.95)]);

    assert_eq!(
        observed(&wrapper),
        [
            PluginParameterEvent::value(DRIVE_PARAM_ID, DRIVE_CEILING),
            PluginParameterEvent::value(MODULATED_PARAM_ID, DRIVE_CEILING * 0.5),
        ]
    );
    assert!(wrapper.flush_parameters_off_audio_thread());
    assert_eq!(controller_value(&wrapper, DRIVE_PARAM_ID), DRIVE_CEILING);
}

/// The controller learns every value the processor reports, meter included,
/// but only on the control path: the audio thread records them and raises the
/// flush hint, and the drain hands them to `setParamNormalized`.
#[test]
fn the_controller_learns_the_processors_output_on_the_control_path() {
    let _hint = flush_hint_guard();
    let plugin = InstalledPlugin::create("vst3-output-controller");
    let mut wrapper = emitter(&plugin);

    process(&mut wrapper, &[], &[drive(0.8)]);

    assert_eq!(
        controller_value(&wrapper, METER_PARAM_ID),
        0.0,
        "the audio thread never calls into the controller"
    );
    assert!(
        take_pending_parameter_flush_signal(),
        "the block asks the control path to drain"
    );

    assert!(wrapper.flush_parameters_off_audio_thread());

    assert_eq!(controller_value(&wrapper, METER_PARAM_ID), f64::from(PEAK));
    assert_eq!(controller_value(&wrapper, MODULATED_PARAM_ID), 0.4);
    assert_eq!(
        controller_value(&wrapper, DRIVE_PARAM_ID),
        0.0,
        "the echo of a host write is not handed back to the controller"
    );
}

/// The zero-sample flush that lands a write on an idle instance is a process
/// call like any other: the processor is handed both output lists, what it
/// reports reaches the controller on the control path and the observers
/// without the echo, and the note it writes is captured.
#[test]
fn an_idle_flush_hands_the_processor_its_output_lists_and_forwards_what_it_reports() {
    let _hint = flush_hint_guard();
    let plugin = InstalledPlugin::create("vst3-output-idle-flush");
    let mut wrapper = emitter(&plugin);
    let notes = wrapper.output_note_queue();
    observed(&wrapper);

    wrapper.set_parameter(DRIVE_PARAM_ID, 0.6);

    assert_eq!(
        observed(&wrapper),
        [PluginParameterEvent::value(MODULATED_PARAM_ID, 0.3)],
        "observers hear the processor's own move, and not the echo of the write"
    );
    assert!(wrapper.flush_parameters_off_audio_thread());
    assert_eq!(controller_value(&wrapper, MODULATED_PARAM_ID), 0.3);

    let mut captured = Vec::new();
    notes.drain(&mut captured);
    assert_eq!(
        captured
            .iter()
            .map(|captured| (captured.note, captured.is_note_on))
            .collect::<Vec<_>>(),
        [(DRIVE_MARKER_PITCH as u8, true)],
        "the flush's note reaches the capture"
    );
}

// ── Output events (#6562) ───────────────────────────────────────────────

/// Every note the plugin writes is captured with the frame it was stamped
/// with inside its block.
#[test]
fn notes_the_plugin_emits_are_captured_with_their_frame_offsets() {
    let plugin = InstalledPlugin::create("vst3-output-notes");
    let mut wrapper = emitter(&plugin);
    let notes = wrapper.output_note_queue();
    let delay = EMITTED_DELAY_FRAMES as u32;
    let up = |pitch: u8| pitch + EMITTED_TRANSPOSE as u8;

    let on_channel = |channel: i16, event: HostMidiEvent| HostMidiEvent { channel, ..event };

    process(
        &mut wrapper,
        &[
            on_channel(3, note(60, true, 3)),
            on_channel(5, note(64, false, 17)),
        ],
        &[],
    );

    let mut captured = Vec::new();
    notes.drain(&mut captured);
    assert_eq!(
        captured,
        [
            on_channel(3, note(up(60), true, 3 + delay)),
            on_channel(5, note(up(64), false, 17 + delay))
        ]
    );
    assert_eq!(notes.take_dropped(), 0);
}

/// A plugin that writes more notes than the capture holds between drains
/// loses the excess, and every lost note is counted.
#[test]
fn notes_past_the_capture_capacity_are_counted_as_dropped() {
    let plugin = InstalledPlugin::create("vst3-output-overflow");
    let mut wrapper = emitter(&plugin);
    let notes = wrapper.output_note_queue();
    let block: Vec<HostMidiEvent> = (0..MAX_MIDI_EVENTS_PER_BLOCK)
        .map(|index| note(36, true, index as u32 % 32))
        .collect();
    let blocks = OUTPUT_NOTE_CAPACITY / MAX_MIDI_EVENTS_PER_BLOCK + 1;

    for _ in 0..blocks {
        process(&mut wrapper, &block, &[]);
    }

    let mut captured = Vec::new();
    notes.drain(&mut captured);
    assert_eq!(captured.len(), OUTPUT_NOTE_CAPACITY);
    assert_eq!(
        notes.take_dropped() as usize,
        blocks * MAX_MIDI_EVENTS_PER_BLOCK - OUTPUT_NOTE_CAPACITY
    );
}
