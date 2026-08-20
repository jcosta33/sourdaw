//! Engine events published from real-time-adjacent callbacks.
//!
//! A stream error arrives on the backend's error callback, which the host
//! owns: it may run on the audio thread itself, so publishing it must not
//! allocate, lock, or block.
//! Every event here is therefore a fixed-size `Copy` value pushed into a
//! bounded SPSC ring; the non-real-time side drains it through
//! `EngineHandle::drain_engine_events`, and everything that costs anything to
//! do — formatting, logging, allocating — happens there rather than at the
//! push.

use rtrb::{Consumer, Producer, RingBuffer};

/// How many events the ring holds before further pushes are refused.
///
/// Errors on a healthy stream are rare, and a stream that is failing every
/// period says nothing new after the first few reports — dropping the excess
/// is preferable to letting the audio side wait for a reader.
pub const ENGINE_EVENT_QUEUE_CAPACITY: usize = 64;

/// Why the audio backend reported a stream error.
///
/// A fixed enum rather than the backend's own error message: the message is
/// an owned string, and building one on the error callback would allocate.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum StreamErrorKind {
    /// The device went away — unplugged, or removed by the OS.
    DeviceNotAvailable,
    /// Another application or stream holds the device.
    DeviceBusy,
    /// The OS rerouted the stream to a different device.
    DeviceChanged,
    /// The stream configuration is no longer valid and must be rebuilt.
    StreamInvalidated,
    /// A buffer underrun or overrun — an audible glitch.
    Xrun,
    /// Anything the backend reported that does not map onto a specific kind.
    BackendSpecific,
}

impl From<cpal::ErrorKind> for StreamErrorKind {
    fn from(kind: cpal::ErrorKind) -> Self {
        match kind {
            cpal::ErrorKind::DeviceNotAvailable => Self::DeviceNotAvailable,
            cpal::ErrorKind::DeviceBusy => Self::DeviceBusy,
            cpal::ErrorKind::DeviceChanged => Self::DeviceChanged,
            cpal::ErrorKind::StreamInvalidated => Self::StreamInvalidated,
            cpal::ErrorKind::Xrun => Self::Xrun,
            _ => Self::BackendSpecific,
        }
    }
}

impl From<&cpal::Error> for StreamErrorKind {
    fn from(error: &cpal::Error) -> Self {
        Self::from(error.kind())
    }
}

/// An observable engine condition that the layer above the audio thread can act
/// on. Fixed size and `Copy` so it can be published from the audio callback.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum EngineEvent {
    /// The audio backend reported an error on the output stream.
    StreamError { kind: StreamErrorKind },
}

pub(crate) fn engine_event_channel() -> (Producer<EngineEvent>, Consumer<EngineEvent>) {
    RingBuffer::new(ENGINE_EVENT_QUEUE_CAPACITY)
}

/// Drain every event currently queued, reporting each one to stderr on the way
/// out.
///
/// Never called on the audio thread, which is what makes the reporting possible
/// here: the `Vec` allocation and the global stderr lock `eprintln!` takes are
/// both affordable on the control side and both forbidden in the callback that
/// produced these events.
///
/// This stderr line is the native-side trace, not the only report. It is the one
/// that survives with no webview attached — a headless host, a crashed
/// front end, a session read from a log afterwards. The app-level report a user
/// can reach is the frontend warn in `refreshEngineRtDiagnostics`, which logs
/// each event as it ingests it. The ring hands an event out exactly once, so
/// each side reports it exactly once.
pub(crate) fn drain_engine_events(consumer: &mut Consumer<EngineEvent>) -> Vec<EngineEvent> {
    let mut events = Vec::new();
    while let Ok(event) = consumer.pop() {
        eprintln!("[Engine] {event:?}");
        events.push(event);
    }
    events
}

#[cfg(test)]
mod tests {
    use super::{
        drain_engine_events, engine_event_channel, EngineEvent, StreamErrorKind,
        ENGINE_EVENT_QUEUE_CAPACITY,
    };

    #[test]
    fn a_pushed_stream_error_is_drained_by_the_non_real_time_side() {
        let (mut producer, mut consumer) = engine_event_channel();

        producer
            .push(EngineEvent::StreamError {
                kind: StreamErrorKind::DeviceNotAvailable,
            })
            .expect("an empty ring should accept an event");
        producer
            .push(EngineEvent::StreamError {
                kind: StreamErrorKind::Xrun,
            })
            .expect("an empty ring should accept a second event");

        assert_eq!(
            drain_engine_events(&mut consumer),
            vec![
                EngineEvent::StreamError {
                    kind: StreamErrorKind::DeviceNotAvailable
                },
                EngineEvent::StreamError {
                    kind: StreamErrorKind::Xrun
                },
            ]
        );
        assert!(drain_engine_events(&mut consumer).is_empty());
    }

    #[test]
    fn a_full_ring_refuses_further_pushes_instead_of_blocking_the_audio_side() {
        let (mut producer, mut consumer) = engine_event_channel();
        let event = EngineEvent::StreamError {
            kind: StreamErrorKind::BackendSpecific,
        };

        for _ in 0..ENGINE_EVENT_QUEUE_CAPACITY {
            producer
                .push(event)
                .expect("ring should accept up to capacity");
        }

        assert!(
            producer.push(event).is_err(),
            "a full ring must refuse the push rather than wait for the reader"
        );
        assert_eq!(
            drain_engine_events(&mut consumer).len(),
            ENGINE_EVENT_QUEUE_CAPACITY
        );
    }

    #[test]
    fn every_cpal_error_kind_maps_onto_a_fixed_stream_error_kind() {
        assert_eq!(
            StreamErrorKind::from(cpal::ErrorKind::DeviceNotAvailable),
            StreamErrorKind::DeviceNotAvailable
        );
        assert_eq!(
            StreamErrorKind::from(cpal::ErrorKind::DeviceBusy),
            StreamErrorKind::DeviceBusy
        );
        assert_eq!(
            StreamErrorKind::from(cpal::ErrorKind::DeviceChanged),
            StreamErrorKind::DeviceChanged
        );
        assert_eq!(
            StreamErrorKind::from(cpal::ErrorKind::StreamInvalidated),
            StreamErrorKind::StreamInvalidated
        );
        assert_eq!(
            StreamErrorKind::from(cpal::ErrorKind::Xrun),
            StreamErrorKind::Xrun
        );
    }

    #[test]
    fn an_unmapped_backend_error_kind_falls_back_to_backend_specific() {
        // `ErrorKind` is `#[non_exhaustive]`: kinds the engine has no distinct
        // reaction to, and any variant cpal adds later, must still be reported
        // rather than silently discarded.
        for kind in [
            cpal::ErrorKind::BackendError,
            cpal::ErrorKind::HostUnavailable,
            cpal::ErrorKind::PermissionDenied,
            cpal::ErrorKind::RealtimeDenied,
            cpal::ErrorKind::ResourceExhausted,
            cpal::ErrorKind::UnsupportedConfig,
            cpal::ErrorKind::UnsupportedOperation,
            cpal::ErrorKind::InvalidInput,
            cpal::ErrorKind::Other,
        ] {
            assert_eq!(
                StreamErrorKind::from(kind),
                StreamErrorKind::BackendSpecific
            );
        }
    }

    #[test]
    fn a_cpal_error_value_maps_through_its_kind_without_reading_its_message() {
        let error = cpal::Error::with_message(
            cpal::ErrorKind::DeviceNotAvailable,
            "device was unplugged mid-stream",
        );

        assert_eq!(
            StreamErrorKind::from(&error),
            StreamErrorKind::DeviceNotAvailable
        );
    }
}
