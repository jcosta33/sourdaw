pub mod audio_bridge;
pub mod audio_thread;
pub mod engine_events;
pub mod midi;
pub mod midi_fx;
pub mod plugin_slot;
pub mod scheduler;

use audio_thread::{spawn_audio_thread_with_diagnostics, AudioThreadHandle};
use engine_events::{engine_event_channel, EngineEvent};
use midi::diagnostics::{
    active_midi_rt_diagnostics_channel, ActiveMidiRtDiagnosticsReader,
    ActiveMidiRtDiagnosticsSnapshot,
};
use plugin_slot::NativePlugin;
use rtrb::{Consumer, Producer, RingBuffer};
use scheduler::GraphCommand;

pub struct EngineHandle {
    command_tx: Producer<GraphCommand>,
    _audio_thread: AudioThreadHandle,
    next_plugin_id: usize,
    midi_rt_diagnostics: ActiveMidiRtDiagnosticsReader,
    engine_events: Consumer<EngineEvent>,
}

impl EngineHandle {
    /// Boot the native audio engine (spawns CPAL stream).
    pub fn new() -> Result<Self, String> {
        let (tx, rx) = RingBuffer::new(256);
        let (diagnostics_tx, diagnostics_reader) = active_midi_rt_diagnostics_channel();
        let (engine_event_tx, engine_event_rx) = engine_event_channel();
        let thread_handle =
            spawn_audio_thread_with_diagnostics(rx, diagnostics_tx, engine_event_tx)?;

        Ok(Self {
            command_tx: tx,
            _audio_thread: thread_handle,
            next_plugin_id: 1000, // Start high to avoid collision with effect IDs
            midi_rt_diagnostics: diagnostics_reader,
            engine_events: engine_event_rx,
        })
    }

    /// Read the latest fixed numeric MIDI diagnostics outside the audio callback.
    pub fn midi_rt_diagnostics_snapshot(&mut self) -> ActiveMidiRtDiagnosticsSnapshot {
        self.midi_rt_diagnostics.snapshot()
    }

    /// Take every engine event published since the last drain.
    ///
    /// Consuming, not peeking: an event reported once is reported once. This
    /// runs on the control side, never in the audio callback, so allocating the
    /// `Vec` here is safe.
    pub fn drain_engine_events(&mut self) -> Vec<EngineEvent> {
        engine_events::drain_engine_events(&mut self.engine_events)
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
        let id = self.reserve_plugin_id();
        self.add_plugin_with_id(id, plugin)?;
        Ok(id)
    }

    /// Reserve a native plugin ID before all runtime-side state is registered.
    pub fn reserve_plugin_id(&mut self) -> usize {
        let id = self.next_plugin_id;
        self.next_plugin_id += 1;
        id
    }

    /// Add a native plugin with an already reserved plugin ID.
    pub fn add_plugin_with_id(
        &mut self,
        id: usize,
        plugin: Box<dyn NativePlugin>,
    ) -> Result<(), String> {
        self.command_tx
            .push(GraphCommand::AddPlugin(id, plugin))
            .map_err(|_| "Audio command queue full".to_string())
    }

    /// Add a native plugin and its audio bridge with one scheduler command.
    pub fn add_plugin_with_bridge(
        &mut self,
        id: usize,
        plugin: Box<dyn NativePlugin>,
        bridge: audio_bridge::PluginAudioBridge,
    ) -> Result<(), String> {
        self.command_tx
            .push(GraphCommand::AddPluginWithBridge(id, plugin, bridge))
            .map_err(|_| "Audio command queue full".to_string())
    }

    /// Remove a native plugin from the audio thread.
    pub fn remove_plugin(&mut self, id: usize) -> Result<(), String> {
        self.command_tx
            .push(GraphCommand::RemovePluginWithBridge(id))
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
