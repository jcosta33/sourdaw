//! Native hosting internals, owned by `sourdaw-native`.
//!
//! Re-exported rather than re-implemented: `main.rs` reaches
//! `host::plugin_scan_worker::run_from_process_args` through this path, and the
//! scan-worker contract must be the same one the Node addon runs.

pub use sourdaw_native::host::*;
