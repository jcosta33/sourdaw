//! Lock-free Messaging and Task Schedule for Native CPAL engine.

use std::sync::Arc;
use rtrb::{Consumer, Producer, RingBuffer};
use daw_dsp::knead::engine::KneadEngine;

pub enum GraphCommand {
    /// Add an effect to the end of the processing chain.
    AddEffect(usize, String), // id, plugin_type
    /// Remove an effect by ID.
    RemoveEffect(usize),
    /// Set a parameter on a specific effect ID.
    SetParam(usize, String, f32), // id, param_name, value
    /// Set bypass state on a specific effect ID.
    SetBypass(usize, bool),
}

pub enum PluginCore {
    Knead(KneadEngine),
}

pub struct ActiveEffect {
    pub id: usize,
    pub instance: PluginCore,
}

pub struct AudioScheduler {
    pub effects: Vec<ActiveEffect>,
    pub command_rx: Consumer<GraphCommand>,
    pub sample_rate: f32,
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
                        self.effects.push(ActiveEffect { id, instance: inst });
                    }
                }
                GraphCommand::RemoveEffect(id) => {
                    self.effects.retain(|e| e.id != id);
                }
                GraphCommand::SetParam(id, name, value) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        // TODO: Map string parameters to methods
                    }
                }
                GraphCommand::SetBypass(id, bypassed) => {
                    // TODO: implement bypass natively
                }
            }
        }
    }

    /// Process a block of audio (called by CPAL render callback).
    #[inline]
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], frames: usize) {
        // Iterate contiguous cache-local effects chain
        for effect in &mut self.effects {
            // Process block internally mutates the audio frames in place
            match &mut effect.instance {
                PluginCore::Knead(engine) => {
                    // Knead processes mono input on left channel natively
                    engine.process_analysis_frame(left);
                }
            }
        }
    }
}
