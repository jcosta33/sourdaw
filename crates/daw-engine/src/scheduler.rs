//! Lock-free Messaging and Task Schedule for Native CPAL engine.
//!
//! Handles both built-in DSP effects (Knead) and external plugins (CLAP/VST3)
//! via the NativePlugin trait. All communication is lock-free via rtrb.

use rtrb::Consumer;
use daw_dsp::knead::engine::KneadEngine;
use crate::plugin_slot::{NativePlugin, MidiNoteEvent, TransportState};
use crate::audio_bridge::PluginAudioBridge;

/// Commands sent from the UI/main thread to the audio thread (lock-free via rtrb).
pub enum GraphCommand {
    // Built-in effects
    AddEffect(usize, String),
    RemoveEffect(usize),
    SetParam(usize, String, f32),
    SetBypass(usize, bool),

    // External plugins (CLAP/VST3/AU)
    AddPlugin(usize, Box<dyn NativePlugin>),
    RemovePlugin(usize),
    SetPluginParam(usize, u32, f64),

    // MIDI events (routed to a specific plugin by ID)
    SendMidiNote(usize, MidiNoteEvent),

    // Transport state (global, affects all plugins)
    SetTransport(TransportState),

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
    /// Pending MIDI events for this block (drained each process_block call).
    pending_midi: Vec<MidiNoteEvent>,
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
            effects: Vec::new(),
            audio_bridges: Vec::new(),
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
                        "knead" => Some(PluginCore::Knead(KneadEngine::new(self.sample_rate))),
                        _ => None,
                    };
                    if let Some(inst) = instance {
                        self.effects.push(ActiveEffect {
                            id, instance: inst, bypassed: false, pending_midi: Vec::new(),
                        });
                    }
                }
                GraphCommand::RemoveEffect(id) | GraphCommand::RemovePlugin(id) => {
                    self.effects.retain(|e| e.id != id);
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
                    self.effects.push(ActiveEffect {
                        id,
                        instance: PluginCore::Native(plugin),
                        bypassed: false,
                        pending_midi: Vec::new(),
                    });
                }
                GraphCommand::SetPluginParam(id, param_id, value) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        if let PluginCore::Native(ref mut plugin) = effect.instance {
                            plugin.set_param(param_id, value);
                        }
                    }
                }
                GraphCommand::SendMidiNote(id, event) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        effect.pending_midi.push(event);
                    }
                }
                GraphCommand::SetTransport(state) => {
                    self.transport = state;
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
                    let midi = &effect.pending_midi;
                    let transport = &self.transport;

                    bridge.try_process(|left, right, num_samples| {
                        if midi.is_empty() {
                            plugin.process_audio(left, right, num_samples);
                        } else {
                            plugin.process_with_events(left, right, num_samples, midi, transport);
                        }
                    });

                    effect.pending_midi.clear();
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
            match &mut effect.instance {
                PluginCore::Knead(engine) => {
                    engine.process_analysis_frame(left);
                }
                PluginCore::Native(plugin) => {
                    if effect.pending_midi.is_empty() {
                        plugin.process_audio(left, right, num_samples);
                    } else {
                        plugin.process_with_events(
                            left, right, num_samples,
                            &effect.pending_midi,
                            &self.transport,
                        );
                        effect.pending_midi.clear();
                    }
                }
            }
        }
    }
}
