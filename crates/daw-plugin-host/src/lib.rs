pub mod clap_host;
pub mod clap_wrapper;
pub mod params;
pub mod scanner;
pub mod traits;

pub use clap_wrapper::ClapWrapper;
pub use params::PluginParameter;
pub use scanner::{PluginFormat, ScanResult, ScannedDescriptor, ScannedPlugin};
pub use traits::{
    AudioPlugin, HostParameterUpdate, HostTransport, HostedPluginRuntime, ProcessingGate,
};
