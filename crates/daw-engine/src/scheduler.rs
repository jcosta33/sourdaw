//! Lock-free Messaging and Task Schedule for Native CPAL engine.
//!
//! Handles both built-in DSP effects (Knead) and external plugins (CLAP/VST3)
//! via the NativePlugin trait. All communication is lock-free via rtrb.

use crate::audio_bridge::PluginAudioBridge;
use crate::midi_fx::{Arpeggiator, MidiEventBuffer, MidiFx, VelocityScaler};
use crate::plugin_slot::{MidiNoteEvent, NativePlugin, TransportState};
use daw_core::tuning::TuningTable;
use daw_dsp::knead::engine::KneadEngine;
use rtrb::Consumer;
use triple_buffer::Output;

/// Commands sent from the UI/main thread to the audio thread (lock-free via rtrb).
pub enum GraphCommand {
    // Built-in effects
    AddEffect(usize, String),
    RemoveEffect(usize),
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
    AddMidiFx(usize, String),
    RemoveMidiFx(usize, usize), // effect_id, fx_index
    SetMidiFxParam(usize, usize, String, f32),

    // Transport state (global, affects all plugins)
    SetTransport(TransportState),

    // Tuning system
    RegisterTuning(usize, Output<TuningTable>),

    // Ring buffer audio bridge
    RegisterAudioBridge(PluginAudioBridge),
    UnregisterAudioBridge(usize),
}

enum PluginCore {
    Knead(KneadEngine),
    Native(Box<dyn NativePlugin>),
}

struct ActiveEffect {
    id: usize,
    instance: PluginCore,
    bypassed: bool,
    midi_fx: Vec<Box<dyn MidiFx>>,
    /// Pending MIDI events for this block (drained each process_block call).
    pending_midi: MidiEventBuffer,
}

impl ActiveEffect {
    fn new(id: usize, instance: PluginCore) -> Self {
        Self {
            id,
            instance,
            bypassed: false,
            midi_fx: Vec::new(),
            pending_midi: MidiEventBuffer::new(),
        }
    }

    #[inline]
    fn enqueue_midi(&mut self, event: MidiNoteEvent) {
        // Drop the newest event when the fixed block-local buffer is full.
        let _ = self.pending_midi.try_push(event);
    }
}

pub struct AudioScheduler {
    effects: Vec<ActiveEffect>,
    audio_bridges: Vec<PluginAudioBridge>,
    command_rx: Consumer<GraphCommand>,
    sample_rate: f32,
    transport: TransportState,
}

impl AudioScheduler {
    pub fn new(command_rx: Consumer<GraphCommand>, sample_rate: f32) -> Self {
        Self {
            effects: Vec::with_capacity(128),
            audio_bridges: Vec::with_capacity(128),
            command_rx,
            sample_rate,
            transport: TransportState::default(),
        }
    }

    /// Process pending UI commands lock-free on the audio thread.
    #[inline]
    pub fn update_graph(&mut self) {
        while let Ok(cmd) = self.command_rx.pop() {
            match cmd {
                GraphCommand::AddEffect(id, plugin_type) => {
                    let instance = match plugin_type.as_str() {
                        "knead" => {
                            Some(PluginCore::Knead(KneadEngine::new(self.sample_rate)))
                        }
                        _ => None,
                    };
                    if let Some(inst) = instance {
                        self.effects.push(ActiveEffect::new(id, inst));
                    }
                }
                GraphCommand::RemoveEffect(id) | GraphCommand::RemovePlugin(id) => {
                    self.effects.retain(|e| e.id != id);
                }
                GraphCommand::RemovePluginWithBridge(id) => {
                    self.effects.retain(|e| e.id != id);
                    self.audio_bridges.retain(|b| b.plugin_id != id);
                }
                GraphCommand::SetParam(id, _name, _value) => {
                    if let Some(_effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        // TODO: Map string parameters to Knead methods
                    }
                }
                GraphCommand::SetBypass(id, bypassed) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        effect.bypassed = bypassed;
                    }
                }
                GraphCommand::AddPlugin(id, plugin) => {
                    self.effects
                        .push(ActiveEffect::new(id, PluginCore::Native(plugin)));
                }
                GraphCommand::AddPluginWithBridge(id, plugin, bridge) => {
                    self.effects
                        .push(ActiveEffect::new(id, PluginCore::Native(plugin)));
                    self.audio_bridges.push(bridge);
                }
                GraphCommand::AddMidiFx(id, fx_type) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        let fx: Option<Box<dyn MidiFx>> = match fx_type.as_str() {
                            "arp" => Some(Box::new(Arpeggiator::default())),
                            "velocity" => Some(Box::new(VelocityScaler::default())),
                            _ => None,
                        };
                        if let Some(instance) = fx {
                            effect.midi_fx.push(instance);
                        }
                    }
                }
                GraphCommand::RemoveMidiFx(id, index) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        if index < effect.midi_fx.len() {
                            effect.midi_fx.remove(index);
                        }
                    }
                }
                GraphCommand::SetMidiFxParam(id, index, name, value) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        if let Some(fx) = effect.midi_fx.get_mut(index) {
                            fx.set_param(&name, value);
                        }
                    }
                }
                GraphCommand::SendMidiNote(id, event) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        effect.enqueue_midi(event);
                    }
                }
                GraphCommand::SetTransport(state) => {
                    self.transport = state;
                }
                GraphCommand::RegisterTuning(_id, _output) => {
                    // The current KneadEngine contract does not expose a tuning input.
                }
                GraphCommand::RegisterAudioBridge(bridge) => {
                    self.audio_bridges.push(bridge);
                }
                GraphCommand::UnregisterAudioBridge(plugin_id) => {
                    self.audio_bridges.retain(|b| b.plugin_id != plugin_id);
                }
            }
        }
    }

    /// Process ring-buffer audio bridges — reads input blocks from main thread,
    /// processes through plugins, writes output back for main thread to return to worklet.
    #[inline]
    pub fn process_audio_bridges(&mut self) {
        for bridge in &mut self.audio_bridges {
            let plugin_id = bridge.plugin_id;

            // Find the matching plugin
            if let Some(effect) = self.effects.iter_mut().find(|e| e.id == plugin_id) {
                if effect.bypassed {
                    // Drain input without processing (passthrough)
                    bridge.try_process(|left, right, n| {
                        // output = input (already in the block)
                        let _ = (left, right, n);
                    });
                    continue;
                }

                if let PluginCore::Native(ref mut plugin) = effect.instance {
                    let midi_fx = &mut effect.midi_fx;
                    let pending_midi = &mut effect.pending_midi;
                    let transport = self.transport;
                    let sample_rate = self.sample_rate;

                    bridge.try_process(|left, right, num_samples| {
                        for fx in midi_fx.iter_mut() {
                            fx.process_midi(pending_midi, &transport, sample_rate, num_samples);
                        }

                        if pending_midi.is_empty() {
                            plugin.process_audio(left, right, num_samples);
                        } else {
                            plugin.process_with_events(
                                left,
                                right,
                                num_samples,
                                pending_midi.as_slice(),
                                &transport,
                            );
                        }
                    });

                    pending_midi.clear();
                }
            }
        }
    }

    /// Process a block of audio (called by CPAL render callback).
    #[inline]
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        for effect in &mut self.effects {
            if effect.bypassed {
                effect.pending_midi.clear();
                continue;
            }

            // Apply MIDI FX chain before processing
            for fx in &mut effect.midi_fx {
                fx.process_midi(
                    &mut effect.pending_midi,
                    &self.transport,
                    self.sample_rate,
                    num_samples,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::midi_fx::MIDI_EVENT_BUFFER_CAPACITY;
    use rtrb::RingBuffer;
    use std::any::Any;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    struct FakeNativePlugin {
        value: f32,
    }

    struct MidiRecordingPlugin {
        received_event_count: Arc<AtomicUsize>,
        received_channel_sum: Arc<AtomicUsize>,
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

    fn create_scheduler() -> (rtrb::Producer<GraphCommand>, AudioScheduler) {
        let (command_tx, command_rx) = RingBuffer::new(16);
        let scheduler = AudioScheduler::new(command_rx, 48_000.0);

        (command_tx, scheduler)
    }

    #[test]
    fn add_plugin_with_bridge_registers_plugin_and_bridge_atomically() {
        let (mut command_tx, mut scheduler) = create_scheduler();
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

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(left, [0.25; 4]);
        assert_eq!(right, [0.25; 4]);
    }

    #[test]
    fn remove_plugin_with_bridge_removes_plugin_and_bridge_atomically() {
        let (mut command_tx, mut scheduler) = create_scheduler();
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
    }

    #[test]
    fn send_midi_note_drops_newest_events_after_fixed_capacity() {
        let midi_capacity = MIDI_EVENT_BUFFER_CAPACITY;
        let (mut command_tx, command_rx) = RingBuffer::new(256);
        let mut scheduler = AudioScheduler::new(command_rx, 48_000.0);
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
                        probability: 1.0,
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

        assert_eq!(
            received_event_count.load(Ordering::Relaxed),
            midi_capacity
        );
        assert_eq!(
            received_channel_sum.load(Ordering::Relaxed),
            (midi_capacity - 1) * midi_capacity / 2
        );
        assert!(scheduler.effects[0].pending_midi.is_empty());
    }
}
