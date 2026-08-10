pub mod clap_host;
pub mod clap_wrapper;
pub mod params;
pub mod scanner;
pub mod traits;

pub use clap_wrapper::{ClapParameterUpdate, ClapWrapper, HostTransport, ProcessingGate};
pub use params::PluginParameter;
pub use scanner::{ScanResult, ScannedPlugin};
pub use traits::AudioPlugin;
