#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        reason = "tests assert by unwrapping and fail by panicking"
    )
)]

#[cfg(test)]
mod allocation_counter;
pub mod clap_host;
/// The run loop a CLAP editor's `clap.timer-support` and `clap.posix-fd-support`
/// registrations land in. Compiled and tested on every unix, offered to a plugin
/// only on Linux (see `clap_host::host_get_extension`).
#[cfg(unix)]
pub mod clap_run_loop;
pub mod clap_wrapper;
/// The format-neutral pump every open editor's run loop is serviced from.
#[cfg(unix)]
pub mod editor_run_loop;
pub mod output_notes;
pub mod parameter_events;
pub mod params;
pub mod runtime;
pub mod scanner;
pub mod traits;
pub mod vst3_bus_layout;
pub mod vst3_class_id;
pub mod vst3_editor;
pub mod vst3_host;
pub mod vst3_module;
pub mod vst3_module_info;
/// The `IRunLoop` a VST3 editor needs on X11. Compiled on every unix so it is
/// built and tested wherever the crate is, and advertised to a plugin only on
/// Linux, which is the one platform whose editors cannot run without it.
#[cfg(unix)]
pub mod vst3_run_loop;
pub mod vst3_scanner;
pub mod vst3_wrapper;

pub use clap_host::{
    signal_pending_editor_resize, signal_pending_latency_requery,
    signal_pending_main_thread_callback, signal_pending_tail_change,
    take_pending_editor_resize_signal, take_pending_latency_requery_signal,
    take_pending_main_thread_callback_signal, take_pending_tail_change_signal,
};
pub use clap_wrapper::ClapWrapper;
pub use parameter_events::{
    is_empty_batch, pair_gestures, signal_pending_parameter_flush,
    take_pending_parameter_events_signal, take_pending_parameter_flush_signal,
    PairedParameterEvents, PluginParameterEvent, PluginParameterEventKind,
    PluginParameterEventQueue, PARAMETER_EVENT_CAPACITY,
};
pub use params::PluginParameter;
pub use runtime::HostedRuntime;
pub use scanner::{PluginFormat, ScanResult, ScannedDescriptor, ScannedPlugin};
pub use traits::{
    signal_pending_process_refusal, signal_pending_service_change,
    take_pending_process_refusal_signal, take_pending_service_change_signal, AudioPlugin,
    EditorClosed, EditorVisibility, EditorWindowAsks, EditorWindowHost, EditorWindowResizer,
    HostMidiEvent, HostParameterUpdate, HostTransport, HostedPluginRuntime, LatencyChangeNotifier,
    PluginError, PluginHostRequest, PluginHostRequestNotifier, ProcessMode, ProcessingGate,
    ServiceChange, SharedEditorWindow, DEFAULT_EDITOR_CONTENT_SCALE,
};
pub use vst3_wrapper::Vst3Wrapper;
