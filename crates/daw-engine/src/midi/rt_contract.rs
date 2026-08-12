use super::diagnostics::{
    active_midi_rt_diagnostics_channel, ActiveMidiRtDiagnostics, ActiveMidiRtDiagnosticsSnapshot,
};
use crate::midi_fx::{Arpeggiator, MidiEventBuffer, MidiFx, PROBABILITY_CUTOFF_RANGE};
use crate::plugin_slot::{MidiNoteEvent, NativePlugin, TransportState};
use crate::scheduler::{AudioScheduler, GraphCommand, MidiFxKind};
use rtrb::{Consumer, RingBuffer};
use std::any::Any;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

struct MidiRecordingPlugin {
    received_event_count: Arc<AtomicUsize>,
    received_channel_sum: Arc<AtomicUsize>,
}

struct LegacyMidiFx;

impl MidiFx for LegacyMidiFx {
    fn process_midi(
        &mut self,
        _events: &mut MidiEventBuffer,
        _transport: &TransportState,
        _sample_rate: f32,
        _num_samples: usize,
    ) {
    }

    fn set_param(&mut self, _name: &str, _value: f32) {}

    fn reset(&mut self) {}
}

impl NativePlugin for MidiRecordingPlugin {
    fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

    fn process_with_events(
        &mut self,
        _left: &mut [f32],
        _right: &mut [f32],
        _num_samples: usize,
        midi_events: &[MidiNoteEvent],
        _transport: &TransportState,
    ) {
        self.received_event_count
            .fetch_add(midi_events.len(), Ordering::Relaxed);
        let channel_sum = midi_events
            .iter()
            .map(|event| event.channel as usize)
            .sum::<usize>();
        self.received_channel_sum
            .fetch_add(channel_sum, Ordering::Relaxed);
    }

    fn name(&self) -> &str {
        "midi-recording-plugin"
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

fn note_on(note: u8, channel: i16) -> MidiNoteEvent {
    MidiNoteEvent {
        note,
        velocity: 100,
        channel,
        is_note_on: true,
        probability_cutoff: PROBABILITY_CUTOFF_RANGE,
        project_probability_seed: 0,
        clip_id_hash: 0,
        event_id_hash: 0,
        absolute_occurrence_index: 0,
    }
}

#[test]
fn public_rt_entry_points_remain_source_compatible() {
    let _spawn: fn(
        Consumer<GraphCommand>,
    ) -> Result<crate::audio_thread::AudioThreadHandle, String> =
        crate::audio_thread::spawn_audio_thread;
    let mut effect = LegacyMidiFx;
    let mut events = MidiEventBuffer::new();

    effect.process_midi(&mut events, &TransportState::default(), 48_000.0, 128);
}

#[test]
fn scheduler_event_overflow_reports_exact_count_and_preserves_accepted_prefix() {
    let (mut command_tx, command_rx) = RingBuffer::new(256);
    let (retired_tx, _retired_rx) = RingBuffer::new(256);
    let (diagnostics_tx, mut diagnostics_reader) = active_midi_rt_diagnostics_channel();
    let mut scheduler =
        AudioScheduler::with_midi_rt_diagnostics(command_rx, retired_tx, 48_000.0, diagnostics_tx);
    let received_event_count = Arc::new(AtomicUsize::new(0));
    let received_channel_sum = Arc::new(AtomicUsize::new(0));

    command_tx
        .push(GraphCommand::AddPlugin(
            7,
            Box::new(MidiRecordingPlugin {
                received_event_count: Arc::clone(&received_event_count),
                received_channel_sum: Arc::clone(&received_channel_sum),
            }),
        ))
        .expect("plugin command should fit");

    for channel in 0..=128 {
        command_tx
            .push(GraphCommand::SendMidiNote(7, note_on(60, channel as i16)))
            .expect("MIDI command should fit");
    }

    scheduler.update_graph();
    scheduler.publish_midi_rt_diagnostics();

    assert_eq!(
        diagnostics_reader
            .snapshot()
            .scheduler_event_buffer_overflows,
        1
    );

    let mut left = [0.0; 4];
    let mut right = [0.0; 4];
    scheduler.process_block(&mut left, &mut right, 4);

    assert_eq!(received_event_count.load(Ordering::Relaxed), 128);
    assert_eq!(received_channel_sum.load(Ordering::Relaxed), 8_128);
}

#[test]
fn arpeggiator_exhaustion_publishes_through_scheduler_reader() {
    let (mut command_tx, command_rx) = RingBuffer::new(256);
    let (retired_tx, _retired_rx) = RingBuffer::new(256);
    let (diagnostics_tx, mut diagnostics_reader) = active_midi_rt_diagnostics_channel();
    let mut scheduler =
        AudioScheduler::with_midi_rt_diagnostics(command_rx, retired_tx, 48_000.0, diagnostics_tx);
    let received_event_count = Arc::new(AtomicUsize::new(0));
    let received_channel_sum = Arc::new(AtomicUsize::new(0));

    command_tx
        .push(GraphCommand::AddPlugin(
            7,
            Box::new(MidiRecordingPlugin {
                received_event_count: Arc::clone(&received_event_count),
                received_channel_sum,
            }),
        ))
        .expect("plugin command should fit");
    command_tx
        .push(GraphCommand::AddMidiFx(7, MidiFxKind::Arpeggiator))
        .expect("MIDI FX command should fit");
    for note in 60..=76 {
        command_tx
            .push(GraphCommand::SendMidiNote(7, note_on(note, 0)))
            .expect("MIDI command should fit");
    }

    scheduler.update_graph();
    let mut left = [0.0; 4];
    let mut right = [0.0; 4];
    scheduler.process_block(&mut left, &mut right, 4);
    scheduler.publish_midi_rt_diagnostics();

    assert_eq!(received_event_count.load(Ordering::Relaxed), 1);
    assert_eq!(
        diagnostics_reader
            .snapshot()
            .arpeggiator_active_note_exhaustions,
        1
    );
}

#[test]
fn arpeggiator_exhaustion_reports_exact_count_and_preserves_accepted_set() {
    let mut arpeggiator = Arpeggiator::default();
    let mut events = MidiEventBuffer::new();
    let mut diagnostics = ActiveMidiRtDiagnostics::new();

    for note in 60..=76 {
        assert!(events.try_push(note_on(note, 0)));
    }

    arpeggiator.process_midi_with_diagnostics(
        &mut events,
        &TransportState::default(),
        48_000.0,
        128,
        &mut diagnostics,
    );

    assert_eq!(
        diagnostics.snapshot().arpeggiator_active_note_exhaustions,
        1
    );
    assert_eq!(arpeggiator.active_note_count(), 16);
    assert!(arpeggiator.contains_active_note(60));
    assert!(arpeggiator.contains_active_note(75));
    assert!(!arpeggiator.contains_active_note(76));
}

#[test]
fn active_runtime_diagnostic_aggregation_saturates_both_counters() {
    let maximum = ActiveMidiRtDiagnosticsSnapshot {
        scheduler_event_buffer_overflows: u64::MAX,
        arpeggiator_active_note_exhaustions: u64::MAX,
        effect_id_collisions: 0,
        unsupported_effect_additions: 0,
        unmapped_set_param_calls: 0,
    };
    let mut diagnostics = ActiveMidiRtDiagnostics::new();

    diagnostics.record_scheduler_event_buffer_overflow(u64::MAX);
    diagnostics.record_scheduler_event_buffer_overflow(1);
    diagnostics.record_arpeggiator_active_note_exhaustion(u64::MAX);
    diagnostics.record_arpeggiator_active_note_exhaustion(1);

    assert_eq!(diagnostics.snapshot(), maximum);
}
