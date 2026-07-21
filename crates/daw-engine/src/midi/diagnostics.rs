#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ActiveMidiRtDiagnosticsSnapshot {
    pub scheduler_event_buffer_overflows: u64,
    pub arpeggiator_active_note_exhaustions: u64,
}

impl ActiveMidiRtDiagnosticsSnapshot {
    pub fn saturating_add(self, other: Self) -> Self {
        Self {
            scheduler_event_buffer_overflows: self
                .scheduler_event_buffer_overflows
                .saturating_add(other.scheduler_event_buffer_overflows),
            arpeggiator_active_note_exhaustions: self
                .arpeggiator_active_note_exhaustions
                .saturating_add(other.arpeggiator_active_note_exhaustions),
        }
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

    #[cfg(test)]
    pub(crate) const fn from_snapshot(snapshot: ActiveMidiRtDiagnosticsSnapshot) -> Self {
        Self { snapshot }
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
