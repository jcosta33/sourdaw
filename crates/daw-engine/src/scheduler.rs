//! Lock-free Messaging and Task Schedule for Native CPAL engine.
//!
//! Handles both built-in DSP effects (Knead) and external plugins (CLAP/VST3)
//! via the NativePlugin trait. All communication is lock-free via rtrb.

use crate::audio_bridge::{PluginAudioBridge, RENDER_QUANTUM_FRAMES, RING_CAPACITY};
use crate::audio_thread::MAX_CALLBACK_FRAMES;
#[cfg(test)]
use crate::midi::diagnostics::active_midi_rt_diagnostics_channel;
use crate::midi::diagnostics::{ActiveMidiRtDiagnostics, ActiveMidiRtDiagnosticsSnapshot};
use crate::midi_fx::{Arpeggiator, MidiEventBuffer, MidiFx, ProbabilityEvaluator, VelocityScaler};
use crate::plugin_slot::{MidiNoteEvent, NativePlugin, TransportState};
use daw_dsp::knead::engine::KneadEngine;
use rtrb::{Consumer, Producer, PushError};
use triple_buffer::Input;

pub enum MidiFxKind {
    Arpeggiator,
    VelocityScaler,
}

/// Commands sent from the UI/main thread to the audio thread (lock-free via rtrb).
pub enum GraphCommand {
    // Built-in effects
    AddEffect(usize, String),
    SetParam(usize, String, f32),
    SetBypass(usize, bool),

    // External plugins (CLAP/VST3/AU)
    AddPlugin(usize, Box<dyn NativePlugin>),
    AddPluginWithBridge(usize, Box<dyn NativePlugin>, PluginAudioBridge),
    RemovePlugin(usize),
    RemovePluginWithBridge(usize),

    // MIDI events (routed to a specific plugin by ID)
    SendMidiNote(usize, MidiNoteEvent),

    // MIDI FX
    AddMidiFx(usize, MidiFxKind),
    RemoveMidiFx(usize, usize), // effect_id, fx_index
    SetMidiFxParam(usize, usize, String, f32),

    // Transport state (global, affects all plugins)
    SetTransport(TransportState),

    /// Register an audio bridge that no plugin answers for.
    ///
    /// Production registers and retires a bridge only alongside its plugin
    /// (`AddPluginWithBridge` / `RemovePluginWithBridge`), so this state is
    /// unreachable there. The real-time drain still has to survive it — a
    /// bridge nobody processes must return its blocks and keep its ring
    /// moving, or the app is left on permanent dry fallback — and this is how
    /// a test puts the scheduler in that state.
    #[cfg(test)]
    RegisterAudioBridge(PluginAudioBridge),
}

enum PluginCore {
    Knead(KneadEngine),
    Native(Box<dyn NativePlugin>),
}

/// Map a `SetParam` name/value pair onto the matching `KneadEngine` setter.
///
/// Returns `false` for an unrecognized name so the caller can diagnose it
/// instead of reporting success while doing nothing.
fn apply_knead_param(engine: &mut KneadEngine, name: &str, value: f32) -> bool {
    match name {
        "shift_semitones" => {
            engine.set_shift_semitones(value);
            true
        }
        "retune_speed_ms" => {
            engine.set_retune_speed_ms(value);
            true
        }
        "formant_preserve" => {
            engine.set_formant_preserve(value != 0.0);
            true
        }
        _ => false,
    }
}

struct ActiveEffect {
    id: usize,
    instance: PluginCore,
    bypassed: bool,
    /// Fixed pre-FX gate. Inline ownership avoids callback-time registration/allocation.
    probability_evaluator: ProbabilityEvaluator,
    midi_fx: Vec<Box<dyn MidiFx>>,
    /// Pending MIDI events for this block (drained each process_block call).
    pending_midi: MidiEventBuffer,
}

pub(crate) const RETIREMENT_QUEUE_CAPACITY: usize = 257;

pub(crate) struct RetiredGraphObjects {
    effect: Option<ActiveEffect>,
    audio_bridge: Option<PluginAudioBridge>,
    midi_fx: Option<Box<dyn MidiFx>>,
    remaining_effects: Vec<ActiveEffect>,
    remaining_audio_bridges: Vec<PluginAudioBridge>,
    queued_commands: Vec<GraphCommand>,
    command_rx: Option<Consumer<GraphCommand>>,
}

impl RetiredGraphObjects {
    fn removed(
        effect: Option<ActiveEffect>,
        audio_bridge: Option<PluginAudioBridge>,
        midi_fx: Option<Box<dyn MidiFx>>,
    ) -> Self {
        Self {
            effect,
            audio_bridge,
            midi_fx,
            remaining_effects: Vec::new(),
            remaining_audio_bridges: Vec::new(),
            queued_commands: Vec::new(),
            command_rx: None,
        }
    }

    fn effect(effect: ActiveEffect) -> Self {
        Self::removed(Some(effect), None, None)
    }

    fn effect_with_bridge(
        effect: Option<ActiveEffect>,
        audio_bridge: Option<PluginAudioBridge>,
    ) -> Option<Self> {
        if effect.is_none() && audio_bridge.is_none() {
            return None;
        }

        Some(Self::removed(effect, audio_bridge, None))
    }

    fn midi_fx(midi_fx: Box<dyn MidiFx>) -> Self {
        Self::removed(None, None, Some(midi_fx))
    }

    fn shutdown(
        pending: Option<Self>,
        remaining_effects: Vec<ActiveEffect>,
        remaining_audio_bridges: Vec<PluginAudioBridge>,
        queued_commands: Vec<GraphCommand>,
        command_rx: Option<Consumer<GraphCommand>>,
    ) -> Self {
        let mut pending = pending.unwrap_or_else(|| Self::removed(None, None, None));

        Self {
            effect: pending.effect.take(),
            audio_bridge: pending.audio_bridge.take(),
            midi_fx: pending.midi_fx.take(),
            remaining_effects,
            remaining_audio_bridges,
            queued_commands,
            command_rx,
        }
    }
}

impl Drop for RetiredGraphObjects {
    fn drop(&mut self) {
        if let Some(effect) = self.effect.take() {
            effect.reclaim();
        }
        for effect in self.remaining_effects.drain(..) {
            effect.reclaim();
        }
        self.remaining_audio_bridges.clear();
        for command in self.queued_commands.drain(..) {
            drop_safely(command);
        }
        if let Some(mut command_rx) = self.command_rx.take() {
            loop {
                while let Ok(command) = command_rx.pop() {
                    drop_safely(command);
                }
                if command_rx.is_abandoned() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
}

fn drop_safely<T>(value: T) {
    if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(value))).is_err() {
        eprintln!("[Engine] Plugin destructor panicked during retirement");
    }
}

impl ActiveEffect {
    fn reclaim(self) {
        let Self { instance, .. } = self;
        drop_safely(instance);
    }

    fn new(id: usize, instance: PluginCore) -> Self {
        Self {
            id,
            instance,
            bypassed: false,
            probability_evaluator: ProbabilityEvaluator,
            midi_fx: Vec::new(),
            pending_midi: MidiEventBuffer::new(),
        }
    }

    #[inline]
    fn enqueue_midi(&mut self, event: MidiNoteEvent, diagnostics: &mut ActiveMidiRtDiagnostics) {
        // Drop the newest event when the fixed block-local buffer is full.
        if !self.pending_midi.try_push(event) {
            diagnostics.record_scheduler_event_buffer_overflow(1);
        }
    }
}

pub struct AudioScheduler {
    effects: Vec<ActiveEffect>,
    audio_bridges: Vec<PluginAudioBridge>,
    command_rx: Option<Consumer<GraphCommand>>,
    retired_tx: Producer<RetiredGraphObjects>,
    pending_retirement: Option<RetiredGraphObjects>,
    shutdown_commands: Vec<GraphCommand>,
    retain_command_consumer: bool,
    sample_rate: f32,
    transport: TransportState,
    midi_rt_diagnostics: ActiveMidiRtDiagnostics,
    midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
}

impl AudioScheduler {
    #[cfg(test)]
    pub(crate) fn new(
        command_rx: Consumer<GraphCommand>,
        retired_tx: Producer<RetiredGraphObjects>,
        sample_rate: f32,
    ) -> Self {
        let (diagnostics_tx, _diagnostics_reader) = active_midi_rt_diagnostics_channel();
        Self::with_midi_rt_diagnostics(command_rx, retired_tx, sample_rate, diagnostics_tx)
    }

    pub(crate) fn with_midi_rt_diagnostics(
        command_rx: Consumer<GraphCommand>,
        retired_tx: Producer<RetiredGraphObjects>,
        sample_rate: f32,
        midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
    ) -> Self {
        let command_queue_capacity = command_rx.buffer().capacity();
        Self {
            effects: Vec::with_capacity(128),
            audio_bridges: Vec::with_capacity(128),
            command_rx: Some(command_rx),
            retired_tx,
            pending_retirement: None,
            shutdown_commands: Vec::with_capacity(command_queue_capacity),
            retain_command_consumer: !cfg!(test),
            sample_rate,
            transport: TransportState::default(),
            midi_rt_diagnostics: ActiveMidiRtDiagnostics::new(),
            midi_rt_diagnostics_tx,
        }
    }

    #[inline]
    pub(crate) fn publish_midi_rt_diagnostics(&mut self) {
        self.midi_rt_diagnostics_tx
            .write(self.midi_rt_diagnostics.snapshot());
    }

    /// Process pending UI commands lock-free on the audio thread.
    #[inline]
    pub fn update_graph(&mut self) {
        if !self.flush_pending_retirement() {
            return;
        }

        while let Ok(cmd) = self.command_rx.as_mut().expect("command consumer").pop() {
            let retired = match cmd {
                GraphCommand::AddEffect(id, plugin_type) => {
                    let instance = match plugin_type.as_str() {
                        "knead" => Some(PluginCore::Knead(KneadEngine::new(self.sample_rate))),
                        _ => {
                            self.midi_rt_diagnostics
                                .record_unsupported_effect_addition(1);
                            None
                        }
                    };
                    if let Some(inst) = instance {
                        if self.effect_id_exists(id) {
                            self.midi_rt_diagnostics.record_effect_id_collision(1);
                            Some(RetiredGraphObjects::effect(ActiveEffect::new(id, inst)))
                        } else {
                            self.effects.push(ActiveEffect::new(id, inst));
                            None
                        }
                    } else {
                        None
                    }
                }
                GraphCommand::RemovePlugin(id) => {
                    self.remove_effect(id).map(RetiredGraphObjects::effect)
                }
                GraphCommand::RemovePluginWithBridge(id) => {
                    RetiredGraphObjects::effect_with_bridge(
                        self.remove_effect(id),
                        self.remove_audio_bridge(id),
                    )
                }
                GraphCommand::SetParam(id, name, value) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        match &mut effect.instance {
                            PluginCore::Knead(engine) => {
                                if !apply_knead_param(engine, &name, value) {
                                    self.midi_rt_diagnostics.record_unmapped_set_param_call(1);
                                }
                            }
                            PluginCore::Native(_) => {
                                // `SetParam` only has a mapped target for the
                                // built-in Knead effect today; a native
                                // plugin's parameters are not routed here.
                                self.midi_rt_diagnostics.record_unmapped_set_param_call(1);
                            }
                        }
                    }
                    None
                }
                GraphCommand::SetBypass(id, bypassed) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        effect.bypassed = bypassed;
                    }
                    None
                }
                GraphCommand::AddPlugin(id, plugin) => {
                    if self.effect_id_exists(id) {
                        self.midi_rt_diagnostics.record_effect_id_collision(1);
                        Some(RetiredGraphObjects::effect(ActiveEffect::new(
                            id,
                            PluginCore::Native(plugin),
                        )))
                    } else {
                        self.effects
                            .push(ActiveEffect::new(id, PluginCore::Native(plugin)));
                        None
                    }
                }
                GraphCommand::AddPluginWithBridge(id, plugin, bridge) => {
                    if self.effect_id_exists(id) {
                        self.midi_rt_diagnostics.record_effect_id_collision(1);
                        RetiredGraphObjects::effect_with_bridge(
                            Some(ActiveEffect::new(id, PluginCore::Native(plugin))),
                            Some(bridge),
                        )
                    } else {
                        self.effects
                            .push(ActiveEffect::new(id, PluginCore::Native(plugin)));
                        self.audio_bridges.push(bridge);
                        None
                    }
                }
                GraphCommand::AddMidiFx(id, fx_kind) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        let fx: Box<dyn MidiFx> = match fx_kind {
                            MidiFxKind::Arpeggiator => Box::new(Arpeggiator::default()),
                            MidiFxKind::VelocityScaler => Box::new(VelocityScaler::default()),
                        };
                        effect.midi_fx.push(fx);
                    }
                    None
                }
                GraphCommand::RemoveMidiFx(id, index) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        if index < effect.midi_fx.len() {
                            Some(RetiredGraphObjects::midi_fx(effect.midi_fx.remove(index)))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                GraphCommand::SetMidiFxParam(id, index, name, value) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        if let Some(fx) = effect.midi_fx.get_mut(index) {
                            fx.set_param(&name, value);
                        }
                    }
                    None
                }
                GraphCommand::SendMidiNote(id, event) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        effect.enqueue_midi(event, &mut self.midi_rt_diagnostics);
                    }
                    None
                }
                GraphCommand::SetTransport(state) => {
                    self.transport = state;
                    None
                }
                #[cfg(test)]
                GraphCommand::RegisterAudioBridge(bridge) => {
                    self.audio_bridges.push(bridge);
                    None
                }
            };

            if let Some(retired) = retired {
                if !self.retire(retired) {
                    return;
                }
            }
        }
    }

    fn effect_id_exists(&self, id: usize) -> bool {
        self.effects.iter().any(|effect| effect.id == id)
    }

    fn remove_effect(&mut self, id: usize) -> Option<ActiveEffect> {
        let index = self.effects.iter().position(|effect| effect.id == id)?;
        Some(self.effects.remove(index))
    }

    fn remove_audio_bridge(&mut self, plugin_id: usize) -> Option<PluginAudioBridge> {
        let index = self
            .audio_bridges
            .iter()
            .position(|bridge| bridge.plugin_id == plugin_id)?;
        Some(self.audio_bridges.remove(index))
    }

    fn flush_pending_retirement(&mut self) -> bool {
        let Some(retired) = self.pending_retirement.take() else {
            return true;
        };

        self.retire(retired)
    }

    fn retire(&mut self, retired: RetiredGraphObjects) -> bool {
        if self.retired_tx.slots() <= 1 {
            self.pending_retirement = Some(retired);
            return false;
        }

        match self.retired_tx.push(retired) {
            Ok(()) => true,
            Err(PushError::Full(retired)) => {
                self.pending_retirement = Some(retired);
                false
            }
        }
    }

    /// Process ring-buffer audio bridges — reads input blocks from main thread,
    /// processes through plugins, writes output back for main thread to return to worklet.
    ///
    /// `callback_frames` is what the device asked for this period. Each bridge
    /// may spend that plus one render quantum of catch-up, so a backlog left
    /// by a main-thread stall is worked off over successive callbacks rather
    /// than rendered in one spike on the thread with the deadline.
    #[inline]
    pub fn process_audio_bridges(&mut self, callback_frames: usize) {
        // A device period the bridge cannot carry would starve every plugin
        // permanently rather than intermittently, so it is counted rather than
        // left to look like ordinary jitter.
        if callback_frames > MAX_CALLBACK_FRAMES {
            self.midi_rt_diagnostics
                .record_callback_frames_over_bridge_reach(1);
        }
        let callback_frames = callback_frames.min(MAX_CALLBACK_FRAMES);
        let frame_budget = callback_frames.saturating_add(RENDER_QUANTUM_FRAMES);
        // Deep enough to cover the device period twice over, plus a quantum of
        // slack either side. Nothing locks the app's IPC cadence to this
        // callback, so the phase between them wanders across a full period;
        // a target of one period would shed on every crossing, and each shed
        // costs the app a quantum of return audio. Two periods absorbs the
        // whole slip. Beyond that is plugin latency the user hears against the
        // rest of the graph, so the target stays proportional to the period
        // rather than growing to the ring's capacity.
        // The clamp keeps the target meaningful: a period that already needs
        // most of the ring cannot also carry twice itself, and a target above
        // what the ring holds would never be crossed, which is the ratchet
        // this shedding exists to stop.
        let blocks_per_period = callback_frames.div_ceil(RENDER_QUANTUM_FRAMES);
        let target_depth_blocks = (blocks_per_period * 2 + 2).min(RING_CAPACITY);

        for bridge in &mut self.audio_bridges {
            let plugin_id = bridge.plugin_id;

            let effect = self
                .effects
                .iter_mut()
                .find(|effect| effect.id == plugin_id);

            // A bridge with no plugin able to process its audio — no effect
            // under that id at all (registered on its own through
            // `RegisterAudioBridge`, or outliving its plugin), or an effect
            // with no bridged path, such as a built-in Knead — used to be left
            // untouched. Its input ring then filled and stayed full, so every
            // later push was refused and the app was left on permanent dry
            // fallback with nothing recorded. Return the blocks untouched
            // instead: the app keeps its audio, the ring keeps moving, and the
            // count says no plugin took them.
            let unprocessable = match effect {
                None => true,
                Some(ref effect) => !matches!(effect.instance, PluginCore::Native(_)),
            };

            if unprocessable {
                let drain =
                    bridge.drain_process(frame_budget, target_depth_blocks, |left, right, n| {
                        let _ = (left, right, n);
                    });
                self.midi_rt_diagnostics
                    .record_unmatched_bridge_blocks(drain.blocks_processed as u64);
                self.midi_rt_diagnostics
                    .record_bridge_output_blocks_dropped(drain.output_blocks_dropped as u64);
                self.midi_rt_diagnostics
                    .record_bridge_backlog_blocks_shed(drain.blocks_shed as u64);
                if let Some(effect) = effect {
                    effect.pending_midi.clear();
                }
                continue;
            }

            let Some(effect) = effect else {
                continue;
            };

            if effect.bypassed {
                // Drain input without processing (passthrough)
                let drain =
                    bridge.drain_process(frame_budget, target_depth_blocks, |left, right, n| {
                        // output = input (already in the block)
                        let _ = (left, right, n);
                    });
                self.midi_rt_diagnostics
                    .record_bridge_output_blocks_dropped(drain.output_blocks_dropped as u64);
                self.midi_rt_diagnostics
                    .record_bridge_backlog_blocks_shed(drain.blocks_shed as u64);
                // A bypassed effect discards incoming MIDI rather than
                // banking it: without this, notes queued via SendMidiNote
                // while bypassed would accumulate toward the fixed
                // 128-slot ceiling and then flush as one stale burst —
                // old note-ons with no note-offs behind them — the
                // instant the effect is un-bypassed.
                effect.pending_midi.clear();
                continue;
            }

            let PluginCore::Native(ref mut plugin) = effect.instance else {
                continue;
            };

            let probability_evaluator = &mut effect.probability_evaluator;
            let midi_fx = &mut effect.midi_fx;
            let pending_midi = &mut effect.pending_midi;
            let transport = self.transport;
            let sample_rate = self.sample_rate;

            let diagnostics = &mut self.midi_rt_diagnostics;
            // The MIDI chain belongs to the callback, not to the block.
            // Several blocks are normally waiting, and running the chain
            // once per block would re-evaluate authored probability and
            // re-emit every queued note once per block — the same note-on
            // delivered to the plugin two, three, four times. It runs on
            // the first block of the pass, the earliest audio in the
            // callback.
            let mut events_delivered = false;

            let drain = bridge.drain_process(
                frame_budget,
                target_depth_blocks,
                |left, right, num_samples| {
                    if events_delivered {
                        plugin.process_bridged_audio(left, right, num_samples);
                        return;
                    }

                    probability_evaluator.process_midi_with_diagnostics(
                        pending_midi,
                        &transport,
                        sample_rate,
                        num_samples,
                        diagnostics,
                    );
                    for fx in midi_fx.iter_mut() {
                        fx.process_midi_with_diagnostics(
                            pending_midi,
                            &transport,
                            sample_rate,
                            num_samples,
                            diagnostics,
                        );
                    }
                    events_delivered = true;

                    if pending_midi.is_empty() {
                        plugin.process_bridged_audio(left, right, num_samples);
                    } else {
                        plugin.process_bridged_with_events(
                            left,
                            right,
                            num_samples,
                            pending_midi.as_slice(),
                            &transport,
                        );
                    }
                },
            );

            // Only clear pending MIDI when the closure actually ran and
            // consumed it. When the input ring was empty this cycle (the
            // CPAL callback beating the worklet's push, guaranteed at
            // bridge startup and on any cadence jitter), the events must
            // survive to the next cycle rather than being dropped.
            if drain.blocks_processed > 0 {
                pending_midi.clear();
            }
            diagnostics.record_bridge_output_blocks_dropped(drain.output_blocks_dropped as u64);
            diagnostics.record_bridge_backlog_blocks_shed(drain.blocks_shed as u64);
        }
    }

    /// Process a block of audio (called by CPAL render callback).
    #[inline]
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        for effect in &mut self.effects {
            // A bridged plugin is driven by `process_audio_bridges` above, from
            // real worklet audio. This standalone chain runs over zeroed
            // scratch, so processing a bridged plugin here would push phantom
            // silence through a stateful plugin (corrupting its tails, envelope
            // followers and delay lines) and emit its output on a second,
            // uncontrolled path straight into the CPAL device buffer.
            //
            // `pending_midi` is deliberately left untouched here: ownership of
            // clearing it belongs entirely to `process_audio_bridges`, which
            // already ran earlier in this same callback and already decided
            // whether to clear (a block was processed) or not (the input ring
            // was empty this cycle, or the effect is bypassed). Clearing again
            // here would wipe out exactly the events `process_audio_bridges`
            // just chose to keep for the next cycle, undoing that fix within
            // the same callback. Accumulation while bypassed or unfed is
            // bounded by the fixed 128-slot buffer itself — `try_push` refuses
            // once full and records `scheduler_event_buffer_overflows` — so
            // leaving it alone is a deliberate, observable tradeoff, not an
            // unbounded leak.
            if self
                .audio_bridges
                .iter()
                .any(|bridge| bridge.plugin_id == effect.id)
            {
                continue;
            }

            if effect.bypassed {
                effect.pending_midi.clear();
                continue;
            }

            effect.probability_evaluator.process_midi_with_diagnostics(
                &mut effect.pending_midi,
                &self.transport,
                self.sample_rate,
                num_samples,
                &mut self.midi_rt_diagnostics,
            );

            // Apply the mutable user MIDI FX chain only after authored probability.
            for fx in &mut effect.midi_fx {
                fx.process_midi_with_diagnostics(
                    &mut effect.pending_midi,
                    &self.transport,
                    self.sample_rate,
                    num_samples,
                    &mut self.midi_rt_diagnostics,
                );
            }

            match &mut effect.instance {
                PluginCore::Knead(engine) => {
                    engine.process_block(left, right);
                }
                PluginCore::Native(plugin) => {
                    if effect.pending_midi.is_empty() {
                        plugin.process_audio(left, right, num_samples);
                    } else {
                        plugin.process_with_events(
                            left,
                            right,
                            num_samples,
                            effect.pending_midi.as_slice(),
                            &self.transport,
                        );
                        effect.pending_midi.clear();
                    }
                }
            }
        }
    }
}

impl Drop for AudioScheduler {
    fn drop(&mut self) {
        while let Ok(command) = self.command_rx.as_mut().expect("command consumer").pop() {
            self.shutdown_commands.push(command);
        }
        let command_rx = self.command_rx.take().expect("command consumer");
        let command_rx = self.retain_command_consumer.then_some(command_rx);
        let retired = RetiredGraphObjects::shutdown(
            self.pending_retirement.take(),
            std::mem::take(&mut self.effects),
            std::mem::take(&mut self.audio_bridges),
            std::mem::take(&mut self.shutdown_commands),
            command_rx,
        );
        if let Err(PushError::Full(retired)) = self.retired_tx.push(retired) {
            debug_assert!(false, "reserved shutdown retirement slot was unavailable");
            std::mem::forget(retired);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::midi_fx::MIDI_EVENT_BUFFER_CAPACITY;
    use rtrb::RingBuffer;
    use std::any::Any;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    };
    use std::thread;

    struct FakeNativePlugin {
        value: f32,
    }

    struct MidiRecordingPlugin {
        received_event_count: Arc<AtomicUsize>,
        received_channel_sum: Arc<AtomicUsize>,
    }

    struct DropTrackingPlugin {
        dropped_tx: mpsc::Sender<thread::ThreadId>,
        panic_on_drop: bool,
    }

    fn drop_tracking_plugin(
        dropped_tx: &mpsc::Sender<thread::ThreadId>,
        panic_on_drop: bool,
    ) -> Box<dyn NativePlugin> {
        Box::new(DropTrackingPlugin {
            dropped_tx: dropped_tx.clone(),
            panic_on_drop,
        })
    }

    fn push_drop_tracking_plugin(
        command_tx: &mut rtrb::Producer<GraphCommand>,
        id: usize,
        dropped_tx: &mpsc::Sender<thread::ThreadId>,
        panic_on_drop: bool,
    ) {
        let plugin = drop_tracking_plugin(dropped_tx, panic_on_drop);
        assert!(command_tx.push(GraphCommand::AddPlugin(id, plugin)).is_ok());
    }

    impl Drop for DropTrackingPlugin {
        fn drop(&mut self) {
            self.dropped_tx
                .send(thread::current().id())
                .expect("drop observer should remain connected");
            if self.panic_on_drop {
                panic!("plugin destructor panic");
            }
        }
    }

    impl NativePlugin for DropTrackingPlugin {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn name(&self) -> &str {
            "drop-tracking-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    impl NativePlugin for FakeNativePlugin {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            for index in 0..num_samples {
                left[index] = self.value;
                right[index] = self.value;
            }
        }

        fn name(&self) -> &str {
            "fake-native-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
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

    fn create_scheduler() -> (
        rtrb::Producer<GraphCommand>,
        AudioScheduler,
        rtrb::Consumer<RetiredGraphObjects>,
    ) {
        let (command_tx, command_rx) = RingBuffer::new(16);
        let (retired_tx, retired_rx) = RingBuffer::new(16);
        let scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
        (command_tx, scheduler, retired_rx)
    }

    fn reclaim_on_background_thread(retired: RetiredGraphObjects) -> thread::ThreadId {
        thread::spawn(move || {
            let thread_id = thread::current().id();
            drop(retired);
            thread_id
        })
        .join()
        .unwrap()
    }

    #[test]
    fn add_plugin_with_bridge_registers_plugin_and_bridge_atomically() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(42);

        assert!(command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .is_ok());
        scheduler.update_graph();

        assert_eq!(scheduler.effects.len(), 1);
        assert_eq!(scheduler.audio_bridges.len(), 1);
        assert_eq!(scheduler.effects[0].id, 42);
        assert_eq!(scheduler.audio_bridges[0].plugin_id, 42);

        // The standalone chain must leave a bridged plugin alone. It runs over
        // zeroed scratch, so processing the plugin here would both corrupt its
        // internal state with phantom silence and write its output into the
        // CPAL device buffer on a path nothing controls.
        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(left, [0.0; 4]);
        assert_eq!(right, [0.0; 4]);
    }

    #[test]
    fn a_bridged_plugin_processes_only_the_audio_that_arrived_over_its_bridge() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(42);

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        // Real worklet audio arrives over the bridge and is processed.
        assert!(handle.push_input(&[0.0; 4], &[0.0; 4]));
        scheduler.process_audio_bridges(512);
        let processed = handle.pop_output().expect("the bridged block");
        assert_eq!(processed.frames, 4);
        assert_eq!(&processed.left[..4], &[0.25; 4]);

        // A standalone callback in the same cycle must not run the plugin a
        // second time over its silent scratch.
        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(left, [0.0; 4]);

        // And an unbridged plugin still runs on the standalone chain, so the
        // guard is scoped to bridged instances rather than disabling the path.
        command_tx
            .push(GraphCommand::AddPlugin(
                7,
                Box::new(FakeNativePlugin { value: 0.5 }),
            ))
            .unwrap();
        scheduler.update_graph();
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(left, [0.5; 4]);
    }

    #[test]
    fn bridged_plugin_midi_survives_a_callback_that_finds_the_input_ring_empty() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(42);
        let received_event_count = Arc::new(AtomicUsize::new(0));
        let received_channel_sum = Arc::new(AtomicUsize::new(0));

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(MidiRecordingPlugin {
                    received_event_count: Arc::clone(&received_event_count),
                    received_channel_sum,
                }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::SendMidiNote(
                42,
                MidiNoteEvent {
                    note: 60,
                    velocity: 100,
                    channel: 0,
                    is_note_on: true,
                    probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                    project_probability_seed: 0,
                    clip_id_hash: 0,
                    event_id_hash: 0,
                    absolute_occurrence_index: 0,
                },
            ))
            .unwrap();
        scheduler.update_graph();

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];

        // Drive both calls in sequence, the way audio_thread.rs's CPAL
        // callback does every cycle: process_audio_bridges() first, then
        // process_block() over the standalone chain's zeroed scratch. The
        // CPAL callback beats the worklet's input push here — the bridge's
        // input ring is empty, so drain_process's closure never runs this
        // cycle — and process_block must not wipe the note that
        // process_audio_bridges deliberately left queued for next cycle.
        scheduler.process_audio_bridges(512);
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(received_event_count.load(Ordering::Relaxed), 0);

        // A later callback: the worklet's audio has now arrived. The note
        // queued on the earlier, empty-ring cycle must still be delivered —
        // an unconditional clear in either process_audio_bridges or
        // process_block would have discarded it forever on the first cycle.
        assert!(handle.push_input(&[0.0; 4], &[0.0; 4]));
        scheduler.process_audio_bridges(512);
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(received_event_count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn a_bypassed_bridged_effect_discards_midi_queued_while_bypassed() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(42);
        let received_event_count = Arc::new(AtomicUsize::new(0));
        let received_channel_sum = Arc::new(AtomicUsize::new(0));

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(MidiRecordingPlugin {
                    received_event_count: Arc::clone(&received_event_count),
                    received_channel_sum,
                }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        command_tx.push(GraphCommand::SetBypass(42, true)).unwrap();
        scheduler.update_graph();

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];

        // Queue MIDI across several callbacks while bypassed. A bypassed
        // effect should discard incoming MIDI, not accumulate it toward the
        // 128-slot ceiling and flush it all the instant it is un-bypassed.
        for note in 60..=65 {
            command_tx
                .push(GraphCommand::SendMidiNote(
                    42,
                    MidiNoteEvent {
                        note,
                        velocity: 100,
                        channel: 0,
                        is_note_on: true,
                        probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                        project_probability_seed: 0,
                        clip_id_hash: 0,
                        event_id_hash: 0,
                        absolute_occurrence_index: 0,
                    },
                ))
                .unwrap();
            scheduler.update_graph();
            assert!(handle.push_input(&[0.0; 4], &[0.0; 4]));
            scheduler.process_audio_bridges(512);
            scheduler.process_block(&mut left, &mut right, 4);
        }

        // Un-bypass and drive a fresh callback: no stale burst of the notes
        // queued during bypass should reach the plugin.
        command_tx.push(GraphCommand::SetBypass(42, false)).unwrap();
        scheduler.update_graph();
        assert!(handle.push_input(&[0.0; 4], &[0.0; 4]));
        scheduler.process_audio_bridges(512);
        scheduler.process_block(&mut left, &mut right, 4);

        assert_eq!(received_event_count.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn one_callback_processes_every_block_the_app_queued_since_the_last_one() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(42);

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        // The device buffer spans several render quanta — a 512-frame CPAL
        // callback at 48 kHz covers four 128-frame worklet quanta — so four
        // blocks are already waiting when the callback runs. Taking one per
        // callback leaves the rest to fill the ring, after which the app's
        // pushes are refused for good and the plugin hears a fraction of its
        // input.
        for _ in 0..4 {
            assert!(handle.push_input(&[0.1; 128], &[0.1; 128]));
        }

        scheduler.process_audio_bridges(512);

        let mut returned = 0;
        while let Some(block) = handle.pop_output() {
            assert_eq!(block.frames, 128);
            assert_eq!(block.left[0], 0.25);
            returned += 1;
        }
        assert_eq!(returned, 4, "a block left in the ring is lost audio");
    }

    #[test]
    fn a_burst_of_blocks_delivers_each_queued_note_to_the_plugin_once() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(42);
        let received_event_count = Arc::new(AtomicUsize::new(0));
        let received_channel_sum = Arc::new(AtomicUsize::new(0));

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(MidiRecordingPlugin {
                    received_event_count: Arc::clone(&received_event_count),
                    received_channel_sum,
                }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::SendMidiNote(
                42,
                MidiNoteEvent {
                    note: 60,
                    velocity: 100,
                    channel: 0,
                    is_note_on: true,
                    probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                    project_probability_seed: 0,
                    clip_id_hash: 0,
                    event_id_hash: 0,
                    absolute_occurrence_index: 0,
                },
            ))
            .unwrap();
        scheduler.update_graph();

        for _ in 0..3 {
            assert!(handle.push_input(&[0.0; 128], &[0.0; 128]));
        }
        scheduler.process_audio_bridges(512);

        // The MIDI queue belongs to the callback, not to the block. Running
        // the chain once per drained block would hand the plugin the same
        // note-on three times — three stacked voices from one key press.
        assert_eq!(received_event_count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn blocks_on_a_bridge_with_no_plugin_are_returned_and_counted() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(77);

        command_tx
            .push(GraphCommand::RegisterAudioBridge(bridge))
            .unwrap();
        scheduler.update_graph();
        assert!(scheduler.effects.is_empty());

        // Fill the input ring the way a running worklet does.
        let mut pushed = 0;
        while handle.push_input(&[0.4; 64], &[0.4; 64]) {
            pushed += 1;
        }
        assert!(pushed > 0);

        // Successive callbacks, each spending its own budget.
        let mut returned = 0;
        for _ in 0..pushed {
            scheduler.process_audio_bridges(512);
            while let Some(block) = handle.pop_output() {
                assert_eq!(block.left[0], 0.4, "an unprocessed block must be intact");
                returned += 1;
            }
        }

        // A ring filled to capacity is deeper than the device period needs, so
        // the oldest blocks are shed to bring the round trip back to its
        // target. Every block is accounted for: returned or shed, none left
        // sitting in a ring that never drains again.
        let snapshot = scheduler.midi_rt_diagnostics.snapshot();
        assert_eq!(
            returned as u64 + snapshot.bridge_backlog_blocks_shed,
            pushed as u64
        );
        assert_eq!(snapshot.unmatched_bridge_blocks, pushed as u64);

        // The ring keeps moving. Skipping the bridge left it full forever, so
        // every later push was refused and the app never processed again.
        assert!(handle.push_input(&[0.4; 64], &[0.4; 64]));
    }

    #[test]
    fn remove_plugin_with_bridge_removes_plugin_and_bridge_atomically() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(42);

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::RemovePluginWithBridge(42))
            .unwrap();
        scheduler.update_graph();

        assert!(scheduler.effects.is_empty());
        assert!(scheduler.audio_bridges.is_empty());
        let retired = retired_rx.pop().expect("plugin and bridge retirement");
        assert!(retired.effect.is_some());
        assert!(retired.audio_bridge.is_some());
    }

    #[test]
    fn saturated_queue_reserves_shutdown_retirement_off_the_callback_thread() {
        let (mut command_tx, command_rx) = RingBuffer::new(16);
        let (retired_tx, mut retired_rx) = RingBuffer::new(2);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
        scheduler.retain_command_consumer = true;
        let (dropped_tx, dropped_rx) = mpsc::channel();
        for id in [41, 42, 43] {
            push_drop_tracking_plugin(&mut command_tx, id, &dropped_tx, id != 41);
        }
        scheduler.update_graph();
        command_tx
            .push(GraphCommand::AddMidiFx(43, MidiFxKind::VelocityScaler))
            .unwrap();
        command_tx.push(GraphCommand::RemoveMidiFx(43, 0)).unwrap();
        for id in [41, 42] {
            command_tx.push(GraphCommand::RemovePlugin(id)).unwrap();
        }
        push_drop_tracking_plugin(&mut command_tx, 44, &dropped_tx, false);
        scheduler.update_graph();
        drop(scheduler);
        push_drop_tracking_plugin(&mut command_tx, 45, &dropped_tx, false);
        drop(command_tx);
        assert_eq!(dropped_rx.try_recv(), Err(mpsc::TryRecvError::Empty));
        let live_reclaimer =
            reclaim_on_background_thread(retired_rx.pop().expect("live retirement"));
        let shutdown_reclaimer =
            reclaim_on_background_thread(retired_rx.pop().expect("shutdown retirement"));
        for _ in 0..5 {
            let thread_id = dropped_rx.recv().unwrap();
            assert!(thread_id == live_reclaimer || thread_id == shutdown_reclaimer);
        }
    }

    #[test]
    fn add_plugin_with_a_colliding_id_is_rejected_and_does_not_duplicate_the_effect() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, "knead".to_string()))
            .unwrap();
        scheduler.update_graph();
        assert_eq!(scheduler.effects.len(), 1);

        let (dropped_tx, _dropped_rx) = mpsc::channel();
        push_drop_tracking_plugin(&mut command_tx, 7, &dropped_tx, false);
        scheduler.update_graph();

        // The colliding plugin must not create a second entry sharing id 7 —
        // that second entry is exactly what would let SetParam/SetBypass/
        // SendMidiNote misroute to whichever one `.find` reaches first.
        assert_eq!(scheduler.effects.len(), 1);
        match &scheduler.effects[0].instance {
            PluginCore::Knead(_) => {}
            PluginCore::Native(_) => panic!("existing effect must not be displaced"),
        }
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .effect_id_collisions,
            1
        );
    }

    #[test]
    fn add_plugin_with_bridge_with_a_colliding_id_retires_both_without_inserting() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, "knead".to_string()))
            .unwrap();
        scheduler.update_graph();

        let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(7);
        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                7,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.effects.len(), 1);
        assert!(scheduler.audio_bridges.is_empty());
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .effect_id_collisions,
            1
        );
        let retired = retired_rx.pop().expect("the rejected plugin and bridge");
        assert!(retired.effect.is_some());
        assert!(retired.audio_bridge.is_some());
    }

    #[test]
    fn set_param_maps_known_names_onto_the_knead_engine_and_diagnoses_unknown_ones() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, "knead".to_string()))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::SetParam(
                7,
                "shift_semitones".to_string(),
                3.0,
            ))
            .unwrap();
        scheduler.update_graph();

        match &scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(engine.shift_semitones, 3.0),
            PluginCore::Native(_) => panic!("expected the knead effect"),
        }

        command_tx
            .push(GraphCommand::SetParam(
                7,
                "not_a_real_param".to_string(),
                1.0,
            ))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unmapped_set_param_calls,
            1
        );
    }

    #[test]
    fn add_effect_with_an_unsupported_plugin_type_is_diagnosed_not_silently_dropped() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, "not-a-real-effect".to_string()))
            .unwrap();
        scheduler.update_graph();

        assert!(scheduler.effects.is_empty());
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unsupported_effect_additions,
            1
        );
    }

    #[test]
    fn probability_zero_is_gated_before_arpeggiation() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
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
            .unwrap();
        command_tx
            .push(GraphCommand::AddMidiFx(7, MidiFxKind::Arpeggiator))
            .unwrap();
        // The arp is silent while the transport is stopped; without this the
        // zero-event assertion would hold even with the probability gate broken.
        command_tx
            .push(GraphCommand::SetTransport(TransportState {
                is_playing: true,
                ..TransportState::default()
            }))
            .unwrap();
        command_tx
            .push(GraphCommand::SendMidiNote(
                7,
                MidiNoteEvent {
                    note: 60,
                    velocity: 100,
                    channel: 0,
                    is_note_on: true,
                    probability_cutoff: 0,
                    project_probability_seed: 0,
                    clip_id_hash: 0,
                    event_id_hash: 0,
                    absolute_occurrence_index: 0,
                },
            ))
            .unwrap();

        scheduler.update_graph();

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);

        assert_eq!(received_event_count.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn probability_evaluator_is_inline_and_uses_no_dynamic_chain_capacity() {
        let effect = ActiveEffect::new(
            7,
            PluginCore::Native(Box::new(FakeNativePlugin { value: 0.25 })),
        );

        assert_eq!(std::mem::size_of::<ProbabilityEvaluator>(), 0);
        assert_eq!(effect.midi_fx.len(), 0);
        assert_eq!(effect.midi_fx.capacity(), 0);
    }

    #[test]
    fn send_midi_note_drops_newest_events_after_fixed_capacity() {
        let midi_capacity = MIDI_EVENT_BUFFER_CAPACITY;
        let (mut command_tx, command_rx) = RingBuffer::new(256);
        let (retired_tx, _retired_rx) = RingBuffer::new(256);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
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
            .unwrap();

        for channel in 0..=midi_capacity {
            command_tx
                .push(GraphCommand::SendMidiNote(
                    7,
                    MidiNoteEvent {
                        note: 60,
                        velocity: 100,
                        channel: channel as i16,
                        is_note_on: true,
                        probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                        project_probability_seed: 0,
                        clip_id_hash: 0,
                        event_id_hash: 0,
                        absolute_occurrence_index: 0,
                    },
                ))
                .unwrap();
        }

        scheduler.update_graph();

        assert_eq!(scheduler.effects[0].pending_midi.capacity(), midi_capacity);
        assert_eq!(scheduler.effects[0].pending_midi.len(), midi_capacity);

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);

        assert_eq!(received_event_count.load(Ordering::Relaxed), midi_capacity);
        assert_eq!(
            received_channel_sum.load(Ordering::Relaxed),
            (midi_capacity - 1) * midi_capacity / 2
        );
        assert!(scheduler.effects[0].pending_midi.is_empty());
    }
}
