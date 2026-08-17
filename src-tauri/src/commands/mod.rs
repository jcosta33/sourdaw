//! Tauri command surface.
//!
//! Every file here is a thin shell: it names the command, unwraps the Tauri
//! transport (managed state, raw invoke bodies, channels, the app handle), and
//! calls the body in `sourdaw-native`. Behaviour lives there; only transport
//! lives here.

pub mod ai_audio;
pub mod audio_gen;
pub mod audio_postprocess;
pub mod binary_ipc;
pub mod collab;
pub mod crumbs;
pub mod engine_diagnostics;
pub mod filesystem;
pub mod link;
pub mod midi;
pub mod pitch_edit;
pub mod plugin_gui;
pub mod plugins;
pub mod provider_gateway;
pub mod speech;
pub mod tuning;
