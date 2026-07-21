use triple_buffer::{Input, Output};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ActiveMidiRtDiagnosticsSnapshot {
    pub scheduler_event_buffer_overflows: u64,
    pub arpeggiator_active_note_exhaustions: u64,
}

pub(crate) struct ActiveMidiRtDiagnosticsReader {
    output: Output<ActiveMidiRtDiagnosticsSnapshot>,
}

pub(crate) fn active_midi_rt_diagnostics_channel() -> (
    Input<ActiveMidiRtDiagnosticsSnapshot>,
    ActiveMidiRtDiagnosticsReader,
) {
    let (input, output) = triple_buffer::triple_buffer(&ActiveMidiRtDiagnosticsSnapshot::default());
    (input, ActiveMidiRtDiagnosticsReader { output })
}

impl ActiveMidiRtDiagnosticsReader {
    pub(crate) fn snapshot(&mut self) -> ActiveMidiRtDiagnosticsSnapshot {
        *self.output.read()
    }
}

pub struct ActiveMidiRtDiagnostics {
    snapshot: ActiveMidiRtDiagnosticsSnapshot,
}

impl ActiveMidiRtDiagnostics {
    pub const fn new() -> Self {
        Self {
            snapshot: ActiveMidiRtDiagnosticsSnapshot {
                scheduler_event_buffer_overflows: 0,
                arpeggiator_active_note_exhaustions: 0,
            },
        }
    }

    pub const fn snapshot(&self) -> ActiveMidiRtDiagnosticsSnapshot {
        self.snapshot
    }

    pub fn record_scheduler_event_buffer_overflow(&mut self, count: u64) {
        self.snapshot.scheduler_event_buffer_overflows = self
            .snapshot
            .scheduler_event_buffer_overflows
            .saturating_add(count);
    }

    pub fn record_arpeggiator_active_note_exhaustion(&mut self, count: u64) {
        self.snapshot.arpeggiator_active_note_exhaustions = self
            .snapshot
            .arpeggiator_active_note_exhaustions
            .saturating_add(count);
    }
}

impl Default for ActiveMidiRtDiagnostics {
    fn default() -> Self {
        Self::new()
    }
}
