pub mod audio_bridge;
pub mod audio_thread;
pub mod plugin_slot;
pub mod scheduler;

use audio_thread::{spawn_audio_thread, AudioThreadHandle};
use plugin_slot::NativePlugin;
use rtrb::{Producer, RingBuffer};
use scheduler::GraphCommand;
use std::sync::{Arc, Mutex};

pub struct EngineHandle {
    command_tx: Producer<GraphCommand>,
    _audio_thread: Arc<Mutex<AudioThreadHandle>>,
    next_plugin_id: usize,
}

impl EngineHandle {
    /// Boot the native audio engine (spawns CPAL stream).
    pub fn new() -> Result<Self, String> {
        let (tx, rx) = RingBuffer::new(256);
        let thread_handle = spawn_audio_thread(rx)?;

        Ok(Self {
            command_tx: tx,
            _audio_thread: Arc::new(Mutex::new(thread_handle)),
            next_plugin_id: 1000, // Start high to avoid collision with effect IDs
        })
    }

    /// Add a built-in effect to the native rendering graph.
    pub fn add_effect(&mut self, id: usize, plugin_type: &str) -> Result<(), String> {
        self.command_tx
            .push(GraphCommand::AddEffect(id, plugin_type.to_string()))
            .map_err(|_| "Audio command queue full".to_string())
    }

    /// Update an effect parameter natively.
    pub fn set_effect_param(&mut self, id: usize, param: &str, value: f32) -> Result<(), String> {
        self.command_tx
            .push(GraphCommand::SetParam(id, param.to_string(), value))
            .map_err(|_| "Audio command queue full".to_string())
    }

    /// Add a native plugin (CLAP/VST3) to the audio thread's processing chain.
    /// Returns the assigned plugin ID for future reference.
    pub fn add_plugin(&mut self, plugin: Box<dyn NativePlugin>) -> Result<usize, String> {
        let id = self.next_plugin_id;
        self.next_plugin_id += 1;
        self.command_tx
            .push(GraphCommand::AddPlugin(id, plugin))
            .map_err(|_| "Audio command queue full".to_string())?;
        Ok(id)
    }

    /// Remove a native plugin from the audio thread.
    pub fn remove_plugin(&mut self, id: usize) -> Result<(), String> {
        self.command_tx
            .push(GraphCommand::RemovePlugin(id))
            .map_err(|_| "Audio command queue full".to_string())
    }

    /// Set a parameter on a native plugin (lock-free, from any thread).
    pub fn set_plugin_param(&mut self, id: usize, param_id: u32, value: f64) -> Result<(), String> {
        self.command_tx
            .push(GraphCommand::SetPluginParam(id, param_id, value))
            .map_err(|_| "Audio command queue full".to_string())
    }

    /// Send a MIDI note event to a specific plugin (lock-free).
    pub fn send_midi_note(
        &mut self,
        plugin_id: usize,
        event: plugin_slot::MidiNoteEvent,
    ) -> Result<(), String> {
        self.command_tx
            .push(GraphCommand::SendMidiNote(plugin_id, event))
            .map_err(|_| "Audio command queue full".to_string())
    }

    /// Update the global transport state (lock-free).
    pub fn set_transport(&mut self, state: plugin_slot::TransportState) -> Result<(), String> {
        self.command_tx
            .push(GraphCommand::SetTransport(state))
            .map_err(|_| "Audio command queue full".to_string())
    }

    /// Create and register a ring-buffer audio bridge for a plugin.
    /// Returns the handle that the main thread uses to push/pop audio blocks.
    pub fn create_audio_bridge(
        &mut self,
        plugin_id: usize,
    ) -> Result<audio_bridge::PluginAudioBridgeHandle, String> {
        let (bridge, handle) = audio_bridge::create_audio_bridge(plugin_id);
        self.command_tx
            .push(GraphCommand::RegisterAudioBridge(bridge))
            .map_err(|_| "Audio command queue full".to_string())?;
        Ok(handle)
    }
}
