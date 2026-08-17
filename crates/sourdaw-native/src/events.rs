//! Host-agnostic seams for everything the relocated command bodies used to
//! reach through a `tauri::AppHandle`.
//!
//! A command body may need to *push* — a MIDI message arriving on a driver
//! thread, dictation text, an analysis progress tick — or to *stream* a
//! correlated sequence back to one caller. Under Tauri those were
//! `AppHandle::emit` and `tauri::ipc::Channel`; under the Node addon they are a
//! threadsafe function and a per-request threadsafe function. Neither concept
//! belongs to a transport, so the bodies address these traits and each shell
//! supplies its own implementation.
//!
//! Both seams take **owned** payloads. A sink implementation may hand the value
//! to another thread and outlive the caller's frame, so nothing borrowed can
//! cross. Neither seam may be called from the CPAL callback: `emit_json`
//! serializes, allocates and may block on a queue, all of which are forbidden on
//! the audio path.

use serde::Serialize;

/// Fire-and-forget event push to whatever is hosting these bodies.
///
/// Deliberately returns nothing. Every historical call site discarded the emit
/// result (`let _ = app.emit(..)`), because a listener that has gone away is not
/// a reason to fail the operation that produced the event.
pub trait EventSink: Send + Sync {
    fn emit_json(&self, event: &str, payload: serde_json::Value);
}

/// Typed convenience over [`EventSink`], kept off the trait so the trait stays
/// object-safe and can be held as `Arc<dyn EventSink>`.
pub trait EventSinkExt: EventSink {
    fn emit<Payload: Serialize>(&self, event: &str, payload: Payload) {
        match serde_json::to_value(payload) {
            Ok(value) => self.emit_json(event, value),
            Err(error) => {
                eprintln!("[Events] dropping '{event}': payload did not serialize: {error}");
            }
        }
    }
}

impl<Sink: EventSink + ?Sized> EventSinkExt for Sink {}

/// Sink for a host that has not registered one — used by tests and by the
/// scan-worker process, which has no event consumer at all.
pub struct NoopEventSink;

impl EventSink for NoopEventSink {
    fn emit_json(&self, _event: &str, _payload: serde_json::Value) {}
}

/// One request's correlated response stream.
///
/// Unlike [`EventSink`], a closed stream *is* a failure: the caller is waiting
/// for these events and a body that kept producing into a dead channel would
/// burn the remote budget for nothing.
pub trait EventStream<Event>: Send + Sync {
    fn send(&self, event: Event) -> Result<(), String>;
}

/// Collecting stream used by tests to assert what a body produced.
#[derive(Default)]
pub struct RecordingEventStream<Event> {
    events: std::sync::Mutex<Vec<Event>>,
}

impl<Event> RecordingEventStream<Event> {
    pub fn new() -> Self {
        Self {
            events: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn take(&self) -> Vec<Event> {
        std::mem::take(
            &mut self
                .events
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
    }
}

impl<Event: Send> EventStream<Event> for RecordingEventStream<Event> {
    fn send(&self, event: Event) -> Result<(), String> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(event);
        Ok(())
    }
}
