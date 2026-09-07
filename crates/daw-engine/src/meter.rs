//! Peak-hold logic shared by the master meter and every timeline track's own
//! strip meter, so both hold a transient over the same kind of window without
//! duplicating the arithmetic.

/// Holds a callback's peak against a release window.
///
/// A meter is polled at UI rate and fed at callback rate, so most peaks are
/// never seen by the reader that samples between them. The hold is what makes
/// the published number the loudest thing that actually happened rather than
/// whichever block the poll happened to land on.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct PeakHold {
    /// The peak currently being held.
    held_peak: f32,
    /// Frames rendered since `held_peak` was last taken, against the caller's
    /// `hold_frames`.
    held_frames: u64,
}

impl PeakHold {
    /// Fold this callback's peak into the hold and return what is being
    /// held.
    ///
    /// A peak stands until something louder arrives or the window expires,
    /// and a quieter callback inside the window advances the window rather
    /// than the level. `>=` rather than `>` restarts the window on a repeated
    /// peak, so steady material holds at its own level instead of decaying
    /// under it.
    pub(crate) fn hold(&mut self, callback_peak: f32, frames: u64, hold_frames: u64) -> f32 {
        if callback_peak >= self.held_peak || self.held_frames >= hold_frames {
            self.held_peak = callback_peak;
            self.held_frames = 0;
        } else {
            self.held_frames += frames;
        }
        self.held_peak
    }
}
