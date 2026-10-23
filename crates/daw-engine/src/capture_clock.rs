//! Callback dates for recording placement, separate from the cursor's cadence.
//!
//! All seconds are relative to one engine-owned monotonic epoch. No Unix,
//! Chromium or other stream epoch is assumed. Platform presentation times are
//! estimates; the optional uncertainty measures only a local query bracket,
//! never an otherwise unmeasured driver/hardware error.

use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(any(windows, test))]
use std::time::Duration;
use std::time::Instant;

static NEXT_CLOCK_EPOCH: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CaptureClockQuality {
    Estimated,
    Degraded,
}

/// Published in the very same transport snapshot as frame, wraps and batch.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CaptureClockSnapshot {
    pub epoch: u64,
    pub stream_epoch: u64,
    pub sample_rate: f64,
    /// Predicted device presentation of the callback's exclusive end frame.
    pub presentation_seconds: f64,
    pub quality: CaptureClockQuality,
    /// Local measurement uncertainty only. None means no measured bound.
    pub uncertainty_seconds: Option<f64>,
}

#[derive(Clone, Copy)]
pub(crate) struct CaptureClock {
    epoch: u64,
    origin: Instant,
}

impl CaptureClock {
    /// Control-side only: never initialize an epoch lazily on the callback.
    pub(crate) fn new() -> Self {
        Self {
            epoch: NEXT_CLOCK_EPOCH.fetch_add(1, Ordering::Relaxed),
            origin: Instant::now(),
        }
    }

    pub(crate) fn now(self) -> (u64, f64) {
        (self.epoch, self.origin.elapsed().as_secs_f64())
    }

    pub(crate) fn snapshot(
        self,
        presentation: PresentationTime,
        sample_rate: f64,
    ) -> Option<CaptureClockSnapshot> {
        Some(CaptureClockSnapshot {
            epoch: self.epoch,
            stream_epoch: presentation.stream_epoch,
            sample_rate,
            presentation_seconds: presentation
                .at
                .checked_duration_since(self.origin)?
                .as_secs_f64(),
            quality: presentation.quality,
            uncertainty_seconds: presentation.uncertainty_seconds,
        })
    }
}

#[derive(Clone, Copy)]
pub(crate) struct PresentationTime {
    pub at: Instant,
    pub stream_epoch: u64,
    pub quality: CaptureClockQuality,
    pub uncertainty_seconds: Option<f64>,
}

/// WASAPI's clock position is in GetFrequency units, not necessarily frames.
/// The submitted end includes the silent prefill, which advances the device
/// clock even though it advances no musical transport. Compiled on every host
/// so these units and the query bracket have a device-free regression oracle.
#[allow(clippy::too_many_arguments)]
#[cfg(any(windows, test))]
pub(crate) fn device_presentation_end(
    before: Instant,
    after: Instant,
    position: u64,
    frequency: u64,
    submitted_end_frames: u64,
    sample_rate: f64,
    stream_epoch: u64,
    degraded: bool,
) -> Option<PresentationTime> {
    if frequency == 0 || !sample_rate.is_finite() || sample_rate <= 0.0 {
        return None;
    }
    let bracket = after.checked_duration_since(before)?;
    let lead = submitted_end_frames as f64 / sample_rate - position as f64 / frequency as f64;
    if !lead.is_finite() || lead < 0.0 {
        return None;
    }
    let at = before
        .checked_add(bracket / 2)?
        .checked_add(Duration::try_from_secs_f64(lead).ok()?)?;
    Some(PresentationTime {
        at,
        stream_epoch,
        quality: if degraded {
            CaptureClockQuality::Degraded
        } else {
            CaptureClockQuality::Estimated
        },
        uncertainty_seconds: Some(bracket.as_secs_f64() / 2.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_clock_keeps_the_presentation_date_when_a_query_is_later() {
        let clock = CaptureClock::new();
        let stamp = clock
            .snapshot(
                PresentationTime {
                    at: clock.origin + Duration::from_millis(25),
                    stream_epoch: 3,
                    quality: CaptureClockQuality::Estimated,
                    uncertainty_seconds: None,
                },
                48_000.0,
            )
            .unwrap();
        assert_eq!(stamp.presentation_seconds, 0.025);
        assert_eq!(stamp.stream_epoch, 3);
        assert_eq!(clock.now().0, stamp.epoch);
        assert_ne!(CaptureClock::new().now().0, stamp.epoch);
    }

    #[test]
    fn capture_clock_windows_edge_counts_prefill_and_device_frequency_once() {
        let before = Instant::now();
        // 480 prefill + 240 rendered frames; device already played 5 ms.
        // Its counter frequency deliberately differs from the sample rate.
        let stamp = device_presentation_end(
            before,
            before + Duration::from_millis(2),
            50_000,
            10_000_000,
            720,
            48_000.0,
            2,
            true,
        )
        .unwrap();
        assert_eq!(stamp.at.duration_since(before), Duration::from_millis(11));
        assert_eq!(stamp.uncertainty_seconds, Some(0.001));
        assert_eq!(stamp.quality, CaptureClockQuality::Degraded);
        assert_eq!(stamp.stream_epoch, 2);
        assert!(device_presentation_end(before, before, 0, 0, 720, 48_000.0, 2, false).is_none());
        assert!(device_presentation_end(
            before, before, 1_000_000, 10_000_000, 720, 48_000.0, 2, false
        )
        .is_none());
    }
}
