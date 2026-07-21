use super::diagnostics::{MidiRtDiagnostics, MidiRtDiagnosticsSnapshot};
use super::midi_clock::{
    MidiClock, MidiClockBlockInput, MidiClockTransportTransition, MIDI_CLOCK_EVENT_CAPACITY,
};
use super::mpe_allocator::MpeAllocatorDiagnostics;
use crate::midi_fx::{Arpeggiator, MidiEventBuffer, MidiFx, PROBABILITY_CUTOFF_RANGE};
use crate::plugin_slot::{MidiNoteEvent, NativePlugin, TransportState};
use crate::scheduler::{AudioScheduler, GraphCommand};
use rtrb::RingBuffer;
use std::any::Any;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

struct MidiRecordingPlugin {
    received_event_count: Arc<AtomicUsize>,
    received_channel_sum: Arc<AtomicUsize>,
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
fn scheduler_event_overflow_reports_exact_count_and_preserves_accepted_prefix() {
    let (mut command_tx, command_rx) = RingBuffer::new(256);
    let (diagnostics_tx, mut diagnostics_rx) =
        triple_buffer::triple_buffer(&MidiRtDiagnosticsSnapshot::default());
    let mut scheduler =
        AudioScheduler::with_midi_rt_diagnostics(command_rx, 48_000.0, diagnostics_tx);
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

    assert_eq!(diagnostics_rx.read().scheduler_event_buffer_overflows, 1);

    let mut left = [0.0; 4];
    let mut right = [0.0; 4];
    scheduler.process_block(&mut left, &mut right, 4);

    assert_eq!(received_event_count.load(Ordering::Relaxed), 128);
    assert_eq!(received_channel_sum.load(Ordering::Relaxed), 8_128);
}

#[test]
fn arpeggiator_exhaustion_reports_exact_count_and_preserves_accepted_set() {
    let mut arpeggiator = Arpeggiator::default();
    let mut events = MidiEventBuffer::new();
    let mut diagnostics = MidiRtDiagnostics::new();

    for note in 60..=76 {
        assert!(events.try_push(note_on(note, 0)));
    }

    arpeggiator.process_midi(
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
fn unified_diagnostic_aggregation_saturates_every_counter() {
    let maximum = MidiRtDiagnosticsSnapshot {
        scheduler_event_buffer_overflows: u64::MAX,
        arpeggiator_active_note_exhaustions: u64::MAX,
        mpe_channel_reuse_stalls: u64::MAX,
        midi_clock_output_overflows: u64::MAX,
    };
    let mut diagnostics = MidiRtDiagnostics::from_snapshot(maximum);

    diagnostics.record_scheduler_event_buffer_overflow(1);
    diagnostics.record_arpeggiator_active_note_exhaustion(1);
    diagnostics.record_mpe_allocator(MpeAllocatorDiagnostics {
        channel_reuse_stalls: 1,
    });

    let mut clock = MidiClock::new();
    let clock_output = clock
        .process_block(MidiClockBlockInput {
            timeline_sample: 0,
            block_sample_count: 48_000 * 10,
            sample_rate: 48_000,
            tempo_bpm: 960.0,
            transition: MidiClockTransportTransition::Start,
        })
        .expect("valid clock block should process");
    assert_eq!(clock_output.len(), MIDI_CLOCK_EVENT_CAPACITY);
    assert!(clock_output.dropped_event_count() > 0);
    diagnostics.record_midi_clock_output(&clock_output);

    assert_eq!(diagnostics.snapshot(), maximum);
    assert_eq!(
        maximum.saturating_add(MidiRtDiagnosticsSnapshot {
            scheduler_event_buffer_overflows: 1,
            arpeggiator_active_note_exhaustions: 1,
            mpe_channel_reuse_stalls: 1,
            midi_clock_output_overflows: 1,
        }),
        maximum
    );
}
