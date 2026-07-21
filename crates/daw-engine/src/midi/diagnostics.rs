use super::midi_clock::MidiClockEventBuffer;
use super::mpe_allocator::MpeAllocatorDiagnostics;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MidiRtDiagnosticsSnapshot {
    pub scheduler_event_buffer_overflows: u64,
    pub arpeggiator_active_note_exhaustions: u64,
    pub mpe_channel_reuse_stalls: u64,
    pub midi_clock_output_overflows: u64,
}

impl MidiRtDiagnosticsSnapshot {
    pub fn saturating_add(self, other: Self) -> Self {
        Self {
            scheduler_event_buffer_overflows: self
                .scheduler_event_buffer_overflows
                .saturating_add(other.scheduler_event_buffer_overflows),
            arpeggiator_active_note_exhaustions: self
                .arpeggiator_active_note_exhaustions
                .saturating_add(other.arpeggiator_active_note_exhaustions),
            mpe_channel_reuse_stalls: self
                .mpe_channel_reuse_stalls
                .saturating_add(other.mpe_channel_reuse_stalls),
            midi_clock_output_overflows: self
                .midi_clock_output_overflows
                .saturating_add(other.midi_clock_output_overflows),
        }
    }
}

pub struct MidiRtDiagnostics {
    snapshot: MidiRtDiagnosticsSnapshot,
}

impl MidiRtDiagnostics {
    pub const fn new() -> Self {
        Self {
            snapshot: MidiRtDiagnosticsSnapshot {
                scheduler_event_buffer_overflows: 0,
                arpeggiator_active_note_exhaustions: 0,
                mpe_channel_reuse_stalls: 0,
                midi_clock_output_overflows: 0,
            },
        }
    }

    #[cfg(test)]
    pub(crate) const fn from_snapshot(snapshot: MidiRtDiagnosticsSnapshot) -> Self {
        Self { snapshot }
    }

    pub const fn snapshot(&self) -> MidiRtDiagnosticsSnapshot {
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

    pub fn record_mpe_allocator(&mut self, diagnostics: MpeAllocatorDiagnostics) {
        self.snapshot.mpe_channel_reuse_stalls = self
            .snapshot
            .mpe_channel_reuse_stalls
            .saturating_add(diagnostics.channel_reuse_stalls);
    }

    pub fn record_midi_clock_output(&mut self, output: &MidiClockEventBuffer) {
        self.snapshot.midi_clock_output_overflows = self
            .snapshot
            .midi_clock_output_overflows
            .saturating_add(output.dropped_event_count());
    }
}

impl Default for MidiRtDiagnostics {
    fn default() -> Self {
        Self::new()
    }
}
