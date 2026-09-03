//! The capture ring: what the input device's callback writes and the audio
//! owner thread's callback reads.
//!
//! # Buffer and latency contract
//!
//! **What the ring holds.** Interleaved `f32` exactly as the input device
//! delivers it — no deinterleave, no format conversion, no rate conversion.
//! Capacity is decided when the input stream opens and never changes: the
//! writer runs on the capture thread and the reader on the audio thread, and
//! neither may allocate.
//!
//! **Ceilings size the ring; the running cadence is observed.** The two
//! figures an open can offer are bounds, not rates. A backend reports the
//! largest block a device may hand back, which is what the device advertised
//! rather than what it runs — a mic advertising 4096 while running 512 is
//! ordinary — and the engine knows only the largest read it will ever ask
//! for, because the period the render callback is handed is the output
//! device's business and is not this ring's to know. Spending either figure
//! as a cadence would settle the ring at a depth the stream never needed and
//! publish a latency the take was never delayed by. So [`CaptureShape`] sizes
//! capacity from the ceilings, and everything that follows a rate — the
//! settled depth, the shed quantum, the published latency — is derived from
//! the block the writer was actually handed and the slice the reader was
//! actually given.
//!
//! **What refuses.** Input and output are opened at one rate. A device whose
//! rate is not the engine's is refused at open
//! ([`crate::device::InputOpenRefusal::SampleRateMismatch`]) and reported
//! through the engine's existing stream-error route. The engine never
//! resamples capture: a resampler on the record path is a pitch and phase
//! decision the musician did not make. Past the open, input and output are
//! independent clocks that drift against each other; the ring's slack absorbs
//! the drift and the counters below record what it cost, because the
//! alternative — resampling to hold them together — is the thing this crate
//! refuses to do.
//!
//! A block the writer cannot interpret is refused whole rather than written
//! in part: one whose channel count is not the ring's, and one whose length is
//! not a whole number of frames. Writing a partial frame would rotate which
//! channel every later sample belongs to for the rest of the session, which is
//! silent corruption rather than counted loss. A block merely longer or
//! shorter than another is *not* refused — the ring is a sample FIFO, and
//! absorbing a device that jitters its block size is what it is for.
//!
//! **The settle law.** Mirrored from [`crate::audio_bridge`], because the
//! shape of the problem is the same: a producer and a consumer on cadences
//! nothing locks together, and a depth that only ever grows if left alone. The
//! depth the ring settles at covers the read twice over plus a block of slack
//! either side. The reader fills to that depth before it hands anything out,
//! then takes exactly the slice it was given per callback. A depth above the
//! target after a take is drift the reader shortens by one observed block per
//! pass — processed nowhere, counted here — so capture latency settles at the
//! target instead of ratcheting up to the ring's capacity and staying there.
//!
//! The depth is sized from the largest block and the largest read seen since
//! the last stall, not from the ones in hand, so a device alternating block
//! sizes and a callback alternating slice sizes both settle once at the depth
//! their largest needs and are served on every callback in between — the
//! jitter the ring exists to absorb. Only a block or a read bigger than any
//! seen before deepens the target, and that refills the ring before it serves
//! again: nothing else ever fills toward a deeper target, because the shed
//! only enforces the target downward.
//!
//! The law covers one read, so a consumer that splits one device period into
//! several back-to-back reads spends the depth without the writer getting a
//! turn between them. The render callback does exactly that above
//! [`crate::audio_thread::MAX_CALLBACK_FRAMES`], and the depth covers the read
//! twice over, so an output period past twice that limit can underrun its
//! third chunk. That is the same class of device the plugin bridge already
//! counts as over reach, no backend advertises one, and the failure is a
//! counted shortfall rather than corruption — so it is disclosed here and
//! carries no code.
//!
//! **After a stall.** An underrun drops the reader back to unsettled, so it
//! refills to the target before serving again, and the published latency goes
//! back to zero until it does. A reader that kept taking whatever happened to
//! be there would run at the ring's floor for the rest of the session while
//! still publishing the settled figure. Both ceilings are dropped with it, so
//! the refill re-learns the cadence from the blocks and reads that follow.
//!
//! **What the latency figure means.** The largest block seen plus the depth
//! that block and the largest read settle at: the frames between a sample
//! arriving at the device and the same sample leaving
//! [`CaptureRingReader::read_into`]. It is published at the settle, where the
//! depth check has just proved the ring holds at least that much, and only
//! there — a figure published on every take would claim the target as soon as
//! the target moved, and nothing fills toward a deeper target. It is
//! republished on each later settle, because a cadence can grow under a
//! running stream: CoreAudio's buffer frame size is device-global, so another
//! application can walk a device from 512-frame callbacks to 4096-frame ones
//! mid-session, and the ring refills to the new target and publishes the new
//! figure. A block or a read that permanently *shrinks* without a stall keeps
//! the larger figure until the next stall or stream restart. That figure stays
//! true — the ring really does hold that depth — it is merely conservative,
//! which is the right direction for a take offset. Zero means the ring is not serving —
//! it has not settled yet, a stall dropped it back to filling, or a growing
//! cadence did — and a control thread must read it as "no figure", never as
//! "no latency".
//!
//! **What is counted.** Input blocks the writer refused, whether because the
//! ring was full, because the block's layout was not the ring's, or because it
//! ran past the ceiling the ring was sized against; reads that could not be
//! filled after the ring had settled, and reads refused for a shape the ring
//! will not serve; and samples the reader discarded to hold the settled depth.
//! Every sample this path loses is one of those three, and each is an atomic
//! the control side reads.

use rtrb::{Consumer, Producer, RingBuffer};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

/// Input blocks of slack the ring carries above what the settle law needs.
/// Mirrors the four blocks [`crate::audio_bridge`] carries, for the same
/// reason: ordinary jitter must not reach the refusal path.
const RING_SLACK_BLOCKS: usize = 4;

/// The depth the ring settles at for one observed cadence, in frames.
///
/// The law of [`crate::audio_bridge::target_depth_blocks`], with the block the
/// device delivered standing where the render quantum stands: the read covered
/// twice over, plus a block of slack either side.
pub(crate) const fn target_depth_frames(block_frames: usize, read_frames: usize) -> usize {
    (read_frames.div_ceil(block_frames) * 2 + 2) * block_frames
}

/// The bounds an input open settled, in the units the ring works in.
///
/// Both figures are ceilings. Neither is a cadence, and nothing here treats
/// one as a cadence.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CaptureShape {
    /// The most frames one input block may carry — what the device
    /// advertised, not what it runs.
    pub input_block_ceiling: usize,
    /// The most frames one read may ask for.
    pub output_read_ceiling: usize,
    /// Interleaved channels each captured frame carries.
    pub channels: usize,
}

impl CaptureShape {
    /// Frames the ring holds.
    ///
    /// Capacity is the one decision that cannot be revised once the stream is
    /// open, so it is bounded rather than fitted: it has to hold the worst
    /// settled depth plus one worst read for *every* cadence the two ceilings
    /// admit. For a largest observed block `b <= B` and read `r <= R` the law
    /// asks for `(ceil(r/b) * 2 + 2) * b` frames, and `ceil(r/b) * b < r + b`,
    /// so that depth stays under `2r + 4b` and therefore under `2R + 4B`.
    /// Adding the read the reader takes whole gives `3R + 4B`, which is what
    /// makes a ring that can always settle and then serve; the slack sits on
    /// top of that, so ordinary jitter never reaches the refusal path.
    pub const fn ring_frames(self) -> usize {
        3 * self.read_ceiling() + (4 + RING_SLACK_BLOCKS) * self.block_ceiling()
    }

    /// The block ceiling every calculation here works in.
    ///
    /// A zero ceiling is refused at the seam. Standing it up as one frame
    /// keeps the arithmetic total, so a defensive caller gets a small usable
    /// ring rather than a zero-capacity one on the thread that owns the
    /// stream.
    const fn block_ceiling(self) -> usize {
        if self.input_block_ceiling == 0 {
            1
        } else {
            self.input_block_ceiling
        }
    }

    /// The read ceiling every calculation here works in, on the same footing
    /// as [`Self::block_ceiling`].
    const fn read_ceiling(self) -> usize {
        if self.output_read_ceiling == 0 {
            1
        } else {
            self.output_read_ceiling
        }
    }

    /// The interleaved channel count every calculation here works in, on the
    /// same footing as [`Self::block_ceiling`].
    const fn lanes(self) -> usize {
        if self.channels == 0 {
            1
        } else {
            self.channels
        }
    }

    const fn interleaved(self, frames: usize) -> usize {
        frames * self.lanes()
    }
}

/// What the capture path lost, and where.
///
/// Written from the capture thread and the audio thread with relaxed
/// read-modify-writes — wait-free, allocation-free, and ordered against
/// nothing, because a count is only ever read for what it says about the
/// session as a whole.
#[derive(Debug, Default)]
pub struct CaptureCounters {
    blocks_refused: AtomicU64,
    underruns: AtomicU64,
    samples_shed: AtomicU64,
}

impl CaptureCounters {
    /// Input blocks the writer refused: the ring could not hold them, or their
    /// layout was not the ring's.
    pub fn blocks_refused(&self) -> u64 {
        self.blocks_refused.load(Ordering::Relaxed)
    }

    /// Reads that could not be filled once the ring had settled. Startup fill,
    /// and the refill after a stall, are not counted here: filling is not a
    /// shortfall.
    pub fn underruns(&self) -> u64 {
        self.underruns.load(Ordering::Relaxed)
    }

    /// Samples discarded to hold the ring at its settled depth — the price of
    /// two independent clocks that the engine will not pay with a resampler.
    pub fn samples_shed(&self) -> u64 {
        self.samples_shed.load(Ordering::Relaxed)
    }
}

/// The capture thread's end of the ring.
pub struct CaptureRingWriter {
    producer: Producer<f32>,
    counters: Arc<CaptureCounters>,
    observed_block_frames: Arc<AtomicUsize>,
    block_ceiling_samples: usize,
    channels: usize,
}

impl CaptureRingWriter {
    /// Write one input block, or refuse it whole.
    ///
    /// Whole blocks, never partial ones: a half-written block splices the
    /// remainder of a device period into the next one, which reads downstream
    /// as audio that arrived rather than as audio that was lost.
    ///
    /// `channels` travels with the block, as it does on the render side, so a
    /// device-invalidation recovery that resumes this callback on a different
    /// layout is refused rather than written into a ring shaped for the old
    /// one. A length that is not a whole number of frames is refused for the
    /// stronger reason: writing it would rotate every later sample's channel.
    ///
    /// A block longer than the ceiling the ring was sized against is refused
    /// too. This is an invariant guard rather than a recovery: the ceiling is
    /// what the backend said the device may deliver, and no ALSA or CoreAudio
    /// stream exceeds its own advertised maximum. Were one to, the depth the
    /// reader would settle at could pass the ring's capacity and the reader
    /// would never serve a sample again — a silent, permanent failure in
    /// exchange for accepting one block the ring was never shaped for.
    ///
    /// An accepted block also publishes its own size, which is the only place
    /// the running input cadence is ever observed. A refused block publishes
    /// nothing — it is not evidence of what the device delivers.
    #[inline]
    pub fn write_block(&mut self, block: &[f32], channels: usize) {
        if channels != self.channels
            || block.len() % self.channels != 0
            || block.len() > self.block_ceiling_samples
            || self.producer.push_entire_slice(block).is_err()
        {
            self.counters.blocks_refused.fetch_add(1, Ordering::Relaxed);
            return;
        }

        self.observed_block_frames
            .store(block.len() / self.channels, Ordering::Relaxed);
    }
}

/// The audio thread's end of the ring.
pub struct CaptureRingReader {
    consumer: Consumer<f32>,
    counters: Arc<CaptureCounters>,
    observed_block_frames: Arc<AtomicUsize>,
    latency_frames: Arc<AtomicUsize>,
    published_latency: usize,
    /// The largest read the ring was sized against, in samples. Capacity is
    /// bounded on the hypothesis that no read exceeds it
    /// ([`CaptureShape::ring_frames`]), so the reader enforces the hypothesis
    /// rather than trusting it.
    read_ceiling_samples: usize,
    channels: usize,
    settled: bool,
    /// The largest block the writer has been seen to deliver, and the largest
    /// slice this reader has been asked for, since the last stall. The target
    /// follows this pair rather than the block and read of the moment, so a
    /// device or a render callback that alternates sizes settles once at the
    /// depth its largest needs and is served on every callback in between.
    /// Audio-thread private: the writer publishes each block it accepts, and
    /// the running maxima are the reader's own.
    block_ceiling_frames: usize,
    read_ceiling_frames: usize,
    /// The pair this reader last settled at. Everything the settle law derives
    /// is a function of the two ceilings, so a rise in either is exactly when
    /// the ring owes a re-settle — and neither ever falls without a stall.
    settled_block_ceiling_frames: usize,
    settled_read_ceiling_frames: usize,
}

impl CaptureRingReader {
    /// Fill `out` with captured audio, or report that this callback has none.
    ///
    /// Nothing is handed out until the ring has first reached the depth this
    /// callback's cadence settles at, so the very first blocks a device
    /// delivers become the slack the rest of the session runs on rather than
    /// audio that immediately underruns. The cadence is taken from the last
    /// largest block the writer has been seen to deliver and the largest `out`
    /// this reader has been given, not from the ceilings the ring was sized
    /// against. Either one bigger than anything seen before deepens the target,
    /// and the ring fills to it before serving again, exactly as from a cold
    /// open; a smaller one changes nothing, because the depth already covers
    /// it.
    #[inline]
    pub fn read_into(&mut self, out: &mut [f32]) -> bool {
        let block_frames = self.observed_block_frames.load(Ordering::Relaxed);
        if block_frames == 0 {
            // No block has been accepted yet, so there is no cadence to size a
            // depth from. Not a shortfall: the device has not started
            // delivering, which is the state every stream opens in.
            return false;
        }

        if out.len() > self.read_ceiling_samples || out.len() % self.channels != 0 {
            // Two reads the ring will not serve, and neither is reachable from
            // the engine: the ceiling covers the largest callback it accepts,
            // and a render callback's slice is always a whole number of frames.
            // They are guarded rather than trusted because both fail silently.
            // A slice past the ceiling is the one capacity was bounded
            // against, so serving it could settle a depth the ring cannot hold
            // and the reader would never hand out another sample; a slice that
            // is not a whole number of frames would rotate which channel every
            // later sample belongs to — the same corruption `write_block`
            // refuses a partial block for. Counted, and the reader is left
            // exactly as it was.
            self.counters.underruns.fetch_add(1, Ordering::Relaxed);
            return false;
        }

        let read_frames = out.len() / self.channels;
        // The depth follows the worst block and the worst read seen, not the
        // ones in hand. Either axis sized from the value of the moment would
        // deepen the target on every large one and shed back down on every
        // small one, refusing a share of the callbacks forever while counting
        // no shortfall — and both jitter in practice: a device alternates its
        // block size, and a render callback is handed whatever slice the
        // output stream has for it.
        self.block_ceiling_frames = self.block_ceiling_frames.max(block_frames);
        self.read_ceiling_frames = self.read_ceiling_frames.max(read_frames);
        let block_ceiling = self.block_ceiling_frames;
        let read_ceiling = self.read_ceiling_frames;
        let target_frames = target_depth_frames(block_ceiling, read_ceiling);
        let target_depth_samples = target_frames * self.channels;

        if self.settled
            && (block_ceiling != self.settled_block_ceiling_frames
                || read_ceiling != self.settled_read_ceiling_frames)
        {
            // The cadence outgrew the depth this reader filled to. Not a
            // stall, so nothing is counted: serving on would hand out audio
            // from a depth nothing ever filled to, while publishing a delay
            // the take does not suffer. Only a rise ever reaches here, because
            // neither ceiling falls without a stall.
            self.settled = false;
        }

        if !self.settled {
            if self.consumer.slots() < target_depth_samples {
                // Still filling. The figure is retracted here rather than at
                // the cadence change, so a re-settle the ring already has the
                // depth for never shows a control thread a spurious zero.
                self.publish_latency(0);
                return false;
            }

            self.settled = true;
            self.settled_block_ceiling_frames = block_ceiling;
            self.settled_read_ceiling_frames = read_ceiling;
            // The one place the figure is published: the depth check above is
            // what backs it, so the ring was observed to hold at least the
            // frames the figure claims.
            self.publish_latency(block_ceiling + target_frames);
        }

        if self.consumer.pop_entire_slice(out).is_err() {
            self.counters.underruns.fetch_add(1, Ordering::Relaxed);
            // Rebuild the slack before serving again, and stop publishing a
            // figure that no longer describes anything. Carrying on from
            // whatever survived the stall would leave the reader running at
            // the ring's floor while still reporting the settled latency. The
            // ceilings go with it, so the refill re-learns the cadence from
            // the blocks and reads that follow rather than from sizes neither
            // side may still be running.
            self.settled = false;
            self.block_ceiling_frames = 0;
            self.read_ceiling_frames = 0;
            self.publish_latency(0);
            return false;
        }

        self.shed_above_target(target_depth_samples, block_frames * self.channels);
        true
    }

    /// Publish what the ring currently costs, if it has moved.
    ///
    /// The comparison is against the reader's own copy rather than a load of
    /// the slot, so the common path — a settled stream on a steady cadence —
    /// is one comparison and no atomic traffic at all.
    #[inline]
    fn publish_latency(&mut self, frames: usize) {
        if frames == self.published_latency {
            return;
        }

        self.published_latency = frames;
        self.latency_frames.store(frames, Ordering::Relaxed);
    }

    /// Frames of latency this ring is currently adding, or zero while it is
    /// not serving. The same value the slot handed to [`capture_ring`] holds.
    pub fn latency_frames(&self) -> usize {
        self.latency_frames.load(Ordering::Relaxed)
    }

    /// The counters this ring publishes, for a control thread to read.
    pub fn counters(&self) -> &Arc<CaptureCounters> {
        &self.counters
    }

    /// Shorten a ring that has drifted above its settled depth by one observed
    /// block, the way the bridge sheds one block per pass: a drift correction
    /// spread over successive callbacks, never a jump that takes a whole
    /// device period of audio out at once.
    #[inline]
    fn shed_above_target(&mut self, target_depth_samples: usize, block_samples: usize) {
        let depth = self.consumer.slots();
        if depth <= target_depth_samples {
            return;
        }

        let excess = (depth - target_depth_samples).min(block_samples);
        let Ok(chunk) = self.consumer.read_chunk(excess) else {
            return;
        };
        chunk.commit_all();
        self.counters
            .samples_shed
            .fetch_add(excess as u64, Ordering::Relaxed);
    }
}

/// Build the ring an input stream writes and the render callback reads.
///
/// Every allocation the capture path will ever make happens here, on the
/// thread that opens the stream — the cadence slot the writer publishes into
/// and the latency slot the reader publishes into included.
///
/// `latency_frames` is the caller's own slot, so a control thread can read
/// what the ring costs without reaching the reader that lives on the audio
/// thread. It reads zero until the ring settles.
pub fn capture_ring(
    shape: CaptureShape,
    latency_frames: Arc<AtomicUsize>,
) -> (CaptureRingWriter, CaptureRingReader) {
    let counters = Arc::new(CaptureCounters::default());
    let observed_block_frames = Arc::new(AtomicUsize::new(0));
    let capacity = shape.interleaved(shape.ring_frames());
    let (producer, consumer) = RingBuffer::new(capacity);

    latency_frames.store(0, Ordering::Relaxed);

    let writer = CaptureRingWriter {
        producer,
        counters: Arc::clone(&counters),
        observed_block_frames: Arc::clone(&observed_block_frames),
        block_ceiling_samples: shape.interleaved(shape.block_ceiling()),
        channels: shape.lanes(),
    };
    let reader = CaptureRingReader {
        consumer,
        counters,
        observed_block_frames,
        latency_frames,
        published_latency: 0,
        read_ceiling_samples: shape.interleaved(shape.read_ceiling()),
        channels: shape.lanes(),
        settled: false,
        block_ceiling_frames: 0,
        read_ceiling_frames: 0,
        settled_block_ceiling_frames: 0,
        settled_read_ceiling_frames: 0,
    };

    (writer, reader)
}

#[cfg(test)]
mod tests {
    use super::{
        capture_ring, target_depth_frames, CaptureRingReader, CaptureRingWriter, CaptureShape,
    };
    use crate::audio_bridge::{target_depth_blocks, RENDER_QUANTUM_FRAMES};
    use crate::audio_thread::MAX_CALLBACK_FRAMES;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    const CHANNELS: usize = 2;

    /// What the device advertises. Deliberately far above what it runs below:
    /// a mic advertising 4096 while delivering 512 is the ordinary CoreAudio
    /// case, and the whole point of the shape is that the advertisement sizes
    /// the ring and decides nothing else.
    const SHAPE: CaptureShape = CaptureShape {
        input_block_ceiling: 4096,
        output_read_ceiling: MAX_CALLBACK_FRAMES,
        channels: CHANNELS,
    };

    /// What the device runs, and what the render callback asks for.
    const BLOCK: usize = 128;
    const READ: usize = 512;

    fn ring(shape: CaptureShape) -> (CaptureRingWriter, CaptureRingReader, Arc<AtomicUsize>) {
        let latency = Arc::new(AtomicUsize::new(0));
        let (writer, reader) = capture_ring(shape, Arc::clone(&latency));
        (writer, reader, latency)
    }

    fn block(frames: usize) -> Vec<f32> {
        vec![0.5; frames * CHANNELS]
    }

    fn out(frames: usize) -> Vec<f32> {
        vec![0.0; frames * CHANNELS]
    }

    #[test]
    fn the_settled_depth_follows_the_bridge_law_for_the_observed_cadence() {
        // Same arithmetic as the round trip the plugin bridge settles at, with
        // the block the device delivered standing where the render quantum
        // stands.
        assert_eq!(
            target_depth_frames(RENDER_QUANTUM_FRAMES, READ),
            target_depth_blocks(READ) * RENDER_QUANTUM_FRAMES
        );
    }

    #[test]
    fn the_cadence_comes_from_the_blocks_written_not_from_the_ceiling() {
        // The ring advertises 4096. The device runs 512 and the callback asks
        // for 256. Sizing the depth from the advertisement would settle eight
        // times deeper and publish a latency the take never suffered.
        let device_block = 512;
        let read = 256;
        let (mut writer, mut reader, latency) = ring(SHAPE);
        let target = target_depth_frames(device_block, read);
        let mut destination = out(read);

        assert_eq!(latency.load(Ordering::Relaxed), 0);
        for _ in 0..target.div_ceil(device_block) + 1 {
            writer.write_block(&block(device_block), CHANNELS);
        }

        assert!(reader.read_into(&mut destination));
        assert_eq!(
            latency.load(Ordering::Relaxed),
            device_block + target,
            "the published latency has to describe the cadence the stream runs"
        );
        assert!(
            latency.load(Ordering::Relaxed)
                < SHAPE.input_block_ceiling + target_depth_frames(SHAPE.input_block_ceiling, read),
            "the ceiling must not be what the figure is built from"
        );
    }

    #[test]
    fn the_ring_holds_every_cadence_its_ceilings_admit() {
        // Capacity is fixed at open, so it has to cover the worst settled
        // depth plus one worst read for every block size and read size the
        // ceilings allow — including a read above the largest callback the
        // engine accepts, and a block that is the whole advertised ceiling.
        for &block_frames in &[1, 16, 64, 128, 480, 512, 1024, 2048, 4096] {
            for &read_frames in &[1, 64, 128, 256, 512, 1024, 2048, 4096] {
                let needed = target_depth_frames(block_frames, read_frames) + read_frames;
                assert!(
                    SHAPE.ring_frames() >= needed,
                    "a {block_frames}-frame block read in {read_frames}s needs {needed} frames, \
                     sized at {}",
                    SHAPE.ring_frames()
                );
            }
        }
    }

    #[test]
    fn every_cadence_the_ceilings_admit_settles_and_then_serves() {
        // The bound above, exercised rather than asserted: each cadence has to
        // reach its target and hand out a whole read, with the shed reaching a
        // target the ring can actually exceed.
        for &block_frames in &[64, 128, 512, 4096] {
            for &read_frames in &[128, 512, 4096] {
                let (mut writer, mut reader, latency) = ring(SHAPE);
                let mut destination = out(read_frames);
                let mut served = 0;

                for _ in 0..200 {
                    for _ in 0..read_frames.div_ceil(block_frames) + 1 {
                        writer.write_block(&block(block_frames), CHANNELS);
                    }
                    if reader.read_into(&mut destination) {
                        served += 1;
                    }
                }

                assert!(
                    served > 0,
                    "a {block_frames}-frame block read in {read_frames}s never settled"
                );
                assert_eq!(
                    latency.load(Ordering::Relaxed),
                    block_frames + target_depth_frames(block_frames, read_frames)
                );
                assert!(reader.counters().samples_shed() > 0);
            }
        }
    }

    #[test]
    fn a_reader_that_has_seen_no_block_serves_nothing_and_counts_nothing() {
        // Before the first block there is no cadence, so there is no depth to
        // fill to. Counting this as a shortfall would report every stream's
        // opening milliseconds as a failure.
        let (_writer, mut reader, latency) = ring(SHAPE);
        let mut destination = out(READ);

        assert!(!reader.read_into(&mut destination));
        assert_eq!(reader.counters().underruns(), 0);
        assert_eq!(latency.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn a_read_the_ring_could_never_hold_is_refused_without_unsettling_it() {
        // Unreachable from the engine, which never asks for more than the read
        // ceiling the ring was sized with. Falling through to the pop would
        // underrun on every callback and drop a settled reader back to filling
        // for the life of the stream.
        let (mut writer, mut reader, latency) = ring(SHAPE);
        let mut destination = out(READ);
        let target = target_depth_frames(BLOCK, READ);

        for _ in 0..target.div_ceil(BLOCK) + 1 {
            writer.write_block(&block(BLOCK), CHANNELS);
        }
        assert!(reader.read_into(&mut destination));
        let settled_latency = latency.load(Ordering::Relaxed);

        let mut oversized = out(SHAPE.ring_frames() + 1);
        assert!(!reader.read_into(&mut oversized));
        assert_eq!(reader.counters().underruns(), 1);
        assert_eq!(
            latency.load(Ordering::Relaxed),
            settled_latency,
            "a read nobody could serve must not retract the figure the ring is holding"
        );

        // Nothing is written before the follow-up read, deliberately. The ring
        // now holds one whole read and less than the target, which only a
        // reader that is still settled will serve — a reader knocked back to
        // filling would resettle instead, and a ring topped back above the
        // target first would hide the difference.
        let depth = reader.consumer.slots() / CHANNELS;
        assert!(depth >= READ && depth < target, "{depth} frames held");
        assert!(reader.read_into(&mut destination));
        assert_eq!(reader.counters().underruns(), 1);
    }

    #[test]
    fn a_read_past_the_ceiling_the_ring_was_sized_against_is_refused() {
        // Capacity is bounded on the hypothesis that no read exceeds the
        // ceiling. A read one frame past it still fits the ring today, so
        // nothing downstream fails — but the depth it would settle at is
        // outside the bound the capacity proof rests on, and the first read
        // large enough to reach that depth would leave the reader filling for
        // the life of the stream. The hypothesis is enforced here so it stops
        // being an assumption about callers.
        let (mut writer, mut reader, latency) = ring(SHAPE);
        let mut destination = out(READ);
        let target = target_depth_frames(BLOCK, READ);

        for _ in 0..target.div_ceil(BLOCK) + 1 {
            writer.write_block(&block(BLOCK), CHANNELS);
        }
        assert!(reader.read_into(&mut destination));
        let settled_latency = latency.load(Ordering::Relaxed);

        let mut past_the_ceiling = out(SHAPE.output_read_ceiling + 1);
        assert!(
            past_the_ceiling.len() < SHAPE.ring_frames() * CHANNELS,
            "the read has to fit the ring, or capacity rather than the ceiling refuses it"
        );
        assert!(!reader.read_into(&mut past_the_ceiling));
        assert_eq!(reader.counters().underruns(), 1);
        assert!(
            past_the_ceiling.iter().all(|sample| *sample == 0.0),
            "a refused read hands out no part of the ring"
        );
        assert_eq!(
            latency.load(Ordering::Relaxed),
            settled_latency,
            "a read nobody was ever going to serve must not retract the figure"
        );

        // Nothing is written in between, so only a reader left settled serves
        // this: one knocked back to filling would refill instead.
        assert!(reader.read_into(&mut destination));
        assert_eq!(reader.counters().underruns(), 1);
    }

    #[test]
    fn the_published_figure_follows_a_device_that_changes_its_block_size() {
        // CoreAudio's buffer frame size is device-global, so another
        // application can walk a running device from 128-frame callbacks to
        // 512-frame ones. The larger cadence settles deeper, and nothing fills
        // the ring toward that depth — the shed only ever enforces it
        // downward. So the reader refills, and publishes nothing until the
        // depth it claims is a depth it was observed to hold.
        let (mut writer, mut reader, latency) = ring(SHAPE);
        let mut destination = out(READ);
        let grown = 512;
        let settled_target = target_depth_frames(BLOCK, READ);
        let grown_target = target_depth_frames(grown, READ);

        for _ in 0..settled_target.div_ceil(BLOCK) + 1 {
            writer.write_block(&block(BLOCK), CHANNELS);
        }
        assert!(reader.read_into(&mut destination));
        assert_eq!(latency.load(Ordering::Relaxed), BLOCK + settled_target);

        writer.write_block(&block(grown), CHANNELS);

        let mut held_before_the_read;
        let mut blocks_at_the_new_size = 1;
        loop {
            held_before_the_read = reader.consumer.slots() / CHANNELS;
            if reader.read_into(&mut destination) {
                break;
            }

            assert_eq!(
                latency.load(Ordering::Relaxed),
                0,
                "a cadence the ring has not filled to has no figure to publish"
            );
            assert!(
                blocks_at_the_new_size < 16,
                "the ring never refilled to the new target"
            );
            writer.write_block(&block(grown), CHANNELS);
            blocks_at_the_new_size += 1;
        }

        assert!(
            held_before_the_read >= grown_target,
            "the figure has to be backed by an observed depth, and the ring \
             held {held_before_the_read} frames against a target of {grown_target}"
        );
        assert_eq!(
            latency.load(Ordering::Relaxed),
            grown + grown_target,
            "the figure has to follow the cadence the device moved to"
        );
        assert_eq!(
            reader.counters().underruns(),
            0,
            "a device changing its block size is not a stall"
        );
    }

    #[test]
    fn a_device_that_shrinks_its_block_size_keeps_the_depth_it_settled_at() {
        // The ceiling does not fall without a stall, so a smaller block asks
        // nothing of the ring: it already holds what the larger block needed.
        // The reader goes on serving every callback, and the figure stays at
        // the depth it settled on — conservative for a take offset, and still
        // true, because the ring really is holding it.
        let (mut writer, mut reader, latency) = ring(SHAPE);
        let mut destination = out(READ);
        let large = 512;
        let large_target = target_depth_frames(large, READ);

        for _ in 0..large_target.div_ceil(large) + 1 {
            writer.write_block(&block(large), CHANNELS);
        }
        assert!(reader.read_into(&mut destination));
        assert_eq!(latency.load(Ordering::Relaxed), large + large_target);

        // Fed at the smaller block size, in balance with the reads, so the
        // only thing that could stop a read being served is the depth rule.
        for _ in 0..8 {
            for _ in 0..large / BLOCK {
                writer.write_block(&block(BLOCK), CHANNELS);
            }
            assert!(
                reader.read_into(&mut destination),
                "a block the settled depth already covers must not stop the ring serving"
            );
            assert_eq!(
                latency.load(Ordering::Relaxed),
                large + large_target,
                "a shrinking block does not shorten a delay the ring is still holding"
            );
        }

        assert_eq!(
            reader.consumer.slots() / CHANNELS,
            large_target,
            "the figure has to name the depth the ring is actually holding"
        );
        assert_eq!(
            reader.counters().samples_shed(),
            0,
            "a target that never moved leaves the shed nothing to do"
        );
        assert_eq!(reader.counters().underruns(), 0);
    }

    #[test]
    fn a_device_that_jitters_its_block_size_is_served_on_every_read() {
        // Alternating block sizes is ordinary, and absorbing it is what the
        // ring is for. A target taken from the last block rather than the
        // largest would deepen on every big block and be shed back down on
        // every small one, leaving half the callbacks unserved for the life of
        // the stream with nothing counted anywhere.
        let (mut writer, mut reader, latency) = ring(SHAPE);
        let mut destination = out(READ);
        let large = 512;
        let large_target = target_depth_frames(large, READ);
        let small_target = target_depth_frames(BLOCK, READ);
        assert!(small_target < large_target, "the two cadences must differ");

        for _ in 0..small_target.div_ceil(BLOCK) + 1 {
            writer.write_block(&block(BLOCK), CHANNELS);
        }
        assert!(reader.read_into(&mut destination));

        // One refill, and only one: the first block bigger than any seen so
        // far is the only thing here that deepens the target.
        writer.write_block(&block(large), CHANNELS);
        let mut refills = 0;
        while !reader.read_into(&mut destination) {
            writer.write_block(&block(large), CHANNELS);
            refills += 1;
            assert!(refills < 16, "the ring never reached the deeper target");
        }
        assert_eq!(latency.load(Ordering::Relaxed), large + large_target);

        // The device now alternates, delivering the same frames between reads
        // either way: one 512-frame block, then four 128-frame ones.
        for round in 0..32 {
            if round % 2 == 0 {
                writer.write_block(&block(large), CHANNELS);
            } else {
                for _ in 0..large / BLOCK {
                    writer.write_block(&block(BLOCK), CHANNELS);
                }
            }

            assert!(
                reader.read_into(&mut destination),
                "round {round} went unserved on a cadence the ring already covers"
            );
            assert_eq!(
                latency.load(Ordering::Relaxed),
                large + large_target,
                "the figure has to hold across the jitter, not follow the last block"
            );
        }

        assert_eq!(reader.counters().underruns(), 0);
    }

    #[test]
    fn a_render_callback_that_jitters_its_slice_is_served_on_every_read() {
        // The output side jitters too: CoreAudio sizes each render callback's
        // buffer, and the engine's own renderer already treats the frame count
        // it is handed as variable. A target taken from the slice in hand
        // would settle shallow on a small callback, shed down to it, and then
        // refuse the next large one — one read in three unserved, with nothing
        // counted anywhere.
        let (mut writer, mut reader, latency) = ring(SHAPE);
        let mut whole = out(READ);
        let mut half = out(READ / 2);
        let target = target_depth_frames(BLOCK, READ);
        assert!(
            target_depth_frames(BLOCK, READ / 2) < target,
            "the two slice sizes must settle at different depths"
        );

        for _ in 0..target.div_ceil(BLOCK) + 1 {
            writer.write_block(&block(BLOCK), CHANNELS);
        }
        assert!(reader.read_into(&mut whole));
        assert_eq!(latency.load(Ordering::Relaxed), BLOCK + target);

        // The writer supplies exactly what each read takes, so the only thing
        // that could stop one being served is the depth rule.
        for round in 0..32 {
            let destination = if round % 2 == 0 {
                &mut whole
            } else {
                &mut half
            };
            for _ in 0..destination.len() / CHANNELS / BLOCK {
                writer.write_block(&block(BLOCK), CHANNELS);
            }

            assert!(
                reader.read_into(destination),
                "round {round} went unserved on a slice the ring already covers"
            );
            assert_eq!(
                latency.load(Ordering::Relaxed),
                BLOCK + target,
                "the figure has to hold across the jitter, not follow the last slice"
            );
        }

        assert_eq!(reader.counters().underruns(), 0);
    }

    #[test]
    fn a_stall_forgets_both_ceilings_so_the_refill_relearns_the_cadence() {
        // The ceilings are what the device and the callback were last seen to
        // be capable of, and a stall is the one place that evidence expires.
        // Kept across one, a stream that dropped to a smaller block or a
        // smaller slice would leave the ring holding out for a depth nothing
        // is going to fill again.
        let (mut writer, mut reader, latency) = ring(SHAPE);
        let mut destination = out(READ);
        let large = 512;
        let large_target = target_depth_frames(large, READ);
        // Smaller on both axes than anything this ring has settled at.
        let relearned_target = target_depth_frames(BLOCK, READ / 2);

        for _ in 0..large_target.div_ceil(large) + 1 {
            writer.write_block(&block(large), CHANNELS);
        }
        assert!(reader.read_into(&mut destination));
        assert_eq!(latency.load(Ordering::Relaxed), large + large_target);

        while reader.read_into(&mut destination) {}
        assert_eq!(reader.counters().underruns(), 1);
        assert_eq!(latency.load(Ordering::Relaxed), 0);

        // Both axes come back smaller. Either ceiling kept across the stall
        // would demand a depth these blocks never reach, and the ring would
        // fill forever.
        let mut smaller = out(READ / 2);
        for _ in 0..relearned_target.div_ceil(BLOCK) {
            writer.write_block(&block(BLOCK), CHANNELS);
        }
        assert!(
            reader.read_into(&mut smaller),
            "the refill has to settle on the cadence both sides are running now"
        );
        assert_eq!(latency.load(Ordering::Relaxed), BLOCK + relearned_target);
        assert_eq!(reader.counters().underruns(), 1);
    }

    #[test]
    fn a_read_that_is_not_a_whole_number_of_frames_is_refused() {
        // The mirror of the partial block the writer refuses: popping a slice
        // that ends mid-frame would rotate which channel every later sample
        // belongs to for the rest of the session. No render callback asks for
        // one; the guard exists because the failure is silent corruption
        // rather than counted loss.
        let (mut writer, mut reader, latency) = ring(SHAPE);
        let mut destination = out(READ);

        for _ in 0..target_depth_frames(BLOCK, READ).div_ceil(BLOCK) + 1 {
            writer.write_block(&block(BLOCK), CHANNELS);
        }
        assert!(reader.read_into(&mut destination));
        let settled_latency = latency.load(Ordering::Relaxed);

        let mut misaligned = vec![0.0f32; READ * CHANNELS + 1];
        assert!(!reader.read_into(&mut misaligned));
        assert_eq!(reader.counters().underruns(), 1);
        assert!(
            misaligned.iter().all(|sample| *sample == 0.0),
            "a refused read hands out no part of the ring"
        );
        assert_eq!(latency.load(Ordering::Relaxed), settled_latency);

        // Still settled, so an ordinary read is served rather than refilled.
        assert!(reader.read_into(&mut destination));
        assert_eq!(reader.counters().underruns(), 1);
    }

    #[test]
    fn a_block_longer_than_the_advertised_ceiling_is_refused() {
        // No device exceeds the maximum its own backend advertised, so this is
        // an invariant guard rather than a recovery. Accepting one would let
        // the settled depth pass the ring's capacity, and the reader would
        // never serve another sample — a permanent silent failure bought for
        // one block the ring was never shaped for.
        let (mut writer, mut reader, _latency) = ring(SHAPE);
        let mut destination = out(READ);

        writer.write_block(&block(SHAPE.input_block_ceiling + 1), CHANNELS);

        assert_eq!(reader.counters().blocks_refused(), 1);
        assert_eq!(
            reader.consumer.slots(),
            0,
            "a refused block writes no part of itself"
        );

        // And it is not evidence of a cadence either: the ring still has none,
        // so a read serves nothing and counts nothing.
        assert!(!reader.read_into(&mut destination));
        assert_eq!(reader.counters().underruns(), 0);
    }

    #[test]
    fn capture_ring_refuses_when_full_and_counts_the_refusal() {
        let (mut writer, reader, _latency) = ring(SHAPE);
        let input = block(BLOCK);

        // Nothing reads, so the ring fills and then has to say so.
        for _ in 0..SHAPE.ring_frames() / BLOCK {
            writer.write_block(&input, CHANNELS);
        }
        assert_eq!(reader.counters().blocks_refused(), 0);

        for _ in 0..SHAPE.ring_frames() / BLOCK {
            writer.write_block(&input, CHANNELS);
        }
        assert!(reader.counters().blocks_refused() > 0);
    }

    #[test]
    fn a_block_whose_layout_is_not_the_ring_s_is_refused_whole() {
        let (mut writer, reader, _latency) = ring(SHAPE);

        writer.write_block(&block(BLOCK), CHANNELS + 1);

        assert_eq!(reader.counters().blocks_refused(), 1);
    }

    #[test]
    fn a_block_carrying_a_partial_frame_is_refused_and_leaves_the_ring_untouched() {
        let (mut writer, reader, _latency) = ring(SHAPE);

        // Half a frame at the end. Written, it would swap which channel every
        // later sample belongs to for the rest of the session.
        let misaligned = vec![0.5f32; BLOCK * CHANNELS + 1];
        writer.write_block(&misaligned, CHANNELS);

        assert_eq!(reader.counters().blocks_refused(), 1);
        assert_eq!(
            reader.consumer.slots(),
            0,
            "a refused block writes no part of itself"
        );

        // A device that jitters its block size is absorbed, not refused: the
        // ring is a sample FIFO, not a queue of fixed-size blocks.
        writer.write_block(&block(BLOCK / 2), CHANNELS);
        assert_eq!(reader.counters().blocks_refused(), 1);
        assert_eq!(reader.consumer.slots(), BLOCK / 2 * CHANNELS);
    }

    #[test]
    fn a_refused_block_is_not_evidence_of_the_cadence() {
        // The observed period decides the settle depth, so a block the ring
        // never took must not move it — a burst of refusals on a full ring
        // would otherwise redefine the cadence from blocks that never landed.
        let (mut writer, mut reader, _latency) = ring(SHAPE);
        let mut destination = out(READ);
        let target = target_depth_frames(BLOCK, READ);

        for _ in 0..target.div_ceil(BLOCK) + 1 {
            writer.write_block(&block(BLOCK), CHANNELS);
        }
        writer.write_block(&block(4096), CHANNELS + 1);

        assert!(reader.read_into(&mut destination));
        assert_eq!(reader.latency_frames(), BLOCK + target);
    }

    #[test]
    fn capture_ring_settles_at_its_target_depth_rather_than_ratcheting() {
        let (mut writer, mut reader, _latency) = ring(SHAPE);
        let input = block(BLOCK);
        let mut destination = out(READ);
        let target_samples = target_depth_frames(BLOCK, READ) * CHANNELS;

        // A writer running faster than the reader is the drift no resampler
        // absorbs here: five blocks pushed for every four the reader takes.
        // Left alone the ring climbs to capacity and stays there, and every
        // captured sample arrives a full ring later than it was played.
        for _ in 0..200 {
            for _ in 0..5 {
                writer.write_block(&input, CHANNELS);
            }
            reader.read_into(&mut destination);
        }

        let depth = reader.consumer.slots();
        assert!(
            depth <= target_samples,
            "capture ring settled at {depth} samples against a target of {target_samples}"
        );
        assert!(
            reader.counters().samples_shed() > 0,
            "holding the depth against a fast writer has to be counted"
        );
        assert_eq!(
            reader.counters().blocks_refused(),
            0,
            "a ring held at its target never reaches the refusal path"
        );
    }

    #[test]
    fn the_shed_takes_at_most_one_observed_block_per_read() {
        let (mut writer, mut reader, _latency) = ring(SHAPE);
        let input = block(BLOCK);
        let mut destination = out(READ);

        // Far enough above the target that one read leaves several blocks of
        // excess: a shed that took all of it would drop a whole burst of
        // captured audio in one callback instead of easing the depth down.
        let filled = target_depth_frames(BLOCK, READ) / BLOCK + READ / BLOCK + 4;
        for _ in 0..filled {
            writer.write_block(&input, CHANNELS);
        }
        assert!(reader.read_into(&mut destination));

        assert_eq!(
            reader.counters().samples_shed() as usize,
            BLOCK * CHANNELS,
            "one pass sheds one observed block, however far above target the ring sits"
        );
    }

    #[test]
    fn a_short_read_underruns_only_once_the_ring_has_settled() {
        let (mut writer, mut reader, latency) = ring(SHAPE);
        let input = block(BLOCK);
        let mut destination = out(READ);
        let blocks_to_target = target_depth_frames(BLOCK, READ) / BLOCK;

        // Below the settle depth the reader hands nothing out and counts
        // nothing: filling is not a shortfall.
        writer.write_block(&input, CHANNELS);
        assert!(!reader.read_into(&mut destination));
        assert_eq!(reader.counters().underruns(), 0);
        assert_eq!(latency.load(Ordering::Relaxed), 0);

        for _ in 0..blocks_to_target {
            writer.write_block(&input, CHANNELS);
        }
        assert!(reader.read_into(&mut destination));
        assert_eq!(reader.counters().underruns(), 0);
        assert_eq!(
            latency.load(Ordering::Relaxed),
            BLOCK + target_depth_frames(BLOCK, READ)
        );

        // Settled and starved: now a short ring is a shortfall, counted once
        // for the read that could not be served, and the figure is retracted
        // because the ring is no longer serving.
        while reader.read_into(&mut destination) {}
        assert_eq!(reader.counters().underruns(), 1);
        assert_eq!(latency.load(Ordering::Relaxed), 0);

        // The stall drops the reader back to filling. One block back is not
        // the settled depth, so this read is refill rather than a second
        // shortfall — a reader that stayed settled would count it as one.
        writer.write_block(&input, CHANNELS);
        assert!(!reader.read_into(&mut destination));
        assert_eq!(
            reader.counters().underruns(),
            1,
            "refilling after a stall is not a shortfall"
        );

        // Once the slack is back, the reader serves again and republishes.
        for _ in 0..blocks_to_target {
            writer.write_block(&input, CHANNELS);
        }
        assert!(reader.read_into(&mut destination));
        assert_eq!(reader.counters().underruns(), 1);
        assert_eq!(
            latency.load(Ordering::Relaxed),
            BLOCK + target_depth_frames(BLOCK, READ)
        );
    }

    #[test]
    fn a_zero_ceiling_still_builds_a_ring_the_reader_can_use() {
        // The seam refuses a zero period; the arithmetic here stays total so a
        // defensive caller gets a small usable ring rather than one of zero
        // capacity that can never hand out a sample.
        let shape = CaptureShape {
            input_block_ceiling: 0,
            output_read_ceiling: 0,
            channels: 0,
        };
        let (mut writer, mut reader, _latency) = ring(shape);
        let mut destination = [0.0f32; 1];

        for _ in 0..target_depth_frames(1, 1) {
            writer.write_block(&[0.25], 1);
        }

        assert!(
            reader.read_into(&mut destination),
            "a zero-capacity ring can never serve a read"
        );
        assert_eq!(reader.counters().blocks_refused(), 0);
    }

    #[test]
    fn what_the_device_wrote_is_what_the_reader_hands_out() {
        let (mut writer, mut reader, _latency) = ring(SHAPE);
        let mut destination = [0.0f32; 8];

        let mut written = 0.0;
        for _ in 0..target_depth_frames(4, 4) / 4 + 1 {
            let period: Vec<f32> = (0..8)
                .map(|_| {
                    written += 1.0;
                    written
                })
                .collect();
            writer.write_block(&period, CHANNELS);
        }

        assert!(reader.read_into(&mut destination));
        assert_eq!(destination, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]);
    }

    /// The allocation guard for the two callbacks on the capture path.
    ///
    /// Both run on real-time threads — the device's capture thread writes and
    /// the audio thread reads — so ADR 0020 forbids either to allocate or
    /// free. The interceptor is installed as the test binary's global
    /// allocator by the scheduler's own guards and exists only in debug
    /// builds (`assert_no_alloc`'s `disable_release` feature is on by
    /// default, so in release `assert_no_alloc(f)` is literally `f()`), which
    /// is why this module is `#[cfg(debug_assertions)]`.
    #[cfg(debug_assertions)]
    mod capture_alloc_guards {
        use super::*;
        use assert_no_alloc::assert_no_alloc;

        #[test]
        fn the_capture_callback_allocates_nothing() {
            let (mut writer, mut reader, _latency) = ring(SHAPE);
            let input = block(BLOCK);
            let misaligned = vec![0.5f32; BLOCK * CHANNELS + 1];
            let mut destination = out(READ);
            let mut oversized = out(SHAPE.ring_frames() + 1);
            let mut misaligned_read = out(READ);
            let oversized_block = block(SHAPE.input_block_ceiling + 1);

            assert_no_alloc(|| {
                // Every arm of both callbacks: the read before any block has
                // arrived, the read the ring could never hold, the read that
                // ends mid-frame, the write that fits, the write the full ring
                // refuses, the write refused for its layout, the one refused
                // for a partial frame and the one refused for exceeding the
                // ceiling, the read below the settle depth, the read that
                // fills, the read that underruns, the republish when the
                // cadence grows, and the shed that holds the depth.
                reader.read_into(&mut destination);
                writer.write_block(&input, CHANNELS);
                writer.write_block(&oversized_block, CHANNELS);
                reader.read_into(&mut oversized);
                reader.read_into(&mut misaligned_read[..READ * CHANNELS - 1]);
                for _ in 0..SHAPE.ring_frames() / BLOCK + 2 {
                    writer.write_block(&input, CHANNELS);
                }
                writer.write_block(&input, CHANNELS + 1);
                writer.write_block(&misaligned, CHANNELS);
                for _ in 0..64 {
                    reader.read_into(&mut destination);
                }
            });

            assert!(reader.counters().blocks_refused() > 0);
            assert!(reader.counters().samples_shed() > 0);
            assert!(reader.counters().underruns() > 0);
        }
    }
}
