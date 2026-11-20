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
    DRIVE_PARAM_ID, EMITTED_DELAY_FRAMES, EMITTED_TRANSPOSE, METER_PARAM_ID, MODULATED_PARAM_ID,
    VST3_EMITTER_CLASS_ID,
};
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

// ── Output parameter changes (#6562) ────────────────────────────────────

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

    process(&mut wrapper, &[note(60, true, 3), note(64, false, 17)], &[]);

    let mut captured = Vec::new();
    notes.drain(&mut captured);
    assert_eq!(
        captured,
        [
            note(up(60), true, 3 + delay),
            note(up(64), false, 17 + delay)
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
