//! Lock-free Messaging and Task Schedule for Native CPAL engine.
//!
//! Handles both built-in DSP effects (Knead) and external plugins (CLAP/VST3)
//! via the NativePlugin trait. All communication is lock-free via rtrb.

use rtrb::Consumer;
use daw_dsp::knead::engine::KneadEngine;
use crate::plugin_slot::NativePlugin;

/// Commands sent from the UI/main thread to the audio thread (lock-free via rtrb).
pub enum GraphCommand {
    // Built-in effects
    AddEffect(usize, String),
    RemoveEffect(usize),
    SetParam(usize, String, f32),
    SetBypass(usize, bool),

    // External plugins (CLAP/VST3/AU)
    /// Add a native plugin to the processing chain.
    /// The Box<dyn NativePlugin> is moved to the audio thread — no sharing.
    AddPlugin(usize, Box<dyn NativePlugin>),
    /// Remove a native plugin by ID.
    RemovePlugin(usize),
    /// Set a parameter on a native plugin (param_id, value).
    SetPluginParam(usize, u32, f64),
}

enum PluginCore {
    Knead(KneadEngine),
    Native(Box<dyn NativePlugin>),
}

struct ActiveEffect {
    id: usize,
    instance: PluginCore,
    bypassed: bool,
}

pub struct AudioScheduler {
    effects: Vec<ActiveEffect>,
    command_rx: Consumer<GraphCommand>,
    sample_rate: f32,
}

impl AudioScheduler {
    pub fn new(command_rx: Consumer<GraphCommand>, sample_rate: f32) -> Self {
        Self {
            effects: Vec::new(),
            command_rx,
            sample_rate,
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
                        self.effects.push(ActiveEffect { id, instance: inst, bypassed: false });
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
                    });
                }
                GraphCommand::SetPluginParam(id, param_id, value) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        if let PluginCore::Native(ref mut plugin) = effect.instance {
                            plugin.set_param(param_id, value);
                        }
                    }
                }
            }
        }
    }

    /// Process a block of audio (called by CPAL render callback).
    #[inline]
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        for effect in &mut self.effects {
            if effect.bypassed {
                continue;
            }
            match &mut effect.instance {
                PluginCore::Knead(engine) => {
                    engine.process_analysis_frame(left);
                }
                PluginCore::Native(plugin) => {
                    plugin.process_audio(left, right, num_samples);
                }
            }
        }
    }
}
