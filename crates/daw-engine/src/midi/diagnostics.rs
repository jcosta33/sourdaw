use triple_buffer::{Input, Output};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ActiveMidiRtDiagnosticsSnapshot {
    pub scheduler_event_buffer_overflows: u64,
    pub arpeggiator_active_note_exhaustions: u64,
    /// An `AddEffect`/`AddPlugin`/`AddPluginWithBridge` command named an id
    /// already held by another effect or plugin. The command is rejected
    /// rather than silently misrouting later `SetParam`/`SetBypass`/
    /// `SendMidiNote`/etc. commands to whichever entry was inserted first.
    /// The control-side effect-table ledger also reconciles against this
    /// counter, so a refusal observed here returns the slot the ledger
    /// counted for it.
    pub effect_id_collisions: u64,
    /// An `AddEffect` command named a `plugin_type` with no built-in mapping.
    /// Unreachable from this engine since the command's payload became the
    /// fixed-size `BuiltinEffectType` address: an unmapped name is refused
    /// control-side by `BuiltinEffectType::from_name`. The field stays
    /// published because the diagnostics surface is a contract; this engine
    /// reads zero on it.
    pub unsupported_effect_additions: u64,
    /// A parameter write the engine could not deliver. Three routes feed it:
    ///
    /// - a `SetParam` command addressed a plugin whose parameters are not
    ///   routed there (a native plugin; the built-in's own mapping is total,
    ///   and an unrecognized name is refused control-side by
    ///   `DeviceParam::from_name`);
    /// - a hosted plugin refused an `AutomateDeviceParam` stamp aimed at one of
    ///   its own parameters — only the plugin knows whether it can take the
    ///   write, and a refusal is a value missing from the mix;
    /// - an `AutomateDeviceParam` stamp reached a body its address does not fit
    ///   (a built-in address on a hosted plugin, or a hosted id on a built-in),
    ///   which is a producer that lost track of what an effect id holds.
    ///
    /// A stamp the engine itself discards is not counted here: a hosted stamp
    /// due while its effect is bypassed is dropped rather than refused, because
    /// a bypassed plugin is never handed the block that would drain it.
    pub unmapped_set_param_calls: u64,
    /// A processed audio block the app never received because its return ring
    /// was full. The plugin's output for that block is gone.
    pub bridge_output_blocks_dropped: u64,
    /// Audio blocks drained from a bridge with no plugin registered under its
    /// id. They are returned to the app unprocessed rather than left to fill
    /// the ring, which would refuse every later push for good — except any the
    /// pass shed to hold its depth, which are counted in
    /// `bridge_backlog_blocks_shed`.
    pub unmatched_bridge_blocks: u64,
    /// Stale blocks discarded to hold a bridge's round trip at the depth the
    /// device period needs. Each one is a quantum of dry signal traded for
    /// latency that would otherwise never come back down.
    pub bridge_backlog_blocks_shed: u64,
    /// Blocks returned to the app unprocessed because the plugin the bridge
    /// names is on a track or bus device chain and the monitor is audible: that
    /// chain runs the instance over the strip's own signal, so processing the
    /// bridge's blocks as well would drive one stateful plugin twice a block.
    /// The bridge is still drained, because a ring left to fill refuses every
    /// later push for good.
    pub bridge_blocks_passed_chain_bound: u64,
    /// Callbacks asking for more frames than the bridge can carry in one pass.
    /// Above that the app's pushes are refused every period, not occasionally.
    pub callback_frames_over_bridge_reach: u64,
    /// A `RegisterCaptureConsumer` the input bus would not take: its table was
    /// full, or the id was already on it. The control side holds its own
    /// ledger against the same reserve and refuses first, where the caller
    /// hears it; this counter is the callback's last line, as the effect
    /// table's collision count is for that table.
    pub capture_consumer_refusals: u64,
    /// Capture blocks no consumer took, because every registered id resolved
    /// to nothing or to an effect with no native instance. A registered bus
    /// delivering to nobody is a recorder writing silence with no error.
    pub capture_blocks_dropped: u64,
    /// Capture blocks delivered with no audio behind them: the ring was
    /// filling or had stalled. The consumers still receive the block, as
    /// silence, so a recorder writes a gap it can see rather than splicing two
    /// takes together.
    pub capture_input_underruns: u64,
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
                effect_id_collisions: 0,
                unsupported_effect_additions: 0,
                unmapped_set_param_calls: 0,
                bridge_output_blocks_dropped: 0,
                unmatched_bridge_blocks: 0,
                bridge_backlog_blocks_shed: 0,
                bridge_blocks_passed_chain_bound: 0,
                callback_frames_over_bridge_reach: 0,
                capture_consumer_refusals: 0,
                capture_blocks_dropped: 0,
                capture_input_underruns: 0,
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

    pub fn record_effect_id_collision(&mut self, count: u64) {
        self.snapshot.effect_id_collisions =
            self.snapshot.effect_id_collisions.saturating_add(count);
    }

    pub fn record_unsupported_effect_addition(&mut self, count: u64) {
        self.snapshot.unsupported_effect_additions = self
            .snapshot
            .unsupported_effect_additions
            .saturating_add(count);
    }

    pub fn record_unmapped_set_param_call(&mut self, count: u64) {
        self.snapshot.unmapped_set_param_calls =
            self.snapshot.unmapped_set_param_calls.saturating_add(count);
    }

    pub fn record_bridge_output_blocks_dropped(&mut self, count: u64) {
        self.snapshot.bridge_output_blocks_dropped = self
            .snapshot
            .bridge_output_blocks_dropped
            .saturating_add(count);
    }

    pub fn record_unmatched_bridge_blocks(&mut self, count: u64) {
        self.snapshot.unmatched_bridge_blocks =
            self.snapshot.unmatched_bridge_blocks.saturating_add(count);
    }

    pub fn record_bridge_backlog_blocks_shed(&mut self, count: u64) {
        self.snapshot.bridge_backlog_blocks_shed = self
            .snapshot
            .bridge_backlog_blocks_shed
            .saturating_add(count);
    }

    pub fn record_bridge_blocks_passed_chain_bound(&mut self, count: u64) {
        self.snapshot.bridge_blocks_passed_chain_bound = self
            .snapshot
            .bridge_blocks_passed_chain_bound
            .saturating_add(count);
    }

    pub fn record_callback_frames_over_bridge_reach(&mut self, count: u64) {
        self.snapshot.callback_frames_over_bridge_reach = self
            .snapshot
            .callback_frames_over_bridge_reach
            .saturating_add(count);
    }

    pub fn record_capture_consumer_refusal(&mut self, count: u64) {
        self.snapshot.capture_consumer_refusals = self
            .snapshot
            .capture_consumer_refusals
            .saturating_add(count);
    }

    pub fn record_capture_blocks_dropped(&mut self, count: u64) {
        self.snapshot.capture_blocks_dropped =
            self.snapshot.capture_blocks_dropped.saturating_add(count);
    }

    pub fn record_capture_input_underrun(&mut self, count: u64) {
        self.snapshot.capture_input_underruns =
            self.snapshot.capture_input_underruns.saturating_add(count);
    }
}

impl Default for ActiveMidiRtDiagnostics {
    fn default() -> Self {
        Self::new()
    }
}
