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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_repeated_equal_peak_restarts_the_window_so_steady_material_never_decays_under_itself() {
        let mut hold = PeakHold::default();
        let hold_frames = 1000;
        let frames = 400;

        // Steady material at the same peak, spanning more than one window
        // (4 * 400 = 1600 > 1000 frames): every repeated call must restart
        // the window, so the level never decays while the signal itself
        // never drops.
        for _ in 0..4 {
            assert_eq!(hold.hold(0.5, frames, hold_frames), 0.5);
        }

        // The window was restarted on the last of those calls, so silence
        // now accumulates from zero: the hold survives while less than
        // `hold_frames` of it has built up...
        assert_eq!(hold.hold(0.0, frames, hold_frames), 0.5);
        assert_eq!(hold.hold(0.0, frames, hold_frames), 0.5);
        assert_eq!(hold.hold(0.0, frames, hold_frames), 0.5);
        // ...and releases once the accumulated silence reaches the window.
        assert_eq!(hold.hold(0.0, frames, hold_frames), 0.0);
    }

    #[test]
    fn a_louder_peak_restarts_a_partly_spent_window() {
        let mut hold = PeakHold::default();
        let hold_frames = 1000;
        let frames = 400;

        // Spend part of a window on 0.5 before a louder transient arrives:
        // a louder peak must get a full window of its own, not the leftover
        // of the window the quieter peak already spent.
        assert_eq!(hold.hold(0.5, frames, hold_frames), 0.5);
        assert_eq!(hold.hold(0.0, frames, hold_frames), 0.5);
        assert_eq!(hold.hold(0.0, frames, hold_frames), 0.5);

        // The louder peak resets held_frames to 0, so the window that
        // follows is a full 1000 frames, not the 800 already spent.
        assert_eq!(hold.hold(0.6, frames, hold_frames), 0.6);

        assert_eq!(hold.hold(0.0, frames, hold_frames), 0.6);
        assert_eq!(hold.hold(0.0, frames, hold_frames), 0.6);
        assert_eq!(hold.hold(0.0, frames, hold_frames), 0.6);
        assert_eq!(hold.hold(0.0, frames, hold_frames), 0.0);
    }
}
