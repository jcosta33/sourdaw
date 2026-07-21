//! Dormant product-neutral contracts for time-stretch preparation and processing.
//!
//! The contract deliberately has no production consumer. It defines canonical ratio semantics,
//! preparation-time validation, caller-owned processing buffers, discontinuity/reset handling,
//! declared latency and tail, and typed failures without selecting or implementing an engine.

mod contract;
mod ratio;

pub use contract::{
    validate_process_request, BypassPolicy, ChannelLayout, ChannelSupport, Discontinuity,
    DiscontinuityKind, DrainRequest, DrainStatus, PlanGeneration, PreparationRequest,
    PreparedTimeStretch, ProcessReport, ProcessRequest, ProcessingClass, RatioChange,
    StreamingTimeStretchProcessor, TimeStretchCapabilities, TimeStretchError, TimeStretchPreparer,
    TimeStretchTiming,
};
pub use ratio::{OutputDurationRatio, PlaybackRateRatio, RatioError};
