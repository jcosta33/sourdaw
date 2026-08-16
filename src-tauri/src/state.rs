//! Managed state, owned by `sourdaw-native`.
//!
//! The Tauri shell registers these types with `.manage()` and hands `&` to the
//! command bodies; the definitions themselves — including `AppState`'s
//! drop-order invariant — belong to the crate that owns the audio device.

pub use sourdaw_native::state::*;
