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

/// Run a start attempt, and on failure run it once more with the negotiated
/// buffer period dropped, reporting both failures when neither attempt worked.
///
/// A negotiated `BufferSize::Fixed` request reaches backend code a
/// `BufferSize::Default` request never runs — CoreAudio configures the device
/// period only for a `Fixed` request, and ALSA validates it against a separate
/// `hw_params` clone — so a build can fail for the requested period alone.
/// Failing outright there would leave the user with no engine at all, strictly
/// worse than the unnegotiated period the engine ran on before, so the second
/// attempt drops the request.
///
/// Generic over the attempt rather than written inline in [`EngineHandle::new`]
/// so this control flow — one attempt on success, two on failure, both errors in
/// the merged message — is testable without an audio device.
fn spawn_with_fallback<T>(mut spawn: impl FnMut(bool) -> Result<T, String>) -> Result<T, String> {
    match spawn(false) {
        Ok(handle) => Ok(handle),
        Err(negotiated_error) => spawn(true).map_err(|default_error| {
            format!(
                "{negotiated_error} (retrying with the device default period also failed: {default_error})"
            )
        }),
    }
}

pub struct EngineHandle {
    command_tx: Producer<GraphCommand>,
    _audio_thread: AudioThreadHandle,
    next_plugin_id: usize,
    midi_rt_diagnostics: ActiveMidiRtDiagnosticsReader,
    engine_events: Consumer<EngineEvent>,
}

impl EngineHandle {
    /// Boot the native audio engine (spawns CPAL stream).
    ///
    /// Two attempts, the second without the negotiated buffer period — see
    /// [`spawn_with_fallback`] for why the retry exists and what it reports.
    pub fn new() -> Result<Self, String> {
        spawn_with_fallback(Self::spawn)
    }

    /// Start the audio thread against a freshly built set of channels.
    ///
    /// Every channel is rebuilt per attempt because a failed stream build
    /// consumes the ends it was given: the command consumer went into the
    /// scheduler, the scheduler and the event producer went into the cpal
    /// callbacks, and cpal drops those callbacks along with the stream it could
    /// not build. Reusing the producers held here would leave them writing to
    /// ends that no longer exist. `EngineHandle` is the only place that owns
    /// both halves of all three channels, which is why the retry lives here
    /// rather than inside `spawn_audio_thread`.
    fn spawn(force_default_buffer: bool) -> Result<Self, String> {
        let (tx, rx) = RingBuffer::new(256);
        let (diagnostics_tx, diagnostics_reader) = active_midi_rt_diagnostics_channel();
        let (engine_event_tx, engine_event_rx) = engine_event_channel();
        let thread_handle = spawn_audio_thread_with_diagnostics(
            rx,
            diagnostics_tx,
            engine_event_tx,
            force_default_buffer,
        )?;

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

#[cfg(test)]
mod tests {
    use super::spawn_with_fallback;
    use std::cell::RefCell;

    #[test]
    fn a_start_that_negotiates_its_period_is_the_only_attempt_made() {
        let requests = RefCell::new(Vec::new());

        let started = spawn_with_fallback(|force_default_buffer| {
            requests.borrow_mut().push(force_default_buffer);
            Ok::<&str, String>("engine on the negotiated period")
        });

        assert_eq!(started, Ok("engine on the negotiated period"));
        // One attempt, and it asked for the negotiated period: a retry here
        // would rebuild a stream that already runs.
        assert_eq!(*requests.borrow(), vec![false]);
    }

    #[test]
    fn a_refused_period_is_retried_once_with_the_device_default() {
        let requests = RefCell::new(Vec::new());

        let started = spawn_with_fallback(|force_default_buffer| {
            requests.borrow_mut().push(force_default_buffer);
            if force_default_buffer {
                Ok("engine on the device default period")
            } else {
                Err("requested period unsupported".to_string())
            }
        });

        assert_eq!(started, Ok("engine on the device default period"));
        assert_eq!(*requests.borrow(), vec![false, true]);
    }

    #[test]
    fn a_start_that_fails_both_ways_reports_both_failures() {
        let requests = RefCell::new(Vec::new());

        let started = spawn_with_fallback(|force_default_buffer| {
            requests.borrow_mut().push(force_default_buffer);
            Err::<(), String>(if force_default_buffer {
                "no output device available".to_string()
            } else {
                "requested period unsupported".to_string()
            })
        });

        // The first failure is the one that describes the request the user's
        // settings made; dropping it for the retry's message would leave the
        // rejected period invisible.
        assert_eq!(
            started,
            Err(concat!(
                "requested period unsupported (retrying with the device default ",
                "period also failed: no output device available)"
            )
            .to_string())
        );
        assert_eq!(*requests.borrow(), vec![false, true]);
    }
}
