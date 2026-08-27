pub mod clap_host;
pub mod clap_wrapper;
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

pub use clap_wrapper::ClapWrapper;
pub use params::PluginParameter;
pub use runtime::HostedRuntime;
pub use scanner::{PluginFormat, ScanResult, ScannedDescriptor, ScannedPlugin};
pub use traits::{
    AudioPlugin, EditorWindowResizer, HostParameterUpdate, HostTransport, HostedPluginRuntime,
    LatencyChangeNotifier, ProcessingGate,
};
pub use vst3_wrapper::Vst3Wrapper;
