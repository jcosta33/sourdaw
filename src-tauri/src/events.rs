//! The Tauri shell's implementation of the native crate's event sink.

use sourdaw_native::events::EventSink;
use tauri::{AppHandle, Emitter};

/// Pushes command-body events onto the webview as Tauri events.
///
/// Constructed per call site from the `AppHandle` the command already receives,
/// rather than managed: an `AppHandle` clone is a refcount bump, and a managed
/// sink would have to be installed after the builder chain anyway.
///
/// Never reachable from the CPAL callback — `emit` serializes and takes the
/// webview's IPC path.
pub struct TauriEventSink {
    app: AppHandle,
}

impl TauriEventSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl EventSink for TauriEventSink {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        // Discarding the result is the historical contract: a listener that has
        // gone away is not a reason to fail the operation that produced the
        // event.
        let _ = self.app.emit(event, payload);
    }
}
