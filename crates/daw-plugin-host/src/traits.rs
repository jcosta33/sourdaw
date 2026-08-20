//! The format-neutral seam every hosted plugin format implements.
//!
//! `AudioPlugin` is what the application asks of *any* loaded plugin;
//! `HostedPluginRuntime` is the extra surface the shared RT/control runtime
//! owner (`SharedHostedPlugin` in `sourdaw-native`) drives. CLAP is the only
//! implementation today. A second format implements these two traits and plugs
//! into the runtime owner without either of them changing.
//!
//! The value types below live here rather than in `clap_wrapper` because they
//! are the seam's own vocabulary: none of them names anything CLAP-specific,
//! and a second format's backend has to speak them without depending on the
//! CLAP backend module.

use crate::params::PluginParameter;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

/// One host-side parameter write waiting to reach a plugin.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HostParameterUpdate {
    pub param_id: u32,
    pub value: f64,
}

/// Host timeline handed to a plugin each block.
///
/// Deliberately its own type rather than the engine's transport struct: this
/// crate must stay loadable without the engine, and the engine must be free to
/// grow fields a hosted plugin has no slot for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HostTransport {
    pub tempo: f64,
    pub time_sig_num: u16,
    pub time_sig_denom: u16,
    pub is_playing: bool,
    pub song_pos_beats: f64,
    pub song_pos_seconds: f64,
}

/// Ownership of a plugin's processing state, split by thread the way CLAP
/// splits it.
///
/// CLAP annotates `start_processing` and `stop_processing` `[audio-thread]`, so
/// neither may be called from the loader, the unload command, or a `Drop`. This
/// gate lets a control thread state an *intent* — "this plugin should (not) be
/// processing" — which the audio thread carries out on its next block, and lets
/// the control thread observe when that has happened.
///
/// Exclusive access to the wrapper does not substitute for thread affinity: a
/// plugin that gates real-time state on these callbacks cares which thread ran
/// them, not who else was excluded at the time.
///
/// One case cannot be served on the audio thread: a slot that has already left
/// the graph will never be handed another block, so nothing there can perform
/// the stop that must precede `deactivate`. That path calls
/// `force_stop_processing_off_audio_thread`, which counts itself so the
/// deviation is measurable rather than assumed rare.
///
/// The rule is a hosting rule, not a CLAP one — VST3 splits
/// `setActive`/`setProcessing` the same way — so the gate belongs to the seam.
#[derive(Debug, Default)]
pub struct ProcessingGate {
    /// Control-thread intent. Read by the audio thread each block.
    requested: AtomicBool,
    /// Audio-thread truth: `start_processing` returned true and has not been undone.
    active: AtomicBool,
    /// Stops performed off the audio thread because no further block was coming.
    off_audio_thread_stops: AtomicU32,
}

impl ProcessingGate {
    /// Intent set by the loader once activation succeeds: the plugin should be
    /// processing as soon as the audio thread next runs it.
    pub fn request_start(&self) {
        self.requested.store(true, Ordering::Release);
    }

    /// Intent set before deactivate/destroy. Callable from any thread; performs
    /// no plugin call itself.
    pub fn request_stop(&self) {
        self.requested.store(false, Ordering::Release);
    }

    /// Whether the plugin is currently in the processing state.
    pub fn is_processing(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    /// Whether a requested stop has been carried out. A control thread waits on
    /// this after `request_stop` before it deactivates.
    pub fn has_stopped(&self) -> bool {
        !self.is_processing()
    }

    /// How many stops had to be performed off the audio thread.
    pub fn off_audio_thread_stops(&self) -> u32 {
        self.off_audio_thread_stops.load(Ordering::Acquire)
    }

    /// Whether the control thread currently wants this plugin processing.
    pub fn wants_processing(&self) -> bool {
        self.requested.load(Ordering::Acquire)
    }

    /// Whether a stop has been asked for but not yet carried out. The audio
    /// thread uses this to decide whether a block is worth a visit.
    pub fn has_pending_stop(&self) -> bool {
        !self.wants_processing() && self.is_processing()
    }

    /// A gate in the state a freshly loaded plugin reaches after its first
    /// audio block: wanted, and processing.
    ///
    /// Fixture-only. In production `active` is written by the audio thread and
    /// nothing else, which is the whole point of the split — so the setter that
    /// short-circuits that is not compiled into a normal build.
    #[cfg(feature = "engine-owned-command-fixture")]
    pub fn fixture_already_processing() -> Self {
        let gate = Self::default();
        gate.request_start();
        gate.mark_started();
        gate
    }

    /// Audio-thread truth, written by a format backend's process path and by
    /// nothing else. `pub(crate)` rather than private only because the backend
    /// now lives in a sibling module; it is not part of this crate's public
    /// surface and no control-path caller may reach it.
    pub(crate) fn mark_started(&self) {
        self.active.store(true, Ordering::Release);
    }

    pub(crate) fn mark_stopped(&self) {
        self.active.store(false, Ordering::Release);
    }

    pub(crate) fn count_off_audio_thread_stop(&self) {
        self.off_audio_thread_stops.fetch_add(1, Ordering::AcqRel);
    }
}

/// What the application asks of any loaded plugin, whatever format it is.
///
/// The GUI four carry honest defaults rather than being absent: a format
/// backend that has no editor answers "no editor" instead of leaving the caller
/// to discover the type it is really holding. Nothing downcasts through this
/// trait — that escape hatch is what let the CLAP-only assumption leak into
/// `sourdaw-native`'s state layer in the first place.
pub trait AudioPlugin: Send + Sync {
    /// Process a block of audio.
    /// `inputs`: slice of channel buffers (e.g., [left_in, right_in])
    /// `outputs`: slice of mutable channel buffers (e.g., [left_out, right_out])
    /// `num_samples`: number of samples per channel to process
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize);

    /// Set a parameter value (typically 0.0 to 1.0 normalized)
    fn set_parameter(&mut self, param_id: u32, value: f64);

    /// Get all parameters exposed by the plugin
    fn get_parameters(&self) -> Vec<PluginParameter>;

    /// Get the opaque binary state of the plugin
    fn get_state(&self) -> Vec<u8>;

    /// Set the opaque binary state of the plugin.
    fn set_state(&mut self, state: &[u8]) -> Result<(), String>;

    /// The plugin's display name.
    ///
    /// The default is what a caller can truthfully say about a plugin whose
    /// backend does not report a name.
    fn get_name(&self) -> &str {
        "Plugin"
    }

    /// Whether the plugin provides an editor of its own.
    ///
    /// Defaults to `false`: a backend that cannot host an editor has none, and
    /// that is an answer rather than a gap.
    fn has_gui(&self) -> bool {
        false
    }

    /// Open the plugin's editor, parenting it into the given native handle.
    fn open_gui(&mut self, _handle_ptr: *mut c_void) -> Result<(u32, u32), String> {
        Err("Plugin does not support GUI".to_string())
    }

    /// Close the plugin's editor. A plugin with no editor has nothing to close.
    fn close_gui(&mut self) {}
}

/// What the shared runtime owner requires of a hosted plugin backend.
///
/// Split from [`AudioPlugin`] because these are the operations the RT/control
/// access seam serialises: the process entries it calls under the audio-thread
/// claim, the processing-state transition only the audio thread may perform,
/// and the latency re-query that runs under the control claim. A plugin that is
/// merely loaded (`AudioPlugin`) is not necessarily wired into the engine.
///
/// `SharedHostedPlugin` is generic over this trait rather than holding
/// `dyn HostedPluginRuntime`, so every call on the audio path monomorphises to
/// a direct call.
pub trait HostedPluginRuntime: AudioPlugin {
    /// Whether activation succeeded. An unactivated runtime is never processed.
    fn is_activated(&self) -> bool;

    /// The processing-state gate shared with the runtime owner.
    fn processing_gate(&self) -> Arc<ProcessingGate>;

    /// Carry out a pending processing-state transition. **Audio thread only.**
    fn sync_processing_state(&mut self);

    /// Stage the transport handed to the plugin with the next block.
    fn set_transport(&mut self, transport: HostTransport);

    /// Process a block with pending host-side parameter writes applied.
    fn process_with_parameter_updates(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        parameter_updates: &[HostParameterUpdate],
    );

    /// Process a block with MIDI and pending host-side parameter writes.
    fn process_with_midi_and_parameters(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        midi_events: &[(u8, u8, i16, bool)], // (note, velocity, channel, is_on)
        parameter_updates: &[HostParameterUpdate],
    );

    /// Apply a latency change the plugin flagged, returning the new latency in
    /// frames, or `None` when nothing was pending. Control path only.
    fn poll_latency_change(&mut self) -> Result<Option<u32>, String>;

    /// Reported latency in milliseconds, at the rate the plugin was activated
    /// with. Milliseconds because that rate is known here and nowhere upstream.
    fn latency_ms(&self) -> f64;

    /// Reported latency in frames of the plugin's own activation rate.
    fn latency_samples(&self) -> u32;
}
