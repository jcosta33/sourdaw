//! The one hosted-plugin runtime type the engine holds, whatever format the
//! plugin is.
//!
//! An enum rather than `Box<dyn HostedPluginRuntime>` because the audio thread
//! calls through this on every block: an enum arm is a predictable branch into a
//! monomorphised call, where a trait object is an indirect call through a vtable
//! the branch predictor cannot see past. The seam's whole reason for being
//! generic over `HostedPluginRuntime` was to keep that property, and boxing here
//! would give it away at the last step.
//!
//! Adding a format adds an arm. Nothing outside this file matches on one.

use crate::clap_wrapper::ClapWrapper;
use crate::params::PluginParameter;
use crate::traits::{
    AudioPlugin, EditorWindowResizer, HostParameterUpdate, HostTransport, HostedPluginRuntime,
    LatencyChangeNotifier, ProcessingGate,
};
use crate::vst3_wrapper::Vst3Wrapper;
use std::ffi::c_void;
use std::sync::Arc;

/// A loaded plugin of any format Sourdaw hosts.
pub enum HostedRuntime {
    Clap(ClapWrapper),
    Vst3(Vst3Wrapper),
}

impl From<ClapWrapper> for HostedRuntime {
    fn from(wrapper: ClapWrapper) -> Self {
        Self::Clap(wrapper)
    }
}

impl From<Vst3Wrapper> for HostedRuntime {
    fn from(wrapper: Vst3Wrapper) -> Self {
        Self::Vst3(wrapper)
    }
}

/// Call the same method on whichever backend this runtime holds.
///
/// Every method below is pure delegation, and writing sixteen two-arm matches
/// out longhand buries the one thing that varies — the method — in noise.
macro_rules! delegate {
    ($self:ident, $backend:ident => $call:expr) => {
        match $self {
            HostedRuntime::Clap($backend) => $call,
            HostedRuntime::Vst3($backend) => $call,
        }
    };
}

impl AudioPlugin for HostedRuntime {
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
        delegate!(self, backend => backend.process(inputs, outputs, num_samples))
    }

    fn set_parameter(&mut self, param_id: u32, value: f64) {
        delegate!(self, backend => backend.set_parameter(param_id, value))
    }

    fn get_parameters(&self) -> Vec<PluginParameter> {
        delegate!(self, backend => backend.get_parameters())
    }

    fn get_state(&self) -> Result<Vec<u8>, String> {
        delegate!(self, backend => backend.get_state())
    }

    fn set_state(&mut self, state: &[u8]) -> Result<(), String> {
        delegate!(self, backend => backend.set_state(state))
    }

    fn get_name(&self) -> &str {
        delegate!(self, backend => backend.get_name())
    }

    fn has_gui(&self) -> bool {
        delegate!(self, backend => backend.has_gui())
    }

    fn open_gui(&mut self, handle_ptr: *mut c_void) -> Result<(u32, u32), String> {
        delegate!(self, backend => backend.open_gui(handle_ptr))
    }

    fn close_gui(&mut self) {
        delegate!(self, backend => backend.close_gui())
    }

    fn set_editor_window_resizer(&mut self, resize: EditorWindowResizer) {
        delegate!(self, backend => backend.set_editor_window_resizer(resize))
    }

    fn accepts_midi(&self) -> bool {
        delegate!(self, backend => backend.accepts_midi())
    }
}

impl HostedPluginRuntime for HostedRuntime {
    fn is_activated(&self) -> bool {
        delegate!(self, backend => backend.is_activated())
    }

    fn processing_gate(&self) -> Arc<ProcessingGate> {
        delegate!(self, backend => backend.processing_gate())
    }

    fn sync_processing_state(&mut self) {
        delegate!(self, backend => backend.sync_processing_state())
    }

    fn set_transport(&mut self, transport: HostTransport) {
        delegate!(self, backend => backend.set_transport(transport))
    }

    fn process_with_parameter_updates(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        parameter_updates: &[HostParameterUpdate],
    ) {
        delegate!(self, backend => backend.process_with_parameter_updates(
            inputs,
            outputs,
            num_samples,
            parameter_updates,
        ))
    }

    fn process_with_midi_and_parameters(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        midi_events: &[(u8, u8, i16, bool)],
        parameter_updates: &[HostParameterUpdate],
    ) {
        delegate!(self, backend => backend.process_with_midi_and_parameters(
            inputs,
            outputs,
            num_samples,
            midi_events,
            parameter_updates,
        ))
    }

    fn apply_host_parameter_write_to_editor(&mut self, param_id: u32, value: f64) {
        delegate!(self, backend => backend.apply_host_parameter_write_to_editor(param_id, value))
    }

    fn poll_latency_change(&mut self) -> Result<Option<u32>, String> {
        delegate!(self, backend => backend.poll_latency_change())
    }

    fn latency_ms(&self) -> f64 {
        delegate!(self, backend => backend.latency_ms())
    }

    fn latency_samples(&self) -> u32 {
        delegate!(self, backend => backend.latency_samples())
    }
}

impl HostedRuntime {
    /// Leave the processing state from a thread that is not the audio thread.
    ///
    /// Not on the seam trait: it is the exception the gate documents, and only
    /// the runtime owner's unload and reactivate paths may take it.
    pub fn force_stop_processing_off_audio_thread(&mut self) {
        delegate!(self, backend => backend.force_stop_processing_off_audio_thread())
    }

    /// Install the wake fired when this plugin flags a latency change.
    ///
    /// Not on the seam trait because it is a loader concern rather than a
    /// runtime one: it is installed once, before the plugin is handed to the
    /// audio thread, and never touched again. Returns false when one is already
    /// installed — first install wins, so the wake cannot be hijacked mid-life.
    pub fn set_latency_change_notifier(&self, notifier: LatencyChangeNotifier) -> bool {
        delegate!(self, backend => backend.set_latency_change_notifier(notifier))
    }

    /// Stage the parameter values the command fixture answers with.
    ///
    /// Fixture-only, and only the CLAP arm has one — the VST3 backend's tests
    /// drive a real COM plugin rather than a wrapper that pretends to be one, so
    /// there is nothing here for it to stand in for. Reaching this on a VST3
    /// runtime is a test wired to the wrong backend, and saying so beats
    /// silently doing nothing.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn set_engine_owned_command_fixture_parameters(
        &mut self,
        parameters: Vec<PluginParameter>,
    ) {
        match self {
            Self::Clap(backend) => backend.set_engine_owned_command_fixture_parameters(parameters),
            Self::Vst3(_) => panic!("the VST3 backend has no command fixture"),
        }
    }

    /// The loaded plugin's format, for a caller that must report it.
    pub fn format(&self) -> crate::scanner::PluginFormat {
        match self {
            Self::Clap(_) => crate::scanner::PluginFormat::Clap,
            Self::Vst3(_) => crate::scanner::PluginFormat::Vst3,
        }
    }
}
