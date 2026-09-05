//! Plugin delay compensation: the delay lines the graph holds its early
//! contributors back with.
//!
//! A device that reports latency answers a block later than it was asked, so
//! every strip carrying one arrives at its summing point behind the strips that
//! do not. Compensation is the delay put on *everything else* feeding that
//! point, and the primitive here is the only thing in the engine that performs
//! it: a fixed stereo ring, built control-side, run in place on the callback.

/// The ceiling on one compensating delay, in frames.
///
/// Roughly 340 ms at 48 kHz — past what any professional plugin declares, and
/// the point at which a host stops honouring a reported figure rather than
/// spending unbounded memory on it. A route asking for more is clamped and
/// counted, never silently obeyed and never silently dropped, which is the
/// convention Cubase's constrain threshold and Pro Tools' fixed maximum both
/// state to the engineer.
pub const MAX_COMPENSATION_FRAMES: usize = 16_384;

/// A stereo delay line of fixed capacity: one contributor's hold, so that it
/// reaches a summing point with the same latency as every other contributor.
///
/// Built on the control thread, because the ring is its whole heap and the
/// audio thread may neither allocate it nor free it (ADR 0020). Everything
/// after construction runs in place, and the only branch per sample is the
/// ring's own wrap.
pub struct CompensationDelay {
    left: Vec<f32>,
    right: Vec<f32>,
    /// Where the next frame is written. The read position trails it by
    /// [`Self::delay`], so re-aiming the line costs an offset and nothing else.
    write: usize,
    delay: usize,
}

impl std::fmt::Debug for CompensationDelay {
    /// Names the two numbers that describe the line. The ring itself is
    /// thousands of samples wide and says nothing a reader can use.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CompensationDelay")
            .field("capacity", &self.capacity())
            .field("delay", &self.delay)
            .finish()
    }
}

impl CompensationDelay {
    /// A line that can hold up to `capacity` frames and delays nothing until it
    /// is aimed.
    pub fn new(capacity: usize) -> Self {
        // One slot past the capacity: at a delay equal to the ring's length the
        // read and write positions would coincide and the line would pass its
        // input straight through, so the longest delay needs a slot the write
        // position has not reached yet.
        let slots = capacity + 1;
        Self {
            left: vec![0.0; slots],
            right: vec![0.0; slots],
            write: 0,
            delay: 0,
        }
    }

    /// The dry line a device declaring `latency_frames` needs while bypassed,
    /// or `None` for a device that declares none.
    ///
    /// Sized to the declared figure and clamped to the ceiling, so a device
    /// that reports an absurd latency costs the ceiling's memory rather than
    /// its own claim. The declared figure itself is kept by the caller: it is
    /// what the graph's arrivals are computed from, and clamping it here would
    /// hide the claim the engineer has to see.
    pub fn for_latency(latency_frames: usize) -> Option<Box<Self>> {
        if latency_frames == 0 {
            return None;
        }
        let mut delay = Box::new(Self::new(latency_frames.min(MAX_COMPENSATION_FRAMES)));
        delay.set_delay(latency_frames);
        Some(delay)
    }

    pub fn capacity(&self) -> usize {
        self.left.len() - 1
    }

    pub const fn delay(&self) -> usize {
        self.delay
    }

    /// Delay by `frames`, or by the capacity when more is asked for than the
    /// line holds. Returns whether it clamped, so a route the ceiling cut short
    /// is counted rather than left silently misaligned.
    pub fn set_delay(&mut self, frames: usize) -> bool {
        let capacity = self.capacity();
        let clamped = frames > capacity;
        let delay = frames.min(capacity);
        if delay == self.delay {
            return clamped;
        }

        // A line at zero delay is skipped by its caller and so writes nothing.
        // Its ring therefore still holds whatever it held when it last ran, and
        // reading that back would burst old audio into the mix. Silence is what
        // a newly introduced delay owes in any case: the signal has just been
        // pushed forward, and nothing has arrived to fill the gap. Between two
        // non-zero delays the ring is current, so the change is a read-offset
        // jump and nothing is cleared.
        if self.delay == 0 {
            self.clear();
        }
        self.delay = delay;
        clamped
    }

    fn clear(&mut self) {
        self.left.fill(0.0);
        self.right.fill(0.0);
        self.write = 0;
    }

    /// Delay `frames` of stereo audio in place.
    ///
    /// A line at zero delay is the identity and returns without touching the
    /// ring, which is what makes the common case — a graph whose strips all
    /// arrive together — cost nothing.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32], frames: usize) {
        if self.delay == 0 {
            return;
        }

        let slots = self.left.len();
        let mut write = self.write;
        let mut read = (write + slots - self.delay) % slots;
        for index in 0..frames {
            self.left[write] = left[index];
            self.right[write] = right[index];
            left[index] = self.left[read];
            right[index] = self.right[read];
            write += 1;
            if write == slots {
                write = 0;
            }
            read += 1;
            if read == slots {
                read = 0;
            }
        }
        self.write = write;
    }
}

#[cfg(test)]
mod tests {
    use super::{CompensationDelay, MAX_COMPENSATION_FRAMES};

    fn ramp(frames: usize) -> Vec<f32> {
        (0..frames).map(|index| index as f32 + 1.0).collect()
    }

    #[test]
    fn a_line_holds_exactly_the_frames_its_capacity_names() {
        let mut delay = CompensationDelay::new(4);
        assert_eq!(delay.capacity(), 4);

        assert!(!delay.set_delay(4));
        assert_eq!(delay.delay(), 4);

        let mut left = ramp(8);
        let mut right = ramp(8);
        delay.process(&mut left, &mut right, 8);

        // Four frames of the fill the line was built with, then the input
        // shifted by exactly four.
        assert_eq!(left, vec![0.0, 0.0, 0.0, 0.0, 1.0, 2.0, 3.0, 4.0]);
        assert_eq!(right, left);
    }

    #[test]
    fn a_delay_past_the_capacity_is_clamped_to_it_and_says_so() {
        let mut delay = CompensationDelay::new(MAX_COMPENSATION_FRAMES);

        assert!(delay.set_delay(MAX_COMPENSATION_FRAMES + 1));
        assert_eq!(delay.delay(), MAX_COMPENSATION_FRAMES);
    }

    #[test]
    fn a_zero_delay_line_leaves_its_input_untouched() {
        let mut delay = CompensationDelay::new(64);
        let mut left = ramp(4);
        let mut right = ramp(4);

        delay.process(&mut left, &mut right, 4);

        assert_eq!(left, ramp(4));
        assert_eq!(right, ramp(4));
    }

    #[test]
    fn shortening_a_running_delay_jumps_the_read_offset_without_clearing_the_ring() {
        let mut delay = CompensationDelay::new(8);
        delay.set_delay(4);
        let mut left = ramp(8);
        let mut right = ramp(8);
        delay.process(&mut left, &mut right, 8);

        delay.set_delay(2);
        let mut next_left = vec![9.0; 4];
        let mut next_right = vec![9.0; 4];
        delay.process(&mut next_left, &mut next_right, 4);

        // The ring kept running while the delay was four frames, so shortening
        // it to two reads back the material two frames behind the write head —
        // frames 7 and 8 of the first block — rather than silence.
        assert_eq!(next_left, vec![7.0, 8.0, 9.0, 9.0]);
        assert_eq!(next_right, next_left);
    }

    #[test]
    fn a_line_leaving_zero_delay_starts_from_silence_rather_than_stale_audio() {
        let mut delay = CompensationDelay::new(8);
        delay.set_delay(2);
        let mut left = ramp(8);
        let mut right = ramp(8);
        delay.process(&mut left, &mut right, 8);

        // Off, so the caller skips it and the ring stops advancing; then on
        // again, where the ring's contents are as old as that gap.
        delay.set_delay(0);
        delay.set_delay(2);
        let mut next_left = vec![9.0; 4];
        let mut next_right = vec![9.0; 4];
        delay.process(&mut next_left, &mut next_right, 4);

        assert_eq!(next_left, vec![0.0, 0.0, 9.0, 9.0]);
        assert_eq!(next_right, next_left);
    }

    #[test]
    fn a_device_declaring_no_latency_needs_no_dry_line() {
        assert!(CompensationDelay::for_latency(0).is_none());
    }

    #[test]
    fn a_dry_line_is_sized_to_the_declared_latency_and_capped_at_the_ceiling() {
        let modest = CompensationDelay::for_latency(512).expect("a latent device gets a line");
        assert_eq!(modest.capacity(), 512);
        assert_eq!(modest.delay(), 512);

        let absurd = CompensationDelay::for_latency(MAX_COMPENSATION_FRAMES * 4)
            .expect("a latent device gets a line");
        assert_eq!(absurd.capacity(), MAX_COMPENSATION_FRAMES);
        assert_eq!(absurd.delay(), MAX_COMPENSATION_FRAMES);
    }
}
