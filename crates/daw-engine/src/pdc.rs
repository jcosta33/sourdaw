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
///
/// A caller outside the engine builds a line and hands it over, which is why
/// construction is the whole of the published surface. Aiming or running one
/// belongs to the graph and its callback: a delay set from outside would put a
/// route out of alignment, and the next compensation pass would overwrite it
/// without ever reporting the discrepancy.
pub struct CompensationDelay {
    left: Vec<f32>,
    right: Vec<f32>,
    /// Where the next frame is written. The read position trails it by
    /// [`Self::delay`], so re-aiming the line costs an offset and nothing else.
    write: usize,
    delay: usize,
    /// Frames of valid history behind [`Self::write`]: how far back a read
    /// offset may reach and still land on audio this line itself carried.
    ///
    /// A ring is built silent, so the whole of it counts from the start, and
    /// every frame written adds one until the ring is full again. A restart
    /// resets it to the silence that restart laid down. What it decides is
    /// whether a hold is covered: a hold deeper than this reads slots that
    /// predate the last restart, which still hold whatever the line carried
    /// before it.
    covered: usize,
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
            // A fresh ring is silence all the way round, and silence is valid
            // history: any hold aimed at it reads zeroes back rather than
            // another route's audio.
            covered: capacity,
        }
    }

    /// The dry line a device declaring `latency_frames` needs while bypassed,
    /// or `None` for a device that declares none.
    ///
    /// Built at the ceiling whatever the figure is, and aimed at the declared
    /// one, clamped there. Capacity is what a later latency change has to
    /// re-aim inside: a line sized to its own figure could not take a deeper
    /// one, and swapping a fresh ring in instead would hand the next bypassed
    /// pass a hold's worth of silence. So every dry line is a ring the graph
    /// can point anywhere up to the ceiling, and a latency change is a
    /// read-offset jump like the one every route line takes.
    ///
    /// The declared figure itself is kept by the caller: it is what the
    /// graph's arrivals are computed from, and clamping it here would hide the
    /// claim the engineer has to see.
    pub fn for_latency(latency_frames: usize) -> Option<Box<Self>> {
        if latency_frames == 0 {
            return None;
        }
        let mut delay = Box::new(Self::new(MAX_COMPENSATION_FRAMES));
        delay.set_delay(latency_frames);
        Some(delay)
    }

    pub(crate) fn capacity(&self) -> usize {
        self.left.len() - 1
    }

    pub(crate) const fn delay(&self) -> usize {
        self.delay
    }

    /// Delay by `frames`, or by the capacity when more is asked for than the
    /// line holds. Returns whether it clamped, so a route the ceiling cut short
    /// is counted rather than left silently misaligned.
    ///
    /// Nothing is cleared while the hold stays inside the history behind the
    /// write head. Every line is written on every block the strip owning it
    /// renders — at zero delay too, where its caller feeds it instead of
    /// processing it — so the ring holds the last [`Self::covered`] frames of
    /// that route's signal. Re-aiming inside them is a read-offset jump into
    /// audio that is already current, and silence there would open a hole
    /// rather than close one.
    ///
    /// A hold deeper than that history is the other case: the slots it reaches
    /// back to predate the last restart and still carry whatever the line held
    /// before it, so the line restarts at the hold it is now pointed at. Only
    /// a line whose history was cut short pays that, because a restart is the
    /// one thing that shortens it: a route line, and a dry line that has been
    /// fed since it was built, never reach this branch, and the fill a line
    /// coming out of a detachment does reach is bounded by the newly declared
    /// hold rather than by the ring.
    pub(crate) fn set_delay(&mut self, frames: usize) -> bool {
        let capacity = self.capacity();
        let clamped = frames > capacity;
        self.delay = frames.min(capacity);
        if self.delay > self.covered {
            self.restart_from_silence();
        }
        clamped
    }

    /// Silence the only region that can still hand back stale audio, and
    /// restart the ring at its head.
    ///
    /// The one case a line is not written on every block: a device whose strip
    /// was torn down under it is in no chain at all, so nothing feeds or reads
    /// its line until some chain takes the device again. Left standing, the
    /// line would hand the removed strip's audio back at that re-placement.
    ///
    /// With `write` back at zero, [`Self::process`] starts reading at
    /// `slots - delay` and reaches slot zero exactly `delay` frames later, by
    /// which point every slot it visits was written earlier in that same call.
    /// So the trailing `delay` slots are the whole of what the line owes
    /// silence, and the bound on this work is the declared latency rather than
    /// the ring: every line the graph builds is sized at
    /// [`MAX_COMPENSATION_FRAMES`] so that it can be re-aimed anywhere, and a
    /// full fill would pay two ceiling-sized memsets on the callback to
    /// silence the handful of frames a device actually declares.
    ///
    /// That bound is also the whole of the history the line then has: the
    /// silence just laid down is valid, everything further back belongs to the
    /// era the line is leaving, and [`Self::covered`] is what records the
    /// difference.
    pub(crate) fn restart_from_silence(&mut self) {
        let slots = self.left.len();
        self.left[slots - self.delay..].fill(0.0);
        self.right[slots - self.delay..].fill(0.0);
        self.write = 0;
        self.covered = self.delay;
    }

    /// Record `frames` of freshly written audio behind the write head.
    ///
    /// Shared by both passes over the ring, so a fed line and a processed one
    /// cannot account for their history differently. It saturates at the
    /// capacity, because a ring holds no more than it holds.
    #[inline]
    fn advance_covered(&mut self, frames: usize) {
        self.covered = self.covered.saturating_add(frames).min(self.capacity());
    }

    /// One step round the ring: the only branch either pass over it takes per
    /// sample, and shared so a fed line and a processed one cannot advance
    /// differently.
    #[inline]
    const fn step(slots: usize, position: usize) -> usize {
        let next = position + 1;
        if next == slots {
            0
        } else {
            next
        }
    }

    /// Delay `frames` of stereo audio in place.
    ///
    /// A line at zero delay is the identity and returns without touching the
    /// ring. Its caller runs [`Self::feed`] over the same block instead, so
    /// the ring stays current while the route holds nothing; the guard here is
    /// what keeps the two passes from writing it twice.
    pub(crate) fn process(&mut self, left: &mut [f32], right: &mut [f32], frames: usize) {
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
            write = Self::step(slots, write);
            read = Self::step(slots, read);
        }
        self.write = write;
        self.advance_covered(frames);
    }

    /// Write `frames` of stereo audio into the line and read nothing back.
    ///
    /// The pass a line takes on a block it is not read on: a route line while
    /// it holds nothing, a dry line while its device runs. Either has to hold
    /// current audio the instant it *is* read, and a line left standing
    /// contains whatever was passing through it when it was last read —
    /// reading that back is a burst of audio from an earlier part of the
    /// session at full level. Written on every block its strip renders, at
    /// zero delay included, the ring always holds the last [`Self::capacity`]
    /// frames of the signal the route carries, so taking up a hold or taking a
    /// bypass reads on from where that signal actually is.
    pub(crate) fn feed(&mut self, left: &[f32], right: &[f32], frames: usize) {
        let slots = self.left.len();
        let mut write = self.write;
        for index in 0..frames {
            self.left[write] = left[index];
            self.right[write] = right[index];
            write = Self::step(slots, write);
        }
        self.write = write;
        self.advance_covered(frames);
    }

    /// Take this line's one pass over a block: read the hold back when it
    /// holds, write the block through when it does not.
    ///
    /// Every line is written on every block the route carrying it renders. A
    /// line at zero hold is fed rather than skipped, so the ring stays as
    /// current as the route it belongs to; taking up a hold later is then a
    /// read-offset jump into audio that is already there, and never a burst of
    /// the era the line was in when its hold was last dropped. The branch
    /// lives here so that no caller can write one half of that invariant.
    pub(crate) fn run(&mut self, left: &mut [f32], right: &mut [f32], frames: usize) {
        if self.delay > 0 {
            self.process(left, right, frames);
        } else {
            self.feed(left, right, frames);
        }
    }

    /// The ring itself, for a test that has to prove which slots a re-aiming
    /// touched. Deliberately not a published surface: nothing outside a test
    /// has any business reading the buffer a line runs on.
    #[cfg(test)]
    fn ring(&self) -> (&[f32], &[f32]) {
        (&self.left, &self.right)
    }

    /// Where the next frame lands, for a test that has to prove a re-aiming
    /// left the write head standing rather than restarting the line. Internal
    /// for the same reason [`Self::ring`] is.
    #[cfg(test)]
    const fn write_position(&self) -> usize {
        self.write
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

    /// The line a bypass reads has to hold what the running device was handed,
    /// so feeding it is what makes the switch seamless rather than a replay of
    /// whatever passed through the last time the device was bypassed.
    #[test]
    fn a_fed_line_hands_back_the_frames_it_was_fed_when_it_is_next_read() {
        let mut delay = CompensationDelay::new(4);
        delay.set_delay(4);

        let fed_left = ramp(8);
        let fed_right = ramp(8);
        delay.feed(&fed_left, &fed_right, 8);

        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        delay.process(&mut left, &mut right, 4);

        assert_eq!(
            left,
            vec![5.0, 6.0, 7.0, 8.0],
            "the read picks up on the frame after the last one fed"
        );
        assert_eq!(right, left);
        assert_eq!(
            (fed_left, fed_right),
            (ramp(8), ramp(8)),
            "a feed reads nothing back into the block it was handed"
        );
    }

    /// Feeding is the same walk round the ring processing is, so a feed longer
    /// than the ring leaves exactly the last `capacity` frames standing in it.
    #[test]
    fn a_feed_past_the_ring_leaves_the_last_frames_of_it_to_be_read_back() {
        let mut delay = CompensationDelay::new(4);
        delay.set_delay(4);

        delay.feed(&ramp(12), &ramp(12), 12);

        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        delay.process(&mut left, &mut right, 4);

        assert_eq!(
            left,
            vec![9.0, 10.0, 11.0, 12.0],
            "the four frames still in the ring are the four most recently fed"
        );
        assert_eq!(right, left);
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

    /// A line holding nothing is still written, so a hold taken up after a
    /// spell at zero — and one raised again after that — reads the audio that
    /// was passing while it stood at zero, never the era it was in when the
    /// hold was last dropped.
    #[test]
    fn a_line_written_while_it_holds_nothing_never_replays_the_era_it_left() {
        const NOW: f32 = -1.0;
        let mut delay = CompensationDelay::new(8);
        delay.set_delay(4);
        let mut left = ramp(8);
        let mut right = ramp(8);
        delay.process(&mut left, &mut right, 8);

        // At zero the caller feeds rather than processes, so the ring goes on
        // holding what the route actually carries.
        delay.set_delay(0);
        let passing = vec![NOW; 8];
        delay.feed(&passing, &passing, 8);

        delay.set_delay(2);
        let mut short_left = vec![NOW; 2];
        let mut short_right = vec![NOW; 2];
        delay.process(&mut short_left, &mut short_right, 2);

        delay.set_delay(6);
        let mut long_left = vec![NOW; 6];
        let mut long_right = vec![NOW; 6];
        delay.process(&mut long_left, &mut long_right, 6);

        assert_eq!(
            short_left,
            vec![NOW; 2],
            "the hold taken up after the zero span reads what was fed during it"
        );
        assert_eq!(short_right, short_left);
        assert_eq!(
            long_left,
            vec![NOW; 6],
            "and deepening it again reads on, rather than back into the ramp"
        );
        assert_eq!(long_right, long_left);
    }

    /// The one case a line still owes silence: its device's strip was torn
    /// down under it, so nothing wrote the ring while it waited.
    ///
    /// The shape every dry line is in: a ring built at the ceiling, aimed at
    /// the figure its device declares, so the region that owes silence is the
    /// declared latency rather than the ring.
    #[test]
    fn restarting_from_silence_clears_the_tail_the_read_head_traverses_and_nothing_else() {
        let mut delay = CompensationDelay::new(8);
        delay.set_delay(8);
        let mut left = ramp(8);
        let mut right = ramp(8);
        delay.process(&mut left, &mut right, 8);

        delay.set_delay(2);
        delay.restart_from_silence();

        // The read head starts two slots from the end and reaches the slots
        // this line's next call writes immediately after, so those two are the
        // whole of what can still hand back stale audio. Clearing the rest is
        // a ceiling-sized memset the audio callback would pay for nothing.
        let (ring_left, ring_right) = delay.ring();
        assert_eq!(
            ring_left,
            [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 0.0, 0.0].as_slice()
        );
        assert_eq!(ring_right, ring_left);
    }

    /// The far end of the same bound: a line aimed at everything its ring
    /// holds. The read head still never reaches the one slot the next call
    /// writes first, so even here the fill stops one slot short.
    #[test]
    fn restarting_from_silence_at_a_delay_the_whole_ring_holds_still_spares_the_first_slot() {
        let mut delay = CompensationDelay::new(4);
        delay.set_delay(4);
        let mut left = ramp(4);
        let mut right = ramp(4);
        delay.process(&mut left, &mut right, 4);

        delay.restart_from_silence();

        let (ring_left, ring_right) = delay.ring();
        assert_eq!(ring_left, [1.0, 0.0, 0.0, 0.0, 0.0].as_slice());
        assert_eq!(ring_right, ring_left);

        let mut next_left = vec![9.0; 4];
        let mut next_right = vec![9.0; 4];
        delay.process(&mut next_left, &mut next_right, 4);
        assert_eq!(
            next_left,
            vec![0.0; 4],
            "the slot left standing is written before the read head arrives at it"
        );
        assert_eq!(next_right, next_left);
    }

    #[test]
    fn a_device_declaring_no_latency_needs_no_dry_line() {
        assert!(CompensationDelay::for_latency(0).is_none());
    }

    /// A dry line is built at the ceiling whatever its device declares, so a
    /// later latency change is re-aimed into the ring the device is already
    /// running rather than swapped for a fresh one holding nothing.
    #[test]
    fn a_dry_line_is_built_at_the_ceiling_and_aimed_at_the_declared_latency() {
        let modest = CompensationDelay::for_latency(512).expect("a latent device gets a line");
        assert_eq!(modest.capacity(), MAX_COMPENSATION_FRAMES);
        assert_eq!(modest.delay(), 512);

        let absurd = CompensationDelay::for_latency(MAX_COMPENSATION_FRAMES * 4)
            .expect("a latent device gets a line");
        assert_eq!(absurd.capacity(), MAX_COMPENSATION_FRAMES);
        assert_eq!(absurd.delay(), MAX_COMPENSATION_FRAMES);
    }

    /// The branch every route-line site takes, in one place: a line that holds
    /// reads its hold back, and a line that holds nothing is still written.
    #[test]
    fn running_a_line_that_holds_nothing_writes_the_block_through_and_keeps_the_ring_current() {
        let mut delay = CompensationDelay::new(8);

        let mut passing = ramp(8);
        let mut passing_right = ramp(8);
        delay.run(&mut passing, &mut passing_right, 8);
        assert_eq!(passing, ramp(8), "a line at zero hold passes its block on");
        assert_eq!(passing_right, passing);

        delay.set_delay(4);
        let mut held = vec![-1.0; 4];
        let mut held_right = vec![-1.0; 4];
        delay.run(&mut held, &mut held_right, 4);
        assert_eq!(
            held,
            vec![5.0, 6.0, 7.0, 8.0],
            "and the hold taken up after it reads the frames that ran through while it held nothing"
        );
        assert_eq!(held_right, held);
    }

    /// What decides whether a re-aiming may be taken in place is the history
    /// behind the write head, not where the line's device happens to sit. A
    /// line whose history was cut short by a restart owes silence for any hold
    /// reaching past that restart, because those slots still carry the era it
    /// left.
    #[test]
    fn a_hold_deeper_than_the_history_behind_the_write_head_restarts_the_line() {
        let mut delay = CompensationDelay::new(8);
        delay.feed(&ramp(8), &ramp(8), 8);

        // Fed its whole capacity, so every hold the ring admits is covered.
        delay.set_delay(4);
        let (ring_left, ring_right) = delay.ring();
        assert_eq!(
            ring_left,
            [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 0.0].as_slice(),
            "a covered hold leaves the ring exactly as the feed left it"
        );
        assert_eq!(ring_right, ring_left);
        assert_eq!(
            delay.write_position(),
            8,
            "and leaves the write head where it stood"
        );

        let mut left = vec![-1.0; 4];
        let mut right = vec![-1.0; 4];
        delay.process(&mut left, &mut right, 4);
        assert_eq!(
            left,
            vec![5.0, 6.0, 7.0, 8.0],
            "so the hold reads the material four frames behind the write head"
        );
        assert_eq!(right, left);

        // A detachment cuts the history back to the silence it laid down.
        delay.restart_from_silence();
        delay.feed(&[9.0; 2], &[9.0; 2], 2);

        // Four frames of restart silence plus two fed: a six-frame hold is the
        // deepest one still covered.
        delay.set_delay(6);
        let (ring_left, ring_right) = delay.ring();
        assert_eq!(
            ring_left,
            [9.0, 9.0, -1.0, 4.0, 5.0, 0.0, 0.0, 0.0, 0.0].as_slice(),
            "a hold the history exactly covers is taken in place"
        );
        assert_eq!(ring_right, ring_left);
        assert_eq!(delay.write_position(), 2);

        delay.set_delay(7);
        let (ring_left, ring_right) = delay.ring();
        assert_eq!(
            ring_left,
            [9.0, 9.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0].as_slice(),
            "one frame deeper reaches past the restart, so the line restarts at the new hold"
        );
        assert_eq!(ring_right, ring_left);
        assert_eq!(delay.write_position(), 0);
    }

    /// The cost is paid only where it is owed. A ring is built silent, and
    /// silence is history a hold may read, so no line pays a restart for its
    /// first aiming however deep it is — which is every dry line the control
    /// thread ships.
    #[test]
    fn a_fresh_line_takes_any_hold_without_restarting() {
        let mut delay = CompensationDelay::new(8);
        delay.feed(&ramp(3), &ramp(3), 3);

        delay.set_delay(8);

        assert_eq!(
            delay.write_position(),
            3,
            "the deepest hold the ring admits leaves the write head where the feed left it"
        );
        let (ring_left, ring_right) = delay.ring();
        assert_eq!(
            ring_left,
            [1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0].as_slice(),
            "and the frames already fed still stand"
        );
        assert_eq!(ring_right, ring_left);

        let mut left = vec![-1.0; 3];
        let mut right = vec![-1.0; 3];
        delay.process(&mut left, &mut right, 3);
        assert_eq!(
            left,
            vec![0.0; 3],
            "the hold reads the ring's own silence, which is what made it covered"
        );
        assert_eq!(right, left);
    }
}
