use std::error::Error;
use std::fmt::{Display, Formatter};

/// Lowest canonical playback-rate ratio accepted by the shared contract.
pub const MIN_PLAYBACK_RATE_RATIO: f64 = 0.25;

/// Highest canonical playback-rate ratio accepted by the shared contract.
pub const MAX_PLAYBACK_RATE_RATIO: f64 = 4.0;

/// Failure produced when a ratio cannot represent a supported time-stretch value.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RatioError {
    NonFinite { value: f64 },
    NotPositive { value: f64 },
    OutsideCanonicalRange { value: f64, min: f64, max: f64 },
}

impl Display for RatioError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NonFinite { value } => {
                write!(formatter, "ratio must be finite, received {value}")
            }
            Self::NotPositive { value } => {
                write!(
                    formatter,
                    "ratio must be greater than zero, received {value}"
                )
            }
            Self::OutsideCanonicalRange { value, min, max } => write!(
                formatter,
                "ratio {value} is outside the canonical range {min}..={max}"
            ),
        }
    }
}

impl Error for RatioError {}

fn validate_ratio(value: f64) -> Result<f64, RatioError> {
    if !value.is_finite() {
        return Err(RatioError::NonFinite { value });
    }
    if value <= 0.0 {
        return Err(RatioError::NotPositive { value });
    }
    if !(MIN_PLAYBACK_RATE_RATIO..=MAX_PLAYBACK_RATE_RATIO).contains(&value) {
        return Err(RatioError::OutsideCanonicalRange {
            value,
            min: MIN_PLAYBACK_RATE_RATIO,
            max: MAX_PLAYBACK_RATE_RATIO,
        });
    }
    Ok(value)
}

/// Canonical shared ratio: `source_span_seconds / output_span_seconds`.
///
/// Values above one shorten repitch output and raise its pitch. Values below one lengthen repitch
/// output and lower its pitch. Consumers must not invert this value except at a typed
/// [`OutputDurationRatio`] adapter.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct PlaybackRateRatio(f64);

impl PlaybackRateRatio {
    pub fn new(value: f64) -> Result<Self, RatioError> {
        validate_ratio(value).map(Self)
    }

    pub const fn get(self) -> f64 {
        self.0
    }

    pub fn output_duration_ratio(self) -> OutputDurationRatio {
        OutputDurationRatio(1.0 / self.0)
    }
}

/// Explicit adapter value for engines whose legacy API consumes
/// `output_span_seconds / source_span_seconds`.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct OutputDurationRatio(f64);

impl OutputDurationRatio {
    pub fn new(value: f64) -> Result<Self, RatioError> {
        validate_ratio(value).map(Self)
    }

    pub const fn get(self) -> f64 {
        self.0
    }

    pub fn playback_rate_ratio(self) -> PlaybackRateRatio {
        PlaybackRateRatio(1.0 / self.0)
    }
}
