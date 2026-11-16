//! The graph refusals whose message text TypeScript matches.
//!
//! The napi edge sends every command error as text, so these enums exist to make
//! the Rust side of that contract compile-checked: each failure kind is a variant,
//! `Display` carries the exact text the TypeScript consumers match
//! (`pumpNativeLiveAutomationWriter.ts`, `engineNotRenderingRefusal.ts`,
//! `createNativeOfflineGraphBackend.ts`), and callers convert with `to_string()`
//! at the existing edge. Rewording a message needs the matching TypeScript change
//! (ADR 0059). All of these are built on control threads, never the audio callback.

use std::fmt;

use daw_engine::timeline::{AUTOMATION_QUEUE_CAPACITY, DEVICE_PARAM_QUEUE_CAPACITY};

/// A queue-ledger refusal: the batch is refused whole instead of letting the
/// engine drop a write silently.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum QueueCapacityRefusal {
    Automation,
    DeviceParam,
}

impl fmt::Display for QueueCapacityRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Automation => write!(
                f,
                "automation-queue-capacity — this parameter's native queue is full: \
                 {AUTOMATION_QUEUE_CAPACITY} unlanded writes are pending, counting this \
                 batch and every earlier accepted one; the engine would drop further \
                 writes silently, so the batch refuses whole. These slots release when \
                 the engine's progress echo proves earlier writes landed (playback \
                 passing their stamps frees them for the next batch), when a replace or \
                 hold cancels the stale writes, or when a locate behind their stamps \
                 drops them"
            ),
            Self::DeviceParam => write!(
                f,
                "device-param-queue-capacity — this device's pending window is full: \
                 {DEVICE_PARAM_QUEUE_CAPACITY} changes are charged, counting this batch \
                 and every earlier accepted one; the engine would drop the writes \
                 silently, so the batch refuses whole instead. The window frees as the \
                 engine's progress echo proves earlier changes landed — playback passing \
                 their stamps releases them for the next batch"
            ),
        }
    }
}

impl std::error::Error for QueueCapacityRefusal {}

/// The engine slot is filled but its render callback is not running.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EngineNotRendering {
    /// A graph batch met a stalled stream; `fault` is the stream's last reported
    /// fault kind, already formatted (empty when it reported none).
    StreamStalled {
        fault: String,
    },
    TimelineRetirement,
}

impl fmt::Display for EngineNotRendering {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StreamStalled { fault } => write!(
                f,
                "engine-not-rendering: the output stream stopped calling back{fault}; the \
                 engine renders nothing until the stream resumes or it is restarted"
            ),
            Self::TimelineRetirement => {
                f.write_str("engine-not-rendering: timeline retirement requires engine recovery")
            }
        }
    }
}

impl std::error::Error for EngineNotRendering {}

/// A fault in an offline mapping call that crosses the wire as an error rather
/// than a batch refusal; the TypeScript backend matches the text prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MappingFault {
    /// A `prior` that was already accepted once no longer replays.
    PriorNoLongerMaps { reason: String },
    /// The named session is absent or held at a different revision.
    SessionUnknown { session_id: String, revision: u64 },
}

impl fmt::Display for MappingFault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PriorNoLongerMaps { reason } => {
                write!(f, "previously applied commands no longer map: {reason}")
            }
            Self::SessionUnknown {
                session_id,
                revision,
            } => write!(
                f,
                "mapping session unknown: '{session_id}' is not held at revision {revision} — \
                 resend the full prior to re-establish it"
            ),
        }
    }
}

impl std::error::Error for MappingFault {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_capacity_refusals_start_with_the_tokens_typescript_matches() {
        assert!(QueueCapacityRefusal::Automation
            .to_string()
            .starts_with("automation-queue-capacity — this parameter's native queue is full: "));
        assert!(QueueCapacityRefusal::DeviceParam
            .to_string()
            .starts_with("device-param-queue-capacity — this device's pending window is full: "));
    }

    #[test]
    fn engine_not_rendering_refusals_carry_the_prefix_typescript_matches() {
        let stalled = EngineNotRendering::StreamStalled {
            fault: " after reporting DeviceChanged".into(),
        }
        .to_string();
        assert_eq!(
            stalled,
            "engine-not-rendering: the output stream stopped calling back after reporting \
             DeviceChanged; the engine renders nothing until the stream resumes or it is restarted"
        );
        assert_eq!(
            EngineNotRendering::TimelineRetirement.to_string(),
            "engine-not-rendering: timeline retirement requires engine recovery"
        );
    }

    #[test]
    fn mapping_faults_carry_the_prefixes_typescript_matches() {
        assert_eq!(
            MappingFault::PriorNoLongerMaps {
                reason: "unknown track".into()
            }
            .to_string(),
            "previously applied commands no longer map: unknown track"
        );
        assert_eq!(
            MappingFault::SessionUnknown {
                session_id: "s1".into(),
                revision: 3
            }
            .to_string(),
            "mapping session unknown: 's1' is not held at revision 3 — resend the full prior \
             to re-establish it"
        );
    }
}
